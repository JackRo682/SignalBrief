"""Profile excerpts are private, archived, identity-bound and retain dated evidence on failure."""
import copy
import json
from datetime import timedelta

import pytest
from sqlalchemy import text
from test_workspace_schema import ROOT, C
from test_workspace_schema import db as db
from test_workspace_schema import own as own

pytestmark = pytest.mark.postgres
MIGRATION = '20261102020450_company_profile_source_enrichment.sql'
LEASE = '80000000-0000-4000-8000-000000000001'
SHA = 'a' * 64


@pytest.fixture
def enriched(own):
    own.exec_driver_sql('RESET ROLE')
    with own.connection.driver_connection.cursor() as cursor:
        cursor.execute((ROOT / 'supabase/migrations' / MIGRATION).read_text(), prepare=False)
    return own


def admin(conn, op, payload=None):
    return conn.execute(text('select public.sb_profile_enrichment_admin(:op,cast(:p as jsonb))'),
                        {'op': op, 'p': json.dumps({'company_id': C, **(payload or {})})}).scalar()


def snapshot(conn):
    now = conn.exec_driver_sql('select now()').scalar()
    quote = 'Synthetic Corporation provides documented laboratory products and research services.'
    source = {
        'id': SHA, 'provider': 'SEC EDGAR',
        'source_url': 'https://www.sec.gov/Archives/edgar/data/1/000000000126000001/synthetic.htm',
        'source_sha256': SHA, 'fetched_at': now.isoformat(), 'published_on': '2026-01-01',
        'publication_precision': 'date', 'report_period': '2025-12-31', 'form_type': '10-K',
        'title': 'Synthetic annual report', 'normalization': 'profile-visible-text-v1',
        'object_key': f'profiles/sec/{SHA}.html', 'provider_company_id': '0000000001',
        'ticker': 'TEST', 'normalized_text': quote,
    }
    public = {key: value for key, value in source.items()
              if key not in ('object_key', 'provider_company_id', 'ticker', 'normalized_text')}
    result = {
        'schema': 'signalbrief.company-profile.v1', 'company_id': C, 'status': 'partial',
        'checked_at': now.isoformat(), 'next_refresh_at': (now + timedelta(hours=24)).isoformat(),
        'sources': [public], 'leadership': [], 'formation': [], 'products': [], 'segments': [],
        'business': [{'text': quote, 'evidence': {'source_id': SHA, 'quote': quote, 'location': {
            'kind': 'normalized_text', 'start': 0, 'end': len(quote), 'section': 'Item 1. Business',
        }}}], 'limitations': ['formation_date_not_verified'], 'last_error': None,
    }
    return {'lease': LEASE, 'result': result, 'archives': [source]}


def claim_and_archive(conn, value):
    assert admin(conn, 'claim', {'lease': LEASE}) is True
    for source in value['archives']:
        conn.execute(text("insert into storage.objects(bucket_id,name) values('signalbrief-raw',:path)"),
                     {'path': source['object_key']})


def assert_denied(conn, value, expected='PT422'):
    point = conn.begin_nested()
    with pytest.raises(Exception) as caught:
        admin(conn, 'save', value)
    point.rollback()
    assert caught.value.orig.sqlstate == expected


@pytest.mark.parametrize('role', ['anon', 'authenticated'])
def test_profile_cache_and_mutations_are_not_public(enriched, role):
    enriched.exec_driver_sql(f'SET LOCAL ROLE {role}')
    for query in ('select * from app_private.company_profile_enrichments',
                  'select * from app_private.company_profile_official_sources',
                  "select public.sb_profile_enrichment_admin('read','{}')",
                  "select app_content_private.profile_enrichment_admin('read','{}')"):
        point = enriched.begin_nested()
        with pytest.raises(Exception) as caught:
            enriched.exec_driver_sql(query)
        point.rollback()
        assert caught.value.orig.sqlstate == '42501'


def test_archived_exact_source_quotes_are_persisted_and_private_material_is_not_returned(enriched):
    value = snapshot(enriched)
    claim_and_archive(enriched, value)
    assert admin(enriched, 'save', value) == value['result']
    read = admin(enriched, 'read')
    assert read['result'] == value['result']
    assert read['refresh_in_progress'] is False
    assert all('normalized_text' not in source and 'object_key' not in source
               for source in read['result']['sources'])
    assert 'archives' not in read and '"normalized_text":' not in json.dumps(read)
    assert admin(enriched, 'claim', {'lease': LEASE}) is False


def test_cannot_publish_an_unarchived_source_or_a_lost_lease(enriched):
    value = snapshot(enriched)
    assert admin(enriched, 'claim', {'lease': LEASE}) is True
    assert_denied(enriched, value)
    value['lease'] = '80000000-0000-4000-8000-000000000002'
    assert_denied(enriched, value, 'PT409')


def test_partial_fields_cannot_be_published_as_complete(enriched):
    value = snapshot(enriched)
    claim_and_archive(enriched, value)
    value['result']['status'] = 'ready'
    assert_denied(enriched, value)


@pytest.mark.parametrize('field,wrong', [
    ('provider_company_id', '0000000002'), ('ticker', 'WRONG'), ('provider', 'OpenDART'),
    ('source_url', 'https://www.sec.gov/Archives/edgar/data/999/000000000126000001/synthetic.htm'),
    ('source_url', 'https://www.sec.gov.evil.test/Archives/edgar/data/1/000000000126000001/synthetic.htm'),
    ('source_url', 'https://www.sec.gov/Archives/edgar/data/1/000000000126000001/synthetic.htm?secret=x'),
    ('source_sha256', 'b' * 64), ('normalization', 'unverified_parser'),
])
def test_wrong_issuer_source_and_parser_evidence_are_rejected(enriched, field, wrong):
    value = snapshot(enriched)
    claim_and_archive(enriched, value)
    value['archives'][0][field] = wrong
    assert_denied(enriched, value)


@pytest.mark.parametrize('mutation', ['quote', 'offset', 'source', 'public_extra', 'private_extra'])
def test_source_and_exact_quote_projection_cannot_be_forged(enriched, mutation):
    value = snapshot(enriched)
    claim_and_archive(enriched, value)
    proof = value['result']['business'][0]['evidence']
    if mutation == 'quote':
        proof['quote'] = 'Fabricated business description'
        value['result']['business'][0]['text'] = proof['quote']
    elif mutation == 'offset':
        proof['location']['start'] = 1
    elif mutation == 'source':
        proof['source_id'] = 'b' * 64
    elif mutation == 'public_extra':
        value['result']['sources'][0]['raw_secret'] = 'not-public'
    else:
        value['archives'][0]['raw_secret'] = 'not-public'
    assert_denied(enriched, value)


def test_unicode_offsets_match_code_points_not_utf16_units(enriched):
    value = snapshot(enriched)
    quote = value['archives'][0]['normalized_text']
    value['archives'][0]['normalized_text'] = '🧪\n' + quote
    proof = value['result']['business'][0]['evidence']
    proof['location']['start'] = 2
    proof['location']['end'] = len(quote) + 2
    claim_and_archive(enriched, value)
    assert admin(enriched, 'save', value)['business'][0]['evidence']['quote'] == quote


def test_failed_refresh_keeps_previous_dated_evidence_and_adds_truthful_retry_status(enriched):
    value = snapshot(enriched)
    claim_and_archive(enriched, value)
    original = admin(enriched, 'save', value)
    enriched.exec_driver_sql("update app_private.company_profile_enrichments set next_refresh_at=now()-interval '1 second'")
    assert admin(enriched, 'claim', {'lease': LEASE}) is True
    failed = admin(enriched, 'fail', {'lease': LEASE, 'code': 'profile_source_unavailable'})
    assert failed['business'] == original['business'] and failed['sources'] == original['sources']
    assert failed['checked_at'] == original['checked_at']
    assert failed['status'] == 'partial' and failed['last_error'] == 'profile_source_unavailable'
    assert admin(enriched, 'claim', {'lease': LEASE}) is False


def test_empty_failed_refresh_is_unavailable_not_a_successful_empty_profile(enriched):
    assert admin(enriched, 'claim', {'lease': LEASE}) is True
    result = admin(enriched, 'fail', {'lease': LEASE, 'code': 'profile_source_unavailable'})
    assert result['status'] == 'unavailable' and result['sources'] == []


def test_changed_company_identity_cannot_reuse_the_old_cache(enriched):
    value = snapshot(enriched)
    claim_and_archive(enriched, value)
    admin(enriched, 'save', value)
    enriched.execute(text("update public.companies set ticker='DIFFERENT' where id=:id"), {'id': C})
    assert admin(enriched, 'read')['result'] is None


@pytest.mark.parametrize('field', ['schema', 'company_id', 'status', 'sources', 'business', 'last_error'])
def test_missing_required_snapshot_fields_are_rejected(enriched, field):
    value = snapshot(enriched)
    claim_and_archive(enriched, value)
    del value['result'][field]
    assert_denied(enriched, value)


@pytest.mark.parametrize('field', ['schema', 'company_id', 'status', 'checked_at', 'next_refresh_at'])
def test_null_required_snapshot_values_are_rejected(enriched, field):
    value = snapshot(enriched)
    claim_and_archive(enriched, value)
    value['result'][field] = None
    assert_denied(enriched, value)


def test_filing_executive_cannot_be_labeled_as_verified_today(enriched):
    value = snapshot(enriched)
    quote = 'Taylor Example, Chief Executive Officer'
    value['archives'][0]['normalized_text'] = quote
    value['result']['business'] = []
    value['result']['leadership'] = [{'name': 'Taylor Example', 'role': 'Chief Executive Officer',
        'basis': 'filing', 'as_of': value['result']['checked_at'][:10], 'evidence': {
            'source_id': SHA, 'quote': quote, 'location': {'kind': 'normalized_text', 'start': 0,
                'end': len(quote), 'section': 'Signatures'}}}]
    claim_and_archive(enriched, value)
    assert_denied(enriched, value)


@pytest.mark.parametrize('date,precision', [('2021-02-29', 'day'), ('2020-13', 'month'), ('2050', 'year'), ('2007-05-01', 'month')])
def test_invalid_or_fabricated_formation_precision_is_rejected(enriched, date, precision):
    value = snapshot(enriched)
    proof = copy.deepcopy(value['result']['business'][0]['evidence'])
    value['result']['formation'] = [{'kind': 'incorporated', 'date': date, 'precision': precision, 'evidence': proof}]
    claim_and_archive(enriched, value)
    assert_denied(enriched, value)
