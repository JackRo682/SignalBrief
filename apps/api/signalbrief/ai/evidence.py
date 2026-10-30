import re
from decimal import Decimal, InvalidOperation, localcontext

from .schemas import CitationVerdict, ExtractedFact

VALIDATOR_VERSION = "bound-evidence-numeric-v3"
NUMBER = re.compile(r"(?<![\w.])(?:\(\s*[+-]?\d[\d,]*(?:\.\d+)?\s*\)|[+-]?\d[\d,]*(?:\.\d+)?)(?![\w.])")
KEYWORDS = {
    "revenue": ("revenue", "net sales", "매출"),
    "operating_income": ("operating income", "operating profit", "영업이익", "영업손익"),
    "guidance": ("guidance", "outlook", "가이던스", "전망"),
    "capex": ("capex", "capital expenditure", "capital spending", "설비투자", "시설투자"),
    "dividend": ("dividend", "배당"),
    "management_change": ("management", "chief executive", "ceo", "대표이사", "경영진"),
    "risk_change": ("risk", "uncertainty", "위험", "리스크", "불확실"),
}
UNIT_ALIASES = {
    "USD": ("usd", "us$", "$"),
    "USD million": ("usd million", "$ million", "$ in millions", "us$ million", "달러 백만"),
    "USD billion": ("usd billion", "$ billion", "$ in billions", "us$ billion"),
    "KRW": ("krw", "원"),
    "KRW million": ("krw million", "백만원", "백만 원"),
    "KRW billion": ("krw billion", "십억원", "십억 원"),
    "KRW 억원": ("억원", "억 원"),
    "%": ("%", "percent", "퍼센트"),
    "shares": ("shares", "주식", "주"),
}

UNIT_SCALES = {
    "USD": ("USD", Decimal(1)),
    "USD million": ("USD", Decimal(1_000_000)),
    "USD billion": ("USD", Decimal(1_000_000_000)),
    "KRW": ("KRW", Decimal(1)),
    "KRW million": ("KRW", Decimal(1_000_000)),
    "KRW billion": ("KRW", Decimal(1_000_000_000)),
    "KRW 억원": ("KRW", Decimal(100_000_000)),
    "%": ("percentage_point", Decimal(1)),
    "shares": ("shares", Decimal(1)),
}
PERIOD = re.compile(
    r"(?<!\w)(?:FY\d{4}|\d{4}-Q[1-4]|Q[1-4]|(?:first|second|third|fourth|1st|2nd|3rd|4th)\s+quarter)(?!\w)",
    re.I,
)


def metric_matches(text, field):
    pattern = "|".join(re.escape(word) for word in sorted(KEYWORDS[field], key=len, reverse=True))
    return list(re.finditer(r"(?<!\w)(?:" + pattern + r")(?!\w)", text, re.I))


def bound_numeric_claim(fact):
    """Accept a single explicit metric/value/unit relation; ambiguous prose needs review."""
    quote = fact.quote.casefold()
    fields = {"revenue", "operating_income", "capex", "dividend"}
    if fact.field == "guidance":
        fields.add("guidance")
    mentioned = {field for field in fields if metric_matches(quote, field)}
    matches = metric_matches(quote, fact.field)
    if mentioned != {fact.field} or len(matches) != 1:
        return False
    periods = {match.group().casefold() for match in PERIOD.finditer(quote)}
    if fact.period and not PERIOD.fullmatch(fact.period.casefold()):
        return False
    if periods and (not fact.period or periods != {fact.period.casefold()}):
        return False
    scopes = {
        name
        for name, words in {
            "consolidated": ("consolidated", "연결"),
            "separate": ("separate", "별도", "개별"),
        }.items()
        if any(re.search(r"(?<!\w)" + re.escape(word) + r"(?!\w)", quote) for word in words)
    }
    if len(scopes) > 1 or (fact.scope != "unknown" and scopes != {fact.scope}):
        return False
    if "actual" in quote and any(word in quote for word in ("guidance", "outlook", "가이던스", "전망")):
        return False
    # Exclude explicit reporting-period tokens, not financial quantities.
    cleaned = PERIOD.sub(lambda match: " " * len(match.group()), quote)
    values = list(NUMBER.finditer(cleaned))
    if len(values) != 1 or number(values[0].group()) != number(fact.value_raw):
        return False
    metric, value = matches[0], values[0]
    if fact.period:
        # The period belongs to this metric/value clause, never a later pending-results clause.
        boundaries = list(re.finditer(r"[;\n]|(?<!\d)\.(?!\d)", quote))
        start = max((m.end() for m in boundaries if m.end() <= metric.start()), default=0)
        end = min((m.start() for m in boundaries if m.start() >= value.end()), default=len(quote))
        clause_periods = {m.group().casefold() for m in PERIOD.finditer(quote[start : value.start()])}
        # Deterministic fixture records have explicit semicolon-separated key/value metadata.
        metadata = re.search(r";\s*period\s*=\s*(" + PERIOD.pattern + r")\s*(?:;|$)", quote[end:], re.I)
        if clause_periods != {fact.period.casefold()} and not (
            not clause_periods and metadata and metadata.group(1).casefold() == fact.period.casefold()
        ):
            return False
    if metric.end() > value.start():
        return False
    connector = cleaned[metric.end() : value.start()]
    connector = re.sub(r"[\s:=,()]+", " ", connector).strip()
    allowed = {
        "was",
        "is",
        "were",
        "are",
        "of",
        "at",
        "for",
        "totaled",
        "totalled",
        "reached",
        "stood",
        "amounted",
        "to",
        "guidance",
        "outlook",
        "consolidated",
        "separate",
        "actual",
    }
    if connector and any(word not in allowed for word in connector.split()):
        return False
    suffix = quote[value.end() :].lstrip()
    aliases = sorted(
        ((alias.casefold(), unit) for unit, names in UNIT_ALIASES.items() for alias in (*names, unit)),
        key=lambda item: len(item[0]),
        reverse=True,
    )
    units = [unit for alias, unit in aliases if re.match(re.escape(alias) + r"(?!\w)", suffix)]
    return bool(units) and units[0] == fact.unit


def number(value: str) -> Decimal:
    raw = value.strip().replace(",", "").replace("−", "-")
    if raw.startswith("(") and raw.endswith(")"):
        raw = "-" + raw[1:-1].strip()
    if not re.fullmatch(r"[+-]?\d+(?:\.\d+)?", raw) or len(raw) > 60:
        raise ValueError("invalid_numeric_token")
    try:
        result = Decimal(raw)
    except InvalidOperation:
        raise ValueError("invalid_numeric_token") from None
    if not result.is_finite():
        raise ValueError("non_finite_number")
    return result


def numeric_tokens(text: str) -> set[Decimal]:
    tokens = set()
    for match in NUMBER.finditer(text):
        try:
            tokens.add(number(match.group()))
        except ValueError:
            pass
    return tokens


def validate_fact(fact: ExtractedFact, chunks: dict[str, str], key: str) -> CitationVerdict:
    def verdict(status, reason):
        return CitationVerdict(status=status, reason=reason, claim_key=key)

    source = chunks.get(fact.chunk_id)
    if source is None:
        return verdict("missing_source", "Referenced chunk does not belong to this document")
    from .sec_table_evidence import PREFIX, validate_sec_fact

    if source.startswith(PREFIX):
        return validate_sec_fact(fact, source, key)
    if fact.quote not in source:
        return verdict("unsupported", "Quotation is not an exact contiguous substring of the cited chunk")
    lowered = fact.quote.casefold()
    if not any(word in lowered for word in KEYWORDS[fact.field]):
        return verdict("partially_supported", "Metric/semantic label is not explicit in the quoted evidence")
    if fact.value_raw is not None:
        try:
            value = number(fact.value_raw)
        except ValueError:
            return verdict("numeric_mismatch", "Invalid financial number representation")
        if value not in numeric_tokens(fact.quote):
            return verdict(
                "numeric_mismatch", "Reported value is not present as a numeric token in the quote"
            )
        if fact.unit is None or not any(alias in lowered for alias in UNIT_ALIASES[fact.unit]):
            return verdict("partially_supported", "Currency/unit is not explicit in the same quotation")
        if fact.unit == "USD" and re.search(r"\b(million|billion|thousand)s?\b", lowered):
            return verdict(
                "partially_supported", "Unscaled USD conflicts with an explicit magnitude in the quote"
            )
        if fact.unit == "KRW" and any(
            x in lowered for x in ("억원", "억 원", "백만원", "백만 원", "million", "billion")
        ):
            return verdict(
                "partially_supported", "Unscaled KRW conflicts with an explicit magnitude in the quote"
            )
        if fact.basis == "actual" and any(w in lowered for w in ("guidance", "outlook", "가이던스", "전망")):
            return verdict(
                "partially_supported", "Actual classification conflicts with explicit forward guidance"
            )
        if fact.period and fact.period.casefold() not in lowered:
            return verdict("partially_supported", "Reporting period is not explicit in the same quotation")
        if fact.scope != "unknown":
            scope_words = (
                ("consolidated", "연결") if fact.scope == "consolidated" else ("separate", "별도", "개별")
            )
            if not any(word in lowered for word in scope_words):
                return verdict(
                    "partially_supported", "Accounting scope is not explicit in the same quotation"
                )
        if fact.basis == "guidance" and not any(
            w in lowered for w in ("guidance", "outlook", "가이던스", "전망")
        ):
            return verdict("partially_supported", "Guidance classification lacks quoted support")
        if not bound_numeric_claim(fact):
            return verdict(
                "partially_supported", "Metric, value, unit and period are not one unambiguous bound claim"
            )
    elif fact.field not in ("management_change", "risk_change"):
        return verdict("partially_supported", "Numeric field has no supported numeric value")
    return verdict(
        "supported",
        "Exact quotation, explicit metric label, and numeric/context checks passed; semantic review still applies",
    )


def conflicting_facts(facts: list[ExtractedFact]) -> set[int]:
    groups = {}
    for index, fact in enumerate(facts):
        if fact.value_raw is None or not fact.period or fact.unit not in UNIT_SCALES:
            continue
        dimension, scale = UNIT_SCALES[fact.unit]
        key = (fact.field, dimension, fact.period.casefold(), fact.scope, fact.basis)
        with localcontext() as context:
            context.prec = 80
            value = number(fact.value_raw) * scale
        groups.setdefault(key, {}).setdefault(value, set()).add(index)
    return {
        index
        for values in groups.values()
        if len(values) > 1
        for indexes in values.values()
        for index in indexes
    }


def validate_extractive_answer(answer, source_quotes: dict[str, str]):
    if answer.abstain:
        return []
    accepted = []
    for quote in answer.quotes:
        source = source_quotes.get(quote.source_id)
        if not source or len(quote.quote.strip()) < 5 or quote.quote not in source:
            return []  # Fail the entire answer, not just a convenient unsupported clause.
        accepted.append(quote.model_dump())
    return accepted
