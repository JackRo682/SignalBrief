"""Local operator commands. Run from repository root or use the installed `signalbrief` entry point."""

import argparse
import json
from datetime import date
from pathlib import Path
from uuid import UUID

from sqlalchemy import delete, select, update

from . import models as m
from .db import create_development_schema, make_engine, session_factory
from .logging_config import configure_logging
from .settings import Settings


def parser():
    p = argparse.ArgumentParser(
        prog="signalbrief", description="Evidence-first financial document application"
    )
    sub = p.add_subparsers(dest="command", required=True)
    sub.add_parser("init-db", help="Development schema only; production uses alembic upgrade head")
    sub.add_parser("seed", help="Explicitly synthetic development data only")
    worker = sub.add_parser("worker")
    worker.add_argument("--once", action="store_true")
    sync = sub.add_parser("sync-companies")
    sync.add_argument("provider", choices=["dart", "sec"])
    companies = sub.add_parser("companies")
    companies.add_argument("--query", default="")
    one = sub.add_parser("ingest-company")
    one.add_argument("company_id")
    one.add_argument("--since", type=date.fromisoformat, required=True)
    one.add_argument("--until", type=date.fromisoformat, default=date.today())
    one.add_argument("--refresh", action="store_true")
    doc = sub.add_parser("ingest-document")
    doc.add_argument("company_id")
    doc.add_argument("external_id")
    scheduled = sub.add_parser("schedule")
    scheduled.add_argument("--lookback-days", type=int, default=7)
    scheduled.add_argument("--limit", type=int, default=500)
    parse = sub.add_parser("parse-document")
    parse.add_argument("document_id")
    parse.add_argument("--revision", default="pipeline-v1")
    sub.add_parser("cleanup-rate-buckets")
    evaluation = sub.add_parser("eval")
    evaluation.add_argument("--dataset", default="evals/datasets/synthetic-v1.jsonl")
    evaluation.add_argument("--output", default="evals/reports")
    evaluation.add_argument("--live", action="store_true")
    index = sub.add_parser("index-document")
    index.add_argument("document_id")
    search = sub.add_parser("vector-search")
    search.add_argument("company_id")
    search.add_argument("query")
    semantic = sub.add_parser("compare-wording")
    semantic.add_argument("previous")
    semantic.add_argument("current")
    remove = sub.add_parser("delete-user")
    remove.add_argument("user_id")
    remove.add_argument("--confirm-user-id", required=True)
    sub.add_parser("check-config", help="Validate configuration without printing secrets")
    return p


def delete_user(factory, user_id):
    """Delete app-owned personal data; preserve financial provenance with anonymized audit references.
    Supabase Auth deletion is intentionally a separate account-administration operation.
    """
    UUID(user_id)
    with factory.begin() as s:
        # Explicit detach for auditable non-personal pipeline records, in addition to FK ON DELETE SET NULL.
        s.execute(update(m.AuditLog).where(m.AuditLog.actor_id == user_id).values(actor_id=None))
        s.execute(update(m.AIRun).where(m.AIRun.user_id == user_id).values(user_id=None))
        s.execute(delete(m.User).where(m.User.id == user_id))
    return {
        "app_user_deleted": user_id,
        "supabase_auth_account_deleted": False,
        "next": "Revoke/delete the corresponding Supabase Auth user separately; otherwise signing in recreates a blank app profile.",
    }


def main(argv=None):
    args = parser().parse_args(argv)
    settings = Settings()
    configure_logging(settings.log_level)
    if args.command == "check-config":
        print(
            json.dumps(
                {
                    "valid": True,
                    "environment": settings.environment,
                    "demo_mode": settings.demo_mode,
                    "auth_mode": settings.auth_mode,
                    "storage_mode": settings.storage_mode,
                    "dart_configured": bool(settings.dart_api_key),
                    "sec_contact_configured": bool(settings.sec_user_agent),
                    "ai_configured": bool(settings.openai_api_key and settings.openai_model),
                },
                ensure_ascii=False,
            )
        )
        return 0
    engine = make_engine(settings)
    factory = session_factory(engine)
    output = None
    try:
        if args.command == "init-db":
            create_development_schema(engine, settings)
            output = {"schema": "created", "dialect": engine.dialect.name}
        elif args.command == "seed":
            from .seed import seed_demo

            output = {"synthetic_document_ids": seed_demo(settings, factory)}
        elif args.command == "worker":
            from .worker import run_forever, run_once

            if args.once:
                output = {"processed": run_once(settings, factory)}
            else:
                run_forever(settings, factory)
        elif args.command == "sync-companies":
            from .ingestion import IngestionService

            output = {"companies": IngestionService(settings, factory).sync_companies(args.provider)}
        elif args.command == "companies":
            with factory() as s:
                q = args.query.replace("%", "\\%").replace("_", "\\_")
                rows = s.execute(
                    select(m.Company)
                    .where(
                        m.Company.is_demo == settings.demo_mode,
                        m.Company.name.ilike("%" + q + "%", escape="\\")
                        | m.Company.ticker.ilike("%" + q + "%", escape="\\"),
                    )
                    .limit(100)
                ).scalars()
                output = [
                    {
                        "id": x.id,
                        "name": x.name,
                        "ticker": x.ticker,
                        "provider": x.provider,
                        "provider_company_id": x.provider_company_id,
                    }
                    for x in rows
                ]
        elif args.command == "ingest-company":
            from .ingestion import IngestionService

            if args.since > args.until:
                raise ValueError("since must be <= until")
            output = IngestionService(settings, factory).company(
                args.company_id, args.since, args.until, refresh=args.refresh
            )
        elif args.command == "ingest-document":
            from .ingestion import IngestionService

            identity, created = IngestionService(settings, factory).document(
                args.company_id, args.external_id
            )
            output = {"document_id": identity, "created": created}
        elif args.command == "schedule":
            from .ingestion import schedule_ingestion

            if not 1 <= args.lookback_days <= 3650 or not 1 <= args.limit <= 10000:
                raise ValueError("schedule arguments out of range")
            output = {"jobs": schedule_ingestion(factory, args.lookback_days, args.limit)}
        elif args.command == "parse-document":
            from .pipeline import process_document

            output = {"event_id": process_document(settings, factory, args.document_id, args.revision)}
        elif args.command == "cleanup-rate-buckets":
            with factory.begin() as s:
                result = s.execute(delete(m.RateBucket).where(m.RateBucket.expires_at < m.now()))
                output = {"removed": result.rowcount}
        elif args.command == "eval":
            from .evaluation import evaluate_file

            output = evaluate_file(settings, factory, Path(args.dataset), Path(args.output), live=args.live)
        elif args.command == "index-document":
            from .vector_search import VectorSearch

            output = {"indexed_chunks": VectorSearch(settings, factory).index_document(args.document_id)}
        elif args.command == "vector-search":
            from .vector_search import VectorSearch

            output = VectorSearch(settings, factory).search(args.company_id, args.query)
        elif args.command == "compare-wording":
            from .ai.client import LiveExtractor, StructuredLLM

            started = m.now()
            run_id = m.uid()
            llm = StructuredLLM(settings, factory)
            with factory.begin() as s:
                s.add(
                    m.AIRun(
                        id=run_id,
                        stage="semantic_comparison",
                        model=settings.openai_model,
                        prompt_version="semantic-v1",
                        pipeline_version="semantic-v1",
                        status="running",
                    )
                )
            try:
                result = LiveExtractor(llm).semantic_compare(args.previous, args.current)
                output = {
                    "suggestion": result.model_dump(),
                    "publication": "not_published_requires_human_review",
                    "run_id": run_id,
                }
                with factory.begin() as s:
                    run = s.get(m.AIRun, run_id)
                    run.status = "needs_review"
                    run.validation_result = result.model_dump()
            except Exception as exc:
                with factory.begin() as s:
                    run = s.get(m.AIRun, run_id)
                    run.status = "failed"
                    run.error_code = getattr(exc, "code", type(exc).__name__)[:100]
                raise
            finally:
                with factory.begin() as s:
                    run = s.get(m.AIRun, run_id)
                    run.finished_at = m.now()
                    run.latency_ms = int((m.now() - started).total_seconds() * 1000)
                    run.model_version = llm.usage.model_version
                    run.input_tokens = llm.usage.input_tokens if llm.usage.measured else None
                    run.output_tokens = llm.usage.output_tokens if llm.usage.measured else None
                    run.cost_usd = llm.usage.cost(settings)
                llm.close()
        elif args.command == "delete-user":
            if args.user_id != args.confirm_user_id:
                raise ValueError("confirmation UUID must exactly match user_id")
            output = delete_user(factory, args.user_id)
        if output is not None:
            print(json.dumps(output, ensure_ascii=False, indent=2, default=str))
    finally:
        engine.dispose()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
