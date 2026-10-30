"""Real-original benchmark primitives. Machine agreement is not human accuracy.

The reference reader deliberately does not call the production table parser.
It reads undimensioned inline XBRL and is only a candidate for human adjudication.
"""

import gzip
import hashlib
import json
from datetime import date
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
from typing import Literal

from bs4 import BeautifulSoup
from pydantic import BaseModel, ConfigDict

from .changes import compare
from .errors import EvidenceError
from .sec_tables import parse_sec_tables

FIELDS = {
    "RevenueFromContractWithCustomerExcludingAssessedTax": "revenue",
    "SalesRevenueNet": "revenue",
    "Revenues": "revenue",
    "OperatingIncomeLoss": "operating_income",
}


class Fact(BaseModel):
    model_config = ConfigDict(extra="forbid")
    field: Literal["revenue", "operating_income"]
    value: str
    unit: Literal["USD"]
    period: str
    accession: str
    fact_id: str
    quote: str


class Change(BaseModel):
    model_config = ConfigDict(extra="forbid")
    field: Literal["revenue", "operating_income"]
    previous_fact_id: str
    current_fact_id: str
    comparison_kind: str
    absolute_change: str
    percentage_change: str | None


class Interpretation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str
    previous_fact_id: str
    current_fact_id: str


class Brief(BaseModel):
    model_config = ConfigDict(extra="forbid")
    facts: list[Fact]
    changes: list[Change]
    interpretations: list[Interpretation]
    abstain: bool
    reason: str


def load_manifest(root: Path):
    path = root / "evals/financial-v1/manifest.json"
    raw = path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != path.with_suffix(".sha256").read_text().strip():
        raise EvidenceError("manifest_hash_mismatch")
    manifest = json.loads(raw)
    groups = [
        {p[key] for p in manifest["pairs"] if p["split"] == split for key in ("previous", "current")}
        for split in ("development", "held_out")
    ]
    if groups[0] & groups[1]:
        raise EvidenceError("split_source_leakage")
    hashes = [{manifest["sources"][a]["raw_sha256"] for a in group} for group in groups]
    if hashes[0] & hashes[1]:
        raise EvidenceError("split_byte_leakage")
    return manifest


def original(root, source):
    path = (root / source["path"]).resolve()
    if not path.is_relative_to(root.resolve()):
        raise EvidenceError("original_path_escape")
    with gzip.open(path, "rb") as stream:
        raw = stream.read(25_000_001)
    if len(raw) > 25_000_000 or hashlib.sha256(raw).hexdigest() != source["raw_sha256"]:
        raise EvidenceError("original_hash_mismatch")
    return raw


def reference_candidates(raw, source):
    """Independent automated XBRL candidate reader, never human ground truth."""
    soup = BeautifulSoup(raw, "html.parser")
    facts = []
    for tag in soup.find_all("ix:nonfraction"):
        local = tag.get("name", "").split(":")[-1]
        if local not in FIELDS:
            continue
        context = soup.find("xbrli:context", id=tag.get("contextref"))
        if context is None or context.find(["xbrli:segment", "xbrli:scenario"]):
            continue
        start, end = context.find("xbrli:startdate"), context.find("xbrli:enddate")
        if not start or not end or end.text != source["report_date"]:
            continue
        if not 77 <= (date.fromisoformat(end.text) - date.fromisoformat(start.text)).days + 1 <= 100:
            continue
        entity = context.find("xbrli:identifier")
        unit = soup.find("xbrli:unit", id=tag.get("unitref"))
        if not entity or entity.text.zfill(10) != source["cik"] or not unit:
            continue
        measure = unit.find("xbrli:measure")
        if not measure or measure.text != "iso4217:USD":
            continue
        if tag.get("xsi:nil") in ("true", "1") or tag.get("continuedat"):
            continue
        lexical = tag.get_text("", strip=True).replace(",", "")
        if lexical in ("—", "–", "-") and tag.get("format", "").endswith("fixed-zero"):
            lexical = "0"
        try:
            amount = Decimal(lexical) * Decimal(10) ** int(tag.get("scale", 0))
        except (ValueError, ArithmeticError):
            continue
        if tag.get("sign") == "-":
            amount = -amount
        if not amount.is_finite():
            continue
        facts.append(
            {
                "field": FIELDS[local],
                "value": str(amount),
                "unit": "USD",
                "period": f"{start.text}/{end.text}",
                "accession": source["accession"],
                "fact_id": tag.get("id"),
                "quote": tag.get_text(" ", strip=True),
                "concept": tag["name"],
                "context": tag["contextref"],
                "scale": tag.get("scale", "0"),
                "entity": entity.text,
                "status": "machine_candidate_human_review_pending",
            }
        )
    selected = []
    for field in ("revenue", "operating_income"):
        candidates = [f for f in facts if f["field"] == field]
        if not candidates or len({(f["value"], f["period"]) for f in candidates}) != 1:
            raise EvidenceError("ambiguous_reference_" + field)
        selected.append(candidates[0])
    return selected


def deterministic_brief(raws, sources):
    facts = []
    for raw, source in zip(raws, sources, strict=True):
        parsed = parse_sec_tables(raw)
        soup = BeautifulSoup(raw, "html.parser")
        if parsed.errors:
            raise EvidenceError("table_errors:" + ",".join(sorted({e["reason"] for e in parsed.errors})))
        for field in ("revenue", "operating_income"):
            selected = [
                f
                for f in parsed.facts
                if f.field == field
                and f.period_kind == "quarter"
                and f.reporting_date == source["report_date"]
                and f.entity.zfill(10) == source["cik"]
            ]
            signatures = {(f.base_value, f.period, f.unit, f.entity) for f in selected}
            if not selected or len(signatures) != 1:
                raise EvidenceError("missing_or_ambiguous_quarter:" + field)
            # Repeated consolidated totals with identical context are not conflicting values.
            # Preserve the first original location deterministically; reject any disagreement.
            f = selected[0]
            facts.append(
                Fact(
                    field=field,
                    value=str(f.base_value),
                    unit="USD",
                    period=f.period,
                    accession=source["accession"],
                    fact_id=f.fact_id,
                    quote=soup.find(id=f.fact_id).get_text(" ", strip=True),
                )
            )
    changes = []
    for old, new in zip(facts[:2], facts[2:], strict=True):

        def operand(f):
            return SimpleNamespace(
                id=f.fact_id,
                field=f.field,
                value_raw=f.value,
                unit=f.unit,
                period=f.period,
                scope="consolidated",
                basis="actual",
                quote=f.quote,
            )

        change = compare(operand(old), operand(new))
        if change["comparison_kind"] != "year_over_year":
            raise EvidenceError("unexpected_comparison_kind")
        changes.append(Change(**{k: change[k] for k in Change.model_fields}))
    return Brief(facts=facts, changes=changes, interpretations=[], abstain=False, reason="")


def canonical_interpretation(change):
    return (
        f"{change.field}: {change.comparison_kind}; change USD {change.absolute_change}; "
        f"percent {change.percentage_change if change.percentage_change is not None else 'undefined'}."
    )


def validate_interpretation(brief, baseline):
    # This deliberately conservative entailment gate supports arithmetic statements only.
    if brief.abstain:
        return False
    if brief.facts != baseline.facts or brief.changes != baseline.changes:
        return False
    expected = {
        (canonical_interpretation(c), c.previous_fact_id, c.current_fact_id) for c in baseline.changes
    }
    actual = [(i.text, i.previous_fact_id, i.current_fact_id) for i in brief.interpretations]
    return len(actual) == len(expected) and set(actual) == expected


def score(brief, references):
    """Missing/extra/duplicate facts remain in denominators; no gold claims."""
    keys = [(r["accession"], r["field"], r["period"]) for r in references]
    predicted = [(f.accession, f.field, f.period) for f in brief.facts]
    matched, citations = 0, 0
    for key, ref in zip(keys, references, strict=True):
        values = [f for f in brief.facts if (f.accession, f.field, f.period) == key]
        if len(values) != 1:
            continue
        f = values[0]
        try:
            equal = (
                Decimal(f.value).is_finite() and Decimal(f.value) == Decimal(ref["value"]) and f.unit == "USD"
            )
        except ArithmeticError:
            equal = False
        matched += equal
        # Fact id plus value/context/source identity is required, not URL presence.
        citations += equal and f.fact_id == ref["fact_id"] and ref["quote"] == f.quote
    slots = (
        len(keys)
        + sum(k not in keys for k in predicted)
        + sum(max(0, predicted.count(k) - 1) for k in set(keys))
    )
    correct_changes = 0
    for field in ("revenue", "operating_income"):
        refs = [r for r in references if r["field"] == field]
        candidates = [c for c in brief.changes if c.field == field]
        if len(refs) != 2 or len(candidates) != 1:
            continue
        old, new = refs
        prior, current = Decimal(old["value"]), Decimal(new["value"])
        delta = current - prior
        pct = (delta / prior * 100).quantize(Decimal("0.0001")) if prior > 0 else None
        c = candidates[0]
        try:
            correct_changes += (
                c.previous_fact_id == old["fact_id"]
                and c.current_fact_id == new["fact_id"]
                and c.comparison_kind == "year_over_year"
                and Decimal(c.absolute_change) == delta
                and (
                    c.percentage_change is None
                    if pct is None
                    else Decimal(c.percentage_change or "NaN") == pct
                )
            )
        except ArithmeticError:
            pass
    supported_text = (
        {(canonical_interpretation(c), c.previous_fact_id, c.current_fact_id) for c in brief.changes}
        if correct_changes == 2
        else set()
    )
    unsupported = sum(
        (i.text, i.previous_fact_id, i.current_fact_id) not in supported_text for i in brief.interpretations
    )
    change_slots = max(2, len(brief.changes))
    return {
        "numeric_correct": matched,
        "numeric_slots": slots,
        "citation_correct": citations,
        "citation_slots": max(len(references), len(brief.facts)),
        "comparison_correct": correct_changes,
        "comparison_slots": change_slots,
        "unsupported_claims": len(brief.facts)
        - citations
        + len(brief.changes)
        - correct_changes
        + unsupported,
        "total_claims": len(brief.facts) + len(brief.changes) + len(brief.interpretations),
        "interpretation_claims": len(brief.interpretations),
        "useful_completion": not brief.abstain
        and matched == slots
        and citations == len(references)
        and correct_changes == change_slots
        and unsupported == 0,
        "reference_status": "automated_candidate_not_human_ground_truth",
    }
