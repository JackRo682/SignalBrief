"""DART row-parser refresh preserves evidence, retry cooldowns and worker ownership."""
import copy
import json
import re
from pathlib import Path

import pytest
from sqlalchemy import text
from test_company_profile_dart import dart_profile as dart_profile
from test_company_profile_dart import db as db
from test_company_profile_dart import enriched as enriched
from test_company_profile_dart import own as own
from test_company_profile_dart import payload, prepare
from test_company_profile_enrichment import LEASE, C, admin

pytestmark = pytest.mark.postgres
MIGRATION = Path(__file__).resolve().parents[2] / 'supabase/migrations/20261102060038_profile_dart_rows_refresh.sql'
SEC_COMPANY = '20000000-0000-4000-8000-000000000099'


def apply(conn):
    with conn.connection.driver_connection.cursor() as cursor:
        cursor.execute(MIGRATION.read_text(), prepare=False)


def row(conn, company_id=C):
    return conn.execute(text('select to_jsonb(cache) from app_private.company_profile_enrichments cache where company_id=:id'),
                        {'id': company_id}).scalar()


def saved(conn, recovered=False):
    value = payload(conn, recovered)
    prepare(conn, value)
    admin(conn, 'save', value)
    return value


@pytest.mark.parametrize('recovered', [False, True])
@pytest.mark.parametrize('timezone', ['UTC', 'Asia/Seoul'])
def test_only_due_times_change_with_explicit_utc_z_and_all_evidence_bytes_preserved(dart_profile, recovered, timezone):
    conn = dart_profile
    conn.execute(text("select set_config('TimeZone',:zone,true)"), {'zone': timezone})
    saved(conn, recovered)
    before = row(conn)
    raw_before = conn.exec_driver_sql("select archives::text,(result-'next_refresh_at')::text from app_private.company_profile_enrichments").one()
    objects_before = conn.exec_driver_sql('select bucket_id,name from storage.objects order by bucket_id,name').all()
    assert admin(conn, 'claim', {'lease': LEASE}) is False
    apply(conn)
    after = row(conn)
    assert conn.exec_driver_sql('select next_refresh_at<=now() from app_private.company_profile_enrichments').scalar()
    assert conn.exec_driver_sql("select (result->>'next_refresh_at')::timestamptz=next_refresh_at from app_private.company_profile_enrichments").scalar()
    assert re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z', after['result']['next_refresh_at'])
    expected = copy.deepcopy(before)
    expected['next_refresh_at'] = after['next_refresh_at']
    expected['result']['next_refresh_at'] = after['result']['next_refresh_at']
    assert after == expected
    assert conn.exec_driver_sql("select archives::text,(result-'next_refresh_at')::text from app_private.company_profile_enrichments").one() == raw_before
    assert conn.exec_driver_sql('select bucket_id,name from storage.objects order by bucket_id,name').all() == objects_before
    assert admin(conn, 'read')['result'] == after['result']
    assert admin(conn, 'claim', {'lease': LEASE}) is True
    assert row(conn)['result'] == after['result']


@pytest.mark.parametrize('has_snapshot', [True, False])
def test_any_active_dart_lease_aborts_without_overwriting_evidence_or_stealing_work(dart_profile, has_snapshot):
    conn = dart_profile
    if has_snapshot:
        saved(conn)
        conn.exec_driver_sql("update app_private.company_profile_enrichments set next_refresh_at=now()-interval '1 second'")
    assert admin(conn, 'claim', {'lease': LEASE}) is True
    before = row(conn)
    point = conn.begin_nested()
    with pytest.raises(Exception) as caught:
        apply(conn)
    point.rollback()
    assert caught.value.diag.message_primary == 'dart_profile_refresh_active_lease'
    assert row(conn) == before
    assert admin(conn, 'read')['refresh_in_progress'] is True


def test_expired_dart_lease_is_preserved_until_normal_new_worker_claim(dart_profile):
    conn = dart_profile
    saved(conn)
    conn.execute(text("update app_private.company_profile_enrichments set lease=:lease,lease_until=now()-interval '1 second'"),
                 {'lease': LEASE})
    before = row(conn)
    apply(conn)
    after = row(conn)
    assert (after['lease'], after['lease_until'], after['archives']) == (before['lease'], before['lease_until'], before['archives'])
    assert admin(conn, 'claim', {'lease': '80000000-0000-4000-8000-000000000002'}) is True


@pytest.mark.parametrize('has_snapshot', [True, False])
def test_failed_refresh_retains_cooldown_errors_and_any_previous_verified_fields(dart_profile, has_snapshot):
    conn = dart_profile
    if has_snapshot:
        saved(conn)
        conn.exec_driver_sql("update app_private.company_profile_enrichments set next_refresh_at=now()-interval '1 second'")
    assert admin(conn, 'claim', {'lease': LEASE}) is True
    admin(conn, 'fail', {'lease': LEASE, 'code': 'profile_source_unavailable'})
    before = row(conn)
    assert before['result']['status'] == ('partial' if has_snapshot else 'unavailable')
    assert conn.exec_driver_sql('select next_refresh_at>now() from app_private.company_profile_enrichments').scalar()
    apply(conn)
    assert row(conn) == before
    assert admin(conn, 'claim', {'lease': LEASE}) is False


def test_no_periodic_evidence_keeps_the_existing_not_available_refresh_policy(dart_profile):
    conn = dart_profile
    value = payload(conn)
    value['archives'] = []
    value['result'].update(status='not_available', sources=[], business=[], products=[], segments=[])
    assert admin(conn, 'claim', {'lease': LEASE}) is True
    admin(conn, 'save', value)
    before = row(conn)
    apply(conn)
    assert row(conn) == before
    assert admin(conn, 'claim', {'lease': LEASE}) is False


def test_sec_snapshot_and_its_active_lease_are_untouched(dart_profile):
    conn = dart_profile
    value = saved(conn)
    conn.execute(text("""insert into companies(id,name,ticker,market,provider,provider_company_id,is_demo,created_at)
        values(:id,'Synthetic SEC issuer','SYNO','NASDAQ','sec','0000000999',false,now())"""), {'id': SEC_COMPANY})
    sec_result = copy.deepcopy(value['result'])
    sec_result['company_id'] = SEC_COMPANY
    sec_result['sources'][0].update(provider='SEC EDGAR', normalization='profile-visible-text-v1')
    conn.execute(text("""insert into app_private.company_profile_enrichments
        (company_id,provider,provider_company_id,ticker,result,next_refresh_at,lease,lease_until,last_error)
        values(:id,'sec','0000000999','SYNO',cast(:result as jsonb),now()+interval '1 day',:lease,
               now()+interval '30 seconds','synthetic_prior_error')"""),
                 {'id': SEC_COMPANY, 'result': json.dumps(sec_result), 'lease': LEASE})
    before = row(conn, SEC_COMPANY)
    apply(conn)
    assert row(conn, SEC_COMPANY) == before
    assert conn.execute(text('select next_refresh_at<=now() from app_private.company_profile_enrichments where company_id=:id'),
                        {'id': C}).scalar()
