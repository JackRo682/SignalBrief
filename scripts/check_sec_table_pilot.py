"""Offline first-filing reference comparison. Never calls APIs or reads .env."""

import gzip
import json
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace

from signalbrief.ai.client import PROMPTS
from signalbrief.ai.schemas import ExtractionBatch
from signalbrief.ai.sec_table_evidence import SCOPE, SecTableExtractor, evidence_source, replay_source
from signalbrief.changes import compare
from signalbrief.sec_tables import VERSION

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "tests/fixtures/sec"
TARGET = ROOT / "verification/sec-tables-20261008"


class CaptureRequest:
    def call(self, schema, prompt_name, data):
        self.payload = {
            "model": "gpt-4.1-mini-2025-04-14",
            "store": False,
            "input": [
                {"role": "system", "content": (PROMPTS / (prompt_name + ".txt")).read_text(encoding="utf-8")},
                {"role": "user", "content": json.dumps(data, ensure_ascii=False)},
            ],
            "text": {
                "format": {
                    "type": "json_schema",
                    "name": schema.__name__,
                    "schema": schema.model_json_schema(),
                    "strict": True,
                }
            },
            "max_output_tokens": 5000,
        }
        return ExtractionBatch(event_type="earnings", facts=[], scheduled_dates=[])


def main():
    raw = gzip.decompress((FIXTURES / "aapl-20260328.htm.gz").read_bytes())
    reference = json.loads((FIXTURES / "aapl-20260328.reference.json").read_text())
    source = evidence_source(raw)
    parsed = replay_source(source)
    matches = []
    for field, values in reference["expected"].items():
        facts = [f for f in parsed.facts if f.field == field]
        matches.extend(
            f.value == Decimal(v) and f.period == period and f.unit == reference["unit"]
            for f, v, period in zip(facts, values, reference["periods"], strict=True)
        )
    capture = CaptureRequest()
    SecTableExtractor(capture).extract(
        [SimpleNamespace(id="00000000-0000-4000-8000-000000000000", text=source, parser_version=VERSION)]
    )
    input_bound = len(json.dumps(capture.payload, ensure_ascii=False).encode("utf-8")) + 4096
    reservation = (Decimal(input_bound) * Decimal("0.4") + Decimal(5000) * Decimal("1.6")) / 1_000_000
    comparisons = []
    for field in reference["expected"]:
        current, previous = [f for f in parsed.facts if f.field == field][:2]

        def operand(f):
            return SimpleNamespace(id=f.fact_id, **f.claim("source").model_dump())

        comparisons.append(compare(operand(previous), operand(current)))
    report = {
        "status": "PASS_OFFLINE_SCOPED_PARSER" if all(matches) and len(matches) == 8 else "FAIL",
        "end_to_end_status": "FAIL_NOT_COMPLETED",
        "source_url": reference["source_url"],
        "raw_sha256": parsed.raw_sha256,
        "scope": SCOPE,
        "reference_status": reference["review_status"],
        "checked_facts": len(matches),
        "matched_facts": sum(matches),
        "inline_facts_seen": parsed.inline_facts_seen,
        "excluded_from_scope": len(parsed.excluded),
        "facts": [f.record() for f in parsed.facts],
        "within_filing_yoy_examples": comparisons,
        "new_paid_calls": 0,
        "new_input_tokens": 0,
        "new_output_tokens": 0,
        "new_estimated_usage_cost_usd": "0",
        "next_request_reservation_usd": str(reservation),
        "cost_assumption": "Configured text rates: input 0.4/output 1.6 USD per million; reservation is not measured use",
        "outstanding": [
            "user_approval_before_paid_call",
            "independent_human_reference_review",
            "live_model_extraction",
            "second_filing_and_cross_filing_comparison",
            "hosted_approval_and_today_browser",
            "live_nonadmin_and_user_isolation",
        ],
        "ten_pairs_started": False,
    }
    TARGET.mkdir(exist_ok=True)
    (TARGET / "offline.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(
        json.dumps(
            {
                k: report[k]
                for k in (
                    "status",
                    "end_to_end_status",
                    "checked_facts",
                    "matched_facts",
                    "new_paid_calls",
                    "next_request_reservation_usd",
                )
            }
        )
    )
    return 0 if report["status"] == "PASS_OFFLINE_SCOPED_PARSER" else 1


if __name__ == "__main__":
    raise SystemExit(main())
