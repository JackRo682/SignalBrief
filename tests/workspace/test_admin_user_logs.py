"""Private activity-log regressions on disposable native PostgreSQL only.

The existing workspace fixture replays the deployed schema in a loopback *_test
database. All people, sessions, event contents, and tokens below are synthetic.
Only this new migration and missing Auth-platform fixture fields are added here.
"""
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import text
from test_workspace_schema import A, B
from test_workspace_schema import db as db

pytestmark = pytest.mark.postgres
ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / 'supabase/migrations/20261105020506_admin_user_activity_logs.sql'
ADMIN_SESSION = '50000000-0000-4000-8000-000000000001'
READER_SESSION = '50000000-0000-4000-8000-000000000002'
KST = ZoneInfo('Asia/Seoul')


def identify(conn, user=A, session=ADMIN_SESSION, aal='aal1', role='authenticated', extra=None):
    conn.exec_driver_sql('RESET ROLE')
    claims = {'sub': user, 'session_id': session, 'aal': aal, 'role': role, **(extra or {})}
    conn.execute(text("select set_config('request.jwt.claim.sub',:u,true)"), {'u': user or ''})
    conn.execute(text("select set_config('request.jwt.claims',:claims,true)"),
                 {'claims': json.dumps(claims)})
    assert role in ('authenticated', 'anon')
    conn.exec_driver_sql(f'SET LOCAL ROLE {role}')


@pytest.fixture
def activity(db):
    savepoint = db.begin_nested()
    db.exec_driver_sql('RESET ROLE')
    db.exec_driver_sql("""
      ALTER TABLE auth.users ADD COLUMN banned_until timestamptz;
      ALTER TABLE auth.users ADD COLUMN deleted_at timestamptz;
      CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
      $$ SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
      GRANT EXECUTE ON FUNCTION auth.jwt() TO authenticated,anon;
    """)
    with db.connection.driver_connection.cursor() as cursor:
        cursor.execute(MIGRATION.read_text(), prepare=False)
    for user, session in ((A, ADMIN_SESSION), (B, READER_SESSION)):
        identify(db, user, session)
        db.exec_driver_sql('select public.sb_initialize_profile()')
    db.exec_driver_sql('RESET ROLE')
    db.execute(text('insert into app_private.sb_admin_users(user_id) values(:u)'), {'u': A})
    db.exec_driver_sql('update auth.users set email_confirmed_at=now()')
    db.exec_driver_sql('update public.users set analytics_consent=true')
    identify(db)
    yield db
    savepoint.rollback()


def filters(conn, **changes):
    today = conn.exec_driver_sql("select (now() at time zone 'Asia/Seoul')::date").scalar()
    return {'from': (today - timedelta(days=6)).isoformat(), 'to': today.isoformat(),
            'user_id': '', 'event': '', 'screen': '', 'device': '',
            'include_admin': False, 'cursor': None, **changes}


def logs(conn, payload):
    return conn.execute(text('select public.sb_admin_user_logs(cast(:p as jsonb))'),
                        {'p': json.dumps(payload)}).scalar()


def expect_denied(conn, payload, state, message=None):
    savepoint = conn.begin_nested()
    with pytest.raises(Exception) as caught:
        logs(conn, payload)
    savepoint.rollback()
    assert caught.value.orig.sqlstate == state
    if message:
        assert message in str(caught.value.orig)


def execute_as_owner(conn, sql, values=None):
    conn.exec_driver_sql('RESET ROLE')
    result = conn.execute(text(sql), values or {})
    identify(conn)
    return result


def usage(conn, user=B, event='view', screen='today', device='desktop', active_ms=0,
          created_at=None, event_id=None, session_id=None, page_id=None):
    stamp = created_at or conn.exec_driver_sql("select now()-interval '1 minute'").scalar()
    event_id = event_id or str(uuid4())
    values = {'id': event_id, 'user': user, 'event': event, 'screen': screen, 'device': device,
              'active': active_ms, 'stamp': stamp,
              'session': session_id or str(uuid4()), 'page': page_id or str(uuid4())}
    execute_as_owner(conn, """insert into app_private.research_events
      (id,user_id,session_id,page_id,screen,device,kind,active_ms,created_at)
      values(cast(:id as uuid),cast(:user as uuid),cast(:session as uuid),cast(:page as uuid),
        :screen,:device,:event,:active,:stamp)""", values)
    return 'usage:' + event_id


def product(conn, user=B, event='watchlist_added', properties=None, created_at=None, event_id=None):
    event_id = event_id or str(uuid4())
    stamp = created_at or conn.exec_driver_sql("select now()-interval '1 minute'").scalar()
    execute_as_owner(conn, """insert into public.user_events(id,user_id,event_name,properties,created_at)
      values(:id,:user,:event,cast(:properties as json),:stamp)""",
                     {'id': event_id, 'user': user, 'event': event,
                      'properties': json.dumps(properties or {}), 'stamp': stamp})
    return 'product:' + event_id


def test_verified_live_admin_reads_real_empty_result_and_read_is_audited(activity):
    result = logs(activity, filters(activity))
    assert result['items'] == [] and result['has_more'] is False and result['next_cursor'] is None
    assert result['summary'] == {'events': 0, 'users': 0, 'sessions': 0, 'active_ms': 0}
    assert result['timezone'] == 'Asia/Seoul' and result['retention_days'] == 90
    assert datetime.fromisoformat(result['generated_at']).tzinfo is not None
    activity.exec_driver_sql('RESET ROLE')
    audit = activity.exec_driver_sql("""select actor::text,detail from app_private.research_audit
      where action='user_logs_read' order by created_at desc limit 1""").one()
    assert audit.actor == A and audit.detail['returned'] == 0
    assert set(audit.detail) == {'from', 'to', 'include_admin', 'returned'}
    assert activity.exec_driver_sql('select count(*) from app_private.sb_admin_users').scalar() == 1
    assert activity.exec_driver_sql('select bool_and(analytics_consent) from public.users').scalar() is True


def test_anonymous_role_cannot_execute_public_or_private_log_projection(activity):
    payload = filters(activity)
    identify(activity, user=None, session=None, role='anon')
    expect_denied(activity, payload, '42501')
    savepoint = activity.begin_nested()
    with pytest.raises(Exception) as caught:
        activity.exec_driver_sql("select app_private.sb_admin_user_logs('{}')")
    savepoint.rollback()
    assert caught.value.orig.sqlstate == '42501'


def test_authenticated_role_without_a_user_is_denied(activity):
    payload = filters(activity)
    identify(activity, user=None, session=None)
    expect_denied(activity, payload, 'PT401', 'authentication_required')


def test_ordinary_account_cannot_claim_admin_by_editable_metadata_or_email(activity):
    payload = filters(activity)
    identify(activity, B, READER_SESSION, extra={
        'email': 'claimed-admin@example.invalid', 'user_metadata': {'is_admin': True},
        'app_metadata': {'role': 'admin'},
    })
    expect_denied(activity, payload, 'PT403', 'admin_required')


@pytest.mark.parametrize(('field', 'value', 'state', 'message'), [
    ('email_confirmed_at', 'NULL', 'PT403', 'verified_account_required'),
    ('deleted_at', 'now()', 'PT401', 'invalid_or_expired_session'),
    ('banned_until', "now()+interval '1 day'", 'PT401', 'invalid_or_expired_session'),
])
def test_unverified_deleted_and_banned_admins_are_denied(activity, field, value, state, message):
    execute_as_owner(activity, f'update auth.users set {field}={value} where id=cast(:u as uuid)', {'u': A})
    expect_denied(activity, filters(activity), state, message)


@pytest.mark.parametrize('session', [None, '', 'not-a-session', READER_SESSION,
                                    '50000000-0000-4000-8000-999999999999'])
def test_missing_malformed_other_users_and_revoked_sessions_are_denied(activity, session):
    payload = filters(activity)
    identify(activity, session=session)
    expect_denied(activity, payload, 'PT401', 'session_revoked')


def test_expired_admin_session_is_denied_even_with_existing_allowlist_membership(activity):
    execute_as_owner(activity, """update auth.sessions set not_after=now()-interval '1 second'
      where id=cast(:id as uuid)""", {'id': ADMIN_SESSION})
    expect_denied(activity, filters(activity), 'PT401', 'session_revoked')


def test_revoked_admin_membership_takes_effect_without_token_refresh(activity):
    assert logs(activity, filters(activity))['items'] == []
    execute_as_owner(activity, 'delete from app_private.sb_admin_users where user_id=:u', {'u': A})
    expect_denied(activity, filters(activity), 'PT403', 'admin_required')


def test_enrolled_mfa_requires_aal2_at_database_boundary(activity):
    execute_as_owner(activity, """insert into auth.mfa_factors(id,user_id,status)
      values(gen_random_uuid(),cast(:u as uuid),'verified')""", {'u': A})
    payload = filters(activity)
    expect_denied(activity, payload, 'PT403', 'mfa_required')
    identify(activity, aal='aal2')
    assert logs(activity, payload)['items'] == []


@pytest.mark.parametrize('user', [A, B])
@pytest.mark.parametrize('table', ['app_private.research_events', 'public.user_events'])
def test_browser_roles_cannot_bypass_projection_with_raw_table_reads(activity, user, table):
    identify(activity, user, ADMIN_SESSION if user == A else READER_SESSION)
    savepoint = activity.begin_nested()
    with pytest.raises(Exception) as caught:
        activity.exec_driver_sql(f'select * from {table}')
    savepoint.rollback()
    assert caught.value.orig.sqlstate == '42501'


def test_only_consented_records_are_visible_and_revocation_hides_both_sources(activity):
    visible = usage(activity)
    detail = product(activity)
    assert {row['id'] for row in logs(activity, filters(activity))['items']} == {visible, detail}
    execute_as_owner(activity, 'update public.users set analytics_consent=false where id=:u', {'u': B})
    result = logs(activity, filters(activity))
    assert result['items'] == [] and result['summary']['events'] == 0
    assert result['consented_users'] == 1


def test_admin_test_traffic_is_excluded_unless_requested(activity):
    own = usage(activity, user=A)
    other = usage(activity, user=B)
    assert [row['id'] for row in logs(activity, filters(activity))['items']] == [other]
    result = logs(activity, filters(activity, include_admin=True))
    assert {row['id'] for row in result['items']} == {own, other}
    assert {row['user_id']: row['is_admin'] for row in result['items']} == {A: True, B: False}


def test_safe_projection_excludes_raw_product_properties_and_normalizes_known_screen(activity):
    event = product(activity, event='brief_opened', properties={
        'screen': 'event_detail', 'email': 'never-expose@example.invalid',
        'question': 'SYNTHETIC PRIVATE QUESTION', 'access_token': 'SYNTHETIC SECRET',
        'device': 'desktop', 'session_id': str(uuid4()), 'active_ms': 5000,
    })
    result = logs(activity, filters(activity))
    row = result['items'][0]
    assert row['id'] == event and row['screen'] == 'event' and row['source'] == 'product'
    assert row['device'] is row['session_id'] is row['page_id'] is row['active_ms'] is None
    assert set(row) == {'id', 'created_at', 'user_id', 'event', 'screen', 'device',
                        'session_id', 'page_id', 'active_ms', 'source', 'is_admin'}
    serialized = json.dumps(result)
    for forbidden in ('never-expose', 'PRIVATE QUESTION', 'SECRET', 'access_token', 'properties'):
        assert forbidden not in serialized


def test_unknown_product_screens_are_null_and_unknown_event_names_are_excluded(activity):
    product(activity, properties={'screen': '/private?token=synthetic'})
    product(activity, event='unsupported_sensitive_event')
    result = logs(activity, filters(activity))
    assert len(result['items']) == 1 and result['items'][0]['screen'] is None
    assert result['summary']['events'] == 1


def test_filters_apply_to_records_and_full_range_summary(activity):
    picked = usage(activity, event='heartbeat', screen='calendar', device='mobile', active_ms=3500)
    usage(activity, event='heartbeat', screen='calendar', device='desktop', active_ms=7000)
    usage(activity, event='view', screen='today', device='mobile')
    product(activity, event='watchlist_added')
    result = logs(activity, filters(activity, user_id=B, event='heartbeat', screen='calendar', device='mobile'))
    assert [row['id'] for row in result['items']] == [picked]
    assert result['summary'] == {'events': 1, 'users': 1, 'sessions': 1, 'active_ms': 3500}


def test_consent_population_is_independent_of_activity_filters(activity):
    empty_user = '10000000-0000-4000-8000-999999999999'
    full = logs(activity, filters(activity, include_admin=True))
    narrowed = logs(activity, filters(activity, user_id=empty_user, event='heartbeat'))
    assert full['consented_users'] == narrowed['consented_users'] == 2
    assert narrowed['items'] == []


def test_kst_date_range_includes_start_and_excludes_next_day_boundary(activity):
    now = activity.exec_driver_sql('select now()').scalar()
    day = now.astimezone(KST).date() - timedelta(days=1)
    start = datetime.combine(day, datetime.min.time(), tzinfo=KST).astimezone(timezone.utc)
    excluded_before = usage(activity, created_at=start - timedelta(microseconds=1))
    included = usage(activity, created_at=start)
    last = usage(activity, created_at=start + timedelta(days=1) - timedelta(microseconds=1))
    excluded_after = usage(activity, created_at=start + timedelta(days=1))
    result = logs(activity, filters(activity, **{'from': day.isoformat(), 'to': day.isoformat()}))
    assert {row['id'] for row in result['items']} == {included, last}
    assert {row['id'] for row in result['items']}.isdisjoint({excluded_before, excluded_after})


def test_reads_clip_to_ninety_days_and_never_include_future_records(activity):
    now = activity.exec_driver_sql('select now()').scalar()
    old = usage(activity, created_at=now - timedelta(days=91))
    future = usage(activity, created_at=now + timedelta(days=1))
    valid = usage(activity, created_at=now - timedelta(days=2))
    old_day = (now.astimezone(KST).date() - timedelta(days=91)).isoformat()
    old_result = logs(activity, filters(activity, **{'from': old_day, 'to': old_day}))
    assert old_result['items'] == []
    tomorrow = (now.astimezone(KST).date() + timedelta(days=1)).isoformat()
    current = logs(activity, filters(activity, to=tomorrow))
    assert [row['id'] for row in current['items']] == [valid]
    assert {row['id'] for row in current['items']}.isdisjoint({old, future})


def test_equal_timestamp_keyset_pages_do_not_repeat_or_omit_either_event_source(activity):
    stamp = activity.exec_driver_sql("select now()-interval '1 minute'").scalar()
    session = str(uuid4())
    expected = set()
    for index in range(31):
        eid = f'70000000-0000-4000-8000-{index:012d}'
        expected.add(usage(activity, created_at=stamp, event_id=eid, session_id=session))
        expected.add(product(activity, created_at=stamp, event_id=eid))
    query = filters(activity)
    first = logs(activity, query)
    second = logs(activity, {**query, 'cursor': first['next_cursor']})
    assert len(first['items']) == 50 and first['has_more'] is True
    assert len(second['items']) == 12 and second['has_more'] is False and second['next_cursor'] is None
    first_ids = [row['id'] for row in first['items']]
    second_ids = [row['id'] for row in second['items']]
    assert set(first_ids).isdisjoint(second_ids) and set(first_ids + second_ids) == expected
    assert first_ids + second_ids == sorted(expected, reverse=True)
    assert first['next_cursor'] == {key: first['items'][-1][key] for key in ('created_at', 'id')}
    assert first['summary'] == second['summary'] == {'events': 62, 'users': 1, 'sessions': 1, 'active_ms': 0}


@pytest.mark.parametrize('patch', [
    {'actor_id': A}, {'user_id': "' OR true --"}, {'include_admin': 'true'},
    {'device': 'tablet'}, {'screen': 'private'}, {'event': 'raw_error'},
    {'from': '2026-02-30'}, {'from': '2026-01-01', 'to': '2026-04-01'},
    {'from': '2026-02-02', 'to': '2026-02-01'},
    {'cursor': {'id': 'usage:valid-id', 'created_at': 'infinity'}},
    {'cursor': {'id': 'usage:valid-id', 'created_at': '2026-11-01T00:00:00Z', 'role': 'admin'}},
    {'cursor': {'id': 'unknown:id', 'created_at': '2026-11-01T00:00:00Z'}},
    {'cursor': []},
])
def test_direct_rpc_rejects_invalid_filters_and_cursor_injection(activity, patch):
    expect_denied(activity, filters(activity, **patch), 'PT422')


@pytest.mark.parametrize('payload', [None, [], {}, {'from': 'x' * 5000, 'to': '2026-11-05'}])
def test_direct_rpc_rejects_invalid_body_shape_and_oversized_payload(activity, payload):
    expect_denied(activity, payload, 'PT422')


def test_repeated_admin_reads_are_rate_limited(activity):
    execute_as_owner(activity, """insert into public.rate_buckets(key,hits,expires_at)
      values('web:'||:u||':'||floor(extract(epoch from now())/60)::text,120,now()+interval '2 minutes')
      on conflict(key) do update set hits=120""", {'u': A})
    expect_denied(activity, filters(activity), 'PT429')


def test_public_wrapper_is_invoker_and_private_function_has_locked_search_path(activity):
    activity.exec_driver_sql('RESET ROLE')
    rows = activity.exec_driver_sql("""select n.nspname,p.prosecdef,p.proconfig
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where p.proname='sb_admin_user_logs' order by n.nspname""").all()
    assert {row.nspname: row.prosecdef for row in rows} == {'app_private': True, 'public': False}
    assert all('search_path=""' in row.proconfig for row in rows)
    assert activity.exec_driver_sql("""select has_function_privilege('anon',
      'public.sb_admin_user_logs(jsonb)','EXECUTE')""").scalar() is False
    assert activity.exec_driver_sql("""select has_table_privilege('authenticated',
      'public.user_events','SELECT')""").scalar() is False
