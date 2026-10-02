import json
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
from signalbrief import models as m
from signalbrief.ai.client import LiveExtractor, StructuredLLM
from signalbrief.ai.demo_extractor import DemoExtractor
from signalbrief.ai.schemas import ExtractionBatch
from signalbrief.analytics import export_event
from signalbrief.errors import EvidenceError, ProviderError
from signalbrief.evaluation import evaluate_cases, evaluate_file, macro_f1
from signalbrief.vector_search import DIMENSIONS, checked_vector
from sqlalchemy import select


def llm(db, handler):
    settings = db.settings.model_copy(
        update={"openai_api_key": "unit-test-not-real", "openai_model": "fixture-model"}
    )
    return StructuredLLM(settings, db.factory, transport=httpx.MockTransport(handler), sleep=lambda _: None)


def result(payload, **changes):
    return {
        "status": "completed",
        "model": "fixture-model-2026-01-01",
        "usage": {"input_tokens": 30, "output_tokens": 15},
        "output": [{"type": "message", "content": [{"type": "output_text", "text": json.dumps(payload)}]}],
        **changes,
    }


def test_strict_structured_request_and_usage(db):
    def handler(request):
        body = json.loads(request.content)
        assert body["store"] is False and body["text"]["format"]["strict"] is True
        assert body["text"]["format"]["schema"]["additionalProperties"] is False
        return httpx.Response(200, json=result({"event_type": "other", "facts": [], "scheduled_dates": []}))

    client = llm(db, handler)
    try:
        batch = client.call(ExtractionBatch, "extract-v1", {"source_text": "SYNTHETIC untrusted document"})
        assert (
            batch.event_type == "other"
            and client.usage.input_tokens == 30
            and client.usage.output_tokens == 15
        )
        assert client.usage.cost(db.settings) is None
    finally:
        client.close()


@pytest.mark.parametrize("kind", ["malformed", "unknown_field", "refusal", "incomplete"])
def test_malformed_refused_and_incomplete_rejected(db, kind):
    payload = result({"event_type": "other", "facts": [], "scheduled_dates": []})
    if kind == "malformed":
        payload["output"][0]["content"][0]["text"] = "not json"
    if kind == "unknown_field":
        payload["output"][0]["content"][0]["text"] = json.dumps(
            {"event_type": "other", "facts": [], "scheduled_dates": [], "buy": True}
        )
    if kind == "refusal":
        payload["output"][0]["content"][0] = {"type": "refusal", "refusal": "cannot"}
    if kind == "incomplete":
        payload["status"] = "incomplete"
    client = llm(db, lambda r: httpx.Response(200, json=payload))
    try:
        with pytest.raises(EvidenceError):
            client.call(ExtractionBatch, "extract-v1", {})
    finally:
        client.close()


def test_llm_api_failure(db):
    client = llm(db, lambda r: httpx.Response(401))
    with pytest.raises(ProviderError):
        client.call(ExtractionBatch, "extract-v1", {})
    client.close()


def test_llm_missing_usage_not_reported_zero(db):
    payload = result({"event_type": "other", "facts": [], "scheduled_dates": []})
    payload.pop("usage")
    client = llm(db, lambda r: httpx.Response(200, json=payload))
    client.call(ExtractionBatch, "extract-v1", {})
    assert client.usage.measured is False
    client.close()


def test_long_document_not_silently_truncated(db):
    client = llm(db, lambda r: httpx.Response(200))
    client.settings.max_llm_chunks = 1
    with pytest.raises(EvidenceError):
        LiveExtractor(client).extract(
            [SimpleNamespace(id="a", text="one"), SimpleNamespace(id="b", text="two")]
        )
    assert client.usage.requests == 0
    client.close()


def test_semantic_comparison_cannot_rewrite_evidence(db):
    client = llm(
        db,
        lambda r: httpx.Response(
            200,
            json=result(
                {
                    "has_meaningful_change": True,
                    "previous_quote": "invented previous",
                    "current_quote": "current",
                    "uncertainty": "requires_human_review",
                }
            ),
        ),
    )
    with pytest.raises(EvidenceError):
        LiveExtractor(client).semantic_compare("previous", "current")
    client.close()


def test_macro_f1_actual_formula():
    assert macro_f1(["a", "b"], ["a", "b"]) == 1
    assert macro_f1(["a", "b"], ["b", "a"]) == 0
    assert macro_f1([], []) is None


def test_120_synthetic_regressions_computed_not_oracle():
    path = Path("evals/datasets/synthetic-v1.jsonl")
    cases = [json.loads(x) for x in path.read_text(encoding="utf-8").splitlines()]
    report = evaluate_cases(cases, DemoExtractor())
    assert report["case_count"] == 120
    assert report["metrics"]["change_detection_accuracy"] == 1
    assert report["metrics"]["synthetic_false_acceptance_rate"] == 0
    # Poison a GOLD label and ensure measured score drops, proving outputs aren't copied from expected.
    cases[0]["expected"]["facts"][0][1] = "77777"
    assert evaluate_cases(cases, DemoExtractor())["metrics"]["fact_extraction_accuracy"] < 1


def test_report_written_and_history_stored(db, tmp_path):
    output = evaluate_file(db.settings, db.factory, Path("evals/datasets/synthetic-v1.jsonl"), tmp_path)
    assert Path(output["report"]).exists() and Path(output["human_report"]).exists()
    with db.factory() as s:
        assert s.scalar(select(m.EvalResult.dataset_sha256))


def test_posthog_opt_in_and_revocation(db):
    settings = db.settings.model_copy(update={"posthog_project_key": "unit-test-project"})
    with db.factory.begin() as s:
        user = m.User(analytics_consent=True)
        s.add(user)
        s.flush()
        e = m.UserEvent(user_id=user.id, event_name="brief_opened", properties={"event_id": "synthetic"})
        s.add(e)
        s.flush()
        eid = e.id
        uid = user.id
    captured = []

    def handler(r):
        captured.append(json.loads(r.content))
        return httpx.Response(200, json={"status": 1})

    assert export_event(settings, db.factory, eid, httpx.MockTransport(handler)) == "exported"
    assert (
        captured[0]["distinct_id"] != uid
        and captured[0]["uuid"] == eid
        and captured[0]["properties"]["$ip"] is None
    )
    with db.factory.begin() as s:
        s.get(m.User, uid).analytics_consent = False
    assert export_event(settings, db.factory, eid, httpx.MockTransport(handler)) == "consent_absent"
    assert len(captured) == 1


@pytest.mark.parametrize(
    "value", [[], [1.0] * 2, [float("nan")] * DIMENSIONS, [0.0] * DIMENSIONS, [True] * DIMENSIONS]
)
def test_bad_embedding_denied(value):
    with pytest.raises(EvidenceError):
        checked_vector(value)


def test_vector_validation():
    assert len(checked_vector([0.5] * DIMENSIONS)) == DIMENSIONS


@pytest.mark.parametrize(
    "usage",
    [
        {"input_tokens": 12},
        {"input_tokens": -1, "output_tokens": 2},
        {"input_tokens": True, "output_tokens": 2},
        {"input_tokens": "12", "output_tokens": 2},
    ],
)
def test_incomplete_or_invalid_usage_is_unknown(db, usage):
    client = llm(
        db,
        lambda r: httpx.Response(
            200, json=result({"event_type": "other", "facts": [], "scheduled_dates": []}, usage=usage)
        ),
    )
    try:
        client.call(ExtractionBatch, "extract-v1", {})
        assert not client.usage.measured
        settings = db.settings.model_copy(
            update={"openai_input_usd_per_million": 1, "openai_output_usd_per_million": 1}
        )
        assert client.usage.cost(settings) is None
    finally:
        client.close()


def test_final_transport_timeout_does_not_claim_zero_cost(db):
    def handler(request):
        raise httpx.ReadTimeout("response lost", request=request)

    client = llm(db, handler)
    client.settings.max_retries = 0
    try:
        with pytest.raises(ProviderError):
            client.call(ExtractionBatch, "extract-v1", {})
        assert not client.usage.measured
    finally:
        client.close()
