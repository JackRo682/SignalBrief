"""Representative overview regressions against isolated native PostgreSQL.

The imported workspace fixture refuses non-loopback URLs and databases without
the _test suffix. All identities and records here are synthetic; no Supabase
project or production endpoint is contacted.
"""
import json
from datetime import datetime, time, timedelta
from pathlib import Path
from uuid import uuid4
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import text
from test_admin_user_logs import (
    ADMIN_SESSION,
    READER_SESSION,
    execute_as_owner,
    identify,
    product,
    usage,
)
from test_admin_user_logs import activity as activity
from test_workspace_schema import A, B
from test_workspace_schema import db as db

pytestmark = pytest.mark.postgres
MIGRATION = Path(__file__).resolve().parents[2] / 'supabase/migrations/20261105050950_admin_overview.sql'
KST = ZoneInfo('Asia/Seoul')


@pytest.fixture
def overview(activity):
    activity.exec_driver_sql('RESET ROLE')
    with activity.connection.driver_connection.cursor() as cursor:
        cursor.execute(MIGRATION.read_text(), prepare=False)
    identify(activity)
    yield activity


def parameters(conn, **changes):
    today = conn.exec_driver_sql("select (now() at time zone 'Asia/Seoul')::date").scalar()
    return {'from': (today - timedelta(days=13)).isoformat(), 'to': today.isoformat(),
            'include_admin': False, **changes}


def read(conn, **changes):
    return conn.execute(text('select public.sb_admin_overview(cast(:p as jsonb))'),
                        {'p': json.dumps(parameters(conn, **changes))}).scalar()


def deny(conn, code, message=None):
    savepoint = conn.begin_nested()
    with pytest.raises(Exception) as caught:
        read(conn)
    savepoint.rollback()
    assert caught.value.orig.sqlstate == code
    if message:
        assert message in str(caught.value.orig)


def at_day(conn, offset):
    today = conn.exec_driver_sql("select (now() at time zone 'Asia/Seoul')::date").scalar()
    return datetime.combine(today + timedelta(days=offset), time(0, 0, 1), tzinfo=KST)


def test_overview_native_private_role_live_session_and_mfa_guards(overview):
    identify(overview, user=None, session=None, role='anon')
    deny(overview, '42501')
    identify(overview, B, READER_SESSION)
    deny(overview, 'PT403', 'admin_required')
    identify(overview, A, None)
    deny(overview, 'PT401', 'session_revoked')
    identify(overview, A, ADMIN_SESSION)
    execute_as_owner(overview, """insert into auth.mfa_factors(id,user_id,status)
      values(gen_random_uuid(),cast(:u as uuid),'verified')""", {'u': A})
    deny(overview, 'PT403', 'mfa_required')
    identify(overview, aal='aal2')
    assert read(overview)['summary']['visitors'] == 0


def test_overview_native_aggregate_privacy_consent_and_current_onboarding(overview):
    session = str(uuid4())
    usage(overview, session_id=session)
    usage(overview, event='heartbeat', active_ms=4500, session_id=session)
    usage(overview, user=A)
    product(overview, properties={'question': 'PRIVATE_QUESTION', 'email': 'PRIVATE_EMAIL'})
    execute_as_owner(overview, """update public.users
      set created_at=now()-interval '3 days',onboarding_completed=true where id=:u""", {'u': B})
    result = read(overview)
    summary = result['summary']
    assert summary['visitors'] == 1 and summary['page_views'] == 1
    assert summary['sessions'] == 1 and summary['active_ms'] == 4500
    assert summary['average_active_ms'] == 4500
    assert summary['core_feature_users'] == 1 and summary['core_feature_rate'] == 1
    assert summary['signup_conversion'] is None
    assert summary['activation'] == {
        'completed': 1, 'eligible': 1, 'rate': 1,
        'basis': 'new_profiles_current_onboarding', 'as_of': result['generated_at'],
    }
    assert 'PRIVATE_' not in json.dumps(result)
    assert read(overview, include_admin=True)['summary']['visitors'] == 2
    execute_as_owner(overview, 'update public.users set analytics_consent=false where id=:u', {'u': B})
    withdrawn = read(overview)
    assert withdrawn['summary']['visitors'] == 0
    assert withdrawn['summary']['core_feature_users'] == 0
    assert withdrawn['summary']['activation']['rate'] is None
    overview.exec_driver_sql('RESET ROLE')
    audit = overview.exec_driver_sql("""select detail from app_private.research_audit
      where action='admin_overview_read' order by created_at desc limit 1""").scalar()
    assert set(audit) == {'from', 'to', 'include_admin'}


def test_overview_native_exact_kst_retention_and_pending_target_day(overview):
    for day in (-10, -9, -3):
        usage(overview, user=B, created_at=at_day(overview, day))
    for day in (-7, 0):
        usage(overview, user=A, created_at=at_day(overview, day))
    result = read(overview, include_admin=True)
    assert result['retention'] == [
        {'day': 1, 'returned': 1, 'eligible': 2, 'pending': 0, 'rate': 0.5},
        {'day': 7, 'returned': 1, 'eligible': 1, 'pending': 1, 'rate': 1},
    ]
    assert result['coverage']['retention_basis'] == 'first_observed_view_in_retained_history'
    first_day = at_day(overview, -10).date().isoformat()
    cohort_only = read(overview, **{'from': first_day, 'to': first_day})
    # Returns after the selected first-observation window are still observed.
    assert cohort_only['retention'][1] == {
        'day': 7, 'returned': 1, 'eligible': 1, 'pending': 0, 'rate': 1,
    }


def test_overview_native_system_api_weighting_retention_and_bounded_error_buckets(overview):
    execute_as_owner(overview, """insert into app_private.research_api_metrics
      (hour,requests,errors,latency_ms,last_seen) values
      (date_trunc('hour',now())-interval '2 hours',20,2,2000,now()-interval '2 hours'),
      (date_trunc('hour',now())-interval '1 hour',80,0,16000,now()-interval '1 hour'),
      (date_trunc('hour',now())-interval '31 days',1000,900,100000,now()-interval '31 days')""")
    first_day = at_day(overview, -89).date().isoformat()
    api = read(overview, **{'from': first_day})['api']
    assert api['requests'] == 100 and api['errors'] == 2
    assert api['error_rate'] == pytest.approx(0.02) and api['mean_latency_ms'] == 180
    assert api['includes_admin'] is True and api['retention_days'] == 30
    assert api['scope'] == 'signalbrief_api_completed_requests'
    assert api['coverage_from'] is not None and api['coverage_to'] is not None
    assert len(api['recent_error_hours']) == 1
    assert set(api['recent_error_hours'][0]) == {'hour', 'requests', 'errors', 'error_rate'}
    assert read(overview, include_admin=True)['api']['error_rate'] == pytest.approx(0.02)
