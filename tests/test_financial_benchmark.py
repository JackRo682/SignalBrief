"""Benchmark guardrails, not measured LLM outcomes or human ground truth."""

import copy
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest
from signalbrief.errors import EvidenceError
from signalbrief.financial_benchmark import (
    Brief,
    Interpretation,
    canonical_interpretation,
    deterministic_brief,
    load_manifest,
    original,
    reference_candidates,
    score,
    validate_interpretation,
)

ROOT = Path(__file__).resolve().parents[1]
MUTATIONS = ["value", "unit", "period", "accession", "fact_id", "quote", "field", "omitted"]


@pytest.mark.parametrize("arguments", [["--method", "A"], ["--method", "C"], ["--split", "held_out"]])
def test_paid_and_heldout_execution_is_explicitly_gated(tmp_path, arguments):
    output = tmp_path / "must-not-exist.json"
    result = subprocess.run(
        [
            sys.executable,
            str(ROOT / "scripts/run_financial_benchmark.py"),
            *arguments,
            "--output",
            str(output),
        ],
        cwd=ROOT,
        capture_output=True,
        timeout=30,
        env={**os.environ, "PYTHONPATH": str(ROOT / "apps/api")},
    )
    assert result.returncode == 2
    assert b"Paid calls require" in result.stderr or b"Held-out is sealed" in result.stderr
    assert not output.exists()


@pytest.fixture(scope="module")
def sample():
    manifest = load_manifest(ROOT)
    pair = next(p for p in manifest["pairs"] if p["split"] == "development" and p["ticker"] == "AAPL")
    sources = [manifest["sources"][pair[k]] for k in ("previous", "current")]
    raws = [original(ROOT, s) for s in sources]
    brief = deterministic_brief(raws, sources)
    refs = [f for raw, s in zip(raws, sources, strict=True) for f in reference_candidates(raw, s)]
    return brief, refs


@pytest.mark.parametrize("mutation", MUTATIONS)
@pytest.mark.parametrize("slot", [0, 1, 2])
def test_adversarial_claim(sample, mutation, slot):
    baseline, references = sample
    changed = baseline.model_copy(deep=True)
    if mutation == "omitted":
        changed.facts.pop(slot)
    else:
        wrong = {
            "value": "999999999999999",
            "unit": "USD million",
            "period": "1900-01-01/1900-03-31",
            "accession": "0000000000-00-000000",
            "fact_id": "foreign-fact",
            "quote": "fabricated quote",
            "field": "operating_income" if changed.facts[slot].field == "revenue" else "revenue",
        }[mutation]
        setattr(changed.facts[slot], mutation, wrong)
    result = score(changed, references)
    assert result["citation_correct"] < result["citation_slots"]
    assert not validate_interpretation(changed, baseline)


def test_real_candidate_agreement_and_missing_output_penalty(sample):
    brief, refs = sample
    result = score(brief, refs)
    assert result["numeric_correct"] == result["numeric_slots"] == 4
    assert result["comparison_correct"] == 2
    assert result["citation_correct"] == 4
    assert result["reference_status"] == "automated_candidate_not_human_ground_truth"
    brief = Brief(facts=[], changes=[], interpretations=[], abstain=True, reason="unsupported")
    assert score(brief, refs)["numeric_slots"] == 4
    assert not score(brief, refs)["useful_completion"]


def test_duplicate_and_nonfinite_values_never_improve_score(sample):
    brief, refs = sample
    duplicate = brief.model_copy(deep=True)
    duplicate.facts.append(duplicate.facts[0])
    result = score(duplicate, refs)
    assert result["numeric_slots"] == 5 and not result["useful_completion"]
    for value in ("NaN", "Infinity", "-Infinity", "garbage"):
        broken = brief.model_copy(deep=True)
        broken.facts[0].value = value
        assert score(broken, refs)["numeric_correct"] == 3


def test_causal_hallucination_and_missing_interpretation_rejected(sample):
    brief, _ = sample
    candidate = brief.model_copy(deep=True)
    candidate.interpretations = [
        Interpretation(
            text=canonical_interpretation(c),
            previous_fact_id=c.previous_fact_id,
            current_fact_id=c.current_fact_id,
        )
        for c in brief.changes
    ]
    assert validate_interpretation(candidate, brief)
    candidate.interpretations[0].text += " Because AI demand accelerated."
    assert not validate_interpretation(candidate, brief)
    assert not validate_interpretation(brief, brief)


def test_split_and_original_integrity_without_heldout_extraction(tmp_path):
    manifest = load_manifest(ROOT)
    assert len([p for p in manifest["pairs"] if p["split"] == "development"]) == 10
    assert len([p for p in manifest["pairs"] if p["split"] == "held_out"]) == 20
    assert all(p["human_review"]["status"] == "pending" for p in manifest["pairs"])
    # Hash verification does not parse or score held-out outcomes.
    for source in manifest["sources"].values():
        original(ROOT, source)
    broken = copy.deepcopy(next(iter(manifest["sources"].values())))
    broken["raw_sha256"] = "0" * 64
    with pytest.raises(EvidenceError, match="original_hash_mismatch"):
        original(ROOT, broken)
    broken["path"] = "../outside.gz"
    with pytest.raises(EvidenceError, match="original_path_escape"):
        original(ROOT, broken)
    path = tmp_path / "evals/financial-v1"
    path.mkdir(parents=True)
    (path / "manifest.json").write_text(json.dumps(manifest))
    (path / "manifest.sha256").write_text("0" * 64)
    with pytest.raises(EvidenceError, match="manifest_hash_mismatch"):
        load_manifest(tmp_path)
