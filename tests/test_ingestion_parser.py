import io
import zipfile
from datetime import date, datetime, timezone
from hashlib import sha256

import pytest
from pydantic import ValidationError
from signalbrief import models as m
from signalbrief.errors import ContentChanged, ParseError, ProviderError
from signalbrief.ingestion import persist_document, schedule_ingestion
from signalbrief.parser import chunk_text, normalized_text
from signalbrief.providers.base import DocumentDescriptor
from signalbrief.storage import LocalBlobStore, validate_key
from sqlalchemy import func, select


def descriptor(**kwargs):
    return DocumentDescriptor(
        **(
            {
                "provider": "fixture",
                "company_external_id": "DEMO-X",
                "external_id": "fixture-001",
                "title": "Synthetic provenance test",
                "form_type": "synthetic",
                "source_url": "https://fixtures.signalbrief.invalid/test",
                "download_url": "https://fixtures.signalbrief.invalid/test",
                "published_at": datetime(2026, 1, 1, tzinfo=timezone.utc),
                "publication_date": date(2026, 1, 1),
                "publication_precision": "date",
                "publication_timezone": "UTC",
                "provider_metadata": {"synthetic": True},
                "is_demo": True,
            }
            | kwargs
        )
    )


def insert_company(db):
    with db.factory.begin() as s:
        c = m.Company(
            provider="fixture",
            provider_company_id="DEMO-X",
            name="TEST synthetic",
            ticker="TEST",
            market="US",
            is_demo=True,
        )
        s.add(c)
        s.flush()
        return c.id


def zip_bytes(name, data):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr(name, data)
    return buffer.getvalue()


def test_idempotency_and_provenance(db):
    store = LocalBlobStore(db.settings.storage_path)
    company = insert_company(db)
    first, inserted = persist_document(
        db.factory, store, company, descriptor(), b"SYNTHETIC source", "text/plain"
    )
    again, changed = persist_document(
        db.factory, store, company, descriptor(), b"SYNTHETIC source", "text/plain"
    )
    assert first == again and inserted and not changed
    with db.factory() as s:
        assert s.scalar(select(func.count()).select_from(m.Document)) == 1
        assert s.scalar(select(func.count()).select_from(m.Job)) == 1
        document = s.get(m.Document, first)
        assert document.source_url == descriptor().source_url and document.publication_precision == "date"
        assert document.ingested_at is not None and document.provider_metadata == {"synthetic": True}
        assert store.get(s.get(m.RawBlob, document.raw_sha256).object_key) == b"SYNTHETIC source"


def test_changed_bytes_preserve_old_url_and_blob(db):
    company = insert_company(db)
    store = LocalBlobStore(db.settings.storage_path)
    identity, _ = persist_document(db.factory, store, company, descriptor(), b"original", "text/plain")
    with pytest.raises(ContentChanged):
        persist_document(db.factory, store, company, descriptor(), b"changed", "text/plain")
    with db.factory() as s:
        document = s.get(m.Document, identity)
        assert document.raw_sha256 == sha256(b"original").hexdigest()
        assert s.scalar(select(func.count()).select_from(m.RawBlob)) == 2
        assert s.scalar(select(m.AuditLog.action)) == "source_content_changed"


def test_blob_dedup_preserves_distinct_filing_identities(db):
    company = insert_company(db)
    store = LocalBlobStore(db.settings.storage_path)
    persist_document(db.factory, store, company, descriptor(), b"same bytes", "text/plain")
    persist_document(
        db.factory, store, company, descriptor(external_id="fixture-002"), b"same bytes", "text/plain"
    )
    with db.factory() as s:
        assert s.scalar(select(func.count()).select_from(m.Document)) == 2
        assert s.scalar(select(func.count()).select_from(m.RawBlob)) == 1


def test_cross_company_provenance_denied(db):
    company = insert_company(db)
    with pytest.raises(ProviderError):
        persist_document(
            db.factory,
            LocalBlobStore(db.settings.storage_path),
            company,
            descriptor(company_external_id="OTHER"),
            b"x",
            "text/plain",
        )


@pytest.mark.parametrize(
    "url",
    [
        "http://www.sec.gov/a",
        "https://evil.test/a",
        "https://u:p@www.sec.gov/a",
        "https://www.sec.gov/a?api_key=secret",
        "https://www.sec.gov:8443/a",
    ],
)
def test_descriptor_forbids_unsafe_or_secret_urls(url):
    with pytest.raises((ProviderError, ValidationError)):
        descriptor(source_url=url)


def test_naive_publication_time_rejected():
    with pytest.raises(ValidationError):
        descriptor(published_at=datetime(2026, 1, 1))


def test_storage_integrity(db):
    store = LocalBlobStore(db.settings.storage_path)
    _, key = store.put(b"abc")
    (db.settings.storage_path / key).write_bytes(b"tampered")
    with pytest.raises(ProviderError):
        store.get(key)


@pytest.mark.parametrize("key", ["../../etc/passwd", "raw/x/y", "raw/aa/../../x", "/etc/passwd"])
def test_key_traversal_denied(key):
    with pytest.raises(ValueError):
        validate_key(key)


def test_parser_ignores_executable_and_hidden_content():
    text = normalized_text(
        b'<html><script>BUY THIS</script><p hidden>HIDDEN</p><p style="display:none">SECRET</p><p>Revenue 120 USD</p><table><tr><td>FY2026</td><td>128</td></tr></table></html>',
        "text/html",
    )
    assert "BUY THIS" not in text and "HIDDEN" not in text and "SECRET" not in text
    assert "Revenue 120 USD" in text and "FY2026 | 128" in text


def test_normalized_offsets_cover_source():
    text = "Evidence line repeated for chunk testing.\n" * 100
    chunks = chunk_text(text, size=250, overlap=35)
    assert chunks[0].char_start == 0 and chunks[-1].char_end == len(text)
    for c in chunks:
        assert (
            c.text == text[c.char_start : c.char_end] and c.text_sha256 == sha256(c.text.encode()).hexdigest()
        )
    for a, b in zip(chunks, chunks[1:]):
        assert b.char_start <= a.char_end


def test_archive_read_without_filesystem_extraction(tmp_path):
    result = normalized_text(
        zip_bytes("../../cannot_write.xml", "<p>Revenue: synthetic</p>"), "application/zip"
    )
    assert "Revenue: synthetic" in result and not (tmp_path / "cannot_write.xml").exists()


@pytest.mark.parametrize(
    "raw",
    [
        b"%PDF-1.4 data",
        b'<!DOCTYPE x SYSTEM "file:///etc/passwd"><x/>',
        b'<!ENTITY x "y"><x/>',
        b"PKinvalid",
        b"",
    ],
)
def test_parser_explicit_failure(raw):
    with pytest.raises(ParseError):
        normalized_text(raw, "application/octet-stream")


def test_zip_bomb_block():
    with pytest.raises(ParseError):
        normalized_text(zip_bytes("big.txt", "x" * 1000000), "application/zip")


def test_no_supported_archive_members():
    with pytest.raises(ParseError):
        normalized_text(zip_bytes("image.png", b"a random binary"), "application/zip")


def test_scheduled_ingestion_only_tracks_selected_live_companies(db):
    with db.factory.begin() as s:
        user = m.User(display_name="owner")
        s.add(user)
        s.flush()
        company = m.Company(
            name="Fake catalog test",
            ticker="CAT",
            market="US",
            provider="sec",
            provider_company_id="0000000042",
            is_demo=False,
        )
        s.add(company)
        s.flush()
        w = m.Watchlist(user_id=user.id, name="Default")
        s.add(w)
        s.flush()
        s.add(m.WatchlistItem(watchlist_id=w.id, company_id=company.id))
    first = schedule_ingestion(db.factory)
    second = schedule_ingestion(db.factory)
    assert len(first) == 1 and first == second
