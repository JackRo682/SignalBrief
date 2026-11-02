"""DART period repair: quarantine old durations, preserve raw versions, verify v2 proof."""
import copy
import json
from datetime import datetime, timezone
from pathlib import Path

import pytest
import test_company_financials as original
from sqlalchemy import text
from test_company_financials import LEASE, SHA, admin, archive, claim, denied, read
from test_company_financials import db as db
from test_company_financials import discovery as discovery
from test_company_financials import finance as finance
from test_company_financials import own as own
from test_workspace_schema import A, C

pytestmark = pytest.mark.postgres
MIGRATION = Path(__file__).resolve().parents[2] / 'supabase/migrations/20261102051051_dart_financial_period_binding.sql'
DART = '20000000-0000-4000-8000-000000000044'
VERSION = 'reported-financials-dart-v2'


def apply(conn):
    with conn.connection.driver_connection.cursor() as cursor:
        cursor.execute(MIGRATION.read_text(), prepare=False)


@pytest.fixture
def current(finance):
    apply(finance)
    return finance


def add_dart(conn):
    conn.execute(text("""insert into public.companies(id,name,ticker,market,provider,provider_company_id,is_demo,created_at)
      values(:id,'Synthetic Korean issuer','0068Y0','KOSPI','dart','12345678',false,now())"""), {'id': DART})


def dart_snapshot(*, legacy=False, report='11012', statement='IS', unknown_period=False):
    row = {'corp_code': '12345678', 'stock_code': '0068Y0', 'bsns_year': '2026', 'reprt_code': report,
           'rcept_no': '20260814000001', 'fs_div': 'CFS', 'sj_div': statement, 'account_nm': '매출액',
           'currency': 'KRW', 'thstrm_dt': '2026.01.01 ~ 2026.06.30',
           'thstrm_amount': '3,388,755,080,295', 'thstrm_add_amount': '6,629,816,183,195',
           'frmtrm_dt': '2025.01.01 ~ 2025.06.30', 'frmtrm_amount': '2,900,000,000,000',
           'frmtrm_add_amount': '5,701,868,408,120'}
    if report == '11011':
        row.update(thstrm_dt='2026.01.01 ~ 2026.12.31', frmtrm_dt='2025.01.01 ~ 2025.12.31')
    if unknown_period:
        row.update(thstrm_dt='제 4 기 반기', frmtrm_dt='제 3 기 반기')
    items = []
    for term, year in [('thstrm', '2026'), ('frmtrm', '2025')]:
        field = term + ('_amount' if legacy or report == '11011' else '_add_amount')
        items.append({'metric': 'revenue', 'taxonomy': 'dart', 'concept': '매출액', 'label': '매출액',
                      'value_raw': row[field].replace(',', ''), 'unit': 'KRW',
                      'period_start': None if unknown_period else f'{year}-01-01',
                      'period_end': None if unknown_period else f'{year}-12-31' if report == '11011' else f'{year}-06-30',
                      'period_label': row[term + '_dt'], 'period_kind': 'duration',
                      'fiscal_year': 2026 if term == 'thstrm' else None, 'fiscal_period': report, 'form': report,
                      'accession': row['rcept_no'], 'filed_on': None, 'accounting_standard': None,
                      'basis': 'reported', 'scope': 'consolidated',
                      'source_url': 'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=' + row['rcept_no'],
                      'source_quote': json.dumps(row), 'location': '/list/0/' + field, 'raw_sha256': SHA})
    bs = copy.deepcopy(row)
    bs.update(sj_div='BS', account_nm='자산총계', thstrm_dt='2026.06.30 현재', thstrm_amount='42,000')
    instant = copy.deepcopy(items[0])
    instant.update(metric='assets', concept='자산총계', label='자산총계', value_raw='42000', period_start=None,
                   period_end='2026-06-30', period_kind='instant', period_label=bs['thstrm_dt'],
                   source_quote=json.dumps(bs), location='/list/1/thstrm_amount')
    items.append(instant)
    return {'provider': 'dart', 'provider_company_id': '12345678',
            'source_url': f'https://opendart.fss.or.kr/api/fnlttSinglAcnt.json?corp_code=12345678&bsns_year=2026&reprt_code={report}',
            'raw_sha256': SHA, 'fetched_at': datetime.now(timezone.utc).isoformat(), 'items': items}


def payload(conn, source, *, version=VERSION, archived=False):
    if archived:
        value = {'company_id': DART, 'lease': LEASE, 'snapshot': source,
                 'object_key': f'financials/dart/12345678/{source["raw_sha256"]}.json'}
    else:
        value = archive(conn, source, DART)
    return {**value, 'parser_version': version}


def public(conn):
    value = read(conn, DART)
    conn.exec_driver_sql('RESET ROLE')
    return value


def legacy_saved(conn):
    add_dart(conn)
    claim(conn, DART)
    source = dart_snapshot(legacy=True)
    admin(conn, 'save', payload(conn, source, version='reported-financials-v1'))
    return source


def due(conn):
    conn.execute(text("""update app_private.company_financial_sources
      set last_success_at=now()-interval '1 day',last_attempt_at=now()-interval '1 hour' where company_id=:id"""), {'id': DART})


def test_migration_immediately_hides_legacy_durations_but_keeps_original_and_bs(finance):
    source = legacy_saved(finance)
    assert public(finance)['items'][0]['value_raw'] == '3388755080295'  # Reproduces the old bug.
    before = finance.execute(text('select to_jsonb(f) from app_private.company_financial_snapshots f where company_id=:id'), {'id': DART}).scalar()
    apply(finance)
    value = public(finance)
    assert value['status'] == 'pending' and value['error_code'] == 'financial_period_revalidation_required'
    assert value['items'] == source['items'][2:]
    assert value['source']['raw_sha256'] == SHA and value['last_success_at'] is not None
    assert finance.execute(text('select to_jsonb(f) from app_private.company_financial_snapshots f where company_id=:id'), {'id': DART}).scalar() == before
    assert finance.execute(text('select count(*) from storage.objects where name like :path'), {'path': 'financials/dart/%'}).scalar() == 1
    queued = finance.execute(text('select status,attempt_count,latest_parser_version from app_private.company_financial_sources where company_id=:id'), {'id': DART}).one()
    assert queued == ('pending', 0, 'reported-financials-v1')


def test_same_archive_can_be_reparsed_once_with_v2_without_overwriting_v1(finance):
    previous = legacy_saved(finance)
    apply(finance)
    assert claim(finance, DART) == {'claimed': True, 'status': 'pending'}  # Fresh v1 cannot hide the repair for six hours.
    source = dart_snapshot()
    assert admin(finance, 'save', payload(finance, source, archived=True)) == {'status': 'ready', 'count': 3}
    value = public(finance)
    assert value['status'] == 'ready' and value['error_code'] is None
    assert value['items'][0]['value_raw'] == '6629816183195'
    assert value['items'][0]['period_start'] == '2026-01-01' and value['items'][0]['period_end'] == '2026-06-30'
    assert value['items'][1]['value_raw'] == '5701868408120' and value['items'][1]['period_start'] == '2025-01-01'
    rows = dict(finance.execute(text('select parser_version,source from app_private.company_financial_snapshots where company_id=:id'), {'id': DART}).all())
    assert rows == {'reported-financials-v1': previous, VERSION: source}
    assert claim(finance, DART) == {'claimed': False, 'status': 'ready'}


def test_old_worker_keeps_its_lease_but_cannot_restore_bad_duration_context(finance):
    legacy_saved(finance)
    due(finance)
    assert claim(finance, DART)['claimed'] is True
    before = finance.execute(text('select lease_id,lease_until from app_private.company_financial_sources where company_id=:id'), {'id': DART}).one()
    apply(finance)
    assert finance.execute(text('select lease_id,lease_until from app_private.company_financial_sources where company_id=:id'), {'id': DART}).one() == before
    assert claim(finance, DART) == {'claimed': False, 'status': 'pending'}
    denied(finance, lambda: admin(finance, 'save', payload(finance, dart_snapshot(legacy=True), version='reported-financials-v1', archived=True)))
    admin(finance, 'fail', {'company_id': DART, 'lease': LEASE, 'code': 'invalid_financial_source'})
    assert public(finance)['status'] == 'unavailable'
    assert all(item['period_kind'] == 'instant' for item in public(finance)['items'])
    assert claim(finance, DART)['claimed'] is True


@pytest.mark.parametrize('statement', ['IS', 'CIS'])
@pytest.mark.parametrize('report', ['11012', '11013', '11014', '11011'])
def test_correct_amount_and_reported_period_binding_is_accepted(current, statement, report):
    add_dart(current)
    claim(current, DART)
    source = dart_snapshot(report=report, statement=statement)
    assert admin(current, 'save', payload(current, source))['count'] == 3
    assert public(current)['items'] == source['items']


@pytest.mark.parametrize('patch', [
    {'location': '/list/0/thstrm_amount', 'value_raw': '3388755080295'},
    {'location': '/list/0/frmtrm_add_amount'}, {'value_raw': '3388755080295'},
    {'period_start': '2026-04-01'}, {'period_end': '2026-03-31'},
    {'period_start': None}, {'period_kind': 'instant'}, {'fiscal_year': 2025},
    {'fiscal_period': '11013'}, {'form': '11013'}, {'scope': 'separate'}, {'unit': 'USD'},
    {'source_url': 'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20260814000002'},
])
def test_wrong_amount_pointer_or_invented_period_is_rejected_atomically(current, patch):
    add_dart(current)
    claim(current, DART)
    source = dart_snapshot()
    source['items'][0].update(patch)
    denied(current, lambda: admin(current, 'save', payload(current, source)))
    assert public(current)['items'] == []
    assert current.exec_driver_sql('select count(*) from app_private.company_financial_snapshots').scalar() == 0


@pytest.mark.parametrize('change', ['missing_cumulative', 'bad_grouping', 'wrong_corp', 'wrong_stock', 'unknown_statement', 'unknown_scope'])
def test_unusable_or_cross_identity_quote_cannot_become_a_duration_fact(current, change):
    add_dart(current)
    claim(current, DART)
    source = dart_snapshot()
    item = source['items'][0]
    quote = json.loads(item['source_quote'])
    if change == 'missing_cumulative':
        del quote['thstrm_add_amount']
    elif change == 'bad_grouping':
        quote['thstrm_add_amount'] = '66,29816,183,195'
    elif change == 'wrong_corp':
        quote['corp_code'] = '87654321'
    elif change == 'wrong_stock':
        quote['stock_code'] = '099999'
    elif change == 'unknown_statement':
        quote['sj_div'] = 'CF'
    else:
        quote['fs_div'] = 'OTHER'
        item['scope'] = None
    item['source_quote'] = json.dumps(quote)
    denied(current, lambda: admin(current, 'save', payload(current, source)))
    assert public(current)['items'] == []


def test_missing_cumulative_can_publish_only_verified_balance_sheet_not_fake_zero(current):
    add_dart(current)
    claim(current, DART)
    source = dart_snapshot()
    source['items'] = source['items'][2:]
    assert admin(current, 'save', payload(current, source))['count'] == 1
    assert public(current)['items'][0]['value_raw'] == '42000'
    assert public(current)['items'][0]['period_kind'] == 'instant'


def test_unfamiliar_period_remains_a_label_with_no_inferred_dates(current):
    add_dart(current)
    claim(current, DART)
    source = dart_snapshot(unknown_period=True)
    assert admin(current, 'save', payload(current, source))['count'] == 3
    assert public(current)['items'][0]['period_start'] is None
    assert public(current)['items'][0]['period_end'] is None


@pytest.mark.parametrize('target', ['annual_income', 'balance_sheet'])
def test_accumulated_pointer_cannot_replace_annual_or_instant_amount(current, target):
    add_dart(current)
    claim(current, DART)
    source = dart_snapshot(report='11011' if target == 'annual_income' else '11012')
    item = source['items'][0 if target == 'annual_income' else 2]
    quote = json.loads(item['source_quote'])
    item['location'] = item['location'].replace('_amount', '_add_amount')
    item['value_raw'] = quote['thstrm_add_amount'].replace(',', '')
    denied(current, lambda: admin(current, 'save', payload(current, source)))
    assert public(current)['items'] == []


def test_old_mislabeled_income_cannot_pass_quarantine_as_an_instant(finance):
    add_dart(finance)
    claim(finance, DART)
    source = dart_snapshot(legacy=True)
    source['items'][0]['period_kind'] = 'instant'
    admin(finance, 'save', payload(finance, source, version='reported-financials-v1'))
    apply(finance)
    assert public(finance)['items'] == source['items'][2:]


@pytest.mark.parametrize('change', ['same_sha', 'new_sha_same_receipt'])
def test_versioning_does_not_weaken_conflicts_within_the_same_parser_revision(current, change):
    add_dart(current)
    claim(current, DART)
    source = dart_snapshot()
    admin(current, 'save', payload(current, source))
    due(current)
    claim(current, DART)
    changed = copy.deepcopy(source)
    changed['items'][0]['value_raw'] = '7'
    quote = json.loads(changed['items'][0]['source_quote'])
    quote['thstrm_add_amount'] = '7'
    changed['items'][0]['source_quote'] = json.dumps(quote)
    if change == 'new_sha_same_receipt':
        changed['raw_sha256'] = 'b' * 64
        for item in changed['items']:
            item['raw_sha256'] = 'b' * 64
    denied(current, lambda: admin(current, 'save', payload(current, changed, archived=change == 'same_sha')), 'PT409')
    assert public(current)['items'] == source['items']


@pytest.mark.parametrize('change', ['provider_identity', 'missing_archive'])
def test_v2_cache_keeps_current_identity_and_original_archive_gates(current, change):
    add_dart(current)
    claim(current, DART)
    admin(current, 'save', payload(current, dart_snapshot()))
    if change == 'provider_identity':
        current.execute(text("update companies set provider_company_id='87654321' where id=:id"), {'id': DART})
    else:
        current.execute(text('delete from storage.objects where name like :path'), {'path': 'financials/dart/%'})
    value = public(current)
    assert value['items'] == [] and value['source'] is None and value['last_success_at'] is None
    assert value['status'] == 'unavailable'
    assert claim(current, DART)['claimed'] is True


def test_sec_v1_and_existing_security_and_approval_boundaries_are_unchanged(current):
    original.test_exact_numeric_projection_requires_archived_source_and_does_not_approve_analysis(current)
    current.exec_driver_sql('RESET ROLE')
    original.test_client_and_anonymous_cannot_change_or_read_private_pipeline(current)
    current.exec_driver_sql('RESET ROLE')
    current.execute(text("insert into auth.mfa_factors values(gen_random_uuid(),:u,'verified')"), {'u': A})
    denied(current, lambda: read(current, C), 'PT403')


def test_untrusted_clients_cannot_invoke_private_period_helpers(current):
    current.exec_driver_sql('SET LOCAL ROLE authenticated')
    denied(current, lambda: current.exec_driver_sql("select app_content_private.dart_financial_dates('2026.06.30',true)"), '42501')
    denied(current, lambda: current.exec_driver_sql("select app_content_private.financial_parser_version('dart')"), '42501')
