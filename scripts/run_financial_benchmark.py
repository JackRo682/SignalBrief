"""Offline B by default. A/C require explicit paid approval, model/rates and isolated budget DB."""

import argparse
import hashlib
import json
import os
import statistics
import subprocess
import time
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

from signalbrief.ai.client import StructuredLLM, Usage
from signalbrief.db import create_development_schema, make_engine, session_factory
from signalbrief.errors import EvidenceError, ParseError, ProviderError
from signalbrief.financial_benchmark import (
    Brief,
    deterministic_brief,
    load_manifest,
    original,
    reference_candidates,
    score,
    validate_interpretation,
)
from signalbrief.settings import Settings

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--method", choices=["A", "B", "C"], default="B")
    parser.add_argument("--split", choices=["development", "held_out"], default="development")
    parser.add_argument("--unlock-held-out", action="store_true")
    parser.add_argument("--approve-paid-usd", type=Decimal, default=Decimal(0))
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        parser.error("Refusing to overwrite an existing run")
    if args.split == "held_out" and not args.unlock_held_out:
        parser.error("Held-out is sealed; freeze code/prompts and explicitly unlock for a one-shot run")
    manifest = load_manifest(ROOT)
    llm = None
    if args.method != "B":
        if args.approve_paid_usd <= 0:
            parser.error("Paid calls require an operator-approved budget; no calls made")
        # Do not inherit any production database, service key or automatic publishing configuration.
        settings = Settings(
            _env_file=None,
            environment="test",
            demo_mode=True,
            auth_mode="demo",
            storage_mode="local",
            demo_seed_on_start=False,
            auto_publish_validated=False,
            database_url="sqlite:///" + str(ROOT / "var/financial-eval-budget.db"),
            openai_api_key=os.environ.get("SB_OPENAI_API_KEY", ""),
            openai_model=os.environ.get("SB_OPENAI_MODEL", ""),
            openai_input_usd_per_million=os.environ.get("SB_OPENAI_INPUT_USD_PER_MILLION"),
            openai_output_usd_per_million=os.environ.get("SB_OPENAI_OUTPUT_USD_PER_MILLION"),
            ai_total_budget_usd=args.approve_paid_usd,
            max_retries=0,
        )
        (ROOT / "var").mkdir(exist_ok=True)
        engine = make_engine(settings)
        create_development_schema(engine, settings)
        llm = StructuredLLM(settings, session_factory(engine))
    records = []
    for pair in manifest["pairs"]:
        if pair["split"] != args.split:
            continue
        sources = [manifest["sources"][pair[k]] for k in ("previous", "current")]
        # Reference candidate construction is outside the timed method and never in model input.
        raws = [original(ROOT, s) for s in sources]
        try:
            references = [
                f
                for raw, source in zip(raws, sources, strict=True)
                for f in reference_candidates(raw, source)
            ]
        except EvidenceError:
            references = None
        record = {
            "pair_id": pair["id"],
            "method": args.method,
            "split": args.split,
            "status": "BLOCKED",
            "reference_status": "human_review_pending",
            "actual_billed_cost_usd": None,
            "api_usage_cost_estimate_usd": "0" if not llm else None,
            "model": None,
            "usage": None,
            "scores": None,
            "references": references,
        }
        started = time.perf_counter()
        if llm:
            llm.usage = Usage()
        try:
            if args.method == "A":
                brief = llm.call(
                    Brief,
                    "benchmark-direct-v1",
                    {
                        "task": "Compare current-quarter revenue and operating income year over year",
                        "sources": [
                            {
                                "accession": s["accession"],
                                "url": s["url"],
                                "report_date": s["report_date"],
                                "original_html": raw.decode("utf-8-sig"),
                            }
                            for raw, s in zip(raws, sources, strict=True)
                        ],
                    },
                )
            else:
                brief = deterministic_brief(raws, sources)
                if args.method == "C":
                    baseline = brief
                    brief = llm.call(Brief, "benchmark-linked-v1", baseline.model_dump())
                    record["raw_model_output"] = brief.model_dump()
                    if not validate_interpretation(brief, baseline):
                        raise EvidenceError("interpretation_validation_failed")
            record["output"] = brief.model_dump()
            record["status"] = "ABSTAIN" if brief.abstain else "COMPLETED"
            if references:
                record["scores"] = score(brief, references)
        except (EvidenceError, ParseError, ProviderError) as exc:
            record["status"] = "ABSTAIN"
            record["reason"] = str(exc)
            if references:
                record["scores"] = score(
                    Brief(facts=[], changes=[], interpretations=[], abstain=True, reason=str(exc)), references
                )
        finally:
            record["offline_end_to_end_ms"] = (time.perf_counter() - started) * 1000
            if llm:
                record["usage"] = vars(llm.usage)
                record["model"] = llm.usage.model_version
                cost = llm.usage.cost(settings)
                record["api_usage_cost_estimate_usd"] = str(cost) if cost is not None else None
        records.append(record)
    if llm:
        llm.close()
        engine.dispose()
    scored = [r["scores"] for r in records if r["scores"]]
    totals = {
        key: sum(s[key] for s in scored)
        for key in (
            "numeric_correct",
            "numeric_slots",
            "citation_correct",
            "citation_slots",
            "comparison_correct",
            "comparison_slots",
            "unsupported_claims",
            "total_claims",
            "interpretation_claims",
            "useful_completion",
        )
    }
    latencies = sorted(r["offline_end_to_end_ms"] for r in records)
    report = {
        "code_sha256": {
            str(p.relative_to(ROOT)).replace("\\", "/"): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in [
                Path(__file__).resolve(),
                ROOT / "apps/api/signalbrief/financial_benchmark.py",
                ROOT / "apps/api/signalbrief/sec_tables.py",
                ROOT / "apps/api/signalbrief/changes.py",
                *sorted((ROOT / "apps/api/signalbrief/prompts").glob("benchmark-*.txt")),
            ]
        },
        "configuration": {
            "requested_model": settings.openai_model if llm else None,
            "input_usd_per_million": settings.openai_input_usd_per_million if llm else None,
            "output_usd_per_million": settings.openai_output_usd_per_million if llm else None,
            "max_output_tokens": 5000 if llm else None,
            "max_retries": 0,
            "source_download_in_latency": False,
        },
        "run_at": datetime.now(timezone.utc).isoformat(),
        "code_base_sha": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
        "working_tree_dirty": bool(subprocess.check_output(["git", "status", "--porcelain"], cwd=ROOT)),
        "manifest_sha256": (ROOT / "evals/financial-v1/manifest.sha256").read_text().strip(),
        "method": args.method,
        "split": args.split,
        "pairs": len(records),
        "human_verified_accuracy": None,
        "actual_billed_cost_per_brief_usd": None,
        "safe_abstention_accuracy": None,
        "limitations": [
            "No independent human labels; scores are machine-reference agreement only",
            "Latency includes parsing/method execution, excludes source download and reference creation",
            "A/C unexecuted without explicit budget; B is not an AI response",
            "Historical held-out filings may be in model pretraining; not contamination-free",
        ],
        "counts": totals,
        "latency_ms_median": statistics.median(latencies),
        "latency_ms_p95_nearest_rank": latencies[max(0, (95 * len(latencies) + 99) // 100 - 1)],
        "paid_requests": sum((r["usage"] or {}).get("requests", 0) for r in records),
        "records": records,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({k: v for k, v in report.items() if k != "records"}, indent=2))


if __name__ == "__main__":
    main()
