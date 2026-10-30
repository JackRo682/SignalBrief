"""Synthetic adversarial cases; the separate Apple fixture is a real SEC excerpt."""

import gzip
import json
from dataclasses import replace
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace

import pytest
from signalbrief.ai.evidence import validate_fact
from signalbrief.ai.sec_table_evidence import complete_table_coverage, evidence_source, replay_source
from signalbrief.changes import compare, comparison_kind
from signalbrief.parser import normalized_text
from signalbrief.sec_tables import parse_sec_tables, validate_table_claim

FIXTURES = Path(__file__).parent / "fixtures/sec"


def filing(value="1,234", scale="6", sign="", end="2026-03-28", unit="iso4217:USD"):
    return f'''<html xmlns:ix="http://www.xbrl.org/2013/inlineXBRL"
      xmlns:us-gaap="http://fasb.org/us-gaap/2025"
      xmlns:xbrli="http://www.xbrl.org/2003/instance"
      xmlns:ixt="http://www.xbrl.org/inlineXBRL/transformation/2020-02-12"
      xmlns:iso4217="http://www.xbrl.org/2003/iso4217">
    <div style="display:none"><ix:header><ix:resources>
    <xbrli:context id="c"><xbrli:entity><xbrli:identifier scheme="http://www.sec.gov/CIK">0000320193</xbrli:identifier></xbrli:entity>
    <xbrli:period><xbrli:startDate>2025-12-28</xbrli:startDate><xbrli:endDate>{end}</xbrli:endDate></xbrli:period></xbrli:context>
    <xbrli:unit id="usd"><xbrli:measure>{unit}</xbrli:measure></xbrli:unit>
    </ix:resources></ix:header></div>
    <div>CONDENSED CONSOLIDATED STATEMENTS OF OPERATIONS</div><div>In millions</div>
    <table><tr><th rowspan="2">Metric</th><th colspan="2">Three Months Ended</th></tr>
    <tr><th colspan="2">March 28, 2026</th></tr>
    <tr><td>Total net sales</td><td>$</td><td><ix:nonFraction id="f1" name="us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax" contextRef="c" unitRef="usd" scale="{scale}" sign="{sign}" format="ixt:num-dot-decimal">{value}</ix:nonFraction></td></tr>
    </table></html>'''.encode()


def test_table_headers_and_hidden_xbrl_resources_survive():
    result = parse_sec_tables(filing())
    assert not result.errors
    fact = result.facts[0]
    assert fact.field == "revenue"
    assert fact.value == Decimal("1234") and fact.base_value == Decimal("1234000000")
    assert fact.unit == "USD million"
    assert fact.period == "2025-12-28/2026-03-28"
    assert fact.period_kind == "quarter"
    assert fact.row == 2 and fact.column == 2
    assert [h.text for h in fact.headers] == ["Three Months Ended", "March 28, 2026"]
    assert validate_table_claim(fact, filing())
    assert not validate_table_claim(replace(fact, value=Decimal("1235")), filing())
    assert not validate_table_claim(replace(fact, quote=fact.quote.replace("1,234", "1,235")), filing())


@pytest.mark.parametrize(
    "edit",
    [
        dict(scale="9"),
        dict(end="2026-06-27"),
        dict(unit="iso4217:EUR"),
        dict(value="(1,234)", sign=""),
        dict(value="1,234", sign="-"),
    ],
)
def test_html_and_xbrl_disagreement_is_blocked(edit):
    result = parse_sec_tables(filing(**edit))
    assert result.errors and not result.facts


def test_parentheses_and_ix_sign_apply_once():
    raw = (
        filing()
        .replace(b"Total net sales", b"Operating income")
        .replace(b"RevenueFromContractWithCustomerExcludingAssessedTax", b"OperatingIncomeLoss")
        .replace(b"<ix:nonFraction", b"(<ix:nonFraction")
        .replace(b"</ix:nonFraction>", b"</ix:nonFraction>)")
        .replace(b'sign=""', b'sign="-"')
    )
    result = parse_sec_tables(raw)
    assert not result.errors
    assert result.facts[0].value == Decimal("-1234")


@pytest.mark.parametrize(
    "old,new",
    [
        (b"Total net sales", b"Unknown metric"),
        (b"In millions", b"Units unavailable"),
        (b"March 28, 2026", b"Date unavailable"),
        (b"ixt:num-dot-decimal", b"ixt:unsupported"),
        (b'contextRef="c"', b'contextRef="missing"'),
        (b"http://fasb.org/us-gaap/2025", b"https://attacker.invalid/taxonomy"),
    ],
)
def test_missing_or_untrusted_context_fails_closed(old, new):
    result = parse_sec_tables(filing().replace(old, new))
    assert result.errors and not result.facts


def test_original_apple_statement_reference_and_legacy_failure():
    raw = gzip.decompress((FIXTURES / "aapl-20260328.htm.gz").read_bytes())
    ref = json.loads((FIXTURES / "aapl-20260328.reference.json").read_text())
    result = parse_sec_tables(raw)
    assert result.raw_sha256 == ref["raw_sha256"]
    assert not result.errors and len(result.facts) == 8
    assert result.inline_facts_seen == len(result.facts) + len(result.excluded) == 756
    for field, values in ref["expected"].items():
        actual = [f for f in result.facts if f.field == field]
        assert [str(f.value) for f in actual] == values
        assert [f.period for f in actual] == ref["periods"]
        assert all(f.unit == ref["unit"] and f.row == ref["rows"][field] for f in actual)
    fact = result.facts[0].claim("source")
    legacy = normalized_text(raw, "text/html")
    row = next(line for line in legacy.splitlines() if line.startswith("Total net sales"))
    legacy_fact = fact.model_copy(update={"quote": row})
    # Real old failure: the numeric row exists, but its detached unit/header does not.
    assert validate_fact(legacy_fact, {"source": legacy}, "fact:0").status == "partially_supported"
    source = evidence_source(raw)
    assert validate_fact(fact, {"source": source}, "fact:0").status == "supported"
    assert fact.quote in source  # Existing hosted approval substring guard still holds.


@pytest.mark.parametrize(
    "field,value",
    [
        ("value_raw", "999999"),
        ("unit", "USD billion"),
        ("period", "2026-Q1"),
        ("scope", "separate"),
        ("basis", "guidance"),
        ("field", "operating_income"),
        ("quote", "Fabricated quotation of 1234 dollars"),
    ],
)
def test_replayed_source_rejects_every_changed_claim_dimension(field, value):
    source = evidence_source(filing())
    fact = replay_source(source).facts[0].claim("chunk")
    wrong = fact.model_copy(update={field: value})
    assert validate_fact(wrong, {"chunk": source}, "f").status == "unsupported"


def test_envelope_tampering_omission_and_missing_inline_cells():
    source = evidence_source(filing())
    fact = replay_source(source).facts[0].claim("chunk")
    assert validate_fact(fact, {"chunk": source.replace("1,234", "9,999", 1)}, "f").status == "unsupported"
    assert not complete_table_coverage([], {"chunk": source})
    assert not complete_table_coverage([fact, fact], {"chunk": source})
    assert complete_table_coverage([fact], {"chunk": source})
    raw = filing().replace(
        b"</tr>\n    </table>", b"</tr><tr><td>Operating income</td><td>$</td><td>100</td></tr></table>"
    )
    result = parse_sec_tables(raw)
    assert any(e["reason"] == "missing_or_ambiguous_inline_cell_coverage" for e in result.errors)


def test_exact_fiscal_intervals_do_not_compare_cumulative_to_quarter():
    def fact(period, value):
        return SimpleNamespace(
            id=period,
            field="revenue",
            value_raw=value,
            unit="USD million",
            period=period,
            scope="consolidated",
            basis="actual",
            quote="source",
        )

    p = fact("2025-12-28/2026-03-28", "111184")
    c = fact("2026-03-29/2026-06-27", "120000")  # Synthetic arithmetic test, not Apple results.
    assert comparison_kind(p, c) == "quarter_over_quarter"
    assert compare(p, c)["absolute_change"] == "8816"
    assert compare(p, c)["percentage_change"] == "7.9292"
    assert (
        comparison_kind(fact("2025-09-28/2026-03-28", "254940"), fact("2025-09-28/2026-06-27", "1")) is None
    )
    assert (
        comparison_kind(fact("2024-09-29/2025-03-29", "219659"), fact("2025-09-28/2026-03-28", "254940"))
        == "year_over_year"
    )


def test_real_second_filing_reference_and_pair_arithmetic():
    results = []
    for stem in ("aapl-20260328", "aapl-20260627"):
        raw = gzip.decompress((FIXTURES / (stem + ".htm.gz")).read_bytes())
        ref = json.loads((FIXTURES / (stem + ".reference.json")).read_text())
        result = parse_sec_tables(raw)
        assert result.raw_sha256 == ref["raw_sha256"]
        assert not result.errors and len(result.facts) == 8
        for field, values in ref["expected"].items():
            facts = [f for f in result.facts if f.field == field]
            assert [str(f.value) for f in facts] == values
            assert [f.period for f in facts] == ref["periods"]
            assert all(f.unit == ref["unit"] for f in facts)
        results.append(result)
    for field, delta, percentage in (
        ("revenue", "-1767", "-1.5893"),
        ("operating_income", "-190", "-0.5295"),
    ):
        old, new = [[f for f in r.facts if f.field == field] for r in results]

        def operand(f):
            return SimpleNamespace(id=f.fact_id, **f.claim("source").model_dump())

        change = compare(operand(old[0]), operand(new[0]))
        assert change["comparison_kind"] == "quarter_over_quarter"
        assert change["absolute_change"] == delta
        assert change["percentage_change"] == percentage
        assert comparison_kind(operand(old[2]), operand(new[2])) is None
