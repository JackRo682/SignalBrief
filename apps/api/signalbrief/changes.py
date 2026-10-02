"""Deterministic comparison with accounting-context matching and two-sided evidence."""

import re
from decimal import Decimal

from .ai.evidence import UNIT_SCALES as UNITS
from .ai.evidence import number


def decimal_string(value: Decimal) -> str:
    return format(value.normalize(), "f")


def comparison_kind(previous, current):
    if previous.field != current.field:
        return None
    if current.value_raw is None and previous.value_raw is None:
        return "wording_comparison" if current.field in ("risk_change", "management_change") else None
    if previous.value_raw is None or current.value_raw is None:
        return None
    if (
        previous.unit not in UNITS
        or current.unit not in UNITS
        or UNITS[previous.unit][0] != UNITS[current.unit][0]
    ):
        return None
    if previous.scope != current.scope or current.scope == "unknown":
        return None
    if previous.basis != current.basis or current.basis == "unknown":
        return None
    if not previous.period or not current.period:
        return None
    if previous.period == current.period:
        return "same_period_revision"
    if current.basis == "guidance":
        return None  # Guidance for different target periods is not a like-for-like revision.
    p, c = re.fullmatch(r"FY(\d{4})", previous.period), re.fullmatch(r"FY(\d{4})", current.period)
    if p and c and int(c[1]) - int(p[1]) == 1:
        return "year_over_year"
    p, c = (
        re.fullmatch(r"(\d{4})-Q([1-4])", previous.period),
        re.fullmatch(r"(\d{4})-Q([1-4])", current.period),
    )
    if p and c:
        if c[2] == p[2] and int(c[1]) - int(p[1]) == 1:
            return "year_over_year"
        if int(c[1]) * 4 + int(c[2]) - (int(p[1]) * 4 + int(p[2])) == 1:
            return "quarter_over_quarter"
    return None


def compare(previous, current) -> dict:
    empty = {
        "field": current.field,
        "current_fact_id": current.id,
        "previous_fact_id": None,
        "change_type": "insufficient_history",
        "comparison_kind": None,
        "previous_value": None,
        "current_value": current.value_raw or current.quote,
        "absolute_change": None,
        "percentage_change": None,
        "materiality": 0.15,
        "confidence": 0.5,
    }
    if previous is None:
        return empty
    kind = comparison_kind(previous, current)
    if kind is None:
        return {**empty, "change_type": "incomparable_context"}
    result = {
        **empty,
        "previous_fact_id": previous.id,
        "comparison_kind": kind,
        "previous_value": previous.value_raw or previous.quote,
        "confidence": 0.85,
    }
    if kind == "wording_comparison":
        changed = previous.quote != current.quote
        return {
            **result,
            "change_type": "wording_changed" if changed else "unchanged",
            "materiality": 0.4 if changed else 0.05,
            "confidence": 0.65,
        }
    prior = number(previous.value_raw) * UNITS[previous.unit][1]
    value = number(current.value_raw) * UNITS[current.unit][1]
    delta = value - prior
    delta_current_units = delta / UNITS[current.unit][1]
    # Relative growth from <=0 is often misleading; never divide by zero or invert its meaning.
    percent = delta / prior * 100 if prior > 0 and current.unit != "%" else None
    magnitude = (
        float(min(abs(percent or Decimal(0)) / 50, 1)) if percent is not None else (0.4 if delta else 0.05)
    )
    return {
        **result,
        "change_type": "increased" if delta > 0 else "decreased" if delta < 0 else "unchanged",
        "absolute_change": decimal_string(delta_current_units),
        "percentage_change": decimal_string(percent.quantize(Decimal("0.0001")))
        if percent is not None
        else None,
        "materiality": magnitude,
    }
