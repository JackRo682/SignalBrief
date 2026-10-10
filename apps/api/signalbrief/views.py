from fastapi import HTTPException
from sqlalchemy import select

from . import models as m
from .api_schemas import CompanyOut
from .card_evidence import headline_fact
from .limits import aware
from .ranking import memberships, rank

VISIBLE_STATES = ("published", "superseded")


def company_dict(company):
    return CompanyOut.model_validate(company).model_dump()


def require_company(session, company_id, demo_mode):
    company = session.get(m.Company, company_id)
    if not company or company.is_demo != demo_mode:
        raise HTTPException(404, "company_not_found")
    return company


def require_event(session, event_id, principal, demo_mode):
    event = session.get(m.Event, event_id)
    if not event or not principal.is_admin and event.state not in VISIBLE_STATES:
        raise HTTPException(404, "event_not_found")
    document = session.get(m.Document, event.document_id)
    if document.is_demo != demo_mode:
        raise HTTPException(404, "event_not_found")
    return event


def event_cards(session, events, user_id, membership=None):
    if not events:
        return []
    event_ids = [event.id for event in events]
    companies = {
        c.id: c
        for c in session.scalars(select(m.Company).where(m.Company.id.in_({e.company_id for e in events})))
    }
    documents = {
        d.id: d
        for d in session.scalars(select(m.Document).where(m.Document.id.in_({e.document_id for e in events})))
    }
    briefs = {b.event_id: b for b in session.scalars(select(m.Brief).where(m.Brief.event_id.in_(event_ids)))}
    grouped_changes = {}
    for change in session.scalars(
        select(m.Change).where(m.Change.event_id.in_(event_ids)).order_by(m.Change.id)
    ):
        grouped_changes.setdefault(change.event_id, []).append(change)
    grouped_facts = {}
    for fact in session.scalars(select(m.Fact).where(m.Fact.event_id.in_(event_ids)).order_by(m.Fact.id)):
        if fact.validation_status == "supported":
            grouped_facts.setdefault(fact.event_id, []).append(fact)
    watched, held = membership or memberships(session, user_id)
    result = []
    for event in events:
        company, document, brief = companies[event.company_id], documents[event.document_id], briefs[event.id]
        changes = grouped_changes.get(event.id, [])
        changed = sum(c.change_type in ("increased", "decreased", "wording_changed") for c in changes)
        ranking = rank(event, company.id in watched, company.id in held, document.provider, bool(changed))
        fact = headline_fact(brief.headline, grouped_facts.get(event.id, []), changes, document)
        result.append(
            {
                "id": event.id,
                "company": company_dict(company),
                "event_type": event.event_type,
                "state": event.state,
                "headline": brief.headline,
                "what_happened": brief.what_happened,
                "confidence": event.confidence,
                "materiality": event.materiality,
                "published_at": aware(event.published_at),
                "publication_precision": document.publication_precision,
                "is_demo": document.is_demo,
                "source_tier": None if document.is_demo else 1,
                "source_provider": document.provider,
                "source_url": document.source_url,
                "ranking": ranking,
                "change_count": changed,
                "fact_summary": fact.quote if fact else None,
                "change_summary": [
                    {"field": c.field, "previous_value": c.previous_value, "current_value": c.current_value}
                    for c in changes[:2]
                ],
                "interpretation": brief.interpretation,
                "source_document": {
                    "id": document.id,
                    "title": document.title,
                    "provider": document.provider,
                    "source_url": document.source_url,
                    "published_at": aware(document.published_at),
                },
            }
        )
    return result


def event_card(session, event, user_id, membership=None):
    return event_cards(session, [event], user_id, membership)[0]


def event_evidence(session, event_id):
    current = session.execute(select(m.Fact).where(m.Fact.event_id == event_id)).scalars().all()
    prior_ids = set(
        session.execute(
            select(m.Change.previous_fact_id).where(
                m.Change.event_id == event_id, m.Change.previous_fact_id.is_not(None)
            )
        ).scalars()
    )
    previous = (
        session.execute(select(m.Fact).where(m.Fact.id.in_(prior_ids))).scalars().all() if prior_ids else []
    )
    result = []
    for fact, role in [(f, "current") for f in current] + [(f, "previous") for f in previous]:
        chunk = session.get(m.Chunk, fact.chunk_id)
        document = session.get(m.Document, chunk.document_id)
        result.append(
            {
                "fact_id": fact.id,
                "chunk_id": chunk.id,
                "document_id": document.id,
                "quote": fact.quote,
                "location": chunk.location,
                "source_url": document.source_url,
                "source_name": "합성 데모"
                if document.is_demo
                else "OpenDART"
                if document.provider == "dart"
                else "SEC EDGAR",
                "source_tier": None if document.is_demo else 1,
                "published_at": aware(document.published_at),
                "publication_precision": document.publication_precision,
                "is_demo": document.is_demo,
                "role": role,
            }
        )
    return result
