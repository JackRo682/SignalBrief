"""Fail-closed SEC statement evidence; no network, model, or publication side effects.

V1 scope is consolidated revenue and operating income in statements of operations.
Other concepts/sections are counted explicitly, never represented as analyzed claims.
Coordinates are zero-based physical table / logical grid row and column positions.
"""

import re
from dataclasses import asdict, dataclass
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from hashlib import sha256

from bs4 import BeautifulSoup

from .errors import ParseError

VERSION = "sec-table-evidence-v1"
CONCEPTS = {
    "RevenueFromContractWithCustomerExcludingAssessedTax": (
        "revenue",
        r"(?:total )?(?:net sales|revenues?|net revenues?)",
    ),
    "SalesRevenueNet": ("revenue", r"(?:total )?(?:net sales|revenues?|net revenues?)"),
    "Revenues": ("revenue", r"(?:total )?(?:net sales|revenues?|net revenues?)"),
    "OperatingIncomeLoss": (
        "operating_income",
        r"(?:total )?operating (?:income|profit|loss)(?:\s*\(loss\))?",
    ),
}
TITLE = re.compile(r"consolidated statements? of (?:operations|income|earnings)", re.I)
MONTHS = {"three": 3, "six": 6, "nine": 9, "twelve": 12}
NUMERIC = re.compile(r"(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?")


@dataclass(frozen=True)
class Cell:
    row: int
    column: int
    rowspan: int
    colspan: int
    text: str


@dataclass(frozen=True)
class TableFact:
    raw_sha256: str
    table: int
    row: int
    column: int
    fact_id: str
    concept: str
    context_ref: str
    entity: str
    unit_ref: str
    scale: int
    field: str
    label: str
    display: str
    value: Decimal
    base_value: Decimal
    unit: str
    period: str
    period_kind: str
    reporting_date: str
    headers: tuple[Cell, ...]
    caption: tuple[str, ...]
    quote: str

    def claim(self, chunk_id):
        from .ai.schemas import ExtractedFact

        return ExtractedFact(
            field=self.field,
            chunk_id=chunk_id,
            quote=self.quote,
            value_raw=format(self.value, "f"),
            unit=self.unit,
            period=self.period,
            scope="consolidated",
            basis="actual",
        )

    def record(self):
        data = asdict(self)
        data["value"], data["base_value"] = str(self.value), str(self.base_value)
        return data


@dataclass
class TableResult:
    raw_sha256: str
    facts: list[TableFact]
    errors: list[dict]
    excluded: list[dict]
    inline_facts_seen: int


def visible(node):
    return not any(
        x.name in ("ix:hidden", "script", "style")
        or x.has_attr("hidden")
        or re.search(r"display\s*:\s*none|visibility\s*:\s*hidden", x.get("style", ""), re.I)
        for x in [node, *node.parents]
        if getattr(x, "attrs", None) is not None
    )


def text(node):
    return " ".join(node.get_text(" ", strip=True).replace("\xa0", " ").split())


def table_grid(table):
    """Expand merged cells without flattening or shifting any numeric columns."""
    grid, origins = {}, {}
    rows = [r for r in table.find_all("tr") if r.find_parent("table") is table]
    if len(rows) > 2000:
        raise ValueError("table_row_limit")
    for row, tr in enumerate(rows):
        col = 0
        for node in tr.find_all(["td", "th"], recursive=False):
            while (row, col) in grid:
                col += 1
            rs, cs = int(node.get("rowspan", 1)), int(node.get("colspan", 1))
            if not (1 <= rs <= 200 and 1 <= cs <= 200 and col + cs <= 500):
                raise ValueError("invalid_table_span")
            cell = Cell(row, col, rs, cs, text(node))
            origins[id(node)] = cell
            for r in range(row, row + rs):
                for c in range(col, col + cs):
                    if (r, c) in grid:
                        raise ValueError("overlapping_table_cells")
                    grid[r, c] = cell
            col += cs
    return grid, origins


def captions(table):
    result = []
    ancestors = {id(x) for x in table.parents}
    for node in table.previous_elements:
        if getattr(node, "name", None) == "table":
            break
        if (
            getattr(node, "name", None) not in ("div", "p", "caption")
            or id(node) in ancestors
            or node.find(["div", "p", "table"])
            or not visible(node)
        ):
            continue
        value = text(node)
        if value:
            result.append(value)
        if TITLE.search(value) or len(result) >= 6:
            break
    if table.caption:
        result.append(text(table.caption))
    return tuple(reversed(result))


def namespace(node, qname):
    if ":" not in qname:
        raise ValueError("unqualified_xbrl_name")
    prefix, local = qname.split(":", 1)
    for parent in [node, *node.parents]:
        if getattr(parent, "attrs", None) and "xmlns:" + prefix in parent.attrs:
            return parent["xmlns:" + prefix], local
    raise ValueError("unknown_xbrl_namespace")


def only(node, name):
    found = node.find_all(name)
    if len(found) != 1:
        raise ValueError("missing_or_ambiguous_" + name)
    return text(found[0])


def read_fact(tag, table_index, table, grid, origins, caption, ids, digest):
    if namespace(tag, "ix:nonfraction")[0] != "http://www.xbrl.org/2013/inlineXBRL":
        raise ValueError("untrusted_inline_namespace")
    uri, concept = namespace(tag, tag["name"])
    if not re.fullmatch(r"https?://fasb.org/us-gaap/\d{4}(?:-\d\d-\d\d)?", uri):
        raise ValueError("untrusted_concept_namespace")
    field, labels = CONCEPTS[concept]
    td = tag.find_parent(["td", "th"])
    if td is None or id(td) not in origins or len(td.find_all("ix:nonfraction")) != 1:
        raise ValueError("ambiguous_numeric_cell")
    cell = origins[id(td)]
    preceding = sorted(
        {v for (r, c), v in grid.items() if r == cell.row and c < cell.column}, key=lambda v: v.column
    )
    label_cells = [v for v in preceding if re.fullmatch(labels, v.text, re.I)]
    if len(label_cells) != 1:
        raise ValueError("missing_or_ambiguous_metric_label")
    # No dimensional segment can silently become a consolidated total.
    context = ids.get(tag.get("contextref"))
    if context is None or context.name != "xbrli:context":
        raise ValueError("missing_xbrl_context")
    if namespace(context, "xbrli:context")[0] != "http://www.xbrl.org/2003/instance":
        raise ValueError("untrusted_context_namespace")
    if context.find(["xbrli:segment", "xbrli:scenario", "xbrldi:explicitmember", "xbrldi:typedmember"]):
        raise ValueError("dimensional_context_not_consolidated")
    entity = only(context, "xbrli:identifier")
    if not re.fullmatch(r"\d{1,10}", entity):
        raise ValueError("invalid_sec_entity")
    identifier = context.find("xbrli:identifier")
    if identifier.get("scheme") != "http://www.sec.gov/CIK":
        raise ValueError("invalid_sec_entity_scheme")
    start, end = (
        date.fromisoformat(only(context, "xbrli:startdate")),
        date.fromisoformat(only(context, "xbrli:enddate")),
    )
    if end <= start or context.find("xbrli:instant"):
        raise ValueError("invalid_duration")
    headers = tuple(
        sorted(
            {
                v
                for (r, c), v in grid.items()
                if r < cell.row
                and cell.column <= c < cell.column + cell.colspan
                and v.text
                and not re.search(r"\d,\d{3}", v.text)
                and (re.search(r"months? ended", v.text, re.I) or re.search(r"\b20\d{2}\b", v.text))
            },
            key=lambda v: (v.row, v.column),
        )
    )
    dates, months = set(), set()
    for h in headers:
        for match in re.finditer(
            r"(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+20\d{2}",
            h.text,
            re.I,
        ):
            dates.add(datetime.strptime(match.group(), "%B %d, %Y").date())
        for match in re.finditer(r"\b(three|six|nine|twelve|3|6|9|12) months? ended\b", h.text, re.I):
            months.add(MONTHS.get(match[1].lower(), int(match[1]) if match[1].isdigit() else 0))
    if dates != {end} or len(months) != 1:
        raise ValueError("html_xbrl_period_mismatch")
    duration = next(iter(months))
    if not (duration * 28 - 7 <= (end - start).days + 1 <= duration * 31 + 7):
        raise ValueError("html_xbrl_duration_mismatch")
    unit = ids.get(tag.get("unitref"))
    if unit is None or unit.name != "xbrli:unit" or unit.find("xbrli:divide"):
        raise ValueError("missing_or_complex_unit")
    if namespace(unit, "xbrli:unit")[0] != "http://www.xbrl.org/2003/instance":
        raise ValueError("untrusted_unit_namespace")
    measure = only(unit, "xbrli:measure")
    unit_uri, currency = namespace(unit, measure)
    if unit_uri != "http://www.xbrl.org/2003/iso4217" or currency != "USD":
        raise ValueError("unsupported_currency")
    scale = int(tag.get("scale", "0"))
    if scale not in (0, 6, 9):
        raise ValueError("unsupported_scale")
    scale_word = {0: "dollars", 6: "millions", 9: "billions"}[scale]
    if not any(re.search(r"\bin " + scale_word + r"\b", c, re.I) for c in caption):
        raise ValueError("html_xbrl_scale_mismatch")
    if "$" not in text(table):
        raise ValueError("missing_html_currency")
    if tag.get("xsi:nil") in ("true", "1") or tag.find("ix:exclude") or tag.get("continuedat"):
        raise ValueError("unsupported_inline_value")
    fmt_uri, fmt = namespace(tag, tag.get("format", ""))
    if fmt_uri not in (
        "http://www.xbrl.org/inlineXBRL/transformation/2020-02-12",
        "http://www.xbrl.org/inlineXBRL/transformation/2022-02-16",
    ) or fmt not in ("num-dot-decimal", "fixed-zero"):
        raise ValueError("unsupported_inline_transformation")
    display = text(tag)
    if fmt == "fixed-zero":
        if display not in ("-", "—", "–"):
            raise ValueError("invalid_zero_dash")
        magnitude = Decimal(0)
    else:
        if not NUMERIC.fullmatch(display):
            raise ValueError("invalid_decimal_lexical_value")
        magnitude = Decimal(display.replace(",", ""))
    if tag.get("sign", "") not in ("", "-"):
        raise ValueError("invalid_inline_sign")
    negative = tag.get("sign") == "-"
    rendered = text(td).replace(" ", "")
    html_negative = rendered.startswith("(") and rendered.endswith(")") or rendered.startswith("-")
    if magnitude and negative != html_negative:
        raise ValueError("html_xbrl_sign_mismatch")
    value = -magnitude if negative else magnitude
    fact_id = tag.get("id")
    if not fact_id:
        raise ValueError("missing_inline_fact_id")
    # Delimit separate original fragments explicitly; this is never called a contiguous quote.
    quote = f"[SEC table {table_index}, row {cell.row}, column {cell.column}; reconstructed cell excerpts]\n"
    quote += "\n".join(caption) + "\n"
    quote += "\n".join(f"[header r{h.row} c{h.column}] {h.text}" for h in headers)
    quote += f"\n[label r{label_cells[0].row} c{label_cells[0].column}] {label_cells[0].text}"
    quote += f"\n[value r{cell.row} c{cell.column}] {text(td)}"
    quote += f"\n[XBRL {fact_id}] {tag['name']}; context={tag['contextref']}; unit={measure}; scale={scale}; {start}/{end}"
    return TableFact(
        digest,
        table_index,
        cell.row,
        cell.column,
        fact_id,
        tag["name"],
        tag["contextref"],
        entity,
        tag["unitref"],
        scale,
        field,
        label_cells[0].text,
        text(td),
        value,
        value * Decimal(10) ** scale,
        {0: "USD", 6: "USD million", 9: "USD billion"}[scale],
        f"{start}/{end}",
        "quarter" if duration == 3 else "annual" if duration == 12 else "year_to_date",
        str(end),
        headers,
        caption,
        quote,
    )


def parse_sec_tables(raw: bytes) -> TableResult:
    if len(raw) > 4_000_000:
        raise ParseError("sec_table_document_limit")
    source = raw.decode("utf-8-sig")
    if "<!ENTITY" in source.upper() or re.search(r"<!DOCTYPE[^>]+SYSTEM", source, re.I):
        raise ParseError("external_entity_rejected")
    soup = BeautifulSoup(source, "html.parser")
    digest = sha256(raw).hexdigest()
    facts, errors, excluded, ids = [], [], [], {}
    for tag in soup.find_all(id=True):
        if tag["id"] in ids:
            raise ParseError("duplicate_xml_id")
        ids[tag["id"]] = tag
    tags = soup.find_all("ix:nonfraction")
    tables = {id(t): (i, t) for i, t in enumerate(soup.find_all("table"))}
    cache = {}
    for tag in tags:
        local = tag.get("name", "").split(":")[-1]
        if local not in CONCEPTS:
            excluded.append({"id": tag.get("id"), "reason": "concept_outside_v1_scope"})
            continue
        table = tag.find_parent("table")
        if table is None or not visible(tag):
            excluded.append({"id": tag.get("id"), "reason": "outside_visible_statement_table"})
            continue
        index, _ = tables[id(table)]
        caption = captions(table)
        if not any(TITLE.search(c) for c in caption):
            excluded.append({"id": tag.get("id"), "reason": "outside_consolidated_operations_statement"})
            continue
        context = ids.get(tag.get("contextref"))
        if context and context.find(["xbrli:segment", "xbrli:scenario"]):
            excluded.append({"id": tag.get("id"), "reason": "dimensional_segment_not_consolidated"})
            continue
        try:
            if index not in cache:
                cache[index] = table_grid(table)
            grid, origins = cache[index]
            facts.append(read_fact(tag, index, table, grid, origins, caption, ids, digest))
        except (ValueError, KeyError, InvalidOperation) as exc:
            errors.append({"id": tag.get("id"), "table": index, "reason": str(exc)})
    if not facts and not errors:
        errors.append({"reason": "no_supported_statement_facts"})
    # An untagged/empty amount in a recognized metric row is a coverage error,
    # not a reason to quietly publish the remaining convenient cells.
    for index, (grid, origins) in cache.items():
        table = next(t for i, t in tables.values() if i == index)
        for node in table.find_all(["td", "th"]):
            label = origins.get(id(node))
            if not label or not any(
                re.fullmatch(pattern, label.text, re.I) for _, pattern in CONCEPTS.values()
            ):
                continue
            date_headers = {
                c
                for c in grid.values()
                if c.row < label.row and re.fullmatch(r"[A-Za-z]+ \d{1,2}, 20\d{2}", c.text)
            }
            for h in date_headers:
                cells = {grid.get((label.row, c)) for c in range(h.column, h.column + h.colspan)}
                ids_in_cells = {id(n) for n in table.find_all(["td", "th"]) if origins.get(id(n)) in cells}
                bound = [
                    f
                    for f in table.find_all("ix:nonfraction")
                    if id(f.find_parent(["td", "th"])) in ids_in_cells
                    and f.get("name", "").split(":")[-1] in CONCEPTS
                ]
                if len(bound) != 1:
                    errors.append(
                        {
                            "table": index,
                            "row": label.row,
                            "column": h.column,
                            "reason": "missing_or_ambiguous_inline_cell_coverage",
                        }
                    )
    return TableResult(digest, facts, errors, excluded, len(tags))


def validate_table_claim(claim: TableFact, raw: bytes) -> bool:
    """Replay the original bytes, including coordinates, headers and hidden resources."""
    if sha256(raw).hexdigest() != claim.raw_sha256:
        return False
    result = parse_sec_tables(raw)
    return not result.errors and claim in result.facts
