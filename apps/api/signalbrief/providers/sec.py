import json
import re
from datetime import date, datetime, time
from zoneinfo import ZoneInfo

from ..errors import ProviderError
from .base import DocumentDescriptor, Provider


class SecProvider(Provider):
    name = "sec"
    base = "https://data.sec.gov/submissions/"

    def __init__(self, settings, http):
        # SEC identifies clients by declared organization/contact, not an API key.
        if not settings.sec_user_agent or "@" not in settings.sec_user_agent:
            raise ProviderError("sec_user_agent_with_contact_required")
        self.http, self.settings = http, settings
        self.headers = {"User-Agent": settings.sec_user_agent, "Accept": "application/json,text/html,*/*"}

    def close(self):
        self.http.close()

    @staticmethod
    def cik(value):
        if not re.fullmatch(r"\d{1,10}", value):
            raise ProviderError("sec_invalid_cik")
        return value.zfill(10)

    def _json(self, url):
        raw, _ = self.http.get(url, headers=self.headers)
        try:
            data = json.loads(raw)
        except (ValueError, UnicodeError):
            raise ProviderError("sec_invalid_json", True) from None
        if not isinstance(data, dict):
            raise ProviderError("sec_invalid_payload")
        return data

    def _rows(self, company_id, columns):
        accessions = columns.get("accessionNumber", [])
        if not isinstance(accessions, list):
            raise ProviderError("sec_invalid_accessions")
        for key in ("filingDate", "form", "primaryDocument"):
            if len(columns.get(key, [])) != len(accessions):
                raise ProviderError("sec_misaligned_columns")
        for index, accession in enumerate(accessions):
            if not re.fullmatch(r"\d{10}-\d{2}-\d{6}", accession):
                raise ProviderError("sec_invalid_accession")
            filename = columns["primaryDocument"][index]
            # SEC ownership/144 filings use a single official XSL directory.
            # Reject arbitrary directories, traversal, query strings and external URLs.
            if not isinstance(filename, str) or not re.fullmatch(
                r"(?:xsl[A-Za-z0-9_-]{1,40}/)?[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}", filename
            ) or ".." in filename:
                raise ProviderError("sec_unsafe_primary_document")
            try:
                filing_date = date.fromisoformat(columns["filingDate"][index])
            except (ValueError, TypeError):
                raise ProviderError("sec_invalid_filing_date") from None
            accepted = columns.get("acceptanceDateTime", [])
            accepted_raw = accepted[index] if index < len(accepted) else None
            if accepted_raw:
                try:
                    published = datetime.fromisoformat(accepted_raw.replace("Z", "+00:00"))
                except ValueError:
                    raise ProviderError("sec_invalid_acceptance_datetime") from None
                # A missing offset is NOT silently interpreted as UTC.
                if published.tzinfo is None:
                    published = published.replace(tzinfo=ZoneInfo("America/New_York"))
                    timezone_name = "America/New_York (assumed for offsetless SEC timestamp)"
                else:
                    timezone_name = str(published.tzinfo)
                precision = "second"
            else:
                published = datetime.combine(filing_date, time(), tzinfo=ZoneInfo("America/New_York"))
                timezone_name, precision = "America/New_York", "date"
            url = f"https://www.sec.gov/Archives/edgar/data/{int(company_id)}/{accession.replace('-', '')}/{filename}"
            form = columns["form"][index]
            yield DocumentDescriptor(
                provider="sec",
                company_external_id=self.cik(company_id),
                external_id=accession,
                title=f"{form} · {filing_date.isoformat()}",
                form_type=form,
                source_url=url,
                download_url=url,
                published_at=published,
                publication_date=filing_date,
                publication_precision=precision,
                publication_timezone=timezone_name,
                provider_metadata={
                    "cik": self.cik(company_id),
                    "accessionNumber": accession,
                    "filingDate": filing_date.isoformat(),
                    "acceptanceDateTime": accepted_raw,
                    "primaryDocument": filename,
                    "form": form,
                    "is_amendment": form.endswith("/A"),
                },
            )

    def list_documents(self, company_id, since, until):
        company_id = self.cik(company_id)
        if since > until:
            raise ValueError("since must be <= until")
        data = self._json(self.base + "CIK" + company_id + ".json")
        returned_cik = data.get("cik")
        if returned_cik is not None and self.cik(str(returned_cik)) != company_id:
            raise ProviderError("sec_company_mismatch")
        filings = data.get("filings", {})
        seen = set()

        def emit(columns):
            for document in self._rows(company_id, columns):
                if since <= document.publication_date <= until and document.external_id not in seen:
                    seen.add(document.external_id)
                    yield document

        yield from emit(filings.get("recent", {}))
        for archive in filings.get("files", []):
            try:
                start, end = (
                    date.fromisoformat(archive["filingFrom"]),
                    date.fromisoformat(archive["filingTo"]),
                )
            except (KeyError, ValueError):
                raise ProviderError("sec_invalid_history_range") from None
            if end < since or start > until:
                continue
            name = archive.get("name", "")
            if not re.fullmatch(r"CIK\d{10}-submissions-\d+\.json", name):
                raise ProviderError("sec_unsafe_history_path")
            yield from emit(self._json(self.base + name))

    def get_document(self, company_id, external_id):
        if not re.fullmatch(r"\d{10}-\d{2}-\d{6}", external_id):
            raise ProviderError("sec_invalid_accession")
        # Search the authoritative submissions metadata, including archive pages.
        # Never construct a title/date from an accession number alone.
        for document in self.list_documents(company_id, date(1993, 1, 1), date.today()):
            if document.external_id == external_id:
                return document
        raise ProviderError("sec_document_not_found")

    def download(self, document):
        return self.http.get(document.download_url, headers=self.headers)

    def companies(self):
        data = self._json("https://www.sec.gov/files/company_tickers.json")
        seen = set()
        for row in data.values():
            cik = self.cik(str(row["cik_str"]))
            if cik in seen:
                continue
            seen.add(cik)
            yield {
                "provider": "sec",
                "provider_company_id": cik,
                "name": row["title"],
                "ticker": row["ticker"],
                "market": "US",
                "is_demo": False,
            }
