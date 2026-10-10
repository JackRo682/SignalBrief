"""Offline original-byte replay and cost envelope; never invokes a paid API."""

import gzip
import json
from decimal import Decimal
from hashlib import sha256
from pathlib import Path
from types import SimpleNamespace

from signalbrief.ai.sec_table_evidence import SecTableExtractor, evidence_source
from signalbrief.sec_tables import VERSION, parse_sec_tables

from scripts.check_sec_table_pilot import CaptureRequest

ROOT = Path(__file__).resolve().parents[1]


def main():
    result = {"new_paid_calls": 0, "sources": [], "human_review": "BLOCKED_PENDING_ATTESTATION"}
    for name in ("aapl-20260328", "aapl-20260627"):
        root = ROOT / "tests/fixtures/sec"
        raw = gzip.decompress((root / (name + ".htm.gz")).read_bytes())
        reference = json.loads((root / (name + ".reference.json")).read_text())
        parsed = parse_sec_tables(raw)
        matches = []
        for field, expected in reference["expected"].items():
            facts = [f for f in parsed.facts if f.field == field]
            matches.extend(
                f.value == Decimal(value) and f.period == period and f.unit == reference["unit"]
                for f, value, period in zip(facts, expected, reference["periods"], strict=True)
            )
        capture = CaptureRequest()
        SecTableExtractor(capture).extract(
            [
                SimpleNamespace(
                    id="00000000-0000-4000-8000-000000000000",
                    parser_version=VERSION,
                    text=evidence_source(raw),
                )
            ]
        )
        bound = len(json.dumps(capture.payload, ensure_ascii=False).encode("utf-8")) + 4096
        reservation = (Decimal(bound) * Decimal("0.4") + Decimal(5000) * Decimal("1.6")) / 1000000
        ok = not parsed.errors and len(matches) == 8 and all(matches)
        ok = ok and sha256(raw).hexdigest() == reference["raw_sha256"]
        result["sources"].append(
            {
                "name": name,
                "status": "PASS" if ok else "FAIL",
                "source_url": reference["source_url"],
                "raw_sha256": parsed.raw_sha256,
                "matched_facts": sum(matches),
                "input_token_upper_bound": bound,
                "max_output_tokens": 5000,
                "per_attempt_reservation_usd": str(reservation),
                "facts": [
                    {
                        "field": f.field,
                        "value": str(f.value),
                        "period": f.period,
                        "unit": f.unit,
                        "table": f.table,
                        "row": f.row,
                        "column": f.column,
                        "context": f.context_ref,
                    }
                    for f in parsed.facts
                ],
            }
        )
    result["cost"] = {
        "model": "gpt-4.1-mini-2025-04-14",
        "input_usd_per_million": "0.4",
        "output_usd_per_million": "1.6",
        "prior_observed_pair_input_tokens": 8416,
        "prior_observed_pair_output_tokens": 3656,
        "prior_observed_pair_cost_usd": "0.009216",
        "ten_new_pairs_baseline_usd": "0.092160",
        "nine_additional_pairs_baseline_usd": "0.082944",
        "ten_pairs_one_full_retry_usd": "0.184320",
        "ten_pairs_three_attempts_usd": "0.276480",
        "caveat": "Extrapolation from one Apple pair; excludes tax, FX, hosting and human review. Actual inputs vary.",
    }
    target = ROOT / "verification/final-20261009"
    target.mkdir(parents=True, exist_ok=True)
    (target / "sec-and-cost.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(
        json.dumps(
            {
                "sources": [
                    {k: s[k] for k in ("name", "status", "matched_facts", "per_attempt_reservation_usd")}
                    for s in result["sources"]
                ],
                "new_paid_calls": 0,
            }
        )
    )
    return int(any(s["status"] != "PASS" for s in result["sources"]))


if __name__ == "__main__":
    raise SystemExit(main())
