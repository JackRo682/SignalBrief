import json
from datetime import date, timezone
from pathlib import Path

import httpx
import pytest
from signalbrief import models as m
from signalbrief.errors import ProviderError
from signalbrief.http_client import SafeHTTP
from signalbrief.ingestion import persist_document
from signalbrief.providers.dart import DartProvider
from signalbrief.providers.sec import SecProvider
from signalbrief.storage import LocalBlobStore
from test_ingestion_parser import zip_bytes

FIXTURES = Path(__file__).parent / "fixtures"


def fixture(name):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def http(settings, fn):
    return SafeHTTP(settings, transport=httpx.MockTransport(fn), sleep=lambda _: None)


def test_sec_recent_and_historical_metadata(settings):
    settings.sec_user_agent = "SignalBrief tests contact@example.invalid"
    seen = []

    def handler(request):
        seen.append(request)
        if "submissions-001" in request.url.path:
            return httpx.Response(200, json=fixture("sec-archive.json"))
        return httpx.Response(200, json=fixture("sec-submissions.json"))

    provider = SecProvider(settings, http(settings, handler))
    docs = list(provider.list_documents("42", date(2025, 1, 1), date(2026, 10, 2)))
    provider.close()
    assert len(docs) == 2
    assert all(r.headers["User-Agent"] == settings.sec_user_agent for r in seen)
    current = docs[0]
    assert current.publication_precision == "second" and current.published_at.tzinfo is not None
    assert (
        current.source_url == "https://www.sec.gov/Archives/edgar/data/42/000000004226000001/fixture-10q.htm"
    )
    assert docs[1].publication_precision == "date" and docs[1].provider_metadata["is_amendment"]


def test_sec_single_document_uses_metadata(settings):
    settings.sec_user_agent = "SignalBrief tests contact@example.invalid"
    provider = SecProvider(
        settings, http(settings, lambda r: httpx.Response(200, json=fixture("sec-submissions.json")))
    )
    result = provider.get_document("42", "0000000042-26-000001")
    provider.close()
    assert result.form_type == "10-Q"


@pytest.mark.parametrize("value", ["", "ABC", "12345678901", "../../etc"])
def test_sec_invalid_cik(value):
    with pytest.raises(ProviderError):
        SecProvider.cik(value)


@pytest.mark.parametrize("path", ["../secret.htm", "https://evil.test/a", "x/y.html", "a..htm"])
def test_sec_traversal(settings, path):
    settings.sec_user_agent = "Test contact@example.invalid"
    data = fixture("sec-submissions.json")
    data["filings"]["recent"]["primaryDocument"] = [path]
    provider = SecProvider(settings, http(settings, lambda r: httpx.Response(200, json=data)))
    with pytest.raises(ProviderError):
        list(provider.list_documents("42", date(2026, 1, 1), date(2026, 12, 31)))
    provider.close()


def test_sec_column_mismatch(settings):
    settings.sec_user_agent = "Test contact@example.invalid"
    data = fixture("sec-submissions.json")
    data["filings"]["recent"]["form"] = []
    provider = SecProvider(settings, http(settings, lambda r: httpx.Response(200, json=data)))
    with pytest.raises(ProviderError):
        list(provider.list_documents("42", date(2026, 1, 1), date(2026, 12, 31)))
    provider.close()


def test_sec_company_mismatch(settings):
    settings.sec_user_agent = "Test contact@example.invalid"
    data = fixture("sec-submissions.json")
    data["cik"] = 999
    provider = SecProvider(settings, http(settings, lambda r: httpx.Response(200, json=data)))
    with pytest.raises(ProviderError):
        list(provider.list_documents("42", date(2026, 1, 1), date(2026, 12, 31)))
    provider.close()


def test_dart_date_precision_key_free_provenance(settings):
    settings.dart_api_key = "test-only-secret"
    seen = []

    def handler(request):
        seen.append(request)
        return httpx.Response(200, json=fixture("dart-list.json"))

    provider = DartProvider(settings, http(settings, handler))
    docs = list(provider.list_documents("00000042", date(2026, 10, 1), date(2026, 10, 2)))
    provider.close()
    assert len(docs) == 1 and docs[0].publication_precision == "date"
    assert docs[0].published_at.utcoffset().total_seconds() == 32400
    assert "crtfc_key" not in docs[0].source_url + docs[0].download_url + json.dumps(
        docs[0].provider_metadata
    )
    assert (
        seen[0].url.params["crtfc_key"] == "test-only-secret" and seen[0].url.params["last_reprt_at"] == "N"
    )


@pytest.mark.parametrize(
    "code,retryable",
    [("020", True), ("800", True), ("900", True), ("010", False), ("011", False), ("100", False)],
)
def test_dart_error_codes(settings, code, retryable):
    settings.dart_api_key = "fixture-key"
    provider = DartProvider(settings, http(settings, lambda r: httpx.Response(200, json={"status": code})))
    with pytest.raises(ProviderError) as exc:
        list(provider.list_documents("00000042", date(2026, 1, 1), date(2026, 2, 1)))
    provider.close()
    assert exc.value.retryable is retryable


def test_dart_no_data(settings):
    settings.dart_api_key = "fixture-key"
    provider = DartProvider(settings, http(settings, lambda r: httpx.Response(200, json={"status": "013"})))
    assert list(provider.list_documents("00000042", date(2026, 1, 1), date(2026, 2, 1))) == []
    provider.close()


def test_dart_pagination(settings):
    settings.dart_api_key = "fixture-key"
    pages = []

    def handler(request):
        page = int(request.url.params["page_no"])
        pages.append(page)
        data = fixture("dart-list.json")
        data["total_page"] = 2
        data["list"][0]["rcept_no"] = f"2026100100000{page}"
        return httpx.Response(200, json=data)

    provider = DartProvider(settings, http(settings, handler))
    result = list(provider.list_documents("00000042", date(2026, 10, 1), date(2026, 10, 2)))
    provider.close()
    assert len(result) == 2 and pages == [1, 2]


def test_dart_document_download_and_zip(settings):
    settings.dart_api_key = "fixture-key"
    payload = zip_bytes("test.xml", "<p>Fictional report</p>")
    provider = DartProvider(settings, http(settings, lambda r: httpx.Response(200, content=payload)))
    doc = provider._descriptor(fixture("dart-list.json")["list"][0])
    raw, mime = provider.download(doc)
    provider.close()
    assert raw == payload and mime == "application/zip"


def test_dart_korean_date_roundtrip_is_utc_not_shifted(db):
    provider = DartProvider(
        db.settings.model_copy(update={"dart_api_key": "test"}),
        http(db.settings, lambda r: httpx.Response(200)),
    )
    doc = provider._descriptor(fixture("dart-list.json")["list"][0])
    provider.close()
    with db.factory.begin() as s:
        company = m.Company(
            name="test",
            ticker="TST",
            market="KR",
            provider="dart",
            provider_company_id="00000042",
            is_demo=False,
        )
        s.add(company)
        s.flush()
        identity = company.id
    document_id, _ = persist_document(
        db.factory, LocalBlobStore(db.settings.storage_path), identity, doc, b"synthetic", "text/plain"
    )
    with db.factory() as s:
        row = s.get(m.Document, document_id)
        assert row.published_at == doc.published_at.astimezone(timezone.utc)
        assert row.publication_date == date(2026, 10, 1)
