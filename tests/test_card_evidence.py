from types import SimpleNamespace as Row

import pytest
from signalbrief.card_evidence import headline_fact


@pytest.mark.parametrize("mode", ["change", "no_history", "stale", "ambiguous", "unsupported"])
def test_preview_matches_headline_metric_and_current_quarter(mode):
    facts = [
        Row(
            id="a",
            field="operating_income",
            period="2026-03-29/2026-06-27",
            quote="Operating income 35,695",
            validation_status="supported",
        ),
        Row(
            id="b",
            field="revenue",
            period="2025-03-30/2025-06-28",
            quote="Total net sales 94,036",
            validation_status="supported",
        ),
        Row(
            id="c",
            field="revenue",
            period="2025-09-28/2026-06-27",
            quote="Total net sales 364,357",
            validation_status="supported",
        ),
        Row(
            id="z",
            field="revenue",
            period="2026-03-29/2026-06-27",
            quote="Total net sales 109,417",
            validation_status="supported",
        ),
    ]
    changes = [
        Row(
            field="revenue",
            change_type="decreased",
            percentage_change="-1.5893",
            materiality=0.03,
            current_fact_id="z",
        )
    ]
    headline = "매출 감소 -1.5893%"
    if mode == "no_history":
        headline, changes = "매출 확인 · 비교 근거 추가 필요", []
    elif mode == "stale":
        changes[0].current_fact_id = "b"
    elif mode == "ambiguous":
        facts.append(Row(**{**vars(facts[-1]), "id": "zz"}))
        changes.append(Row(**{**vars(changes[0]), "current_fact_id": "zz"}))
    elif mode == "unsupported":
        facts[-1].validation_status = "unsupported"
    result = headline_fact(headline, list(reversed(facts)), changes, Row(title="Apple filing", is_demo=False))
    if mode in ("change", "no_history"):
        assert result.id == "z" and "109,417" in result.quote
    else:
        assert result is None
