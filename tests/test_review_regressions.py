from datetime import timedelta

import pytest
from signalbrief import models as m
from signalbrief.ai.evidence import conflicting_facts, validate_fact
from signalbrief.ai.schemas import ExtractedFact, ExtractionBatch
from signalbrief.errors import EvidenceError
from signalbrief.ingestion import persist_document
from signalbrief.pipeline import assert_trusted_history, process_document
from signalbrief.providers.base import DocumentDescriptor
from signalbrief.storage import LocalBlobStore
from sqlalchemy import select


def candidate(quote, value="120", unit="USD million", period="FY2026"):
    return ExtractedFact(
        field="revenue",
        chunk_id="test",
        quote=quote,
        value_raw=value,
        unit=unit,
        period=period,
        scope="consolidated",
        basis="actual",
    )


@pytest.mark.parametrize(
    "quote,value,period",
    [
        (
            "Consolidated FY2026 revenue was 120 USD million; operating income was 20 USD million.",
            "20",
            "FY2026",
        ),
        (
            "Consolidated FY2025 revenue was 100 USD million; FY2026 revenue was 120 USD million.",
            "120",
            "FY2025",
        ),
        ("Consolidated Q1 revenue was 120 USD million; Q2 results are pending.", "120", "Q2"),
        (
            "Consolidated first quarter revenue was 120 USD million; second quarter results are pending.",
            "120",
            "second quarter",
        ),
        ("Consolidated revenue was 120 USD million. Q2 results are pending.", "120", "Q2"),
        ("Consolidated revenue was 120 USD million, Q2 results are pending.", "120", "Q2"),
        ("Consolidated spring revenue was 120 USD million.", "120", "spring"),
        ("Consolidated FY20265 revenue was 120 USD million.", "120", "FY2026"),
        ("Consolidated FY2026 revenue was 120; the unit was USD million.", "120", "FY2026"),
        ("Consolidated FY2026 revenue was low while EBITDA was 120 USD million.", "120", "FY2026"),
    ],
)
def test_ambiguous_metric_value_unit_period_abstains(quote, value, period):
    fact = candidate(quote, value=value, period=period)
    assert validate_fact(fact, {"test": quote}, "test").status != "supported"


@pytest.mark.parametrize("period", ["FY2026", "Q1", "first quarter", "second quarter"])
def test_single_bound_metric_value_context_supported(period):
    quote = f"Consolidated {period} revenue was 120 USD million."
    assert validate_fact(candidate(quote, period=period), {"test": quote}, "test").status == "supported"


@pytest.mark.parametrize("million,expected", [("2", {0, 1, 2}), ("1000", set())])
def test_scale_normalized_conflicts_include_equivalent_duplicates(million, expected):
    quotes = [
        "Consolidated FY2026 revenue was 1 USD billion.",
        f"Consolidated FY2026 revenue was {million} USD million.",
    ]
    facts = [
        candidate(quotes[0], "1", "USD billion"),
        candidate(quotes[0], "1", "USD billion"),
        candidate(quotes[1], million),
    ]
    assert all(validate_fact(fact, {"test": fact.quote}, "test").status == "supported" for fact in facts)
    assert conflicting_facts(facts) == expected


def document(db, text, company_id=None, published=None):
    stamp = published or m.now()
    with db.factory.begin() as session:
        if company_id is None:
            company = m.Company(
                provider="fixture",
                provider_company_id=m.uid(),
                name="Synthetic adversarial",
                ticker="ADV",
                market="US",
                is_demo=True,
            )
            session.add(company)
            session.flush()
        else:
            company = session.get(m.Company, company_id)
        identity, external = company.id, company.provider_company_id
    descriptor = DocumentDescriptor(
        provider="fixture",
        company_external_id=external,
        external_id=m.uid(),
        title="Synthetic review regression",
        form_type="synthetic",
        source_url="https://fixtures.signalbrief.invalid/adversarial",
        download_url="https://fixtures.signalbrief.invalid/adversarial",
        published_at=stamp,
        publication_date=stamp.date(),
        publication_precision="second",
        publication_timezone="UTC",
        provider_metadata={"synthetic": True},
        is_demo=True,
    )
    return persist_document(
        db.factory,
        LocalBlobStore(db.settings.storage_path),
        identity,
        descriptor,
        text.encode("utf-8"),
        "text/plain",
    )[0]


class FixedExtractor:
    def __init__(self, facts):
        self.facts = facts

    def extract(self, chunks):
        return ExtractionBatch(
            event_type="earnings",
            facts=[fact.model_copy(update={"chunk_id": chunks[0].id}) for fact in self.facts],
            scheduled_dates=[],
        )


@pytest.mark.parametrize(
    "kind", ["metric", "period", "quarter", "spelled_quarter", "detached_quarter", "scaled_conflict"]
)
def test_bad_bound_claims_block_auto_publish_and_approval(db, client, admin, headers, kind):
    if kind == "metric":
        text = "Consolidated FY2026 revenue was 120 USD million; operating income was 20 USD million."
        facts = [candidate(text, "20")]
    elif kind == "period":
        text = "Consolidated FY2025 revenue was 100 USD million; FY2026 revenue was 120 USD million."
        facts = [candidate(text, "120", period="FY2025")]
    elif kind in {"quarter", "spelled_quarter", "detached_quarter"}:
        if kind == "quarter":
            text, period = "Consolidated Q1 revenue was 120 USD million; Q2 results are pending.", "Q2"
        elif kind == "spelled_quarter":
            text, period = (
                "Consolidated first quarter revenue was 120 USD million; second quarter results are pending.",
                "second quarter",
            )
        else:
            text, period = "Consolidated revenue was 120 USD million. Q2 results are pending.", "Q2"
        facts = [candidate(text, period=period)]
    else:
        a, b = (
            "Consolidated FY2026 revenue was 1 USD billion.",
            "Consolidated FY2026 revenue was 2 USD million.",
        )
        text, facts = a + "\n" + b, [candidate(a, "1", "USD billion"), candidate(b, "2")]
    doc = document(db, text)
    identity = process_document(
        db.settings.model_copy(update={"auto_publish_validated": True}),
        db.factory,
        doc,
        extractor=FixedExtractor(facts),
    )
    with db.factory() as session:
        assert session.get(m.Event, identity).state == "blocked"
    assert client.get(f"/v1/events/{identity}", headers=headers).status_code == 404
    response = client.post(
        f"/v1/ops/events/{identity}/action",
        headers=admin,
        json={"action": "approve", "reason": "adversarial review cannot bypass"},
    )
    assert response.status_code == 409


def test_approval_revalidates_legacy_supported_fact(db, client, seeded, admin):
    with db.factory.begin() as session:
        event = session.scalar(select(m.Event).where(m.Event.document_id == seeded[1]))
        fact = session.scalar(
            select(m.Fact).where(m.Fact.event_id == event.id, m.Fact.value_raw.is_not(None))
        )
        fact.value_raw = "9999"  # Stored v1 supported verdict must not authorize a changed claim.
        identity = event.id
    assert (
        client.post(
            f"/v1/ops/events/{identity}/action",
            headers=admin,
            json={"action": "approve", "reason": "cached supported verdict is insufficient"},
        ).status_code
        == 409
    )


@pytest.mark.parametrize("action", ["reject", "mark_duplicate"])
def test_rejected_lineage_crosses_superseded_revision(db, client, seeded, headers, admin, action):
    with db.factory() as session:
        a = session.scalar(select(m.Event).where(m.Event.document_id == seeded[0]))
        b = session.scalar(select(m.Event).where(m.Event.document_id == seeded[1]))
        a_id, b_id, company_id, stamp = a.id, b.id, b.company_id, b.published_at
    doc = document(
        db,
        "Revenue: 140 KRW 억원; period=FY2026; scope=consolidated; basis=guidance.",
        company_id,
        stamp + timedelta(hours=1),
    )
    c_id = process_document(db.settings, db.factory, doc)
    process_document(db.settings, db.factory, seeded[1], revision="replacement-b")
    with db.factory() as session:
        assert session.get(m.Event, b_id).state == "superseded"
        assert session.get(m.Event, c_id).state == "published"
        previous = session.scalar(select(m.Change.previous_fact_id).where(m.Change.event_id == c_id))
        assert session.get(m.Fact, previous).event_id == b_id
    assert client.get(f"/v1/events/{c_id}", headers=headers).status_code == 200
    payload = {"action": action, "reason": "invalid root evidence must hold descendants"}
    if action == "mark_duplicate":
        payload["duplicate_of"] = c_id
    assert client.post(f"/v1/ops/events/{a_id}/action", headers=admin, json=payload).status_code == 200
    for identity in [b_id, c_id]:
        with db.factory() as session:
            assert session.get(m.Event, identity).state == "needs_review"
        assert client.get(f"/v1/events/{identity}", headers=headers).status_code == 404
        assert (
            client.post(
                f"/v1/ops/events/{identity}/action",
                headers=admin,
                json={"action": "approve", "reason": "invalid transitive lineage"},
            ).status_code
            == 409
        )
    # Even stale historical state must not bypass the recursive publication gate.
    with db.factory.begin() as session:
        session.get(m.Event, b_id).state = "superseded"
    assert (
        client.post(
            f"/v1/ops/events/{c_id}/action",
            headers=admin,
            json={"action": "approve", "reason": "stale superseded ancestor is untrusted"},
        ).status_code
        == 409
    )
    later = document(
        db,
        "Revenue: 150 KRW 억원; period=FY2026; scope=consolidated; basis=guidance.",
        company_id,
        stamp + timedelta(hours=2),
    )
    later_id = process_document(db.settings, db.factory, later)
    with db.factory() as session:
        assert session.scalar(select(m.Change.previous_fact_id).where(m.Change.event_id == later_id)) is None


def test_cyclic_lineage_blocks_without_looping(db, seeded):
    with db.factory.begin() as session:
        a = session.scalar(select(m.Event).where(m.Event.document_id == seeded[0]))
        b = session.scalar(select(m.Event).where(m.Event.document_id == seeded[1]))
        b_fact = session.scalar(select(m.Fact).where(m.Fact.event_id == b.id, m.Fact.value_raw.is_not(None)))
        a_change = session.scalar(
            select(m.Change).where(m.Change.event_id == a.id, m.Change.field == b_fact.field)
        )
        a_change.previous_fact_id = b_fact.id
        session.flush()
        with pytest.raises(EvidenceError, match="cyclic"):
            assert_trusted_history(session, b)


def test_regular_user_cannot_read_raw_pipeline_document(client, seeded, headers):
    assert client.get(f"/v1/ops/documents/{seeded[0]}/raw", headers=headers).status_code == 403
