"""Synthetic boundary regressions, not factual correctness or live evaluation."""

import copy
import json
from pathlib import Path
from typing import Any

import pytest
from jsonschema import Draft202012Validator, FormatChecker
from pydantic import TypeAdapter, ValidationError

from scripts.export_contracts import artifacts
from services.contracts import api
from services.contracts.api import Cost, Portfolio, Position
from services.contracts.domain import (
    Analysis,
    Fact,
    FinalDisposition,
    PublicationDecision,
    SourceSpan,
)
from services.contracts.exchange import StageExchange
from services.contracts.scalars import Date, DecimalString, Id, Period, Utc
from services.contracts.stages import INPUT_ADAPTER, RESULT_ADAPTER, ClaimBundle

ROOT = Path(__file__).resolve().parents[1]
CASES: list[dict[str, Any]] = json.loads(
    (ROOT / "packages/contracts/fixtures/v1/stages.json").read_text(encoding="utf-8")
)["cases"]
BY_STAGE = {case["input"]["stage"]: case for case in CASES}


@pytest.mark.parametrize("case", CASES, ids=lambda c: c["input"]["stage"])
def test_all_stage_boundaries_and_round_trip(case: dict[str, Any]) -> None:
    result = StageExchange.model_validate(case)
    assert StageExchange.model_validate_json(result.model_dump_json()) == result


@pytest.mark.parametrize("case", CASES, ids=lambda c: c["input"]["stage"])
@pytest.mark.parametrize("status", ["retryable", "blocked", "skipped"])
def test_failure_states_do_not_retain_output(case: dict[str, Any], status: str) -> None:
    bad = copy.deepcopy(case)
    bad["result"]["status"] = status
    with pytest.raises(ValidationError):
        StageExchange.model_validate(bad)
    bad["result"]["output"] = None
    with pytest.raises(ValidationError):
        StageExchange.model_validate(bad)
    bad["result"]["reason_codes"] = ["synthetic_failure"]
    StageExchange.model_validate(bad)


@pytest.mark.parametrize("case", CASES, ids=lambda c: c["input"]["stage"])
@pytest.mark.parametrize("boundary", ["input", "result"])
def test_required_extra_and_discriminator(case: dict[str, Any], boundary: str) -> None:
    adapter = INPUT_ADAPTER if boundary == "input" else RESULT_ADAPTER
    for key in case[boundary]:
        bad = copy.deepcopy(case[boundary])
        del bad[key]
        with pytest.raises(ValidationError):
            adapter.validate_python(bad)
    bad = copy.deepcopy(case[boundary])
    bad["unexpected"] = True
    with pytest.raises(ValidationError):
        adapter.validate_python(bad)
    bad = copy.deepcopy(case[boundary])
    bad["stage"] = "unregistered"
    with pytest.raises(ValidationError):
        adapter.validate_python(bad)
    if boundary == "input":
        bad = copy.deepcopy(case[boundary])
        bad["payload"]["unexpected"] = True
        with pytest.raises(ValidationError):
            adapter.validate_python(bad)


@pytest.mark.parametrize(
    "value", [0, 1.2, True, "NaN", "Infinity", "1e3", "+1", "01", ".1", "1.", " 1", ""]
)
def test_decimal_strict(value: object) -> None:
    with pytest.raises(ValidationError):
        TypeAdapter(DecimalString).validate_python(value)


def test_zero_and_null_are_distinct() -> None:
    fact = copy.deepcopy(BY_STAGE["event_extraction"]["result"]["output"]["facts"][0])
    fact["value_decimal"] = "0"
    assert Fact.model_validate(fact).value_decimal == "0"
    fact["value_decimal"] = None
    with pytest.raises(ValidationError):
        Fact.model_validate(fact)


@pytest.mark.parametrize(
    "changes",
    [
        {"value_decimal": 1},
        {"value_type": "range", "value_decimal": None, "low": "2", "high": "1"},
        {"period_start": "2026-01-01", "period_end": "2025-01-01"},
        {"unit": "currency", "currency": None},
        {"unit": "count", "currency": "USD"},
        {"scale_decimal": "0"},
        {"evidence_span_ids": []},
        {"forward_looking": 0},
    ],
)
def test_invalid_fact(changes: dict[str, Any]) -> None:
    fact = copy.deepcopy(BY_STAGE["event_extraction"]["result"]["output"]["facts"][0])
    fact.update(changes)
    with pytest.raises(ValidationError):
        Fact.model_validate(fact)


@pytest.mark.parametrize(
    "typ,value",
    [
        (Date, "2026-02-30"),
        (Utc, "2026-01-01T00:00:00+01:00"),
        (Utc, "2026-01-01"),
        (Id, "not-a-uuid"),
    ],
)
def test_scalar_invalid(typ: Any, value: str) -> None:
    with pytest.raises(ValidationError):
        TypeAdapter(typ).validate_python(value)


def test_period_base_validates_independently() -> None:
    with pytest.raises(ValidationError):
        Period(period_start="2026-01-02", period_end="2026-01-01", fiscal_label=None)


def test_unicode_codepoints_and_exact_hash() -> None:
    import hashlib

    span = copy.deepcopy(BY_STAGE["event_extraction"]["input"]["evidence"]["spans"][0])
    span["exact_text"] = "한😀é"
    span["locator"]["end_offset"] = len(span["exact_text"])
    span["text_hash"] = hashlib.sha256(span["exact_text"].encode()).hexdigest()
    SourceSpan.model_validate(span)
    span["locator"]["end_offset"] += 1
    with pytest.raises(ValidationError):
        SourceSpan.model_validate(span)


@pytest.mark.parametrize(
    "mutation",
    [
        "raw_hash",
        "artifact_hash",
        "pins",
        "run",
        "input_hash",
        "time",
        "issuer",
        "citation",
        "context",
        "percent_baseline",
    ],
)
def test_reference_and_lineage_failures(mutation: str) -> None:
    case = copy.deepcopy(BY_STAGE["analysis_generation"])
    if mutation == "raw_hash":
        case["input"]["evidence"]["artifacts"][0]["document_version_hash"] = "b" * 64
    elif mutation == "artifact_hash":
        case["input"]["evidence"]["spans"][0]["canonical_text_hash"] = "b" * 64
    elif mutation == "pins":
        case["input"]["parsed_artifact_ids"] = []
    elif mutation == "run":
        case["result"]["run_id"] = "00000000-0000-4000-8000-000000000999"
    elif mutation == "input_hash":
        case["result"]["input_hash"] = "b" * 64
    elif mutation == "time":
        case["result"]["finished_at"] = "2025-01-01T00:00:00Z"
    elif mutation == "issuer":
        case["input"]["payload"]["events"][0]["issuer_id"] = "00000000-0000-4000-8000-000000000999"
    elif mutation == "citation":
        case["result"]["output"]["analysis"]["claims"][0]["citation_span_ids"] = case["input"][
            "evidence"
        ]["spans"][0:1] and [case["input"]["evidence"]["spans"][0]["span_id"]]
    elif mutation == "context":
        case["input"]["payload"]["facts"][1]["accounting_basis"] = "different"
    else:
        case["input"]["payload"]["facts"][1]["value_decimal"] = "0"
    with pytest.raises(ValidationError):
        StageExchange.model_validate(case)


def publish_decision() -> dict[str, Any]:
    decision: dict[str, Any] = copy.deepcopy(
        BY_STAGE["policy_validation_publish"]["result"]["output"]["publication_decision"]
    )
    decision["decision"] = "publish"
    decision["reviewer_action_id"] = "00000000-0000-4000-8000-000000000400"
    decision["reason_codes"] = []
    template = decision["validations"][0]
    checks = [
        "source_identity",
        "source_rights",
        "parser",
        "issuer",
        "numeric",
        "citation",
        "semantic",
        "contradiction",
        "policy",
    ]
    decision["validations"] = [
        dict(template, validation_id=f"00000000-0000-4000-8000-{200 + n:012d}", check_type=check)
        for n, check in enumerate(checks)
    ]
    decision["validation_ids"] = [v["validation_id"] for v in decision["validations"]]
    return decision


@pytest.mark.parametrize(
    "mutation", ["missing", "fail", "uncertain", "info", "review", "run", "ids", "receipt"]
)
def test_publication_hard_gates(mutation: str) -> None:
    decision = publish_decision()
    PublicationDecision.model_validate(decision)
    if mutation == "missing":
        decision["validations"].pop()
        decision["validation_ids"].pop()
    elif mutation in ("fail", "uncertain"):
        decision["validations"][0]["result"] = mutation
    elif mutation == "info":
        decision["validations"][0]["severity"] = "info"
    elif mutation == "review":
        decision["reviewer_action_id"] = None
    elif mutation == "run":
        decision["validations"][0]["run_id"] = decision["event_id"]
    elif mutation == "ids":
        decision["validation_ids"] = []
    else:
        decision["publication_outbox_id"] = decision["event_id"]
    with pytest.raises(ValidationError):
        PublicationDecision.model_validate(decision)


def test_published_final_requires_consistent_committed_receipt() -> None:
    d = publish_decision()
    final = copy.deepcopy(BY_STAGE["uncertainty_handling"]["result"]["output"]["disposition"])
    final.update(outcome="published", publication_decision=d, validation_ids=d["validation_ids"])
    with pytest.raises(ValidationError):
        FinalDisposition.model_validate(final)
    d["publication_outbox_id"] = "00000000-0000-4000-8000-000000000500"
    d["commit_receipt"] = dict(
        decision_id=d["decision_id"],
        run_id=d["run_id"],
        event_id=d["event_id"],
        brief_id=d["candidate_brief_id"],
        outbox_id=d["publication_outbox_id"],
        lease_token="00000000-0000-4000-8000-000000000600",
        revision=1,
        committed_at=d["decided_at"],
    )
    FinalDisposition.model_validate(final)
    d["commit_receipt"]["revision"] = 0
    with pytest.raises(ValidationError):
        FinalDisposition.model_validate(final)


def test_unknown_weights_and_cost_are_not_zero() -> None:
    uid = "00000000-0000-4000-8000-000000000001"
    p = Portfolio(
        id=uid,
        name="Synthetic",
        positions=[Position(id=uid, company_id=uid, manual_weight=None, weight_confirmed_at=None)],
        known_weight_total="0",
        weights_complete=False,
        row_version=1,
    )
    assert p.positions[0].manual_weight is None
    with pytest.raises(ValidationError):
        Portfolio.model_validate(dict(p.model_dump(), weights_complete=True))
    assert Cost(usd=None, complete=False).usd is None
    with pytest.raises(ValidationError):
        Cost(usd=None, complete=True)


def test_model_generation_cannot_publish_and_title_claims_resolve() -> None:
    a = copy.deepcopy(BY_STAGE["analysis_generation"]["result"]["output"]["analysis"])
    a["title_claim_ids"] = ["00000000-0000-4000-8000-000000000999"]
    with pytest.raises(ValidationError):
        Analysis.model_validate(a)
    case = copy.deepcopy(BY_STAGE["analysis_generation"])
    case["result"]["output"]["analysis"]["publication_state"] = "published"
    with pytest.raises(ValidationError):
        StageExchange.model_validate(case)


def test_comparison_claim_cannot_drop_prior_citation() -> None:
    payload = copy.deepcopy(BY_STAGE["analysis_generation"]["input"]["payload"])
    payload = {
        k: v
        for k, v in payload.items()
        if k not in ("glossary_version", "prompt_version", "language")
    }
    payload["claims"][0]["citation_span_ids"].pop()
    with pytest.raises(ValidationError):
        ClaimBundle.model_validate(payload)


def test_generated_shapes_and_schema_fixtures() -> None:
    outputs = artifacts()
    for name, schema in outputs.items():
        if name == "openapi.json":
            assert schema["paths"] == {}
            continue
        Draft202012Validator.check_schema(schema)
        for definition in schema.get("$defs", {}).values():
            if definition.get("type") == "object":
                assert definition["additionalProperties"] is False
                assert set(definition["required"]) == set(definition["properties"])
    schema = outputs["schema.json"]
    schema["$ref"] = "#/$defs/StageExchange"
    validator = Draft202012Validator(schema, format_checker=FormatChecker())
    for case in CASES:
        validator.validate(case)
    # Cross-field validators cannot be represented fully by JSON Schema or TypeScript.
    # Consumers must run the authoritative runtime boundary validation as well.


def test_api_compatibility_missing_extra_and_null_keys() -> None:
    fixture = json.loads(
        (ROOT / "packages/contracts/fixtures/v1/api.json").read_text(encoding="utf-8")
    )
    schema = artifacts()["schema.json"]
    for name, data in fixture["objects"].items():
        model = getattr(api, name)
        model.model_validate(data)
        validator = Draft202012Validator(
            dict(schema, **{"$ref": f"#/$defs/{name}"}), format_checker=FormatChecker()
        )
        validator.validate(data)
        for key in data:
            bad = copy.deepcopy(data)
            del bad[key]
            with pytest.raises(ValidationError):
                model.model_validate(bad)
        with pytest.raises(ValidationError):
            model.model_validate(dict(data, unexpected=True))


def test_upstream_pins_and_unknown_period_cannot_match() -> None:
    case = copy.deepcopy(BY_STAGE["previous_event_matching"])
    ref = dict(
        result_id="00000000-0000-4000-8000-000000000700",
        stage="event_normalization",
        run_id=case["input"]["run_id"],
        input_hash="a" * 64,
        output_hash="b" * 64,
        validator_version="1",
    )
    case["input"]["upstream_results"] = [ref]
    with pytest.raises(ValidationError):
        StageExchange.model_validate(case)
    case["input"]["upstream_result_ids"] = [ref["result_id"]]
    StageExchange.model_validate(case)
    case["result"]["output"]["prior_match"]["compared_context"]["period_start"] = None
    with pytest.raises(ValidationError):
        StageExchange.model_validate(case)


@pytest.mark.parametrize("stage", list(BY_STAGE))
def test_stage_output_specific_shape(stage: str) -> None:
    case = copy.deepcopy(BY_STAGE[stage])
    case["result"]["output"]["unexpected"] = True
    with pytest.raises(ValidationError):
        StageExchange.model_validate(case)
    case = copy.deepcopy(BY_STAGE[stage])
    for key in list(case["result"]["output"]):
        bad = copy.deepcopy(case)
        del bad["result"]["output"][key]
        with pytest.raises(ValidationError):
            StageExchange.model_validate(bad)


def test_comparison_period_and_issuer_boundaries() -> None:
    payload = copy.deepcopy(BY_STAGE["analysis_generation"]["input"]["payload"])
    payload = {
        k: v
        for k, v in payload.items()
        if k not in ("glossary_version", "prompt_version", "language")
    }
    payload["facts"][1]["period_start"] = None
    with pytest.raises(ValidationError):
        ClaimBundle.model_validate(payload)
    payload["facts"][1]["period_start"] = "2025-10-01"
    other_issuer = "00000000-0000-4000-8000-000000000999"
    payload["events"][1]["issuer_id"] = other_issuer
    payload["documents"][1]["issuer_id"] = other_issuer
    with pytest.raises(ValidationError):
        ClaimBundle.model_validate(payload)
