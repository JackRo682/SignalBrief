"""Synthetic API contract examples used in the interview case study."""

import pytest
from signalbrief import api_schemas as a
from signalbrief import models as m
from sqlalchemy import select


def test_analytics_consent_and_no_sensitive_properties(client, headers, db):
    payload = {"event_name": "brief_opened", "properties": {"event_id": "synthetic", "screen": "mobile_detail"}}
    assert client.post("/v1/analytics", json=payload).status_code == 401
    assert client.post("/v1/analytics", headers=headers, json=payload).status_code == 204
    with db.factory() as session:
        assert session.scalars(select(m.UserEvent)).all() == []
    assert client.patch("/v1/me", headers=headers, json={"analytics_consent": True}).status_code == 200
    for key in ("question", "email", "quantity", "source_url"):
        invalid = {**payload, "properties": {key: "private synthetic value"}}
        assert client.post("/v1/analytics", headers=headers, json=invalid).status_code == 422
    assert client.post("/v1/analytics", headers=headers, json=payload).status_code == 204
    assert client.patch("/v1/me", headers=headers, json={"analytics_consent": False}).status_code == 200
    assert client.post("/v1/analytics", headers=headers, json=payload).status_code == 204
    with db.factory() as session:
        rows = session.scalars(select(m.UserEvent)).all()
        assert len(rows) == 1
        assert rows[0].properties == payload["properties"]


def test_three_case_study_contracts(client, headers, seeded, db):
    companies = client.get("/v1/companies", headers=headers).json()
    company_id = companies[0]["id"]
    for _ in range(2):
        assert client.put(f"/v1/watchlist/{company_id}", headers=headers).status_code == 204
    watch = a.WatchlistOut.model_validate(client.get("/v1/watchlist", headers=headers).json())
    assert [c.id for c in watch.items].count(company_id) == 1
    with db.factory() as session:
        event_id = session.scalar(select(m.Event.id).where(m.Event.state == "published"))
    assert event_id
    detail = client.get(f"/v1/events/{event_id}", headers=headers)
    assert detail.status_code == 200
    parsed = a.EventDetailOut.model_validate(detail.json())
    assert parsed.event.id == event_id
    assert all(e.source_url and e.quote for e in parsed.evidence)
    response = client.post(f"/v1/events/{event_id}/questions", headers=headers, json={"question": "Should I buy?"})
    assert response.status_code == 200
    answer = a.AnswerOut.model_validate(response.json())
    assert answer.status == "policy_blocked" and answer.run_id is None and answer.evidence == []


@pytest.mark.parametrize("question", ["x", "x" * 1001])
def test_question_validation_is_not_a_success(client, headers, question):
    response = client.post("/v1/events/missing/questions", headers=headers, json={"question": question})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


def test_unknown_resources_are_not_success(client, headers):
    assert client.put("/v1/watchlist/missing", headers=headers).status_code == 404
    assert client.get("/v1/events/missing", headers=headers).status_code == 404
    assert client.post("/v1/events/missing/questions", headers=headers, json={"question": "Evidence?"}).status_code == 404
