import json
from datetime import timedelta
from uuid import UUID

import jwt
import pytest
from conftest import user_headers
from pydantic import ValidationError
from signalbrief import models as m
from signalbrief.ai.demo_extractor import DemoExtractor
from signalbrief.cli import delete_user
from signalbrief.errors import EvidenceError
from signalbrief.pipeline import process_document
from signalbrief.seed import DEMO_USER_ID, seed_demo
from signalbrief.settings import Settings
from signalbrief.worker import run_once
from sqlalchemy import func, select


def onboard(client, headers):
    companies = client.get("/v1/companies", headers=headers).json()
    ids = [x["id"] for x in companies]
    assert (
        client.post(
            "/v1/onboarding", headers=headers, json={"company_ids": ids, "analytics_consent": False}
        ).status_code
        == 200
    )
    return ids


def test_health_config(client):
    assert client.get("/health/live").status_code == 200 and client.get("/health/ready").status_code == 200
    cfg = client.get("/v1/config").json()
    assert cfg["demo_mode"] and "demo_admin_enabled" in cfg
    assert "secret" not in json.dumps(cfg)


@pytest.mark.parametrize(
    "path",
    [
        "/v1/me",
        "/v1/companies",
        "/v1/watchlist",
        "/v1/portfolio",
        "/v1/feed",
        "/v1/alerts",
        "/v1/ops/dashboard",
    ],
)
def test_auth_required(client, path):
    assert client.get(path).status_code == 401


@pytest.mark.parametrize("token", ["not.a.jwt", "", "e30.e30.forged"])
def test_tampered_tokens(client, token):
    assert client.get("/v1/me", headers={"Authorization": "Bearer " + token}).status_code == 401


def test_expired_token(client, settings):
    token = jwt.encode(
        {
            "sub": DEMO_USER_ID,
            "iss": "signalbrief-demo",
            "aud": "signalbrief-demo",
            "iat": m.now() - timedelta(days=1),
            "exp": m.now() - timedelta(seconds=1),
        },
        settings.demo_jwt_secret,
        algorithm="HS256",
    )
    assert client.get("/v1/me", headers={"Authorization": "Bearer " + token}).status_code == 401


def test_admin_cannot_be_granted_by_client_metadata(client, settings):
    token = jwt.encode(
        {
            "sub": DEMO_USER_ID,
            "iss": "signalbrief-demo",
            "aud": "signalbrief-demo",
            "iat": m.now(),
            "exp": m.now() + timedelta(hours=1),
            "user_metadata": {"admin": True},
            "app_metadata": {"role": "admin"},
        },
        settings.demo_jwt_secret,
        algorithm="HS256",
    )
    assert (
        client.get(
            "/v1/ops/dashboard", headers={"Authorization": "Bearer " + token, "X-Admin": "true"}
        ).status_code
        == 403
    )


def test_onboarding_requires_three_unique(client, seeded, headers):
    company = client.get("/v1/companies", headers=headers).json()[0]["id"]
    assert (
        client.post("/v1/onboarding", headers=headers, json={"company_ids": [company] * 3}).status_code == 422
    )


def test_end_to_end_brief_and_two_sided_evidence(client, seeded, headers):
    ids = onboard(client, headers)
    assert len(ids) == 3
    feed = client.get("/v1/feed", headers=headers)
    assert feed.status_code == 200
    data = feed.json()
    assert len(data["items"]) == 6
    latest = next(x for x in data["items"] if x["change_count"] > 0)
    detail = client.get("/v1/events/" + latest["id"], headers=headers)
    assert detail.status_code == 200
    d = detail.json()
    evidence = {x["fact_id"]: x for x in d["evidence"]}
    for change in d["changes"]:
        assert change["current_fact_id"] in evidence
        if change["previous_fact_id"]:
            assert change["previous_fact_id"] in evidence
    assert d["document"]["source_url"].startswith("https://fixtures.")
    assert d["document"]["published_at"].endswith("Z") or d["document"]["published_at"].endswith("+00:00")
    assert d["event"]["ranking"]["components"]["A"] is None
    answer = client.post(
        f"/v1/events/{latest['id']}/questions",
        headers=headers,
        json={"question": "변경된 수치의 근거를 보여줘"},
    )
    assert answer.status_code == 200 and answer.json()["status"] in ("answered", "abstained")
    assert client.get("/v1/calendar", headers=headers).status_code == 200


def test_watchlist_tenant_isolation(client, seeded, headers, settings):
    ids = onboard(client, headers)
    other = user_headers(settings)
    assert client.get("/v1/watchlist", headers=other).json()["items"] == []
    assert client.delete("/v1/watchlist/" + ids[0], headers=other).status_code == 204
    assert len(client.get("/v1/watchlist", headers=headers).json()["items"]) == 3


def test_portfolio_roundtrip_and_user_isolation(client, seeded, headers, settings):
    ids = onboard(client, headers)
    url = "/v1/portfolio/positions/" + ids[0]
    assert (
        client.put(
            url, headers=headers, json={"quantity": "10.125", "average_cost": "123.45", "currency": "USD"}
        ).status_code
        == 204
    )
    assert (
        client.put(
            url, headers=headers, json={"quantity": "20", "average_cost": None, "currency": "KRW"}
        ).status_code
        == 204
    )
    response = client.get("/v1/portfolio", headers=headers).json()
    assert len(response["positions"]) == 1 and float(response["positions"][0]["quantity"]) == 20
    assert client.get("/v1/portfolio", headers=user_headers(settings)).json()["positions"] == []
    assert client.delete(url, headers=user_headers(settings)).status_code == 204
    assert len(client.get("/v1/portfolio", headers=headers).json()["positions"]) == 1


@pytest.mark.parametrize("quantity", ["0", "-1", "NaN", "inf", "1.123456789", "9" * 30])
def test_bad_position_values(client, seeded, headers, quantity):
    company = client.get("/v1/companies", headers=headers).json()[0]["id"]
    assert (
        client.put(
            "/v1/portfolio/positions/" + company, headers=headers, json={"quantity": quantity}
        ).status_code
        == 422
    )


def test_alert_and_calendar_idor(client, headers, settings):
    alert = client.post("/v1/alerts", headers=headers, json={"name": "Owner only"}).json()
    other = user_headers(settings)
    assert client.delete("/v1/alerts/" + alert["id"], headers=other).status_code == 404
    assert client.put("/v1/alerts/" + alert["id"], headers=other, json={"name": "stolen"}).status_code == 404
    day = (m.now() + timedelta(days=2)).date().isoformat()
    event = client.post(
        "/v1/calendar", headers=headers, json={"title": "Private calendar", "occurs_on": day}
    ).json()
    assert client.get("/v1/calendar", headers=other).json() == []
    assert client.delete("/v1/calendar/" + event["id"], headers=other).status_code == 404
    assert client.delete("/v1/calendar/" + event["id"], headers=headers).status_code == 204


def test_analytics_opt_in_and_allowlist(client, headers, db):
    payload = {"event_name": "brief_opened", "properties": {"event_id": "fictional"}}
    assert client.post("/v1/analytics", headers=headers, json=payload).status_code == 204
    with db.factory() as s:
        assert s.scalar(select(func.count()).select_from(m.UserEvent)) == 0
    client.patch("/v1/me", headers=headers, json={"analytics_consent": True})
    assert client.post("/v1/analytics", headers=headers, json=payload).status_code == 204
    with db.factory() as s:
        assert s.scalar(select(func.count()).select_from(m.UserEvent)) == 1
    payload["properties"] = {"email": "not-allowed@example.invalid"}
    assert client.post("/v1/analytics", headers=headers, json=payload).status_code == 422


def test_density_changes_presentation_not_facts(client, seeded, headers):
    onboard(client, headers)
    identity = client.get("/v1/feed", headers=headers).json()["items"][0]["id"]
    before = client.get("/v1/events/" + identity, headers=headers).json()
    assert client.patch("/v1/me", headers=headers, json={"density": "advanced"}).status_code == 200
    after = client.get("/v1/events/" + identity, headers=headers).json()
    assert before["facts"] == after["facts"] and before["evidence"] == after["evidence"]


@pytest.mark.parametrize(
    "question", ["지금 매수해야 해?", "목표주가 알려줘", "Should I buy this stock?", "Buy or sell now?"]
)
def test_followup_no_investment_recommendations(client, seeded, headers, question):
    onboard(client, headers)
    identity = client.get("/v1/feed", headers=headers).json()["items"][0]["id"]
    response = client.post(f"/v1/events/{identity}/questions", headers=headers, json={"question": question})
    assert response.status_code == 200 and response.json()["status"] == "policy_blocked"


def test_blocked_event_hidden_and_cannot_approve(client, seeded, headers, admin, db):
    onboard(client, headers)

    class WrongNumber:
        def extract(self, chunks):
            batch = DemoExtractor().extract(chunks)
            for f in batch.facts:
                if f.value_raw is not None:
                    f.value_raw = "99999999"
            return batch

    identity = process_document(
        db.settings, db.factory, seeded[1], revision="bad-candidate", extractor=WrongNumber()
    )
    assert client.get("/v1/events/" + identity, headers=headers).status_code == 404
    assert client.get("/v1/events/" + identity, headers=admin).status_code == 200
    result = client.post(
        f"/v1/ops/events/{identity}/action",
        headers=admin,
        json={"action": "approve", "reason": "attempted invalid approval"},
    )
    assert result.status_code == 409


def test_reject_prior_holds_dependents_and_reapproval_denied(client, seeded, headers, admin, db):
    with db.factory() as s:
        previous = s.scalar(select(m.Event).where(m.Event.document_id == seeded[0]))
        current = s.scalar(select(m.Event).where(m.Event.document_id == seeded[1]))
        old_id, new_id = previous.id, current.id
    reject = client.post(
        f"/v1/ops/events/{old_id}/action",
        headers=admin,
        json={"action": "reject", "reason": "prior evidence invalidated"},
    )
    assert reject.status_code == 200
    assert client.get("/v1/events/" + new_id, headers=headers).status_code == 404
    assert (
        client.post(
            f"/v1/ops/events/{new_id}/action",
            headers=admin,
            json={"action": "approve", "reason": "cannot bypass invalid lineage"},
        ).status_code
        == 409
    )


def test_admin_inspect_and_audit(client, seeded, headers, admin, db):
    for path in [
        "/v1/ops/dashboard",
        "/v1/ops/queues",
        "/v1/ops/documents",
        "/v1/ops/audit",
        "/v1/ops/prompts",
    ]:
        assert client.get(path, headers=headers).status_code == 403
        assert client.get(path, headers=admin).status_code == 200
    raw = client.get(f"/v1/ops/documents/{seeded[0]}/raw", headers=admin)
    assert raw.status_code == 200 and "attachment" in raw.headers["content-disposition"]
    assert client.get("/v1/ops/audit", headers=admin).json()[0]["action"] == "download_raw"


def test_seed_and_worker_replays_are_idempotent(db, seeded):
    assert seed_demo(db.settings, db.factory) == seeded
    for _ in range(30):
        if not run_once(db.settings, db.factory):
            break
    with db.factory() as s:
        assert s.scalar(select(func.count()).select_from(m.Document)) == 6
        assert s.scalar(select(func.count()).select_from(m.Event)) == 6
        assert s.scalar(select(func.count()).select_from(m.AIRun)) == 6
        assert s.scalar(select(func.count()).select_from(m.Job).where(m.Job.state == "dead")) == 0


def test_parser_failure_recorded_in_ops(db, seeded):
    class Explodes:
        def extract(self, chunks):
            raise EvidenceError("fixture_model_timeout")

    with pytest.raises(EvidenceError):
        process_document(db.settings, db.factory, seeded[0], revision="failure-case", extractor=Explodes())
    with db.factory() as s:
        run = s.scalar(select(m.AIRun).where(m.AIRun.error_code == "fixture_model_timeout"))
        assert run.status == "failed" and run.finished_at


def test_body_limit_and_security_headers(client, headers):
    r = client.post("/v1/analytics", headers=headers, content=b"a" * 40000)
    assert r.status_code == 413
    response = client.get("/v1/me", headers=headers)
    assert (
        response.headers["cache-control"] == "no-store"
        and response.headers["x-content-type-options"] == "nosniff"
    )
    UUID(response.headers["x-request-id"])


def test_cors_rejects_unknown_origin(client):
    r = client.options(
        "/v1/me", headers={"Origin": "https://evil.invalid", "Access-Control-Request-Method": "GET"}
    )
    assert "access-control-allow-origin" not in r.headers


@pytest.mark.parametrize(
    "overrides",
    [{}, {"demo_mode": False}, {"auth_mode": "supabase"}, {"allowed_hosts": "*"}, {"storage_mode": "local"}],
)
def test_production_insecure_defaults_fail(overrides):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, environment="production", **overrides)


def test_delete_app_account_cascades_personal_not_provenance(client, seeded, headers, db):
    onboard(client, headers)
    delete_user(db.factory, DEMO_USER_ID)
    with db.factory() as s:
        assert s.get(m.User, DEMO_USER_ID) is None
        assert s.scalar(select(func.count()).select_from(m.Watchlist)) == 0
        assert s.scalar(select(func.count()).select_from(m.Document)) == 6
