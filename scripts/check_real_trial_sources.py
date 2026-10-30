"""Verify the collected real pilot locally, without a model call or hosted mutation."""

import argparse
import json
from pathlib import Path

from signalbrief import models as m
from signalbrief.db import create_development_schema, make_engine, session_factory
from signalbrief.ingestion import persist_document
from signalbrief.pipeline import process_document
from signalbrief.providers.base import DocumentDescriptor
from signalbrief.settings import Settings
from signalbrief.storage import LocalBlobStore
from sqlalchemy import func, select

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--directory", type=Path, required=True)
parser.add_argument("--database-name", default="local-source-check.db")
args = parser.parse_args()
trial = args.directory.resolve()
if Path(args.database_name).name != args.database_name:
    raise SystemExit("Database name must be a filename within the trial directory")
manifest = json.loads((trial / "manifest.json").read_text(encoding="utf-8"))
if manifest["pair_count"] != 1 or manifest["status"] != "COLLECTED_NOT_END_TO_END_VERIFIED":
    raise SystemExit("A completely collected one-pair pilot is required")
dbpath = trial / args.database_name
if dbpath.exists():
    raise SystemExit("Refusing to reuse verification database")
settings = Settings(
    _env_file=None,
    environment="development",
    demo_mode=False,
    demo_seed_on_start=False,
    auth_mode="supabase",
    supabase_url="https://xabzzhtdmqsaqdauthbu.supabase.co",
    database_url="sqlite:///" + dbpath.as_posix(),
    storage_path=trial / "sources",
)
engine = make_engine(settings)
create_development_schema(engine, settings)
factory = session_factory(engine)
store = LocalBlobStore(settings.storage_path)
company_id = m.uid()
with factory.begin() as session:
    session.add(
        m.Company(
            id=company_id,
            name="Apple Inc.",
            ticker="AAPL",
            market="US",
            provider="sec",
            provider_company_id="0000320193",
            is_demo=False,
        )
    )
result = {
    "dataset": "real SEC Apple 10-Q pair",
    "database": "local SQLite, not hosted Supabase",
    "checks": [],
    "ai_calls": 0,
    "live_ai": "BLOCKED: Python credentials missing",
}
for item in manifest["pairs"][0]["documents"]:
    descriptor = DocumentDescriptor.model_validate(item["descriptor"])
    raw = store.get(item["object_key"])
    first, created = persist_document(factory, store, company_id, descriptor, raw, item["content_type"])
    second, duplicate = persist_document(factory, store, company_id, descriptor, raw, item["content_type"])
    assert created and not duplicate and first == second
    try:
        process_document(settings, factory, first, store=store)
        raise AssertionError("Unconfigured live AI unexpectedly succeeded")
    except Exception as error:
        assert getattr(error, "code", None) == "openai_key_and_model_required"
    with factory() as session:
        chunks = session.scalar(select(func.count()).select_from(m.Chunk).where(m.Chunk.document_id == first))
        failed = session.scalar(select(m.AIRun).where(m.AIRun.document_id == first))
        assert failed.status == "failed" and failed.error_code == "openai_key_and_model_required"
        assert chunks == item["chunks"]
    result["checks"].append(
        {
            "accession": descriptor.external_id,
            "idempotent_persistence": "PASS",
            "raw_hash_roundtrip": "PASS",
            "chunks": chunks,
            "missing_key_fails_closed": "PASS",
        }
    )
with factory() as session:
    result["documents"] = session.scalar(select(func.count()).select_from(m.Document))
    result["events"] = session.scalar(select(func.count()).select_from(m.Event))
    assert result["documents"] == 2 and result["events"] == 0
engine.dispose()
(trial / "local-source-check.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
print(json.dumps(result, indent=2))
