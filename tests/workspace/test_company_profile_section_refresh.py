"""One-time parser refresh preserves evidence and cannot race an active SEC worker."""
import copy
import json
from pathlib import Path

import pytest
from sqlalchemy import text
from test_company_profile_enrichment import LEASE, admin, claim_and_archive, snapshot
from test_company_profile_enrichment import db as db
from test_company_profile_enrichment import enriched as enriched
from test_company_profile_enrichment import own as own
from test_workspace_schema import C

pytestmark = pytest.mark.postgres
MIGRATION = Path(__file__).resolve().parents[2] / 'supabase/migrations/20261102052148_sec_profile_section_refresh.sql'
DART_COMPANY = '20000000-0000-4000-8000-000000000098'


def apply(conn):
    with conn.connection.driver_connection.cursor() as cursor:
        cursor.execute(MIGRATION.read_text(), prepare=False)


def row(conn, company_id=C):
    return conn.execute(text('select to_jsonb(cache) from app_private.company_profile_enrichments cache where company_id=:id'),
                        {'id': company_id}).scalar()


def saved(conn):
    value = snapshot(conn)
    claim_and_archive(conn, value)
    admin(conn, 'save', value)
    return value


def test_refresh_changes_only_the_two_due_times_and_preserves_all_original_evidence(enriched):
    saved(enriched)
    before = row(enriched)
    assert admin(enriched, 'claim', {'lease': LEASE}) is False
    apply(enriched)
    after = row(enriched)
    now = enriched.exec_driver_sql('select now()').scalar()
    assert enriched.exec_driver_sql('select next_refresh_at<=now() from app_private.company_profile_enrichments').scalar()
    assert enriched.exec_driver_sql("select (result->>'next_refresh_at')::timestamptz=next_refresh_at from app_private.company_profile_enrichments").scalar()
    assert after['result']['checked_at'] == before['result']['checked_at']
    expected = copy.deepcopy(before)
    expected['next_refresh_at'] = after['next_refresh_at']
    expected['result']['next_refresh_at'] = after['result']['next_refresh_at']
    assert after == expected
    assert admin(enriched, 'read')['result'] == after['result']
    assert admin(enriched, 'claim', {'lease': LEASE}) is True
    assert row(enriched)['result'] == after['result']
    assert now is not None


@pytest.mark.parametrize('has_snapshot', [True, False])
def test_active_sec_lease_aborts_without_changing_or_stealing_any_row(enriched, has_snapshot):
    if has_snapshot:
        saved(enriched)
        enriched.exec_driver_sql("update app_private.company_profile_enrichments set next_refresh_at=now()-interval '1 second'")
    assert admin(enriched, 'claim', {'lease': LEASE}) is True
    before = row(enriched)
    point = enriched.begin_nested()
    with pytest.raises(Exception) as caught:
        apply(enriched)
    point.rollback()
    assert caught.value.diag.message_primary == 'sec_profile_refresh_active_lease'
    assert row(enriched) == before
    assert admin(enriched, 'read')['refresh_in_progress'] is True


def test_expired_sec_lease_does_not_prevent_the_normal_new_worker_claim(enriched):
    saved(enriched)
    enriched.execute(text("update app_private.company_profile_enrichments set lease=:lease,lease_until=now()-interval '1 second'"),
                     {'lease': LEASE})
    before = row(enriched)
    apply(enriched)
    assert row(enriched)['archives'] == before['archives']
    assert row(enriched)['lease'] == before['lease']
    assert row(enriched)['lease_until'] == before['lease_until']
    assert admin(enriched, 'claim', {'lease': '80000000-0000-4000-8000-000000000002'}) is True


def test_dart_cache_and_its_active_worker_are_untouched(enriched):
    value = saved(enriched)
    enriched.execute(text("""insert into companies(id,name,ticker,market,provider,provider_company_id,is_demo,created_at)
        values(:id,'Synthetic Korean issuer','099998','KR','dart','00999998',false,now())"""), {'id': DART_COMPANY})
    dart_result = copy.deepcopy(value['result'])
    dart_result['company_id'] = DART_COMPANY
    dart_result['sources'][0]['provider'] = 'OpenDART'
    enriched.execute(text("""insert into app_private.company_profile_enrichments
        (company_id,provider,provider_company_id,ticker,result,next_refresh_at,lease,lease_until,last_error)
        values(:id,'dart','00999998','099998',cast(:result as jsonb),now()+interval '1 day',:lease,
               now()+interval '30 seconds','synthetic_prior_error')"""),
                     {'id': DART_COMPANY, 'result': json.dumps(dart_result), 'lease': LEASE})
    before = row(enriched, DART_COMPANY)
    apply(enriched)
    assert row(enriched, DART_COMPANY) == before
    assert enriched.execute(text('select next_refresh_at<=now() from app_private.company_profile_enrichments where company_id=:id'),
                            {'id': C}).scalar()


def test_prior_provider_failure_without_sec_parsed_evidence_keeps_its_retry_policy(enriched):
    assert admin(enriched, 'claim', {'lease': LEASE}) is True
    admin(enriched, 'fail', {'lease': LEASE, 'code': 'profile_source_unavailable'})
    before = row(enriched)
    apply(enriched)
    assert row(enriched) == before
