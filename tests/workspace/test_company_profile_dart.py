"""DART periodic profile evidence remains issuer/receipt/hash-bound and service-only."""
import copy
import hashlib
import json
from datetime import timedelta

import pytest
from sqlalchemy import text
from test_company_profile_enrichment import LEASE, ROOT, C, admin, snapshot
from test_company_profile_enrichment import db as db
from test_company_profile_enrichment import enriched as enriched
from test_company_profile_enrichment import own as own

pytestmark = pytest.mark.postgres
MIGRATION = '20261102020454_dart_profile_periodic_sources.sql'
CORP = '00999996'
TICKER = '099996'
RECEIPT = '20261015000123'
FILING = '30000000-0000-4000-8000-000000000096'
RAW_SHA = 'b' * 64
LIST_SHA = 'c' * 64
MAIN_URL = f'https://dart.fss.or.kr/dsaf001/main.do?rcpNo={RECEIPT}'


@pytest.fixture
def dart_profile(enriched):
    with enriched.connection.driver_connection.cursor() as cursor:
        cursor.execute((ROOT / 'supabase/migrations' / MIGRATION).read_text(), prepare=False)
    enriched.execute(text("""update companies set name='Synthetic Korean Company',ticker=:ticker,
        provider='dart',provider_company_id=:corp,market='KOSPI' where id=:id"""),
                     {'id': C, 'ticker': TICKER, 'corp': CORP})
    enriched.execute(text("""insert into dart_filings(id,company_id,receipt,title,filing_date,source_url,
        source_sha256,source_object_key,publication_precision,publication_timezone)
        values(:fid,:cid,:receipt,'분기보고서 (2026.09)','2026-10-15',:url,:sha,:path,'date','Asia/Seoul')"""),
                     {'fid': FILING, 'cid': C, 'receipt': RECEIPT, 'url': MAIN_URL, 'sha': LIST_SHA,
                      'path': f'dart/lists/{LIST_SHA}.json'})
    return enriched


def payload(conn, recovered=False):
    now = conn.exec_driver_sql('select now()').scalar()
    business = '당사는 합성 연구장비와 문서화된 실험 지원 서비스를 개발하여 연구기관 및 기업 고객에게 제공합니다.'
    products = '연구 부문 합성 연구장비 문서화된 실험 지원 서비스'
    normalized = f'II. 사업의 내용\n1. 사업의 개요\n{business}\n2. 주요 제품 및 서비스\n{products}'
    normalized_sha = hashlib.sha256(normalized.encode()).hexdigest()
    source = {'id': RAW_SHA, 'provider': 'OpenDART', 'source_url': MAIN_URL, 'source_sha256': RAW_SHA,
              'fetched_at': now.isoformat(), 'published_on': '2026-10-15', 'publication_precision': 'date',
              'publication_timezone': 'Asia/Seoul', 'report_period': '2026-09', 'form_type': '분기보고서',
              'title': '분기보고서 (2026.09)',
              'normalization': 'dart-periodic-recovered-text-v1' if recovered else 'dart-periodic-xml-text-v1',
              'normalized_sha256': normalized_sha, 'object_key': f'profiles/dart/{RAW_SHA}.zip',
              'normalized_object_key': f'profiles/dart/normalized/{normalized_sha}.txt',
              'filing_id': FILING, 'provider_company_id': CORP, 'ticker': TICKER, 'normalized_text': normalized}

    def evidence(quote, section):
        start = normalized.index(quote)
        return {'source_id': RAW_SHA, 'quote': quote, 'location': {'kind': 'normalized_text',
                'start': start, 'end': start + len(quote), 'section': section}}

    public = {key: value for key, value in source.items() if key not in (
        'object_key', 'normalized_object_key', 'filing_id', 'provider_company_id', 'ticker', 'normalized_text')}
    result = {'schema': 'signalbrief.company-profile.v1', 'company_id': C, 'status': 'partial',
              'checked_at': now.isoformat(), 'next_refresh_at': (now + timedelta(hours=24)).isoformat(),
              'sources': [public], 'leadership': [], 'formation': [],
              'business': [{'text': business, 'evidence': evidence(business, '사업의 내용 · 사업의 개요')}],
              'products': [{'name': '합성 연구장비', 'description': None,
                            'evidence': evidence(products, '사업의 내용 · 주요 제품 및 서비스')}],
              'segments': [{'name': '연구 부문', 'description': None,
                            'evidence': evidence(products, '사업의 내용 · 사업부문')}],
              'limitations': ['source_markup_recovery_requires_review'] if recovered else [], 'last_error': None}
    return {'lease': LEASE, 'result': result, 'archives': [source]}


def prepare(conn, value, missing=None):
    assert admin(conn, 'claim', {'lease': LEASE}) is True
    for path in [f'dart/lists/{LIST_SHA}.json', value['archives'][0]['object_key'], value['archives'][0]['normalized_object_key']]:
        if path != missing:
            conn.execute(text("insert into storage.objects(bucket_id,name) values('signalbrief-raw',:path)"), {'path': path})


def denied(conn, value, expected='PT422'):
    point = conn.begin_nested()
    with pytest.raises(Exception) as caught:
        admin(conn, 'save', value)
    point.rollback()
    assert caught.value.orig.sqlstate == expected


@pytest.mark.parametrize('recovered', [False, True])
def test_complete_original_chain_and_exact_korean_evidence_publish_without_private_archive_data(dart_profile, recovered):
    value = payload(dart_profile, recovered)
    prepare(dart_profile, value)
    dart_profile.exec_driver_sql('SET LOCAL ROLE service_role')
    assert admin(dart_profile, 'save', value) == value['result']
    read = admin(dart_profile, 'read')
    assert read['result'] == value['result']
    assert read['refresh_in_progress'] is False
    encoded = json.dumps(read)
    for private in ['normalized_text', 'normalized_object_key', 'object_key', 'filing_id', 'provider_company_id']:
        assert f'"{private}":' not in encoded
    assert read['result']['sources'][0]['publication_timezone'] == 'Asia/Seoul'
    assert read['result']['sources'][0]['report_period'] == '2026-09'
    assert read['result']['sources'][0]['normalized_sha256'] == value['archives'][0]['normalized_sha256']


@pytest.mark.parametrize('role', ['anon', 'authenticated'])
def test_profile_wrapper_and_private_cache_remain_inaccessible_to_browser_roles(dart_profile, role):
    value = payload(dart_profile)
    prepare(dart_profile, value)
    admin(dart_profile, 'save', value)
    dart_profile.exec_driver_sql(f'SET LOCAL ROLE {role}')
    for statement in ["select public.sb_profile_enrichment_admin('read','{}')",
                      "select app_content_private.profile_enrichment_admin('read','{}')",
                      'select * from app_private.company_profile_enrichments']:
        point = dart_profile.begin_nested()
        with pytest.raises(Exception) as caught:
            dart_profile.exec_driver_sql(statement)
        point.rollback()
        assert caught.value.orig.sqlstate == '42501'
    if role == 'authenticated':
        assert dart_profile.exec_driver_sql('select count(*) from storage.objects').scalar() == 0


@pytest.mark.parametrize('missing', ['list', 'zip', 'normalized'])
def test_missing_list_zip_or_normalized_original_is_denied(dart_profile, missing):
    value = payload(dart_profile)
    path = f'dart/lists/{LIST_SHA}.json' if missing == 'list' else value['archives'][0][
        'object_key' if missing == 'zip' else 'normalized_object_key']
    prepare(dart_profile, value, path)
    denied(dart_profile, value)


@pytest.mark.parametrize('field,bad', [
    ('provider_company_id', '00999997'), ('ticker', '099997'), ('provider', 'SEC EDGAR'),
    ('source_url', 'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20261015000999'),
    ('source_url', MAIN_URL + '&redirect=1'), ('source_url', MAIN_URL.replace('dart.fss.or.kr', 'dart.fss.or.kr.evil.test')),
    ('source_sha256', 'd' * 64), ('normalized_sha256', 'd' * 64),
    ('object_key', f'profiles/dart/{RAW_SHA}.html'),
    ('normalized_object_key', f'profiles/dart/normalized/{"d" * 64}.txt'),
    ('filing_id', '30000000-0000-4000-8000-000000000097'),
    ('normalization', 'profile-visible-text-v1'), ('published_on', '2026-10-14'),
    ('report_period', '2026-06'), ('form_type', '반기보고서'), ('title', '다른 보고서'),
    ('publication_timezone', 'UTC'),
])
def test_different_receipt_issuer_format_date_hash_and_public_projection_are_denied(dart_profile, field, bad):
    value = payload(dart_profile)
    prepare(dart_profile, value)
    value['archives'][0][field] = bad
    if field in value['result']['sources'][0]:
        value['result']['sources'][0][field] = bad
    denied(dart_profile, value)


@pytest.mark.parametrize('mutation', ['quote', 'offset', 'source_id', 'business_text', 'product_name', 'normalized_bytes', 'private_leak'])
def test_exact_quote_and_normalized_byte_binding_cannot_be_forged(dart_profile, mutation):
    value = payload(dart_profile)
    prepare(dart_profile, value)
    evidence = value['result']['business'][0]['evidence']
    if mutation == 'quote':
        evidence['quote'] = '원문에 존재하지 않는 합성 주장'
        value['result']['business'][0]['text'] = evidence['quote']
    elif mutation == 'offset':
        evidence['location']['start'] += 1
    elif mutation == 'source_id':
        evidence['source_id'] = 'd' * 64
    elif mutation == 'business_text':
        value['result']['business'][0]['text'] = '원문과 다른 요약'
    elif mutation == 'product_name':
        value['result']['products'][0]['name'] = '원문에 없는 제품'
    elif mutation == 'normalized_bytes':
        value['archives'][0]['normalized_text'] += '\n원문에 없는 문장'
    else:
        value['result']['sources'][0]['object_key'] = value['archives'][0]['object_key']
    denied(dart_profile, value)


@pytest.mark.parametrize('mutation', ['recovered_without_limit', 'ready_without_complete', 'leader', 'formation', 'second_archive'])
def test_recovered_markup_and_source_coverage_are_not_overstated(dart_profile, mutation):
    value = payload(dart_profile, recovered=True)
    prepare(dart_profile, value)
    if mutation == 'recovered_without_limit':
        value['result']['limitations'] = []
    elif mutation == 'ready_without_complete':
        value['result']['status'] = 'ready'
    elif mutation == 'leader':
        value['result']['leadership'] = [{'name': '허위 대표자', 'role': '대표이사', 'as_of': '2026-10-15',
                                          'basis': 'filing', 'evidence': value['result']['business'][0]['evidence']}]
    elif mutation == 'formation':
        value['result']['formation'] = [{'kind': 'established', 'date': '2026', 'precision': 'year',
                                         'evidence': value['result']['business'][0]['evidence']}]
    else:
        value['archives'].append(copy.deepcopy(value['archives'][0]))
        value['result']['sources'].append(copy.deepcopy(value['result']['sources'][0]))
    denied(dart_profile, value)


def test_lost_or_expired_lease_cannot_publish_profile(dart_profile):
    value = payload(dart_profile)
    prepare(dart_profile, value)
    changed = copy.deepcopy(value)
    changed['lease'] = '80000000-0000-4000-8000-000000000002'
    denied(dart_profile, changed, 'PT409')
    dart_profile.exec_driver_sql("update app_private.company_profile_enrichments set lease_until=now()-interval '1 second'")
    denied(dart_profile, value, 'PT409')


def test_failed_refresh_preserves_last_verified_receipt_and_original_dates(dart_profile):
    value = payload(dart_profile)
    prepare(dart_profile, value)
    original = admin(dart_profile, 'save', value)
    dart_profile.exec_driver_sql("update app_private.company_profile_enrichments set next_refresh_at=now()-interval '1 second'")
    assert admin(dart_profile, 'claim', {'lease': LEASE}) is True
    failed = admin(dart_profile, 'fail', {'lease': LEASE, 'code': 'profile_source_unavailable'})
    assert failed['business'] == original['business'] and failed['sources'] == original['sources']
    assert failed['checked_at'] == original['checked_at']
    assert failed['last_error'] == 'profile_source_unavailable'


def test_changed_canonical_identity_cannot_reuse_previous_profile(dart_profile):
    value = payload(dart_profile)
    prepare(dart_profile, value)
    admin(dart_profile, 'save', value)
    dart_profile.execute(text("update companies set provider_company_id='00999997' where id=:id"), {'id': C})
    assert admin(dart_profile, 'read')['result'] is None


def revision(conn, value, receipt, period='2026-09', filed='2026-10-15'):
    changed = copy.deepcopy(value)
    fid = '30000000-0000-4000-8000-000000000097'
    source = changed['archives'][0]
    url = f'https://dart.fss.or.kr/dsaf001/main.do?rcpNo={receipt}'
    title = f'분기보고서 ({period.replace("-", ".")})'
    conn.execute(text("""insert into dart_filings(id,company_id,receipt,title,filing_date,source_url,
        source_sha256,source_object_key,publication_precision,publication_timezone)
        values(:fid,:cid,:receipt,:title,:filed,:url,:sha,:path,'date','Asia/Seoul')"""),
                 {'fid': fid, 'cid': C, 'receipt': receipt, 'title': title, 'filed': filed,
                  'url': url, 'sha': LIST_SHA, 'path': f'dart/lists/{LIST_SHA}.json'})
    source.update(id='d' * 64, source_sha256='d' * 64, filing_id=fid, source_url=url,
                  title=title, published_on=filed, report_period=period, object_key=f'profiles/dart/{"d" * 64}.zip')
    changed['result']['sources'][0] = {key: item for key, item in source.items() if key not in (
        'object_key', 'normalized_object_key', 'filing_id', 'provider_company_id', 'ticker', 'normalized_text')}
    for field in ['business', 'products', 'segments']:
        for entry in changed['result'][field]:
            entry['evidence']['source_id'] = 'd' * 64
    conn.exec_driver_sql("update app_private.company_profile_enrichments set next_refresh_at=now()-interval '1 second'")
    prepare(conn, changed)
    return changed


@pytest.mark.parametrize('receipt,period,filed', [
    ('20260815000123', '2026-06', '2026-08-15'),
    ('20261014000123', '2026-09', '2026-10-14'),
    ('20261015000122', '2026-09', '2026-10-15'),
])
def test_earlier_period_date_or_same_day_receipt_cannot_downgrade_verified_profile(dart_profile, receipt, period, filed):
    value = payload(dart_profile)
    prepare(dart_profile, value)
    admin(dart_profile, 'save', value)
    changed = revision(dart_profile, value, receipt, period, filed)
    denied(dart_profile, changed, 'PT409')
    assert admin(dart_profile, 'read')['result']['sources'][0]['source_url'] == MAIN_URL


def test_newer_same_day_receipt_can_update_dated_evidence(dart_profile):
    value = payload(dart_profile)
    prepare(dart_profile, value)
    admin(dart_profile, 'save', value)
    changed = revision(dart_profile, value, '20261015000124')
    assert admin(dart_profile, 'save', changed)['sources'][0]['source_url'].endswith('20261015000124')


def test_existing_sec_snapshot_still_uses_unchanged_strict_validation(enriched):
    with enriched.connection.driver_connection.cursor() as cursor:
        cursor.execute((ROOT / 'supabase/migrations' / MIGRATION).read_text(), prepare=False)
    value = snapshot(enriched)
    assert admin(enriched, 'claim', {'lease': LEASE}) is True
    enriched.execute(text("insert into storage.objects(bucket_id,name) values('signalbrief-raw',:path)"),
                     {'path': value['archives'][0]['object_key']})
    assert admin(enriched, 'save', value) == value['result']
    assert admin(enriched, 'read')['result'] == value['result']
