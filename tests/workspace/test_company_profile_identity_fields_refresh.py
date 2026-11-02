"""Targeted SEC parser refresh preserves evidence, cooldowns and worker ownership."""
import copy
import json
import re
from pathlib import Path

import pytest
from sqlalchemy import text
from test_company_profile_enrichment import LEASE, C, admin, claim_and_archive, snapshot
from test_company_profile_enrichment import db as db
from test_company_profile_enrichment import enriched as enriched
from test_company_profile_enrichment import own as own

pytestmark = pytest.mark.postgres
MIGRATION = Path(__file__).resolve().parents[2] / 'supabase/migrations/20261102065627_sec_profile_identity_fields_refresh.sql'
DART_COMPANY = '20000000-0000-4000-8000-000000000098'
OTHER_SEC = '20000000-0000-4000-8000-000000000099'


def apply(conn):
    with conn.connection.driver_connection.cursor() as cursor:
        cursor.execute(MIGRATION.read_text(), prepare=False)


def row(conn, company_id=C):
    return conn.execute(text('select to_jsonb(cache) from app_private.company_profile_enrichments cache where company_id=:id'),
                        {'id': company_id}).scalar()


def saved(conn, form='10-K', leadership=False):
    value = snapshot(conn)
    for source in [*value['archives'], *value['result']['sources']]:
        source['form_type'] = form
    if leadership:
        source = value['archives'][0]
        quote = 'Taylor Example, Chief Executive Officer'
        start = len(source['normalized_text']) + 1
        source['normalized_text'] += '\n' + quote
        value['result']['leadership'] = [{'name': 'Taylor Example', 'role': 'Chief Executive Officer',
            'basis': 'filing', 'as_of': source['published_on'], 'evidence': {
                'source_id': source['id'], 'quote': quote, 'location': {
                    'kind': 'normalized_text', 'start': start, 'end': start + len(quote), 'section': 'Signatures'}}}]
    claim_and_archive(conn, value)
    admin(conn, 'save', value)
    return value


@pytest.mark.parametrize('timezone', ['UTC', 'Asia/Seoul'])
def test_only_two_due_times_change_and_all_evidence_and_audit_fields_survive(enriched, timezone):
    conn = enriched
    conn.execute(text("select set_config('TimeZone',:zone,true)"), {'zone': timezone})
    saved(conn)
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


@pytest.mark.parametrize('form', ['10-K/A', '10-Q', '10-Q/A', '20-F', '20-F/A', '40-F', '40-F/A'])
def test_existing_supported_periodic_forms_are_eligible_without_issuer_special_cases(enriched, form):
    saved(enriched, form)
    apply(enriched)
    assert admin(enriched, 'claim', {'lease': LEASE}) is True


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


def test_an_unrelated_active_sec_worker_blocks_the_entire_refresh(enriched):
    saved(enriched)
    enriched.execute(text("""insert into companies(id,name,ticker,market,provider,provider_company_id,is_demo,created_at)
        values(:id,'Other synthetic SEC issuer','OTHER','NASDAQ','sec','0000000999',false,now())"""), {'id': OTHER_SEC})
    enriched.execute(text("""insert into app_private.company_profile_enrichments
        (company_id,provider,provider_company_id,ticker,lease,lease_until)
        values(:id,'sec','0000000999','OTHER',:lease,now()+interval '30 seconds')"""),
        {'id': OTHER_SEC, 'lease': LEASE})
    before = [row(enriched), row(enriched, OTHER_SEC)]
    point = enriched.begin_nested()
    with pytest.raises(Exception) as caught:
        apply(enriched)
    point.rollback()
    assert caught.value.diag.message_primary == 'sec_profile_refresh_active_lease'
    assert [row(enriched), row(enriched, OTHER_SEC)] == before


def test_expired_lease_is_preserved_until_normal_new_worker_claim(enriched):
    saved(enriched)
    enriched.execute(text("update app_private.company_profile_enrichments set lease=:lease,lease_until=now()-interval '1 second'"),
                     {'lease': LEASE})
    before = row(enriched)
    apply(enriched)
    after = row(enriched)
    assert (after['lease'], after['lease_until'], after['archives']) == (before['lease'], before['lease_until'], before['archives'])
    assert admin(enriched, 'claim', {'lease': '80000000-0000-4000-8000-000000000002'}) is True


@pytest.mark.parametrize('has_snapshot', [True, False])
def test_failed_refresh_preserves_retry_cooldown_errors_and_previous_evidence(enriched, has_snapshot):
    if has_snapshot:
        saved(enriched)
        enriched.exec_driver_sql("update app_private.company_profile_enrichments set next_refresh_at=now()-interval '1 second'")
    assert admin(enriched, 'claim', {'lease': LEASE}) is True
    admin(enriched, 'fail', {'lease': LEASE, 'code': 'profile_source_unavailable'})
    before = row(enriched)
    apply(enriched)
    assert row(enriched) == before
    assert admin(enriched, 'claim', {'lease': LEASE}) is False


def test_partial_profile_with_verified_leadership_is_not_invalidated(enriched):
    saved(enriched, leadership=True)
    before = row(enriched)
    assert before['result']['status'] == 'partial'
    apply(enriched)
    assert row(enriched) == before
    assert admin(enriched, 'claim', {'lease': LEASE}) is False


@pytest.mark.parametrize('change', [
    'ready', 'not_available', 'schema', 'leadership_null', 'leadership_missing',
    'no_sources', 'sources_null', 'wrong_source_provider', 'unknown_normalization', 'nonperiodic_form',
    'row_error_only', 'json_error_only', 'missing_json_error', 'missing_due_time',
])
def test_only_successfully_parsed_partial_sec_states_with_empty_leadership_are_expired(enriched, change):
    # These intentionally stored edge states exercise the migration's selection,
    # not the API's independent source-validation gate.
    saved(enriched)
    result = row(enriched)['result']
    if change in ('ready', 'not_available'):
        result['status'] = change
    elif change == 'schema':
        result['schema'] = 'unrecognized-profile-version'
    elif change == 'leadership_null':
        result['leadership'] = None
    elif change == 'leadership_missing':
        del result['leadership']
    elif change == 'no_sources':
        result['sources'] = []
    elif change == 'sources_null':
        result['sources'] = None
    elif change == 'wrong_source_provider':
        result['sources'][0]['provider'] = 'Official company'
    elif change == 'unknown_normalization':
        result['sources'][0]['normalization'] = 'unknown-parser'
    elif change == 'nonperiodic_form':
        result['sources'][0]['form_type'] = '8-K'
    elif change == 'row_error_only':
        enriched.exec_driver_sql("update app_private.company_profile_enrichments set last_error='profile_source_unavailable'")
    elif change == 'json_error_only':
        result['last_error'] = 'profile_source_unavailable'
    elif change == 'missing_json_error':
        del result['last_error']
    else:
        del result['next_refresh_at']
    enriched.execute(text('update app_private.company_profile_enrichments set result=cast(:result as jsonb)'),
                     {'result': json.dumps(result)})
    before = row(enriched)
    apply(enriched)
    assert row(enriched) == before


def test_dart_snapshot_and_its_active_lease_are_untouched(enriched):
    value = saved(enriched)
    enriched.execute(text("""insert into companies(id,name,ticker,market,provider,provider_company_id,is_demo,created_at)
        values(:id,'Synthetic Korean issuer','099998','KR','dart','00999998',false,now())"""), {'id': DART_COMPANY})
    result = copy.deepcopy(value['result'])
    result['company_id'] = DART_COMPANY
    result['sources'][0].update(provider='OpenDART', normalization='dart-periodic-xml-text-v1', form_type='사업보고서')
    enriched.execute(text("""insert into app_private.company_profile_enrichments
        (company_id,provider,provider_company_id,ticker,result,next_refresh_at,lease,lease_until,last_error)
        values(:id,'dart','00999998','099998',cast(:result as jsonb),now()+interval '1 day',:lease,
               now()+interval '30 seconds','synthetic_prior_error')"""),
        {'id': DART_COMPANY, 'result': json.dumps(result), 'lease': LEASE})
    before = row(enriched, DART_COMPANY)
    apply(enriched)
    assert row(enriched, DART_COMPANY) == before
    assert enriched.execute(text('select next_refresh_at<=now() from app_private.company_profile_enrichments where company_id=:id'),
                            {'id': C}).scalar()
