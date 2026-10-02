from fastapi import HTTPException
from sqlalchemy import select

from . import models as m
from .api_schemas import CompanyOut
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


def event_card(session, event, user_id, membership=None):
    company = session.get(m.Company, event.company_id)
    document = session.get(m.Document, event.document_id)
    brief = session.execute(select(m.Brief).where(m.Brief.event_id == event.id)).scalar_one()
    changes = session.execute(select(m.Change).where(m.Change.event_id == event.id)).scalars().all()
    watched, held = membership or memberships(session, user_id)
    changed = len([c for c in changes if c.change_type in ("increased", "decreased", "wording_changed")])
    ranking = rank(event, company.id in watched, company.id in held, document.provider, bool(changed))
    return {
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
    }


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
