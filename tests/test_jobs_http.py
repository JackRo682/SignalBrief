from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

import httpx
import pytest
from signalbrief import jobs
from signalbrief import models as m
from signalbrief.errors import LostLease, ProviderError
from signalbrief.http_client import SafeHTTP, retry_after_seconds
from signalbrief.limits import ProviderLimiter, aware, consume_budget


def queue(db):
    with db.factory.begin() as s:
        return jobs.enqueue(s, "test", {"document_id": "synthetic"}, "unique-job")


def test_job_dedup(db):
    assert queue(db) == queue(db)


def test_claim_fence_success(db):
    identity = queue(db)
    lease = jobs.claim(db.factory, "one")
    assert lease.job_id == identity and jobs.claim(db.factory, "two") is None
    jobs.succeed(db.factory, lease)
    with pytest.raises(LostLease):
        jobs.succeed(db.factory, lease)


def test_expired_lease_reclaimed(db):
    identity = queue(db)
    old = jobs.claim(db.factory, "old", lease_seconds=1)
    with db.factory.begin() as s:
        s.get(m.Job, identity).lease_until = m.now() - timedelta(seconds=1)
    new = jobs.claim(db.factory, "new")
    assert new.token != old.token
    with pytest.raises(LostLease):
        jobs.succeed(db.factory, old)
    jobs.succeed(db.factory, new)


def test_heartbeat_extends_live_lease(db):
    queue(db)
    lease = jobs.claim(db.factory, "one")
    assert jobs.heartbeat(db.factory, lease, 300)
    jobs.succeed(db.factory, lease)
    assert not jobs.heartbeat(db.factory, lease, 300)


def test_retry_honors_long_provider_cooldown(db):
    identity = queue(db)
    lease = jobs.claim(db.factory, "one")
    stamp = m.now()
    jobs.fail(db.factory, lease, ProviderError("quota", True, 7200))
    with db.factory() as s:
        job = s.get(m.Job, identity)
        assert job.state == "retry" and aware(job.available_at) >= stamp + timedelta(seconds=7200)
        assert job.last_error == "quota"


def test_nonretryable_dead_letter(db):
    identity = queue(db)
    lease = jobs.claim(db.factory, "one")
    jobs.fail(db.factory, lease, ProviderError("bad_document"))
    with db.factory() as s:
        assert s.get(m.Job, identity).state == "dead"


def test_final_expired_attempt_not_zombie(db):
    identity = queue(db)
    with db.factory.begin() as s:
        job = s.get(m.Job, identity)
        job.state = "running"
        job.attempts = 5
        job.lease_until = m.now() - timedelta(seconds=1)
    assert jobs.claim(db.factory, "one") is None
    with db.factory() as s:
        assert s.get(m.Job, identity).state == "dead"


def test_budget_shared_across_threads(db):
    stamp = m.now()
    with ThreadPoolExecutor(max_workers=6) as pool:
        outcomes = list(pool.map(lambda _: consume_budget(db.factory, "shared", 5, instant=stamp), range(20)))
    assert sum(outcomes) == 5


def test_limiter_reserves_shared_time_slots(db):
    waits = []
    one = ProviderLimiter(db.factory, "sec", 2, sleep=waits.append)
    two = ProviderLimiter(db.factory, "sec", 2, sleep=waits.append)
    one.acquire()
    two.acquire()
    one.acquire()
    assert len(waits) >= 2 and waits[-1] >= 0.8


@pytest.mark.parametrize(
    "value,expected", [(None, None), ("", None), ("10", 10), ("-1", 0), ("nonsense", None)]
)
def test_retry_after(value, expected):
    assert retry_after_seconds(value) == expected


def test_timeout_and_exponential_retry(settings):
    calls = []
    waits = []

    def handler(request):
        calls.append(1)
        if len(calls) < 3:
            raise httpx.ReadTimeout("do-not-log-url-key", request=request)
        return httpx.Response(200, content=b"ok")

    client = SafeHTTP(settings, transport=httpx.MockTransport(handler), sleep=waits.append, jitter=lambda: 0)
    try:
        assert client.get("https://www.sec.gov/test")[0] == b"ok"
    finally:
        client.close()
    assert len(calls) == 3 and waits == [1, 2]


def test_429_long_retry_after_delegates_to_job(settings):
    waits = []
    client = SafeHTTP(
        settings,
        transport=httpx.MockTransport(lambda r: httpx.Response(429, headers={"Retry-After": "3600"})),
        sleep=waits.append,
    )
    with pytest.raises(ProviderError) as exc:
        client.get("https://www.sec.gov/test")
    client.close()
    assert exc.value.retry_after == 3600 and not waits


@pytest.mark.parametrize("status", [301, 302, 400, 401, 403, 404])
def test_http_does_not_follow_redirect_or_retry_permanent_error(settings, status):
    count = []
    client = SafeHTTP(
        settings,
        transport=httpx.MockTransport(
            lambda r: count.append(1) or httpx.Response(status, headers={"Location": "https://evil.test"})
        ),
    )
    with pytest.raises(ProviderError):
        client.get("https://www.sec.gov/a")
    client.close()
    assert len(count) == 1


def test_stream_size_cap(settings):
    settings.max_download_bytes = 3
    client = SafeHTTP(
        settings, transport=httpx.MockTransport(lambda r: httpx.Response(200, content=b"too large"))
    )
    with pytest.raises(ProviderError):
        client.get("https://www.sec.gov/a")
    client.close()


@pytest.mark.parametrize(
    "url",
    [
        "http://www.sec.gov/a",
        "https://localhost/a",
        "https://127.0.0.1/a",
        "https://www.sec.gov.evil.test/a",
        "https://u:p@www.sec.gov/a",
    ],
)
def test_download_ssrf_guard(settings, url):
    client = SafeHTTP(settings)
    with pytest.raises(ProviderError):
        client.get(url)
    client.close()
