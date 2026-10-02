import io
import json
import re
import zipfile
from datetime import datetime, time
from zoneinfo import ZoneInfo

from defusedxml import ElementTree

from ..errors import ProviderError, QuotaExceeded
from .base import DocumentDescriptor, Provider


class DartProvider(Provider):
    name = "dart"
    base = "https://opendart.fss.or.kr/api/"

    def __init__(self, settings, http):
        if not settings.dart_api_key:
            raise ProviderError("dart_api_key_required")
        self.settings, self.http = settings, http

    def close(self):
        self.http.close()

    def _check_code(self, payload):
        status = payload.get("status")
        if status in ("000", "013"):
            return
        if status == "020":
            # DART quotas vary by account; do not retry every second for a daily quota.
            raise QuotaExceeded("dart_quota_exceeded", True, 3600)
        if status in ("800", "900"):
            raise ProviderError("dart_temporarily_unavailable", True, 60)
        raise ProviderError("dart_" + str(status))

    def _json(self, endpoint, params):
        raw, _ = self.http.get(
            self.base + endpoint, params={"crtfc_key": self.settings.dart_api_key, **params}
        )
        try:
            payload = json.loads(raw)
        except (ValueError, UnicodeError):
            raise ProviderError("dart_invalid_json", True) from None
        if not isinstance(payload, dict):
            raise ProviderError("dart_invalid_payload")
        self._check_code(payload)
        return payload

    @staticmethod
    def company_id(value):
        if not re.fullmatch(r"\d{8}", value):
            raise ProviderError("dart_invalid_company_id")
        return value

    def _descriptor(self, row):
        rid = row.get("rcept_no", "")
        if not re.fullmatch(r"\d{14}", rid):
            raise ProviderError("dart_invalid_receipt_id")
        company = self.company_id(row.get("corp_code", ""))
        try:
            published = datetime.strptime(row["rcept_dt"], "%Y%m%d").date()
        except (KeyError, ValueError):
            raise ProviderError("dart_invalid_publication_date") from None
        return DocumentDescriptor(
            provider="dart",
            company_external_id=company,
            external_id=rid,
            title=row.get("report_nm") or "공시",
            form_type=row.get("report_nm") or "disclosure",
            source_url=f"https://dart.fss.or.kr/dsaf001/main.do?rcpNo={rid}",
            download_url=self.base + "document.xml?rcept_no=" + rid,
            published_at=datetime.combine(published, time(), tzinfo=ZoneInfo("Asia/Seoul")),
            publication_date=published,
            publication_precision="date",
            publication_timezone="Asia/Seoul",
            provider_metadata={
                k: row.get(k)
                for k in (
                    "corp_code",
                    "corp_name",
                    "stock_code",
                    "rcept_no",
                    "report_nm",
                    "flr_nm",
                    "rcept_dt",
                    "rm",
                    "corp_cls",
                )
            },
        )

    def list_documents(self, company_id, since, until):
        company_id = self.company_id(company_id)
        if since > until:
            raise ValueError("since must be <= until")
        page = 1
        while True:
            payload = self._json(
                "list.json",
                {
                    "corp_code": company_id,
                    "bgn_de": since.strftime("%Y%m%d"),
                    "end_de": until.strftime("%Y%m%d"),
                    "page_no": page,
                    "page_count": 100,
                    "sort": "date",
                    "sort_mth": "asc",
                    "last_reprt_at": "N",
                },
            )
            if payload["status"] == "013":
                return
            rows = payload.get("list", [])
            if not isinstance(rows, list):
                raise ProviderError("dart_invalid_list")
            for row in rows:
                item = self._descriptor(row)
                if item.company_external_id != company_id:
                    raise ProviderError("dart_company_mismatch")
                yield item
            total = int(payload.get("total_page", 1))
            if page >= total:
                return
            if not rows or page >= 10000:
                raise ProviderError("dart_pagination_invalid")
            page += 1

    def get_document(self, company_id, external_id):
        if not re.fullmatch(r"\d{14}", external_id):
            raise ProviderError("dart_invalid_receipt_id")
        try:
            receipt_date = datetime.strptime(external_id[:8], "%Y%m%d").date()
        except ValueError:
            raise ProviderError("dart_invalid_receipt_date") from None
        for document in self.list_documents(company_id, receipt_date, receipt_date):
            if document.external_id == external_id:
                return document
        raise ProviderError("dart_document_not_found")

    def download(self, document):
        raw, mime = self.http.get(
            self.base + "document.xml",
            params={"crtfc_key": self.settings.dart_api_key, "rcept_no": document.external_id},
        )
        if not raw.startswith(b"PK"):
            try:
                root = ElementTree.fromstring(raw)
                self._check_code({"status": root.findtext("status")})
            except ProviderError:
                raise
            except Exception:
                raise ProviderError("dart_invalid_document_response") from None
            raise ProviderError("dart_expected_zip")
        return raw, "application/zip"

    def companies(self):
        raw, _ = self.http.get(self.base + "corpCode.xml", params={"crtfc_key": self.settings.dart_api_key})
        if not raw.startswith(b"PK"):
            raise ProviderError("dart_company_list_unavailable")
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            members = archive.infolist()
            if len(members) != 1 or members[0].file_size > 60_000_000:
                raise ProviderError("dart_company_archive_invalid")
            root = ElementTree.fromstring(archive.read(members[0]))
        for row in root.findall("list"):
            ticker = (row.findtext("stock_code") or "").strip()
            if ticker:
                yield {
                    "provider": "dart",
                    "provider_company_id": self.company_id(row.findtext("corp_code") or ""),
                    "name": (row.findtext("corp_name") or ticker).strip(),
                    "ticker": ticker,
                    "market": "KR",
                    "is_demo": False,
                }
