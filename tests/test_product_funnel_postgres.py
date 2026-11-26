"""Actual product-funnel migration on an isolated, disposable PostgreSQL database."""

import json
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from pathlib import Path
from uuid import uuid4

import psycopg
import pytest
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict, make_conninfo

ROOT = Path(__file__).resolve().parents[1]
ADMIN = "10000000-0000-4000-8000-000000000001"
MEMBER = "10000000-0000-4000-8000-000000000002"
SESSION = "20000000-0000-4000-8000-000000000002"
ADMIN_SESSION = "20000000-0000-4000-8000-000000000001"
SECRET = "a" * 64
pytestmark = pytest.mark.postgres


@pytest.fixture
def funnel_db():
    url = os.getenv("SB_TEST_POSTGRES_URL", "").replace("postgresql+psycopg://", "postgresql://")
    if not url:
        pytest.skip("Disposable PostgreSQL required; product funnel SQL was not executed")
    params = conninfo_to_dict(url)
    if params.get("host") not in {"localhost", "127.0.0.1", "::1"} or not params.get("dbname", "").endswith("_test"):
        pytest.fail("Product funnel tests require a loopback *_test database; production is forbidden")
    name = "sb_funnel_test_" + uuid4().hex
    root = psycopg.connect(url, autocommit=True)
    root.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))
    connection = psycopg.connect(make_conninfo(**{**params, "dbname": name}), autocommit=True)
    try:
        connection.execute("""
            DO $$ BEGIN
              IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
              IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
            END $$;
            CREATE SCHEMA auth; CREATE SCHEMA app_private;
            CREATE TABLE auth.users(id uuid PRIMARY KEY,created_at timestamptz DEFAULT now(),email_confirmed_at timestamptz DEFAULT now(),deleted_at timestamptz,banned_until timestamptz);
            CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid,not_after timestamptz);
            CREATE TABLE public.users(id varchar(36) PRIMARY KEY,onboarding_completed boolean DEFAULT false,analytics_consent boolean DEFAULT false);
            CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
            CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
            CREATE FUNCTION app_private.sb_is_admin() RETURNS boolean LANGUAGE sql STABLE AS $$SELECT auth.uid()='10000000-0000-4000-8000-000000000001'::uuid$$;
            CREATE FUNCTION public.sb_require_mfa() RETURNS void LANGUAGE sql AS $$SELECT NULL::void$$;
            CREATE FUNCTION public.sb_rate_limit() RETURNS void LANGUAGE sql AS $$SELECT NULL::void$$;
        """)
        for filename in ["20261110064509_launch_acquisition_analytics.sql", "20261120043507_product_funnel_analytics.sql", "20261126062700_kakao_surface_measurement.sql"]:
            connection.execute((ROOT / "supabase/migrations" / filename).read_text())
        connection.execute("INSERT INTO auth.users(id) VALUES(%s),(%s)", (ADMIN, MEMBER))
        connection.execute("INSERT INTO public.users(id,analytics_consent) VALUES(%s,true),(%s,true)", (ADMIN, MEMBER))
        connection.execute("INSERT INTO auth.sessions VALUES(%s,%s,NULL),(%s,%s,NULL)", (ADMIN_SESSION, ADMIN, SESSION, MEMBER))
        yield connection
    finally:
        connection.close()
        root.execute(sql.SQL("DROP DATABASE {}").format(sql.Identifier(name)))
        root.close()


def role(db, user=None):
    db.execute("RESET ROLE")
    claims = {"session_id": ADMIN_SESSION if user == ADMIN else SESSION} if user else {}
    db.execute("SELECT set_config('request.jwt.claim.sub',%s,false),set_config('request.jwt.claims',%s,false)", (user or "", json.dumps(claims)))
    db.execute("SET ROLE " + ("authenticated" if user else "anon"))


def event(visitor, kind="search_used", **extra):
    value = {"action": "record", "visitor_id": visitor, "secret": SECRET, "id": str(uuid4()), "kind": kind, "page": "search", "source": "disquiet", "product_consent_version": "2026-11-20"}
    if kind == "filter_used":
        value["filter_type"] = "period"
    elif kind in {"event_detail_click", "event_detail_view"}:
        value["event_kind"] = "calendar"
        if kind == "event_detail_view":
            value["page"] = "event_detail"
    value.update(extra)
    return value


def call(db, payload):
    return db.execute("SELECT public.sb_traffic(%s::jsonb)", (json.dumps(payload),)).fetchone()[0]


def landing(db, visitor):
    payload = event(visitor, "page_view", page="home")
    del payload["product_consent_version"]
    return call(db, payload)


def summary(db):
    role(db, ADMIN)
    day = db.execute("SELECT (now() AT TIME ZONE 'Asia/Seoul')::date").fetchone()[0]
    return call(db, {"action": "summary", "from": str(day-timedelta(days=1)), "to": str(day)})


def test_product_events_require_live_account_consent_and_reject_anonymous(funnel_db):
    db = funnel_db
    visitor = str(uuid4())
    role(db)
    with pytest.raises(psycopg.Error) as denied:
        call(db, event(visitor))
    assert denied.value.sqlstate == "PT401"
    db.execute("RESET ROLE")
    db.execute("UPDATE public.users SET analytics_consent=false WHERE id=%s", (MEMBER,))
    role(db, MEMBER)
    assert call(db, event(visitor)) == {"ok": True, "recorded": False}
    db.execute("RESET ROLE")
    assert db.execute("SELECT count(*) FROM app_private.traffic_visitors").fetchone()[0] == 0
    db.execute("UPDATE public.users SET analytics_consent=true WHERE id=%s", (MEMBER,))
    role(db, MEMBER)
    payload = event(visitor)
    assert call(db, payload)["recorded"]
    assert not call(db, payload)["recorded"]


@pytest.mark.parametrize("change", [
    "DELETE FROM auth.sessions WHERE user_id='{member}'",
    "UPDATE auth.sessions SET not_after=now()-interval '1 minute' WHERE user_id='{member}'",
    "UPDATE auth.users SET email_confirmed_at=NULL WHERE id='{member}'",
    "UPDATE auth.users SET deleted_at=now() WHERE id='{member}'",
    "UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id='{member}'",
])
def test_revoked_expired_and_invalid_accounts_cannot_record(funnel_db, change):
    db = funnel_db
    db.execute(change.format(member=MEMBER))
    role(db, MEMBER)
    with pytest.raises(psycopg.Error) as denied:
        call(db, event(str(uuid4())))
    assert denied.value.sqlstate == "PT401"


@pytest.mark.parametrize("extra", [
    {"query": "private text"}, {"url": "https://private.invalid"}, {"user_id": MEMBER},
    {"page": "/search?q=private"}, {"product_consent_version": "2026-11-10"},
    {"product_consent_version": None}, {"filter_type": "company"}, {"event_kind": "calendar"},
    {"page": "event_detail"}, {"source": "person@example.invalid"},
    {"kind": "filter_used", "filter_type": "private selection"},
    {"kind": "event_detail_view", "page": "event_detail"},
])
def test_sql_rejects_extra_personal_or_inconsistent_fields(funnel_db, extra):
    role(funnel_db, MEMBER)
    with pytest.raises(psycopg.Error) as denied:
        call(funnel_db, {**event(str(uuid4())), **extra})
    assert denied.value.sqlstate == "PT422"


def test_private_storage_admin_exclusion_and_read_boundaries(funnel_db):
    db = funnel_db
    role(db, ADMIN)
    assert not call(db, event(str(uuid4())))["recorded"]
    role(db, MEMBER)
    with pytest.raises(psycopg.Error) as denied:
        db.execute("SELECT * FROM app_private.traffic_product_events")
    assert denied.value.sqlstate == "42501"
    with pytest.raises(psycopg.Error) as denied:
        call(db, {"action": "summary", "from": "2026-11-20", "to": "2026-11-20"})
    assert denied.value.sqlstate == "PT403"
    db.execute("RESET ROLE")
    assert not db.execute("SELECT has_schema_privilege('authenticated','app_private','USAGE')").fetchone()[0]
    assert not db.execute("SELECT has_function_privilege('anon','app_private.sb_traffic(jsonb)','EXECUTE')").fetchone()[0]


def test_browser_secret_erasure_and_late_replay(funnel_db):
    db = funnel_db
    visitor = str(uuid4())
    role(db, MEMBER)
    assert landing(db, visitor)["recorded"]
    assert call(db, event(visitor))["recorded"]
    with pytest.raises(psycopg.Error) as denied:
        call(db, event(visitor, secret="b" * 64))
    assert denied.value.sqlstate == "PT403"
    call(db, {"action": "erase", "visitor_id": visitor, "secret": "b" * 64})
    db.execute("RESET ROLE")
    assert db.execute("SELECT count(*) FROM app_private.traffic_product_events").fetchone()[0] == 1
    role(db)
    call(db, {"action": "erase", "visitor_id": visitor, "secret": SECRET})
    role(db, MEMBER)
    assert not call(db, event(visitor))["recorded"]
    db.execute("RESET ROLE")
    assert db.execute("SELECT count(*) FROM app_private.traffic_product_events").fetchone()[0] == 0
    assert db.execute("SELECT count(*) FROM app_private.traffic_events").fetchone()[0] == 0


def test_account_withdrawal_and_profile_deletion_erase_only_product_records(funnel_db):
    db = funnel_db
    visitor = str(uuid4())
    role(db, MEMBER)
    landing(db, visitor)
    call(db, event(visitor))
    db.execute("RESET ROLE")
    db.execute("UPDATE public.users SET analytics_consent=false WHERE id=%s", (MEMBER,))
    assert db.execute("SELECT count(*) FROM app_private.traffic_product_events").fetchone()[0] == 0
    assert db.execute("SELECT count(*) FROM app_private.traffic_events").fetchone()[0] == 1
    db.execute("UPDATE public.users SET analytics_consent=true WHERE id=%s", (MEMBER,))
    role(db, MEMBER)
    call(db, event(visitor))
    db.execute("RESET ROLE")
    db.execute("DELETE FROM public.users WHERE id=%s", (MEMBER,))
    assert db.execute("SELECT count(*) FROM app_private.traffic_product_events").fetchone()[0] == 0


def test_retention_cascades_and_expired_browser_identity_fails_closed(funnel_db):
    db = funnel_db
    visitor = str(uuid4())
    role(db, MEMBER)
    call(db, event(visitor))
    db.execute("RESET ROLE")
    db.execute("UPDATE app_private.traffic_visitors SET created_at=now()-interval '91 days'")
    role(db, MEMBER)
    assert not call(db, event(visitor))["recorded"]
    db.execute("RESET ROLE")
    db.execute("DELETE FROM app_private.traffic_visitors WHERE created_at<now()-interval '90 days'")
    assert db.execute("SELECT count(*) FROM app_private.traffic_product_events").fetchone()[0] == 0


def test_nested_funnel_requires_chronology_and_keeps_public_denominators(funnel_db):
    db = funnel_db
    first, reversed_order, direct = [str(uuid4()) for _ in range(3)]
    role(db, MEMBER)
    for visitor in [first, reversed_order]:
        landing(db, visitor)
    for visitor in [first, reversed_order, direct]:
        for kind in ["search_used", "event_detail_click", "event_detail_view"]:
            call(db, event(visitor, kind))
    db.execute("RESET ROLE")
    # All timestamps are server-owned in actual ingestion; synthetic edits create
    # an independent out-of-order case without relying on test runtime timing.
    db.execute("UPDATE app_private.traffic_events SET created_at=now()-interval '10 minutes'")
    db.execute("UPDATE app_private.traffic_product_events SET created_at=now()-interval '8 minutes' WHERE kind='search_used'")
    db.execute("UPDATE app_private.traffic_product_events SET created_at=now()-interval '6 minutes' WHERE kind='event_detail_click'")
    db.execute("UPDATE app_private.traffic_product_events SET created_at=now()-interval '4 minutes' WHERE kind='event_detail_view'")
    db.execute("UPDATE app_private.traffic_product_events SET created_at=now()-interval '12 minutes' WHERE visitor_id=%s AND kind='search_used'", (reversed_order,))
    result = summary(db)
    assert result["totals"]["visitors"] == 2
    assert result["totals"]["pageviews"] == 2
    assert result["product"] == {
        "landing_visitors": 2, "engaged_visitors": 1, "detail_click_visitors": 1,
        "detail_view_visitors": 1, "search_events": 3, "filter_events": 0,
        "detail_click_events": 3, "detail_view_events": 3,
    }
    role(db, MEMBER)
    call(db, event(reversed_order, "filter_used"))
    # The old click preceded this valid engagement, so stage 3 must stay at one.
    result = summary(db)
    assert result["product"]["engaged_visitors"] == 2
    assert result["product"]["detail_click_visitors"] == 1
    assert result["totals"]["visitors"] == 2


def test_product_rate_limit_preserves_retry_idempotency(funnel_db):
    db = funnel_db
    visitor = str(uuid4())
    role(db, MEMBER)
    first = event(visitor)
    call(db, first)
    for _ in range(119):
        call(db, event(visitor))
    assert not call(db, first)["recorded"]
    with pytest.raises(psycopg.Error) as denied:
        call(db, event(visitor))
    assert denied.value.sqlstate == "PT429"


def test_legacy_acquisition_events_do_not_accept_product_fields(funnel_db):
    role(funnel_db)
    with pytest.raises(psycopg.Error) as denied:
        call(funnel_db, event(str(uuid4()), "page_view", page="home"))
    assert denied.value.sqlstate == "PT422"


def test_summary_uses_korean_calendar_day_boundaries(funnel_db):
    db = funnel_db
    before, inside = str(uuid4()), str(uuid4())
    role(db, MEMBER)
    for visitor in [before, inside]:
        landing(db, visitor)
        call(db, event(visitor))
    db.execute("RESET ROLE")
    day = db.execute("SELECT (now() AT TIME ZONE 'Asia/Seoul')::date-1").fetchone()[0]
    db.execute("UPDATE app_private.traffic_events SET created_at=%s::date::timestamp AT TIME ZONE 'Asia/Seoul'", (day,))
    db.execute("UPDATE app_private.traffic_events SET created_at=created_at-interval '1 microsecond' WHERE visitor_id=%s", (before,))
    db.execute("UPDATE app_private.traffic_product_events SET created_at=(%s::date::timestamp AT TIME ZONE 'Asia/Seoul')+interval '1 minute'", (day,))
    role(db, ADMIN)
    result = call(db, {"action": "summary", "from": str(day), "to": str(day)})
    assert result["totals"]["visitors"] == 1
    assert result["product"]["landing_visitors"] == 1
    assert result["product"]["engaged_visitors"] == 1
    assert result["product"]["search_events"] == 2


def test_inflight_product_write_cannot_race_past_consent_withdrawal(funnel_db):
    db = funnel_db
    started = threading.Event()
    worker_pid = []
    # Connection.info.dsn omits passwords. Reuse the fixture's validated test
    # connection URL and select its isolated database for both extra sessions.
    connection_info = make_conninfo(
        os.environ["SB_TEST_POSTGRES_URL"].replace("postgresql+psycopg://", "postgresql://"),
        dbname=db.info.dbname,
    )
    blocker = psycopg.connect(connection_info)
    blocker.execute("UPDATE public.users SET analytics_consent=false WHERE id=%s", (MEMBER,))

    def record():
        with psycopg.connect(connection_info, autocommit=True) as writer:
            role(writer, MEMBER)
            worker_pid.append(writer.info.backend_pid)
            started.set()
            return call(writer, event(str(uuid4())))

    try:
        with ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(record)
            try:
                assert started.wait(3)
                deadline = time.monotonic()+3
                waiting = False
                while time.monotonic()<deadline:
                    waiting = db.execute("SELECT wait_event_type='Lock' FROM pg_stat_activity WHERE pid=%s", (worker_pid[0],)).fetchone()[0]
                    if waiting:
                        break
                    time.sleep(0.01)
                assert waiting, "Product ingestion must wait for the account-consent row lock"
            finally:
                # Release the writer even when an assertion fails, so pytest can
                # report the failure instead of blocking in executor shutdown.
                blocker.commit()
            assert future.result(timeout=3) == {"ok": True, "recorded": False}
    finally:
        blocker.rollback()
        blocker.close()
    assert db.execute("SELECT count(*) FROM app_private.traffic_product_events").fetchone()[0] == 0

def test_kakao_surface_time_zero_denominator_idempotency_and_erasure(funnel_db):
    db = funnel_db
    visitor = str(uuid4())
    view = {"action": "surface", "visitor_id": visitor, "secret": SECRET, "id": str(uuid4()),
            "source": "kakao", "surface": "home", "release": "1234567",
            "consent_version": "2026-11-26", "active_ms": 0}
    role(db)
    page = event(visitor, "page_view", page="home", source="kakao")
    del page["product_consent_version"]
    assert call(db, page)["recorded"]
    assert call(db, view)["recorded"]
    assert call(db, {**view, "active_ms": 4000})["recorded"]
    assert call(db, {**view, "active_ms": 1000})["recorded"]
    assert call(db, {**view, "id": str(uuid4())})["recorded"]
    product = {**view, "surface": "search", "id": str(uuid4())}
    with pytest.raises(psycopg.Error) as err:
        call(db, product)
    assert err.value.sqlstate == "PT401"
    role(db, MEMBER)
    assert call(db, product)["recorded"]
    assert call(db, event(visitor, source="kakao"))["recorded"]
    result = summary(db)
    home = next(row for row in result["surface_times"] if row["surface"] == "home")
    assert home == {"views": 2, "browsers": 1, "surface": "home", "release": "1234567", "source": "kakao",
                    "mean_ms": 2000, "median_ms": 2000}
    assert result["feature_actions"] == [{"page": "search", "kind": "search_used", "events": 1, "browsers": 1}]
    assert result["sources"][0]["source"] == "kakao"
    db.execute("RESET ROLE")
    db.execute("UPDATE public.users SET analytics_consent=false WHERE id=%s", (MEMBER,))
    assert len(summary(db)["surface_times"]) == 1
    role(db)
    call(db, {"action": "erase", "visitor_id": visitor, "secret": SECRET})
    assert not call(db, view)["recorded"]
    assert summary(db)["surface_times"] == []
