import random
import re
import time
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import urlsplit

import httpx

from .errors import ProviderError, QuotaExceeded

ALLOWED_HOSTS = {"www.sec.gov", "data.sec.gov", "opendart.fss.or.kr"}


def validate_source_url(url: str, allow_demo=False):
    parsed = urlsplit(url)
    allowed = ALLOWED_HOSTS | {"dart.fss.or.kr"}
    if allow_demo:
        allowed |= {"fixtures.signalbrief.invalid"}
    if (
        parsed.scheme != "https"
        or parsed.hostname not in allowed
        or parsed.username
        or parsed.password
        or parsed.port not in (None, 443)
    ):
        raise ProviderError("unsafe_source_url")
    if re.search(r"(api[_-]?key|crtfc_key|token|secret)=", parsed.query, re.I):
        raise ProviderError("credential_in_source_url")
    return url


def retry_after_seconds(value: str | None) -> float | None:
    if not value:
        return None
    try:
        return max(0, float(value))
    except ValueError:
        try:
            return max(0, (parsedate_to_datetime(value) - datetime.now(timezone.utc)).total_seconds())
        except (TypeError, ValueError):
            return None


class SafeHTTP:
    def __init__(self, settings, limiter=None, transport=None, sleep=time.sleep, jitter=random.random):
        self.settings, self.limiter, self.sleep, self.jitter = settings, limiter, sleep, jitter
        self.client = httpx.Client(
            timeout=httpx.Timeout(settings.http_timeout),
            follow_redirects=False,
            transport=transport,
            headers={"Accept-Encoding": "gzip, deflate"},
        )

    def close(self):
        self.client.close()

    def get(self, url: str, *, params=None, headers=None) -> tuple[bytes, str]:
        p = urlsplit(url)
        if (
            p.scheme != "https"
            or p.hostname not in ALLOWED_HOSTS
            or p.port not in (None, 443)
            or p.username
            or p.password
        ):
            raise ProviderError("unapproved_download_host")
        for attempt in range(self.settings.max_retries + 1):
            if self.limiter:
                self.limiter.acquire()
            try:
                with self.client.stream("GET", url, params=params, headers=headers) as response:
                    if response.status_code in (429, 503, 502, 504, 500):
                        delay = retry_after_seconds(response.headers.get("Retry-After"))
                        raise (
                            QuotaExceeded("http_rate_limited", True, delay)
                            if response.status_code == 429
                            else ProviderError("http_temporary", True, delay)
                        )
                    if response.status_code >= 300:
                        raise ProviderError(f"http_{response.status_code}")
                    content_length = response.headers.get("Content-Length", "")
                    if content_length.isdigit() and int(content_length) > self.settings.max_download_bytes:
                        raise ProviderError("document_too_large")
                    output, count = [], 0
                    for chunk in response.iter_bytes():
                        count += len(chunk)
                        if count > self.settings.max_download_bytes:
                            raise ProviderError("document_too_large")
                        output.append(chunk)
                    return b"".join(output), response.headers.get(
                        "Content-Type", "application/octet-stream"
                    ).split(";")[0]
            except (httpx.TimeoutException, httpx.TransportError):
                error = ProviderError("network_timeout_or_transport", True)
            except ProviderError as exc:
                error = exc
            if not error.retryable or attempt >= self.settings.max_retries:
                raise error from None
            delay = max(2**attempt + self.jitter(), error.retry_after or 0)
            # Long provider cooldowns are delegated to durable job scheduling, never shortened.
            if delay > 60:
                raise error from None
            self.sleep(delay)
        raise ProviderError("retry_exhausted")
