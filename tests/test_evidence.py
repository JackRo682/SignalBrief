from decimal import Decimal
from types import SimpleNamespace

import pytest
from pydantic import ValidationError
from signalbrief.ai.evidence import (
    conflicting_facts,
    number,
    numeric_tokens,
    validate_extractive_answer,
    validate_fact,
)
from signalbrief.ai.schemas import ExtractedFact, ExtractionBatch, ExtractiveAnswer
from signalbrief.changes import compare, comparison_kind

QUOTE = "Revenue: 120 USD million; period=FY2026; scope=consolidated; basis=guidance."


def fact(**changes):
    return ExtractedFact(
        **(
            {
                "field": "revenue",
                "chunk_id": "chunk-a",
                "quote": QUOTE,
                "value_raw": "120",
                "unit": "USD million",
                "period": "FY2026",
                "scope": "consolidated",
                "basis": "guidance",
            }
            | changes
        )
    )


def row(**changes):
    return SimpleNamespace(id="test-fact", **fact(**changes).model_dump())


@pytest.mark.parametrize(
    "raw,value",
    [
        ("1,234.50", "1234.50"),
        ("(42)", "-42"),
        ("−9", "-9"),
        ("+2.5", "2.5"),
        ("0", "0"),
        (" 10 ", "10"),
        ("(1,500.4)", "-1500.4"),
    ],
)
def test_number(raw, value):
    assert number(raw) == Decimal(value)


@pytest.mark.parametrize("raw", ["NaN", "inf", "1e7", "", "$2", "1.2.3", "--3", "9" * 61, "123abc"])
def test_bad_number(raw):
    with pytest.raises(ValueError):
        number(raw)


def test_numeric_boundaries():
    values = numeric_tokens("FY2026 vs revenue 120 USD; 12.5%; 1,200 and (15)")
    assert Decimal(2026) not in values
    assert {Decimal(120), Decimal("12.5"), Decimal(1200), Decimal(-15)} <= values


@pytest.mark.parametrize(
    "changes,expected",
    [
        ({}, "supported"),
        ({"chunk_id": "foreign"}, "missing_source"),
        ({"quote": "Revenue is 999 USD million now."}, "unsupported"),
        ({"value_raw": "121"}, "numeric_mismatch"),
        ({"value_raw": "NaN"}, "numeric_mismatch"),
        ({"period": "FY2025"}, "partially_supported"),
        ({"scope": "separate"}, "partially_supported"),
        ({"basis": "actual"}, "partially_supported"),
        ({"unit": "KRW 억원"}, "partially_supported"),
        ({"unit": "USD"}, "partially_supported"),
        ({"unit": None}, "partially_supported"),
        ({"value_raw": None}, "partially_supported"),
        ({"field": "capex"}, "partially_supported"),
    ],
)
def test_fact_guards(changes, expected):
    assert validate_fact(fact(**changes), {"chunk-a": QUOTE}, "fact:0").status == expected


def test_wrong_number_substring_not_accepted():
    assert validate_fact(fact(value_raw="20"), {"chunk-a": QUOTE}, "0").status == "numeric_mismatch"


def test_reject_arbitrary_model_keys():
    with pytest.raises(ValidationError):
        ExtractionBatch.model_validate(
            {"event_type": "earnings", "facts": [], "scheduled_dates": [], "buy_now": True}
        )


def test_conflicting_values():
    assert conflicting_facts([fact(), fact(value_raw="999")]) == {0, 1}


def test_identical_facts_not_conflicting():
    assert conflicting_facts([fact(), fact()]) == set()


@pytest.mark.parametrize(
    "quote,abstain,accepted",
    [(QUOTE, False, True), ("Fabricated support", False, False), (QUOTE, True, False), ("x", False, False)],
)
def test_answer_quote_gate(quote, abstain, accepted):
    answer = ExtractiveAnswer(quotes=[{"source_id": "s", "quote": quote}], abstain=abstain)
    assert bool(validate_extractive_answer(answer, {"s": QUOTE})) is accepted


def test_numeric_change_two_sides():
    previous = row(value_raw="100")
    previous.id = "old"
    current = row()
    result = compare(previous, current)
    assert result["percentage_change"] == "20" and result["absolute_change"] == "20"
    assert result["previous_fact_id"] == "old" and result["current_fact_id"] == "test-fact"


@pytest.mark.parametrize(
    "before,after,percent",
    [("0", "20", None), ("-10", "20", None), ("100", "80", "-20"), ("100", "100", "0"), ("80", "120", "50")],
)
def test_change_math(before, after, percent):
    assert compare(row(value_raw=before), row(value_raw=after))["percentage_change"] == percent


def test_normalize_units():
    result = compare(row(value_raw="1", unit="USD billion"), row(value_raw="1200", unit="USD million"))
    assert result["absolute_change"] == "200" and result["percentage_change"] == "20"


def test_percentage_points_not_relative_growth():
    result = compare(row(value_raw="10", unit="%"), row(value_raw="12", unit="%"))
    assert result["absolute_change"] == "2" and result["percentage_change"] is None


@pytest.mark.parametrize(
    "changes",
    [
        {"scope": "separate"},
        {"scope": "unknown"},
        {"unit": "KRW 억원"},
        {"period": "FY2027"},
        {"period": None},
        {"basis": "actual"},
        {"field": "capex"},
    ],
)
def test_incomparable_accounting_context(changes):
    assert comparison_kind(row(), row(**changes)) is None


@pytest.mark.parametrize(
    "before,after,kind",
    [
        ("FY2025", "FY2026", "year_over_year"),
        ("2025-Q4", "2026-Q1", "quarter_over_quarter"),
        ("2025-Q1", "2026-Q1", "year_over_year"),
        ("FY2024", "FY2026", None),
    ],
)
def test_actual_period_matching(before, after, kind):
    assert comparison_kind(row(period=before, basis="actual"), row(period=after, basis="actual")) == kind


def test_missing_history():
    change = compare(None, row())
    assert change["change_type"] == "insufficient_history" and change["previous_fact_id"] is None


def test_semantic_change_is_label_not_freeform_claim():
    old = row(field="risk_change", value_raw=None, unit=None, quote="Risk: supplier concentration increased.")
    current = row(
        field="risk_change", value_raw=None, unit=None, quote="Risk: supplier concentration remains elevated."
    )
    change = compare(old, current)
    assert change["change_type"] == "wording_changed" and change["percentage_change"] is None
