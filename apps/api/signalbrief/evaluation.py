"""Transparent regression evaluation. Synthetic cases are NEVER a real-world gold benchmark."""

import json
import time
from collections import Counter
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
from statistics import mean
from types import SimpleNamespace

from . import models as m
from .ai.client import LiveExtractor, StructuredLLM
from .ai.demo_extractor import DemoExtractor
from .ai.evidence import number, numeric_tokens, validate_extractive_answer, validate_fact
from .ai.schemas import ExtractionBatch, ExtractiveAnswer
from .changes import compare

SUPPORTED_METRICS = (
    "event_classification_macro_f1",
    "fact_extraction_accuracy",
    "change_detection_accuracy",
    "citation_coverage",
    "citation_correctness",
    "numeric_consistency",
    "hallucination_rate",
    "abstention_accuracy",
    "latency_ms_mean",
    "cost_usd",
)


def ratio(n, d):
    return n / d if d else None


def macro_f1(expected, predicted):
    labels = sorted(set(expected) | set(predicted))
    values = []
    for label in labels:
        tp = sum(x == label and y == label for x, y in zip(expected, predicted))
        fp = sum(x != label and y == label for x, y in zip(expected, predicted))
        fn = sum(x == label and y != label for x, y in zip(expected, predicted))
        values.append(2 * tp / (2 * tp + fp + fn) if 2 * tp + fp + fn else 0)
    return mean(values) if values else None


def evaluate_cases(cases, extractor):
    expected_types = []
    predicted_types = []
    records = []
    latencies = []
    totals = Counter()
    for case in cases:
        started = time.monotonic()
        chunk = SimpleNamespace(id="current", text=case["source_text"])
        previous = SimpleNamespace(id="previous", text=case.get("previous_source_text", ""))
        batch = ExtractionBatch.model_validate(extractor.extract([chunk]))
        expected_types.append(case["expected"]["event_type"])
        predicted_types.append(batch.event_type)
        # Matching uses actual extractor output; no expected values are supplied to the extractor.
        gold = {tuple(x) for x in case["expected"]["facts"]}
        predicted = {(f.field, f.value_raw, f.unit, f.period, f.scope, f.basis) for f in batch.facts}
        totals["fact_correct"] += len(gold & predicted)
        totals["fact_slots"] += len(gold | predicted)
        clean = [validate_fact(f, {chunk.id: chunk.text}, str(i)) for i, f in enumerate(batch.facts)]
        totals["claims"] += len(batch.facts)
        totals["cited"] += sum(v.status == "supported" for v in clean)
        totals["numeric"] += sum(f.value_raw is not None for f in batch.facts)
        totals["numeric_ok"] += sum(
            f.value_raw is not None and number(f.value_raw) in numeric_tokens(f.quote) for f in batch.facts
        )
        old_batch = ExtractionBatch.model_validate(extractor.extract([previous])) if previous.text else None
        changes = []
        for index, current in enumerate(batch.facts):
            old = next((x for x in old_batch.facts if x.field == current.field), None) if old_batch else None
            change = compare(
                SimpleNamespace(id="old", **old.model_dump()) if old else None,
                SimpleNamespace(id="new-" + str(index), **current.model_dump()),
            )
            changes.append({k: change[k] for k in ("field", "change_type", "percentage_change")})
        if "changes" in case["expected"]:
            totals["change_cases"] += 1
            totals["change_correct"] += changes == case["expected"]["changes"]
        mutation = case.get("validator_mutation")
        candidate = [f.model_copy(deep=True) for f in batch.facts]
        if mutation and candidate:
            f = candidate[0]
            if mutation == "wrong_number":
                f.value_raw = "999999999"
            elif mutation == "missing_source":
                f.chunk_id = "foreign-document"
            elif mutation == "wrong_quote":
                f.quote = "Revenue: 999999999 USD; fabricated support."
            elif mutation == "wrong_unit":
                f.unit = "shares"
            elif mutation == "wrong_period":
                f.period = "FY1901"
        verdicts = [validate_fact(f, {chunk.id: chunk.text}, str(i)) for i, f in enumerate(candidate)]
        predicted_publish = bool(candidate) and all(x.status == "supported" for x in verdicts)
        expected_publish = case["expected"]["publish_after_mutation"]
        totals["validator_cases"] += 1
        totals["validator_correct"] += predicted_publish == expected_publish
        totals["published_candidate_cases"] += predicted_publish
        totals["false_accepted_cases"] += predicted_publish and not expected_publish
        totals["adversarial_cases"] += not expected_publish
        # This is extractive-answer abstention, not unrestricted model abstention quality.
        candidate_answer = ExtractiveAnswer.model_validate(case["candidate_answer"])
        supported = validate_extractive_answer(candidate_answer, {"current": chunk.text})
        abstain = not bool(supported)
        totals["abstention_cases"] += 1
        totals["abstention_correct"] += abstain == case["expected"]["answer_abstains"]
        elapsed = (time.monotonic() - started) * 1000
        latencies.append(elapsed)
        records.append(
            {
                "case_id": case["case_id"],
                "predicted_type": batch.event_type,
                "expected_type": case["expected"]["event_type"],
                "changes": changes,
                "verdicts": [v.model_dump() for v in verdicts],
                "publish": predicted_publish,
                "expected_publish": expected_publish,
                "answer_abstains": abstain,
                "latency_ms": round(elapsed, 3),
            }
        )
    metrics = {
        "event_classification_macro_f1": macro_f1(expected_types, predicted_types),
        "fact_extraction_accuracy": ratio(totals["fact_correct"], totals["fact_slots"]),
        "change_detection_accuracy": ratio(totals["change_correct"], totals["change_cases"]),
        "citation_coverage": ratio(totals["cited"], totals["claims"]),
        "citation_correctness": ratio(totals["validator_correct"], totals["validator_cases"]),
        "numeric_consistency": ratio(totals["numeric_ok"], totals["numeric"]),
        "hallucination_rate": ratio(totals["false_accepted_cases"], totals["published_candidate_cases"]),
        "synthetic_false_acceptance_rate": ratio(totals["false_accepted_cases"], totals["adversarial_cases"]),
        "abstention_accuracy": ratio(totals["abstention_correct"], totals["abstention_cases"]),
        "latency_ms_mean": mean(latencies) if latencies else None,
        "cost_usd": None,
    }
    return {"metrics": metrics, "denominators": dict(totals), "cases": records, "case_count": len(records)}


def evaluate_file(settings, factory, path: Path, output: Path, live=False):
    raw = path.read_bytes()
    cases = [json.loads(line) for line in raw.decode().splitlines() if line.strip()]
    if not cases:
        raise ValueError("evaluation_dataset_is_empty")
    llm = StructuredLLM(settings, factory) if live else None
    if not live and any(x.get("dataset_kind") != "synthetic_regression" for x in cases):
        raise ValueError("Non-synthetic gold requires --live or an explicitly reviewed extractor adapter")
    try:
        result = evaluate_cases(cases, LiveExtractor(llm) if llm else DemoExtractor())
    finally:
        if llm:
            llm.close()
    result.update(
        {
            "dataset": path.name,
            "dataset_sha256": sha256(raw).hexdigest(),
            "dataset_kind": sorted({x.get("dataset_kind", "unlabeled") for x in cases}),
            "evaluated_at": datetime.now(timezone.utc).isoformat(),
            "model": settings.openai_model if live else "deterministic-fixture-parser",
            "model_version": llm.usage.model_version if llm else "fixture-parser-v1",
            "prompt_version": "extract-v1",
            "methodology_version": "eval-v1",
            "limitations": [
                "Synthetic regression cases are not independently labeled real filings.",
                "Citation correctness tests exact quotation/number/context guards, not unrestricted semantic entailment.",
                "Hallucination rate is unsupported candidate acceptance in this test set, NOT real-world hallucination prevalence.",
                "Abstention accuracy evaluates the extractive quote gate; sampling confidence intervals are not meaningful for generated cases.",
            ],
        }
    )
    result["metrics"]["cost_usd"] = (
        str(llm.usage.cost(settings))
        if llm and llm.usage.cost(settings) is not None
        else (0 if not live else None)
    )
    output.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    filename = output / (stamp + "-" + path.stem + ".json")
    filename.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    md = [
        "# SignalBrief evaluation",
        "",
        f"Dataset: {path.name}",
        f"Cases: {len(cases)}",
        f"Model: {result['model']}",
        "",
        "**SYNTHETIC REGRESSION — NOT A REAL-WORLD QUALITY CLAIM**",
        "",
        "| Metric | Measured value |",
        "|---|---|",
    ]
    md += [f"| {k} | {v if v is not None else 'not measured'} |" for k, v in result["metrics"].items()]
    md += ["", "## Limitations", *result["limitations"]]
    filename.with_suffix(".md").write_text("\n".join(md) + "\n", encoding="utf-8")
    with factory.begin() as s:
        s.add(
            m.EvalResult(
                dataset_name=path.stem,
                model_version=result["model"],
                prompt_version="extract-v1",
                metrics=result["metrics"],
                dataset_sha256=result["dataset_sha256"],
            )
        )
    return {
        "report": str(filename),
        "human_report": str(filename.with_suffix(".md")),
        "case_count": len(cases),
        "metrics": result["metrics"],
        "dataset_kind": result["dataset_kind"],
    }
