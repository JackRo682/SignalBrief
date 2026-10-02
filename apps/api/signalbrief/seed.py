"""Synthetic companies and fictional filings; no invented real-company financial facts."""

from datetime import timedelta

from sqlalchemy import select

from . import models as m
from .ingestion import persist_document
from .limits import dialect_insert
from .pipeline import process_document, stable_id
from .providers.base import DocumentDescriptor
from .storage import make_store

DEMO_USER_ID = "00000000-0000-4000-8000-000000000001"
DEMO_ADMIN_ID = "00000000-0000-4000-8000-000000000002"

DEMO_COMPANIES = [
    ("DEMO1", "한빛 데이터 · 데모", "HBD", "KR", "Revenue", "KRW 억원", "100", "128"),
    ("DEMO2", "Signal Devices · 데모", "SGDV", "US", "CAPEX", "USD million", "80", "120"),
    ("DEMO3", "Orbit Industrial · 데모", "ORBI", "US", "Dividend", "USD", "2", "2.2"),
]


def seed_demo(settings, factory):
    if not settings.demo_mode or settings.environment == "production":
        raise RuntimeError("Synthetic fixtures are forbidden outside demo mode")
    store = make_store(settings)
    stamp = m.now().replace(microsecond=0)
    document_ids = []
    for i, (external, name, ticker, market, field, unit, old, new) in enumerate(DEMO_COMPANIES):
        company_id = stable_id("company", external)
        with factory.begin() as s:
            statement = dialect_insert(s, m.Company).values(
                id=company_id,
                name=name,
                ticker=ticker,
                market=market,
                provider="fixture",
                provider_company_id=external,
                is_demo=True,
                created_at=stamp,
            )
            s.execute(statement.on_conflict_do_nothing(index_elements=[m.Company.id]))
        for version, value in (("previous", old), ("current", new)):
            external_id = f"{external}-{version}-v1"
            with factory() as s:
                existing = s.execute(
                    select(m.Document).where(
                        m.Document.provider == "fixture", m.Document.external_id == external_id
                    )
                ).scalar_one_or_none()
                if existing:
                    document_ids.append(existing.id)
                    continue
            published = (
                stamp - timedelta(days=8, hours=i)
                if version == "previous"
                else stamp - timedelta(hours=2 + i)
            )
            next_date = (stamp + timedelta(days=7 + i)).date().isoformat()
            text = f"""<!doctype html><html lang="en"><body>
<h1>SYNTHETIC DEMO — {name}</h1>
<p>This fictional filing is a software test fixture, not an actual disclosure.</p>
<p>{field}: {value} {unit}; period=FY2026; scope=consolidated; basis=guidance.</p>
<p>Risk: {"Supply risk remains under review." if version == "previous" else "Supply risk requires additional monitoring."}</p>
<p>Next update date: {next_date}</p></body></html>"""
            url = "https://fixtures.signalbrief.invalid/" + external_id + ".html"
            descriptor = DocumentDescriptor(
                provider="fixture",
                company_external_id=external,
                external_id=external_id,
                title=f"합성 공시 · {name} · {version}",
                form_type="synthetic-guidance",
                source_url=url,
                download_url=url,
                published_at=published,
                publication_date=published.date(),
                publication_precision="second",
                publication_timezone="UTC",
                provider_metadata={"synthetic": True, "fixture_version": "v1"},
                is_demo=True,
            )
            identity, _ = persist_document(factory, store, company_id, descriptor, text.encode(), "text/html")
            process_document(settings, factory, identity, store=store)
            document_ids.append(identity)
    return document_ids
