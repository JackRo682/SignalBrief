"""Source-backed factual introductions reuse archived, exact-issuer snapshots."""
import json

import pytest
from sqlalchemy import text
from test_discovery_reliability import ROOT
from test_discovery_reliability import discovery as discovery
from test_workspace_schema import C
from test_workspace_schema import db as db
from test_workspace_schema import own as own

pytestmark = pytest.mark.postgres
DART_ID = '20000000-0000-4000-8000-000000000094'
SHA = 'd' * 64


@pytest.fixture
def overview(discovery):
    discovery.exec_driver_sql('RESET ROLE')
    with discovery.connection.driver_connection.cursor() as cursor:
        cursor.execute((ROOT / 'supabase/migrations/20261101072153_company_official_overview.sql').read_text(),
                       prepare=False)
    discovery.execute(text("""insert into public.companies
      (id,name,ticker,market,provider,provider_company_id,is_demo,created_at)
      values(:id,'Synthetic Korean issuer','0068Y0','KOSPI','dart','12345678',false,now())"""), {'id': DART_ID})
    return discovery


def profile_value(company_id=DART_ID, provider='dart'):
    sec = provider == 'sec'
    return {
        'status': 'verified', 'provider': 'SEC EDGAR' if sec else 'OpenDART',
        'company_id': company_id, 'source_sha256': SHA, 'fetched_at': '2026-10-18T09:30:00Z',
        'source_url': ('https://www.sec.gov/edgar/browse/?CIK=0000000001' if sec else
                       'https://opendart.fss.or.kr/guide/detail.do?apiGrpCd=DS001&apiId=2019002'),
        'profile': {
            'corp_code': '0000000001' if sec else '12345678', 'ticker': 'TEST' if sec else '0068Y0',
            'name': 'Synthetic verified issuer', 'english_name': 'Synthetic English name',
            'ceo': None if sec else 'Synthetic representative',
            'established_on': None if sec else '2020-02-29',
            'industry_description': 'Synthetic official industry' if sec else None,
            'industry_code': '1234', 'website': 'https://company.example.invalid/',
        },
    }


def save_profile(conn, value, provider='dart', archived=True):
    company_id = value['company_id']
    identity, ticker = ('0000000001', 'TEST') if provider == 'sec' else ('12345678', '0068Y0')
    key = f'profile:{provider}:v1:{company_id}:{identity}:{ticker}'
    conn.execute(text("""insert into app_private.us_cache(key,value,expires_at,updated_at)
      values(:key,cast(:value as jsonb),now()-interval '1 day',now())"""),
                 {'key': key, 'value': json.dumps(value)})
    if archived:
        path = ('us/sec/submissions/' if provider == 'sec' else 'dart/profiles/') + SHA + '.json'
        conn.execute(text("insert into storage.objects(bucket_id,name) values('signalbrief-raw',:path)"),
                     {'path': path})


def projected(conn, company_id=DART_ID):
    conn.exec_driver_sql('SET LOCAL ROLE authenticated')
    return conn.execute(text("select public.sb_customer_workspace('company',jsonb_build_object('id',cast(:id as text)))"),
                        {'id': company_id}).scalar()['company']


@pytest.mark.parametrize('provider,company_id', [('dart', DART_ID), ('sec', C)])
def test_archived_profile_facts_reach_detail_directory_and_catalog_with_provenance(overview, provider, company_id):
    source = profile_value(company_id, provider)
    source['private_unexpected_field'] = 'must-not-be-published'
    save_profile(overview, source, provider)
    resource = projected(overview, company_id)
    facts = resource['official_overview']
    assert resource['summary'] == ''  # Do not invent or overwrite a curated business summary.
    assert facts['kind'] == 'profile' and facts['name'] == 'Synthetic verified issuer'
    assert facts['company_id'] == company_id and facts['source_sha256'] == SHA
    assert facts['source_url'] == source['source_url']
    assert facts['fetched_at'] == source['fetched_at']
    assert facts['industry_description'] == source['profile']['industry_description']
    assert 'private_unexpected_field' not in facts and 'expires_at' not in facts
    for function, action in [('sb_redesign_workspace', 'design_directory'), ('sb_customer_workspace', 'catalog')]:
        result = overview.execute(text(f"select public.{function}(:action,'{{}}')"), {'action': action}).scalar()
        item = next(row for row in result['items'] if row['id'] == company_id)
        assert item['official_overview'] == facts


@pytest.mark.parametrize('mutation', [
    {'status': 'not_available'}, {'company_id': C}, {'provider': 'SEC EDGAR'},
    {'source_sha256': 'not-a-hash'}, {'source_url': 'https://unverified.example.invalid/'},
    {'fetched_at': 'not-a-time'}, {'fetched_at': 'infinity'},
    {'profile': {'ticker': '0017J0'}}, {'profile': {'corp_code': '87654321'}},
    {'profile': {'name': ''}}, {'profile': {'industry_code': {'untrusted': True}}},
    {'profile': {'established_on': '2021-02-29'}},
    {'profile': {'website': 'https://username:password@example.invalid/'}},
])
def test_invalid_or_mismatched_snapshots_never_become_company_introductions(overview, mutation):
    source = profile_value()
    if 'profile' in mutation:
        source['profile'].update(mutation['profile'])
    else:
        source.update(mutation)
    # Store the candidate under the expected issuer cache key, even when its body is mismatched.
    original_id = source['company_id']
    source['company_id'] = DART_ID
    save_profile(overview, source)
    if original_id != DART_ID:
        overview.execute(text("update app_private.us_cache set value=jsonb_set(value,'{company_id}',to_jsonb(cast(:id as text)))"),
                         {'id': original_id})
    assert projected(overview)['official_overview'] is None


def test_unarchived_profile_cannot_claim_source_verification(overview):
    save_profile(overview, profile_value(), archived=False)
    assert projected(overview)['official_overview'] is None


def test_exact_archived_directory_identity_supplies_only_registry_facts_until_profile_ready(overview):
    overview.exec_driver_sql("""update app_private.company_directory_sources
      set source_sha256=repeat('b',64),raw_object_key='directory/dart/'||repeat('b',64)||'.zip' where provider='dart';
      insert into app_private.company_directory(provider,provider_company_id,ticker,name,market,source_sha256,fetched_at,official_english_name)
      values('dart','12345678','0068Y0','Synthetic registry issuer','KR',repeat('b',64),now(),'Synthetic official English');
      insert into storage.objects(bucket_id,name) values('signalbrief-raw','directory/dart/'||repeat('b',64)||'.zip');""")
    facts = projected(overview)['official_overview']
    assert facts['kind'] == 'directory' and facts['name'] == 'Synthetic registry issuer'
    assert facts['english_name'] == 'Synthetic official English'
    assert facts['source_sha256'] == 'b' * 64
    assert facts['ceo'] is facts['industry_description'] is facts['industry_code'] is facts['established_on'] is None
    overview.exec_driver_sql('RESET ROLE')
    overview.exec_driver_sql("update app_private.company_directory set provider_company_id='87654321'")
    assert projected(overview)['official_overview'] is None
    overview.exec_driver_sql('RESET ROLE')
    overview.exec_driver_sql("update app_private.company_directory set provider_company_id='12345678'")
    save_profile(overview, profile_value())
    assert projected(overview)['official_overview']['kind'] == 'profile'


def test_private_projection_and_anonymous_customer_access_remain_denied(overview):
    overview.exec_driver_sql('SET LOCAL ROLE authenticated')
    for sql in (f"select app_private.sb_company_official_overview('{DART_ID}')",
                "select app_private.sb_company_resource_overview('{}')", 'select * from app_private.us_cache'):
        point = overview.begin_nested()
        with pytest.raises(Exception) as caught:
            overview.exec_driver_sql(sql)
        point.rollback()
        assert caught.value.orig.sqlstate == '42501'
    point = overview.begin_nested()
    overview.exec_driver_sql('SET LOCAL ROLE anon')
    with pytest.raises(Exception) as caught:
        overview.exec_driver_sql("select public.sb_redesign_workspace('design_directory','{}')")
    point.rollback()
    assert caught.value.orig.sqlstate == '42501'
