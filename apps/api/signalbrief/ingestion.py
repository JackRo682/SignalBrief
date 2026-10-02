import logging
from datetime import date, timedelta
from hashlib import sha256

from sqlalchemy import or_, select

from .errors import ContentChanged, ProviderError
from .jobs import enqueue
from .limits import dialect_insert
from .models import AuditLog, Company, Document, Position, RawBlob, WatchlistItem, now, uid
from .providers import make_provider
from .providers.base import DocumentDescriptor
from .storage import make_store

log = logging.getLogger(__name__)


def persist_document(
    factory, store, company_id: str, descriptor: DocumentDescriptor, data: bytes, mime: str
) -> tuple[str, bool]:
    if not data:
        raise ProviderError("empty_document")
    digest, key = store.put(data)
    if sha256(data).hexdigest() != digest:
        raise ProviderError("storage_hash_mismatch")
    conflict = False
    with factory.begin() as s:
        company = s.get(Company, company_id)
        if (
            not company
            or company.provider != descriptor.provider
            or company.provider_company_id != descriptor.company_external_id
            or company.is_demo != descriptor.is_demo
        ):
            raise ProviderError("document_company_provenance_mismatch")
        existing = s.execute(
            select(Document).where(
                Document.provider == descriptor.provider, Document.external_id == descriptor.external_id
            )
        ).scalar_one_or_none()
        if existing:
            if existing.company_id != company_id:
                raise ProviderError("document_identity_collision")
            if existing.raw_sha256 != digest:
                # Preserve original bytes & URL, retain changed blob and an auditable conflict record.
                stmt = dialect_insert(s, RawBlob).values(
                    sha256=digest, object_key=key, byte_length=len(data), content_type=mime, created_at=now()
                )
                s.execute(stmt.on_conflict_do_nothing(index_elements=[RawBlob.sha256]))
                s.add(
                    AuditLog(
                        action="source_content_changed",
                        target_id=existing.id,
                        details={
                            "original_sha256": existing.raw_sha256,
                            "candidate_sha256": digest,
                            "candidate_source_url": descriptor.source_url,
                        },
                    )
                )
                conflict = True
            else:
                return existing.id, False
        if not conflict:
            stmt = dialect_insert(s, RawBlob).values(
                sha256=digest, object_key=key, byte_length=len(data), content_type=mime, created_at=now()
            )
            s.execute(stmt.on_conflict_do_nothing(index_elements=[RawBlob.sha256]))
            identity = uid()
            values = descriptor.model_dump(exclude={"company_external_id"})
            stmt = dialect_insert(s, Document).values(
                id=identity,
                company_id=company_id,
                **values,
                raw_sha256=digest,
                state="queued",
                created_at=now(),
                ingested_at=now(),
            )
            inserted = s.execute(
                stmt.on_conflict_do_nothing(
                    index_elements=[Document.provider, Document.external_id]
                ).returning(Document.id)
            ).scalar_one_or_none()
            row = s.execute(
                select(Document).where(
                    Document.provider == descriptor.provider, Document.external_id == descriptor.external_id
                )
            ).scalar_one()
            if row.company_id != company_id or row.raw_sha256 != digest:
                raise ContentChanged("concurrent_source_content_changed")
            # Document metadata and parse job are one DB transaction (transactional outbox).
            enqueue(
                s,
                "parse",
                {"document_id": row.id, "revision": "pipeline-v1"},
                "parse:" + row.id + ":pipeline-v1",
            )
            result = row.id, bool(inserted)
    if conflict:
        raise ContentChanged("source_content_changed_review_required")
    log.info("document_persisted", extra={"provider": descriptor.provider, "document_id": result[0]})
    return result


class IngestionService:
    def __init__(self, settings, factory, store=None):
        self.settings, self.factory = settings, factory
        self.store = store or make_store(settings)

    def company(self, company_id: str, since: date, until: date, provider=None, refresh=False):
        with self.factory() as s:
            company = s.get(Company, company_id)
            if not company or company.is_demo:
                raise ProviderError("live_company_required")
            provider_name, external_id = company.provider, company.provider_company_id
        own_provider = provider is None
        provider = provider or make_provider(self.settings, self.factory, provider_name)
        inserted, skipped = 0, 0
        try:
            # Process oldest first even if a provider returns reverse-chronological metadata.
            documents = sorted(
                provider.list_documents(external_id, since, until), key=lambda x: x.published_at
            )
            for descriptor in documents:
                with self.factory() as s:
                    found = s.execute(
                        select(Document.id).where(
                            Document.provider == provider_name, Document.external_id == descriptor.external_id
                        )
                    ).scalar_one_or_none()
                if found and not refresh:
                    skipped += 1
                    continue
                raw, mime = provider.download(descriptor)
                _, created = persist_document(self.factory, self.store, company_id, descriptor, raw, mime)
                inserted += int(created)
                skipped += int(not created)
            with self.factory.begin() as s:
                s.get(Company, company_id).last_ingested_at = now()
        finally:
            if own_provider:
                provider.close()
        return {"inserted": inserted, "skipped": skipped}

    def document(self, company_id: str, external_id: str, provider=None):
        with self.factory() as s:
            company = s.get(Company, company_id)
            if not company or company.is_demo:
                raise ProviderError("live_company_required")
            provider_name, company_external = company.provider, company.provider_company_id
        owned = provider is None
        provider = provider or make_provider(self.settings, self.factory, provider_name)
        try:
            descriptor = provider.get_document(company_external, external_id)
            raw, mime = provider.download(descriptor)
            return persist_document(self.factory, self.store, company_id, descriptor, raw, mime)
        finally:
            if owned:
                provider.close()

    def sync_companies(self, name):
        provider = make_provider(self.settings, self.factory, name)
        count = 0
        try:
            for data in provider.companies():
                with self.factory.begin() as s:
                    statement = dialect_insert(s, Company).values(id=uid(), created_at=now(), **data)
                    s.execute(
                        statement.on_conflict_do_update(
                            index_elements=[Company.provider, Company.provider_company_id],
                            set_={"name": data["name"], "ticker": data["ticker"], "market": data["market"]},
                        )
                    )
                count += 1
        finally:
            provider.close()
        return count


def schedule_ingestion(factory, lookback_days=7, limit=500, instant=None):
    stamp = instant or now()
    since = stamp.date() - timedelta(days=lookback_days)
    with factory.begin() as s:
        watched = select(WatchlistItem.company_id)
        held = select(Position.company_id)
        companies = (
            s.execute(
                select(Company)
                .where(Company.is_demo.is_(False), or_(Company.id.in_(watched), Company.id.in_(held)))
                .order_by(Company.last_ingested_at.asc().nulls_first())
                .limit(limit)
            )
            .scalars()
            .all()
        )
        keys = []
        for company in companies:
            keys.append(
                enqueue(
                    s,
                    "ingest_company",
                    {"company_id": company.id, "since": since.isoformat(), "until": stamp.date().isoformat()},
                    f"scheduled:{company.id}:{stamp.strftime('%Y%m%d%H')}",
                )
            )
    return keys
