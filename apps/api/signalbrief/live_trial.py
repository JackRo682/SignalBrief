"""Bounded, resumable real SEC trial using the existing pipeline and approval UI.

Collection is local and unprivileged. Analysis uses the configured hosted database;
it never approves events. A previous filing must be approved before analyzing its
successor, otherwise the existing comparison engine has no trusted history.
"""

import argparse
import json
from datetime import date
from hashlib import sha256
from pathlib import Path

from sqlalchemy import select

from . import models as m
from .db import make_engine, session_factory
from .errors import ProviderError
from .http_client import SafeHTTP
from .ingestion import persist_document
from .parser import chunk_text, normalized_text
from .pipeline import assert_trusted_history, process_document, supported_event_evidence
from .providers.base import DocumentDescriptor
from .providers.sec import SecProvider
from .settings import Settings
from .storage import LocalBlobStore, make_store

ISSUERS = {"AAPL": "0000320193", "MSFT": "0000789019", "NVDA": "0001045810"}


def selected_pairs(filings, count):
    # Adjacent filings of the same form; actual metric periods are still checked
    # by comparison_kind, never inferred from the filing dates here.
    rows = sorted((d for d in filings if d.form_type == "10-Q"), key=lambda d: d.published_at)
    pairs = list(zip(rows, rows[1:]))[-count:]
    if len(pairs) != count:
        raise ProviderError("not_enough_verified_quarterly_filings")
    return pairs


def collect(settings, directory, count, pilot=None):
    if count not in (1, 10):
        raise ValueError("pair_count_must_be_one_or_ten")
    if count == 10:
        if pilot is None or pilot.get("pair_count") != 1 or pilot.get("status") != "PASS":
            raise ProviderError("verified_one_pair_pilot_required")
    directory.mkdir(parents=True, exist_ok=True)
    manifest = directory / "manifest.json"
    if manifest.exists():
        raise ProviderError("trial_directory_already_used")
    store = LocalBlobStore(directory / "sources")
    provider = SecProvider(settings, SafeHTTP(settings))
    report = {
        "version": 1,
        "pair_count": count,
        "started_at": m.now().isoformat(),
        "status": "COLLECTING",
        "pairs": [],
        "errors": [],
        "not_verified": [
            "live_ai",
            "hosted_persistence",
            "approval",
            "rejection",
            "today_feed",
            "browser_login",
        ],
    }
    try:
        for symbol, number in ({"AAPL": 1} if count == 1 else {"AAPL": 4, "MSFT": 3, "NVDA": 3}).items():
            cik = ISSUERS[symbol]
            # Verify issuer identity and retain the exact official metadata response.
            import time

            time.sleep(0.5)
            raw, _ = provider.http.get(provider.base + "CIK" + cik + ".json", headers=provider.headers)
            data = json.loads(raw)
            if provider.cik(str(data["cik"])) != cik or symbol not in data.get("tickers", []):
                raise ProviderError("sec_ticker_cik_mismatch")
            metadata_hash, _ = store.put(raw)
            filings = list(provider._rows(cik, data["filings"]["recent"]))
            filings = [d for d in filings if d.publication_date <= date.today()]
            for previous, current in selected_pairs(filings, number):
                pair = {
                    "symbol": symbol,
                    "company_name": data["name"],
                    "metadata_sha256": metadata_hash,
                    "documents": [],
                }
                report["pairs"].append(pair)
                for descriptor in (previous, current):
                    time.sleep(0.5)
                    raw, mime = provider.download(descriptor)
                    digest, key = store.put(raw)
                    text = normalized_text(raw, mime)
                    chunks = chunk_text(text)
                    pair["documents"].append(
                        {
                            "descriptor": descriptor.model_dump(mode="json"),
                            "sha256": digest,
                            "object_key": key,
                            "content_type": mime,
                            "bytes": len(raw),
                            "normalized_chars": len(text),
                            "chunks": len(chunks),
                            "within_llm_coverage_budget": len(chunks) <= settings.max_llm_chunks,
                        }
                    )
        report["status"] = "COLLECTED_NOT_END_TO_END_VERIFIED"
    except Exception as exc:
        report["status"] = "BLOCKED"
        report["errors"].append({"stage": "collection", "code": safe_error(exc)})
    finally:
        provider.close()
        manifest.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return report


def safe_error(exc):
    # Never include connection strings, tokens, HTTP bodies or raw exceptions.
    return exc.code if isinstance(exc, ProviderError) else type(exc).__name__


def analyze(settings, directory):
    if settings.environment != "production" or settings.demo_mode or settings.auto_publish_validated:
        raise ProviderError("production_manual_review_configuration_required")
    if not settings.openai_api_key or not settings.openai_model:
        raise ProviderError("python_openai_credentials_missing")
    report = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
    if report["status"] != "COLLECTED_NOT_END_TO_END_VERIFIED":
        raise ProviderError("complete_collection_required")
    source_store = LocalBlobStore(directory / "sources")
    engine = make_engine(settings)
    factory, destination = session_factory(engine), make_store(settings)
    outcome = {"status": "NEEDS_REVIEW", "pairs": [], "errors": []}
    try:
        for pair in report["pairs"]:
            result = {"symbol": pair["symbol"], "events": []}
            outcome["pairs"].append(result)
            for item in pair["documents"]:
                descriptor = DocumentDescriptor.model_validate(item["descriptor"])
                if descriptor.provider != "sec" or descriptor.is_demo:
                    raise ProviderError("real_sec_source_required")
                raw = source_store.get(item["object_key"])
                if sha256(raw).hexdigest() != item["sha256"]:
                    raise ProviderError("trial_source_integrity_failure")
                with factory() as session:
                    company = session.scalar(
                        select(m.Company).where(
                            m.Company.provider == "sec",
                            m.Company.ticker == pair["symbol"],
                            m.Company.provider_company_id == descriptor.company_external_id,
                            m.Company.is_demo.is_(False),
                        )
                    )
                    if company is None:
                        raise ProviderError("verified_hosted_company_missing")
                    company_id = company.id
                document_id, _ = persist_document(
                    factory, destination, company_id, descriptor, raw, item["content_type"]
                )
                event_id = process_document(settings, factory, document_id)
                with factory() as session:
                    event = session.get(m.Event, event_id)
                    result["events"].append(
                        {"document_id": document_id, "event_id": event_id, "state": event.state}
                    )
                    if event.state in {"blocked", "rejected", "duplicate", "superseded"}:
                        raise ProviderError("pilot_event_not_approvable_" + event.state)
                    if event.state != "published":
                        # Resume after review in the existing console; do not create
                        # a current event with permanently insufficient history.
                        result["next"] = "review_in_existing_ops_console_then_resume"
                        break
                    if not supported_event_evidence(session, event):
                        raise ProviderError("published_evidence_invalid")
                    assert_trusted_history(session, event)
        outcome["next"] = "verify_rejection_and_authenticated_today_feed_separately"
    except Exception as exc:
        outcome["status"] = "BLOCKED"
        outcome["errors"].append({"stage": "analysis", "code": safe_error(exc)})
    finally:
        engine.dispose()
        (directory / "analysis.json").write_text(json.dumps(outcome, indent=2), encoding="utf-8")
    return outcome


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("phase", choices=["collect", "analyze"])
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--pairs", type=int, choices=[1, 10], default=1)
    parser.add_argument(
        "--pilot-report", type=Path, help="Human-reviewed E2E report with pair_count=1 and status=PASS"
    )
    args = parser.parse_args(argv)
    try:
        settings = Settings()
        if args.phase == "collect":
            pilot = json.loads(args.pilot_report.read_text(encoding="utf-8")) if args.pilot_report else None
            result = collect(settings, args.directory, args.pairs, pilot)
        else:
            result = analyze(settings, args.directory)
    except Exception as exc:
        result = {"status": "BLOCKED", "errors": [{"code": safe_error(exc)}]}
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return int(result["status"] == "BLOCKED")


if __name__ == "__main__":
    raise SystemExit(main())
