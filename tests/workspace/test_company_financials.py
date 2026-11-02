"""Synthetic reported financial facts and real PostgreSQL approval/ownership boundaries."""
import copy
import json
from datetime import datetime, timezone
from pathlib import Path

import pytest
from sqlalchemy import text
from test_discovery_reliability import discovery as discovery
from test_workspace_schema import A, C, F
from test_workspace_schema import db as db
from test_workspace_schema import own as own

pytestmark = pytest.mark.postgres
ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / 'supabase/migrations/20261102020442_company_reported_financials.sql'
LEASE = '90000000-0000-4000-8000-000000000031'
SHA = 'a' * 64


@pytest.fixture
def finance(discovery):
    discovery.exec_driver_sql('RESET ROLE')
    collector = (ROOT / 'docs/sql/collector.sql').read_text()
    with discovery.connection.driver_connection.cursor() as cursor:
        cursor.execute(collector[collector.index('CREATE TABLE IF NOT EXISTS app_private.collector_analysis_attempts'):], prepare=False)
        cursor.execute(MIGRATION.read_text(), prepare=False)
    yield discovery


def admin(conn, op, payload):
    return conn.execute(text('select public.sb_company_financial_admin(:op,cast(:p as jsonb))'),
                        {'op': op, 'p': json.dumps(payload)}).scalar()


def read(conn, company=C):
    conn.exec_driver_sql('SET LOCAL ROLE authenticated')
    return conn.execute(text('select public.sb_company_financials(:id)'), {'id': company}).scalar()


def snapshot():
    quote = '{"start":"2026-01-01","end":"2026-03-31","val":99999999999999999.12345678,"accn":"0000000001-26-000001","fy":2026,"fp":"Q1","form":"10-Q","filed":"2026-05-01"}'
    url = 'https://data.sec.gov/api/xbrl/companyfacts/CIK0000000001.json'
    item = {'metric': 'revenue', 'taxonomy': 'us-gaap', 'concept': 'Revenues', 'label': 'Revenues',
            'value_raw': '99999999999999999.12345678', 'unit': 'USD', 'period_start': '2026-01-01',
            'period_end': '2026-03-31', 'period_label': '2026-01-01 — 2026-03-31', 'period_kind': 'duration',
            'fiscal_year': 2026, 'fiscal_period': 'Q1', 'form': '10-Q', 'accession': '0000000001-26-000001',
            'filed_on': '2026-05-01', 'accounting_standard': 'US-GAAP', 'basis': 'reported', 'scope': 'entity',
            'source_url': url, 'source_quote': quote, 'location': '/facts/us-gaap/Revenues/units/USD/0', 'raw_sha256': SHA}
    return {'provider': 'sec', 'provider_company_id': '0000000001', 'source_url': url, 'raw_sha256': SHA,
            'fetched_at': datetime.now(timezone.utc).isoformat(), 'items': [item]}


def archive(conn, source, company=C):
    path = f'financials/{source["provider"]}/{source["provider_company_id"]}/{source["raw_sha256"]}.json'
    conn.execute(text("insert into storage.objects(bucket_id,name,metadata) values ('signalbrief-raw',:path,jsonb_build_object('size',1234))"), {'path': path})
    return {'company_id': company, 'lease': LEASE, 'snapshot': source, 'object_key': path, 'parser_version': 'reported-financials-v1'}


def claim(conn, company=C):
    return admin(conn, 'claim', {'company_id': company, 'lease': LEASE})


def denied(conn, fn, code='PT422'):
    point = conn.begin_nested()
    with pytest.raises(Exception) as error:
        fn()
    point.rollback()
    assert error.value.orig.sqlstate == code


def test_read_distinguishes_not_collected_and_preserves_no_personal_writes(finance):
    value = read(finance)
    assert value['status'] == 'not_collected' and value['items'] == []
    assert value['analysis'] == {'status': 'not_collected', 'approved': 0, 'pending_review': 0, 'error_code': None}
    assert finance.exec_driver_sql('select count(*) from watchlist_items').scalar() == 0
    assert finance.exec_driver_sql('select count(*) from calendar_items').scalar() == 0


def test_exact_numeric_projection_requires_archived_source_and_does_not_approve_analysis(finance):
    assert claim(finance) == {'claimed': True, 'status': 'pending'}
    source = snapshot()
    assert admin(finance, 'save', archive(finance, source)) == {'status': 'ready', 'count': 1}
    value = read(finance)
    assert value['items'] == source['items']
    assert value['items'][0]['value_raw'] == '99999999999999999.12345678'
    assert value['source']['raw_sha256'] == SHA and value['status'] == 'ready'
    assert value['analysis']['approved'] == value['analysis']['pending_review'] == 0
    assert 'raw_object_key' not in json.dumps(value) and 'financials/sec/' not in json.dumps(value)
    finance.exec_driver_sql('RESET ROLE')
    assert finance.exec_driver_sql('select count(*) from us_analyses').scalar() == 0
    assert claim(finance) == {'claimed': False, 'status': 'ready'}


def test_save_before_archive_is_denied_without_leaving_partial_public_numbers(finance):
    claim(finance)
    p = archive(finance, snapshot())
    finance.exec_driver_sql("delete from storage.objects where bucket_id='signalbrief-raw'")
    denied(finance, lambda: admin(finance, 'save', p))
    assert read(finance)['items'] == []


@pytest.mark.parametrize('change', ['provider_identity', 'missing_archive'])
def test_cached_financials_require_current_issuer_identity_and_a_readable_original(finance, change):
    claim(finance)
    source = snapshot()
    admin(finance, 'save', archive(finance, source))
    if change == 'provider_identity':
        finance.execute(text("update companies set provider_company_id='0000000042' where id=:id"), {'id': C})
    else:
        finance.execute(text('delete from storage.objects where name like :prefix'), {'prefix': 'financials/%'})
    value = read(finance)
    assert value['status'] == 'unavailable'
    assert value['items'] == [] and value['source'] is None and value['last_success_at'] is None
    assert value['error_code'] == 'financial_source_unavailable'
    finance.exec_driver_sql('RESET ROLE')
    # Neither an old six-hour cache nor a prior request's minute backoff hides the repair.
    assert claim(finance) == {'claimed': True, 'status': 'pending'}


@pytest.mark.parametrize('patch', [
    {'value_raw': '999'}, {'unit': 'EUR'}, {'period_end': '2026-06-30'}, {'period_start': None},
    {'accession': '0000000002-26-000001'}, {'scope': 'consolidated'}, {'basis': 'estimated'},
    {'accounting_standard': 'IFRS'}, {'location': '/facts/us-gaap/Assets/units/USD/0'},
    {'source_url': 'https://evil.test/data'}, {'raw_sha256': 'b' * 64},
    {'source_quote': '{}'}, {'form': '10-K'},
])
def test_corrupted_context_is_never_projected(finance, patch):
    claim(finance)
    source = snapshot()
    source['items'][0].update(patch)
    denied(finance, lambda: admin(finance, 'save', archive(finance, source)))
    assert read(finance)['items'] == []


def test_failed_refresh_retains_prior_original_and_reports_staleness(finance):
    claim(finance)
    source = snapshot()
    admin(finance, 'save', archive(finance, source))
    finance.exec_driver_sql("update app_private.company_financial_sources set last_success_at=now()-interval '1 day',last_attempt_at=now()-interval '1 hour'")
    claim(finance)
    admin(finance, 'fail', {'company_id': C, 'lease': LEASE, 'code': 'request_timeout'})
    value = read(finance)
    assert value['status'] == 'unavailable' and value['error_code'] == 'request_timeout'
    assert value['items'] == source['items'] and value['last_success_at'] is not None


def test_client_and_anonymous_cannot_change_or_read_private_pipeline(finance):
    finance.exec_driver_sql('SET LOCAL ROLE authenticated')
    for statement in ["select public.sb_company_financial_admin('claim','{}')", 'select * from app_private.company_financial_snapshots', 'select public.sb_financial_collection_pick()']:
        denied(finance, lambda: finance.exec_driver_sql(statement), '42501')
    finance.exec_driver_sql('SET LOCAL ROLE anon')
    denied(finance, lambda: finance.exec_driver_sql(f"select public.sb_company_financials('{C}')"), '42501')


def test_demo_missing_and_unassured_identity_are_denied(finance):
    denied(finance, lambda: read(finance, '20000000-0000-4000-8000-000000000002'), 'PT404')
    denied(finance, lambda: read(finance, '20000000-0000-4000-8000-000000000099'), 'PT404')
    finance.exec_driver_sql('RESET ROLE')
    finance.execute(text('insert into auth.mfa_factors values (gen_random_uuid(),:u,\'verified\')'), {'u': A})
    denied(finance, lambda: read(finance), 'PT403')


def test_new_issuer_is_durably_requested_without_following_or_autoapproval(finance):
    cid = '20000000-0000-4000-8000-000000000042'
    finance.execute(text("""insert into public.companies(id,name,ticker,market,provider,provider_company_id,is_demo,created_at)
      values (:id,'Synthetic new issuer','NEW','NYSE','sec','0000000042',false,now())"""), {'id': cid})
    assert finance.execute(text('select status from app_private.company_financial_sources where company_id=:id'), {'id': cid}).scalar() == 'pending'
    assert finance.execute(text('select count(*) from app_private.company_analysis_requests where company_id=:id'), {'id': cid}).scalar() == 1
    assert finance.exec_driver_sql('select count(*) from us_analyses').scalar() == 0
    assert finance.exec_driver_sql('select count(*) from watchlist_items').scalar() == 0
    value = read(finance, cid)
    assert value['analysis']['status'] == 'blocked' and value['analysis']['error_code'] == 'schedule_disabled'


def test_analysis_picker_prioritizes_new_requested_issuer_and_keeps_review_gate(finance):
    cid = '20000000-0000-4000-8000-000000000042'
    new_id = '30000000-0000-4000-8000-000000000042'
    finance.execute(text("""insert into public.companies(id,name,ticker,market,provider,provider_company_id,is_demo,created_at)
      values (:id,'Synthetic new issuer','NEW','NYSE','sec','0000000042',false,now())"""), {'id': cid})
    finance.execute(text("""insert into us_filings(id,company_id,accession,form,filing_date,document_url,source_url,source_sha256)
      values (:id,:c,'0000000042-26-000001','10-Q',current_date-120,'https://www.sec.gov/Archives/edgar/data/42/synthetic.htm','https://data.sec.gov/submissions/CIK0000000042.json',repeat('a',64))"""), {'id': new_id, 'c': cid})
    assert str(finance.exec_driver_sql('select public.sb_collector_analysis_pick()').scalar()) == new_id
    assert finance.exec_driver_sql('select count(*) from us_analyses').scalar() == 0
    assert str(finance.exec_driver_sql('select public.sb_collector_analysis_pick()').scalar()) == F


def test_analysis_transient_retry_is_bounded_and_semantic_failures_do_not_retry(finance):
    assert str(finance.exec_driver_sql('select public.sb_collector_analysis_pick()').scalar()) == F
    finance.exec_driver_sql(f"select public.sb_collector_analysis_finish('{F}','blocked','request_timeout')")
    assert finance.exec_driver_sql('select public.sb_collector_analysis_pick()').scalar() is None
    for attempt in (2, 3):
        finance.exec_driver_sql("update app_private.collector_analysis_attempts set attempted_at=now()-interval '1 hour'")
        assert str(finance.exec_driver_sql('select public.sb_collector_analysis_pick()').scalar()) == F
        assert finance.exec_driver_sql('select attempt_count from app_private.collector_analysis_attempts').scalar() == attempt
        finance.exec_driver_sql(f"select public.sb_collector_analysis_finish('{F}','blocked','request_timeout')")
    finance.exec_driver_sql("update app_private.collector_analysis_attempts set attempted_at=now()-interval '1 hour'")
    assert finance.exec_driver_sql('select public.sb_collector_analysis_pick()').scalar() is None
    finance.exec_driver_sql("update app_private.collector_analysis_attempts set attempt_count=1,code='numeric_citation_mismatch'")
    assert finance.exec_driver_sql('select public.sb_collector_analysis_pick()').scalar() is None


def test_pending_review_is_truthful_without_exposing_unapproved_content(finance):
    finance.execute(text("insert into public.us_analyses(filing_id,status,model,source_sha256,result) values (:f,'needs_review','synthetic',repeat('a',64),'{\"private_claim\":\"never expose\"}')"), {'f': F})
    value = read(finance)
    assert value['analysis']['status'] == 'pending_review' and value['analysis']['pending_review'] == 1
    assert value['analysis']['approved'] == 0 and 'never expose' not in json.dumps(value)


def test_running_analysis_is_not_reported_as_missing_or_approved(finance):
    finance.exec_driver_sql('select public.sb_collector_analysis_pick()')
    value = read(finance)
    assert value['analysis']['status'] == 'collecting'
    assert value['analysis']['approved'] == value['analysis']['pending_review'] == 0


@pytest.mark.parametrize('change', ['older_period', 'same_receipt_changed_value', 'empty'])
def test_fresh_fetch_cannot_downgrade_or_rewrite_authoritative_context(finance, change):
    claim(finance)
    source = snapshot()
    admin(finance, 'save', archive(finance, source))
    finance.exec_driver_sql("update app_private.company_financial_sources set last_success_at=now()-interval '1 day',last_attempt_at=now()-interval '1 hour'")
    claim(finance)
    newer = copy.deepcopy(source)
    newer['raw_sha256'] = 'b' * 64
    item = newer['items'][0]
    item['raw_sha256'] = 'b' * 64
    if change == 'older_period':
        item['source_quote'] = item['source_quote'].replace('2026-01-01', '2025-01-01').replace('2026-03-31', '2025-03-31')
        item.update(period_start='2025-01-01', period_end='2025-03-31', period_label='2025-01-01 — 2025-03-31')
    elif change == 'same_receipt_changed_value':
        item['source_quote'] = item['source_quote'].replace('99999999999999999.12345678', '7')
        item['value_raw'] = '7'
    else:
        newer['items'] = []
    denied(finance, lambda: admin(finance, 'save', archive(finance, newer)), 'PT409')
    assert read(finance)['items'] == source['items']


def test_dart_exact_period_and_statement_scope_are_bound_to_source(finance):
    cid = '20000000-0000-4000-8000-000000000043'
    finance.execute(text("""insert into public.companies(id,name,ticker,market,provider,provider_company_id,is_demo,created_at)
      values (:id,'Synthetic Korean issuer','0068Y0','KOSPI','dart','12345678',false,now())"""), {'id': cid})
    claim(finance, cid)
    source = snapshot()
    source.update(provider='dart', provider_company_id='12345678', source_url='https://opendart.fss.or.kr/api/fnlttSinglAcnt.json?corp_code=12345678&bsns_year=2026&reprt_code=11012')
    row = {'corp_code': '12345678', 'stock_code': '0068Y0', 'bsns_year': '2026', 'reprt_code': '11012', 'rcept_no': '20260814000001', 'fs_div': 'CFS', 'account_nm': '매출액', 'currency': 'KRW', 'thstrm_dt': '2026.01.01 ~ 2026.06.30', 'thstrm_amount': '12,345,678,901,234,567'}
    source['items'][0].update(taxonomy='dart', concept='매출액', label='매출액', value_raw='12345678901234567', unit='KRW', period_end='2026-06-30', period_label=row['thstrm_dt'], fiscal_period='11012', form='11012', accession=row['rcept_no'], filed_on=None, accounting_standard=None, scope='consolidated', source_url='https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20260814000001', source_quote=json.dumps(row), location='/list/0/thstrm_amount')
    payload = archive(finance, source, cid)
    malformed = copy.deepcopy(payload)
    malformed['snapshot']['items'][0]['scope'] = 'separate'
    denied(finance, lambda: admin(finance, 'save', malformed))
    assert admin(finance, 'save', payload)['count'] == 1
    assert read(finance, cid)['items'] == source['items']
