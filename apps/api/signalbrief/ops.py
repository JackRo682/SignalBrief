from datetime import timedelta
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy import func, select

from . import api_schemas as a
from . import models as m
from .auth import Principal, require_admin
from .errors import EvidenceError
from .jobs import enqueue
from .pipeline import publish_event
from .routes import session
from .storage import make_store
from .views import require_event

router = APIRouter(prefix="/v1/ops", tags=["Admin"])
P = Annotated[Principal, Depends(require_admin)]
S = Annotated[object, Depends(session)]


@router.get("/dashboard")
def dashboard(principal: P, db: S):
    today = m.now().replace(hour=0, minute=0, second=0, microsecond=0)

    def count(model, condition=None):
        query = select(func.count()).select_from(model)
        return db.execute(query.where(condition) if condition is not None else query).scalar_one()

    statuses = dict(db.execute(select(m.Event.state, func.count()).group_by(m.Event.state)).all())
    validations = dict(
        db.execute(select(m.Validation.status, func.count()).group_by(m.Validation.status)).all()
    )
    runs = dict(db.execute(select(m.AIRun.status, func.count()).group_by(m.AIRun.status)).all())
    latency = db.execute(select(func.avg(m.AIRun.latency_ms))).scalar_one()
    cost = db.execute(select(func.sum(m.AIRun.cost_usd))).scalar_one()
    unknown_cost = count(m.AIRun, m.AIRun.cost_usd.is_(None))
    return {
        "metrics": {
            "documents_today_utc": count(m.Document, m.Document.ingested_at >= today),
            "documents_total": count(m.Document),
            "events_total": count(m.Event),
            "ai_runs_total": count(m.AIRun),
            "low_confidence": count(m.Event, m.Event.confidence < 0.7),
            "open_user_reports": count(m.Feedback, m.Feedback.state == "open"),
            "average_pipeline_latency_ms": float(latency) if latency is not None else None,
            "known_cost_usd": str(cost) if cost is not None else None,
            "runs_with_unknown_cost": unknown_cost,
        },
        "event_statuses": statuses,
        "validation_statuses": validations,
        "run_statuses": runs,
        "cost_note": "단가는 환경변수 설정값입니다. 미측정/미설정 비용은 0으로 간주하지 않습니다.",
        "generated_at": m.now(),
    }


@router.get("/queues")
def queues(principal: P, db: S, limit: int = Query(50, ge=1, le=100)):
    events = (
        db.execute(
            select(m.Event)
            .where(m.Event.state.in_(["needs_review", "blocked", "duplicate"]))
            .order_by(m.Event.created_at.desc())
            .limit(limit)
        )
        .scalars()
        .all()
    )
    runs = (
        db.execute(
            select(m.AIRun)
            .where(m.AIRun.status.in_(["failed", "validation_failed"]))
            .order_by(m.AIRun.created_at.desc())
            .limit(limit)
        )
        .scalars()
        .all()
    )
    jobs = (
        db.execute(
            select(m.Job)
            .where(m.Job.state.in_(["dead", "retry", "running"]))
            .order_by(m.Job.created_at.desc())
            .limit(limit)
        )
        .scalars()
        .all()
    )
    reports = (
        db.execute(
            select(m.Feedback)
            .where(m.Feedback.state == "open")
            .order_by(m.Feedback.created_at.desc())
            .limit(limit)
        )
        .scalars()
        .all()
    )
    conflicts = (
        db.execute(
            select(m.AuditLog)
            .where(m.AuditLog.action == "source_content_changed")
            .order_by(m.AuditLog.created_at.desc())
            .limit(limit)
        )
        .scalars()
        .all()
    )
    return {
        "events": [
            {
                "id": x.id,
                "title": x.title,
                "state": x.state,
                "document_id": x.document_id,
                "confidence": x.confidence,
                "run_id": x.run_id,
            }
            for x in events
        ],
        "failed_runs": [a.RunOut.model_validate(x).model_dump(mode="json") for x in runs],
        "jobs": [
            {
                "id": x.id,
                "kind": x.kind,
                "state": x.state,
                "attempts": x.attempts,
                "last_error": x.last_error,
                "available_at": x.available_at,
            }
            for x in jobs
        ],
        "reports": [
            {"id": x.id, "event_id": x.event_id, "rating": x.rating, "comment": x.comment} for x in reports
        ],
        "source_conflicts": [
            {"id": x.id, "document_id": x.target_id, "details": x.details} for x in conflicts
        ],
    }


@router.get("/documents")
def documents(principal: P, db: S, limit: int = Query(100, ge=1, le=200)):
    rows = db.execute(select(m.Document).order_by(m.Document.ingested_at.desc()).limit(limit)).scalars().all()
    return [
        {
            **a.DocumentOut.model_validate(x).model_dump(mode="json"),
            "state": x.state,
            "external_id": x.external_id,
            "company_id": x.company_id,
        }
        for x in rows
    ]


@router.get("/documents/{document_id}")
def inspect_document(document_id: str, principal: P, db: S):
    document = db.get(m.Document, document_id)
    if not document:
        raise HTTPException(404, "document_not_found")
    chunks = (
        db.execute(select(m.Chunk).where(m.Chunk.document_id == document_id).order_by(m.Chunk.ordinal))
        .scalars()
        .all()
    )
    events = (
        db.execute(
            select(m.Event).where(m.Event.document_id == document_id).order_by(m.Event.created_at.desc())
        )
        .scalars()
        .all()
    )
    return {
        "document": a.DocumentOut.model_validate(document).model_dump(mode="json"),
        "provider_metadata": document.provider_metadata,
        "chunks": [
            {
                "id": x.id,
                "text": x.text,
                "location": x.location,
                "sha256": x.text_sha256,
                "parser_version": x.parser_version,
            }
            for x in chunks
        ],
        "events": [{"id": x.id, "state": x.state, "revision": x.revision} for x in events],
    }


@router.get("/documents/{document_id}/raw")
def raw_document(document_id: str, request: Request, principal: P, db: S):
    document = db.get(m.Document, document_id)
    if not document:
        raise HTTPException(404, "document_not_found")
    blob = db.get(m.RawBlob, document.raw_sha256)
    content = make_store(request.app.state.settings).get(blob.object_key)
    db.add(m.AuditLog(actor_id=principal.id, action="download_raw", target_id=document_id, details={}))
    db.commit()
    return Response(
        content,
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": f'attachment; filename="source-{document_id}.bin"',
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get("/runs/{run_id}", response_model=a.RunOut)
def inspect_run(run_id: str, principal: P, db: S):
    run = db.get(m.AIRun, run_id)
    if not run:
        raise HTTPException(404, "run_not_found")
    return run


@router.get("/prompts")
def prompts(principal: P):
    directory = Path(__file__).parent / "prompts"
    return [
        {"version": p.stem, "text": p.read_text(encoding="utf-8")} for p in sorted(directory.glob("*.txt"))
    ]


def hold_dependents(db, rejected_event_id):
    # Rejecting evidence must remove dependent published claims, not leave dangling trusted analyses.
    pending, seen = [rejected_event_id], set()
    while pending:
        event_id = pending.pop()
        if event_id in seen:
            continue
        seen.add(event_id)
        fact_ids = select(m.Fact.id).where(m.Fact.event_id == event_id)
        child_ids = (
            db.execute(select(m.Change.event_id).where(m.Change.previous_fact_id.in_(fact_ids)))
            .scalars()
            .all()
        )
        for child_id in set(child_ids):
            child = db.get(m.Event, child_id)
            if child:
                if child.state in ("published", "superseded"):
                    child.state = "needs_review"
                pending.append(child_id)


@router.post("/events/{event_id}/action")
def action(event_id: str, data: a.AdminAction, request: Request, principal: P, db: S):
    event = require_event(db, event_id, principal, request.app.state.settings.demo_mode)
    job_id = None
    if data.action == "approve":
        try:
            publish_event(db, event)
        except EvidenceError as exc:
            raise HTTPException(409, str(exc)) from None
    elif data.action == "reject":
        event.state = "rejected"
        hold_dependents(db, event.id)
    elif data.action == "rerun":
        revision = "pipeline-v1-review-" + m.uid()
        job_id = enqueue(
            db,
            "parse",
            {"document_id": event.document_id, "revision": revision},
            "parse:" + event.document_id + ":" + revision,
        )
    elif data.action == "mark_duplicate":
        target = db.get(m.Event, data.duplicate_of) if data.duplicate_of else None
        if (
            not target
            or target.id == event.id
            or target.company_id != event.company_id
            or target.state != "published"
        ):
            raise HTTPException(422, "published_same_company_duplicate_target_required")
        event.state, event.duplicate_of = "duplicate", target.id
        hold_dependents(db, event.id)
    db.add(
        m.AuditLog(
            actor_id=principal.id,
            action=data.action,
            target_id=event.id,
            details={"reason": data.reason, "duplicate_of": data.duplicate_of, "job_id": job_id},
        )
    )
    db.commit()
    return {"event_id": event.id, "state": event.state, "job_id": job_id}


@router.post("/ingest", status_code=202)
def ingest(data: a.IngestIn, request: Request, principal: P, db: S):
    company = db.get(m.Company, data.company_id)
    if not company or company.is_demo:
        raise HTTPException(422, "live_company_required_sync_catalog_first")
    settings = request.app.state.settings
    if company.provider == "dart" and not settings.dart_api_key:
        raise HTTPException(409, "dart_api_key_required")
    if company.provider == "sec" and not settings.sec_user_agent:
        raise HTTPException(409, "sec_user_agent_required")
    if data.external_id:
        payload = {"company_id": company.id, "external_id": data.external_id}
        key = f"manual-document:{company.id}:{data.external_id}:{m.now().strftime('%Y%m%d%H')}"
        kind = "ingest_document"
    else:
        payload = {
            "company_id": company.id,
            "since": (m.now().date() - timedelta(days=data.lookback_days)).isoformat(),
            "until": m.now().date().isoformat(),
        }
        key = f"manual-company:{company.id}:{m.now().strftime('%Y%m%d%H')}"
        kind = "ingest_company"
    job_id = enqueue(db, kind, payload, key)
    db.add(
        m.AuditLog(
            actor_id=principal.id,
            action="enqueue_ingestion",
            target_id=company.id,
            details={"job_id": job_id},
        )
    )
    db.commit()
    return {"job_id": job_id}


@router.post("/catalog/sync", status_code=202)
def catalog_sync(data: a.CatalogSyncIn, principal: P, db: S):
    job_id = enqueue(
        db, "sync_companies", {"provider": data.provider}, f"catalog:{data.provider}:{m.now().date()}"
    )
    db.add(
        m.AuditLog(
            actor_id=principal.id, action="sync_catalog", target_id=data.provider, details={"job_id": job_id}
        )
    )
    db.commit()
    return {"job_id": job_id}


@router.post("/jobs/{job_id}/retry", status_code=202)
def retry_job(job_id: str, principal: P, db: S):
    job = db.execute(select(m.Job).where(m.Job.id == job_id).with_for_update()).scalar_one_or_none()
    if not job:
        raise HTTPException(404, "job_not_found")
    if job.state not in ("dead", "retry"):
        raise HTTPException(409, "only_failed_jobs_can_be_retried")
    job.state, job.attempts, job.available_at = "queued", 0, m.now()
    job.lease_token, job.lease_until, job.finished_at = None, None, None
    db.add(m.AuditLog(actor_id=principal.id, action="retry_job", target_id=job_id, details={}))
    db.commit()
    return {"job_id": job_id, "state": "queued"}


@router.post("/reports/{report_id}/resolve", status_code=204)
def resolve_report(report_id: str, principal: P, db: S):
    row = db.get(m.Feedback, report_id)
    if not row:
        raise HTTPException(404, "report_not_found")
    row.state = "resolved"
    db.add(m.AuditLog(actor_id=principal.id, action="resolve_report", target_id=report_id, details={}))
    db.commit()
    return Response(status_code=204)


@router.get("/audit")
def audit(principal: P, db: S, limit: int = Query(100, ge=1, le=200)):
    rows = db.execute(select(m.AuditLog).order_by(m.AuditLog.created_at.desc()).limit(limit)).scalars().all()
    return [
        {
            "id": x.id,
            "actor_id": x.actor_id,
            "action": x.action,
            "target_id": x.target_id,
            "details": x.details,
            "created_at": x.created_at,
        }
        for x in rows
    ]
