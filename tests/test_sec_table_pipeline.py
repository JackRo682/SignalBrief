"""Local disposable DB + actual SEC bytes; extraction is a test double, not live AI."""

import gzip
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient
from signalbrief import models as m
from signalbrief.ai.schemas import ExtractionBatch
from signalbrief.ai.sec_table_evidence import replay_source
from signalbrief.app import create_app
from signalbrief.ingestion import persist_document
from signalbrief.pipeline import process_document, supported_event_evidence
from signalbrief.providers.base import DocumentDescriptor
from signalbrief.storage import make_store
from sqlalchemy import func, select

FIXTURES = Path(__file__).parent / "fixtures/sec"
ADMIN = "00000000-0000-4000-8000-000000000001"
USER = "00000000-0000-4000-8000-000000000002"


@pytest.fixture
def signing_key():
    return ec.generate_private_key(ec.SECP256R1())


@pytest.fixture
def client(db, signing_key):
    # Real-source realm, local asymmetric signatures. No live OAuth or production DB.
    config = db.settings.model_copy(
        update={
            "demo_mode": False,
            "demo_admin": False,
            "auth_mode": "supabase",
            "supabase_url": "https://local-auth.invalid",
            "admin_user_ids": ADMIN,
        }
    )
    app = create_app(config, db.engine)
    app.state.jwks = SimpleNamespace(
        get_signing_key_from_jwt=lambda token: SimpleNamespace(key=signing_key.public_key())
    )
    with TestClient(app) as test_client:
        yield test_client


def signed_headers(signing_key, subject):
    token = jwt.encode(
        {
            "sub": subject,
            "iat": m.now(),
            "exp": m.now() + timedelta(hours=1),
            "iss": "https://local-auth.invalid/auth/v1",
            "aud": "authenticated",
            "role": "authenticated",
        },
        signing_key,
        algorithm="ES256",
        headers={"kid": "local-test"},
    )
    return {"Authorization": "Bearer " + token}


@pytest.fixture
def headers(signing_key):
    return signed_headers(signing_key, USER)


@pytest.fixture
def admin(signing_key):
    return signed_headers(signing_key, ADMIN)


class RecordedCellExtractor:
    def __init__(self, fault=None):
        self.fault = fault

    def extract(self, chunks):
        facts = [f.claim(chunks[0].id) for f in replay_source(chunks[0].text).facts]
        if self.fault == "wrong_number":
            facts[0].value_raw = "9999999"
        if self.fault == "omitted":
            facts.pop()
        return ExtractionBatch(event_type="earnings", facts=facts, scheduled_dates=[])


@pytest.fixture
def sec_document(db):
    raw = gzip.decompress((FIXTURES / "aapl-20260328.htm.gz").read_bytes())
    ref = json.loads((FIXTURES / "aapl-20260328.reference.json").read_text())
    with db.factory.begin() as s:
        company = m.Company(
            name="Apple Inc.",
            ticker="AAPL",
            market="NASDAQ",
            provider="sec",
            provider_company_id="0000320193",
            is_demo=False,
        )
        s.add(company)
        s.flush()
        company_id = company.id
    descriptor = DocumentDescriptor(
        provider="sec",
        company_external_id="0000320193",
        external_id="0000320193-26-000013",
        title="10-Q 2026-05-01",
        form_type="10-Q",
        source_url=ref["source_url"],
        download_url=ref["source_url"],
        published_at="2026-05-01T14:01:00Z",
        publication_date="2026-05-01",
        publication_precision="second",
        publication_timezone="UTC",
        provider_metadata={"fixture": "real public SEC original, isolated local replay"},
        is_demo=False,
    )
    identity, created = persist_document(
        db.factory, make_store(db.settings), company_id, descriptor, raw, "text/html"
    )
    assert created
    db.settings.auto_publish_validated = False
    return identity, company_id


def run(db, identity, fault=None):
    return process_document(
        db.settings, db.factory, identity, revision="sec-tables-v1", extractor=RecordedCellExtractor(fault)
    )


def test_real_source_local_approval_feed_rejection_audit_and_idempotence(
    db, client, headers, admin, sec_document
):
    identity, company = sec_document
    event_id = run(db, identity)
    assert run(db, identity) == event_id
    with db.factory() as s:
        event = s.get(m.Event, event_id)
        assert event.state == "needs_review" and supported_event_evidence(s, event)
        assert s.scalar(select(func.count()).select_from(m.Event)) == 1
        assert s.scalar(select(func.count()).select_from(m.AIRun)) == 1
        assert s.scalar(select(func.count()).select_from(m.Fact)) == 8
    assert client.put(f"/v1/watchlist/{company}", headers=headers).status_code == 204
    endpoint = f"/v1/ops/events/{event_id}/action"
    assert (
        client.post(
            endpoint, headers=headers, json={"action": "approve", "reason": "not an admin"}
        ).status_code
        == 403
    )
    assert client.get(f"/v1/events/{event_id}", headers=headers).status_code == 404
    assert (
        client.post(
            endpoint, headers=admin, json={"action": "approve", "reason": "local evidence replay test"}
        ).status_code
        == 200
    )
    assert client.get(f"/v1/events/{event_id}", headers=headers).status_code == 200
    with patch("signalbrief.routes.m.now", return_value=datetime(2026, 10, 8, tzinfo=timezone.utc)):
        feed = client.get("/v1/feed?days=180", headers=headers)
    assert feed.status_code == 200 and event_id in feed.text
    assert (
        client.post(
            endpoint, headers=admin, json={"action": "reject", "reason": "local rejection replay test"}
        ).status_code
        == 200
    )
    assert client.get(f"/v1/events/{event_id}", headers=headers).status_code == 404
    with patch("signalbrief.routes.m.now", return_value=datetime(2026, 10, 8, tzinfo=timezone.utc)):
        assert event_id not in client.get("/v1/feed?days=180", headers=headers).text
    with db.factory() as s:
        actions = set(s.scalars(select(m.AuditLog.action).where(m.AuditLog.target_id == event_id)))
        assert {"approve", "reject"} <= actions


@pytest.mark.parametrize("fault", ["wrong_number", "omitted"])
def test_bad_or_incomplete_model_output_cannot_be_approved(db, client, admin, sec_document, fault):
    identity, _ = sec_document
    event_id = run(db, identity, fault)
    with db.factory() as s:
        event = s.get(m.Event, event_id)
        assert event.state == "blocked" and not supported_event_evidence(s, event)
        assert s.get(m.AIRun, event.run_id).validation_result["candidates"]
    assert (
        client.post(
            f"/v1/ops/events/{event_id}/action",
            headers=admin,
            json={"action": "approve", "reason": "must not bypass validation"},
        ).status_code
        == 409
    )


def test_approval_replays_raw_hash_and_fact_fields(db, sec_document):
    identity, _ = sec_document
    event_id = run(db, identity)
    with db.factory.begin() as s:
        event = s.get(m.Event, event_id)
        fact = s.scalar(select(m.Fact).where(m.Fact.event_id == event_id))
        fact.value_raw = "9999999"
        s.flush()
        assert not supported_event_evidence(s, event)
