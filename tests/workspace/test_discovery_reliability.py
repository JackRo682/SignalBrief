"""Real PostgreSQL tests for authoritative registry activation and search boundaries."""
import json
from pathlib import Path

import pytest
from sqlalchemy import text
from test_workspace_schema import A, C, F
from test_workspace_schema import db as db
from test_workspace_schema import own as own

pytestmark = pytest.mark.postgres
ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture
def discovery(own):
    own.exec_driver_sql('RESET ROLE')
    for name in ('20261101014441_screenshot_dashboard.sql', '20261101041747_company_discovery_reliability.sql',
                 '20261101050721_official_directory_english_names.sql',
                 '20261101055057_dart_alphanumeric_stock_codes.sql'):
        with own.connection.driver_connection.cursor() as cursor:
            cursor.execute((ROOT / 'supabase/migrations' / name).read_text(), prepare=False)
    own.exec_driver_sql('SET LOCAL ROLE authenticated')
    return own


def admin(conn, op, payload):
    if op == 'activate':
        payload = {**payload, 'actor': A}
    return conn.execute(text('select public.sb_discovery_admin(:op,cast(:p as jsonb))'), {'op': op, 'p': json.dumps(payload)}).scalar()


def test_directory_is_private_and_mutations_are_service_only(discovery):
    for sql in ('select * from app_private.company_directory', "select public.sb_discovery_admin('activate','{}')",
                "select app_private.sb_company_official_search_names('anything')"):
        point = discovery.begin_nested()
        with pytest.raises(Exception) as caught:
            discovery.exec_driver_sql(sql)
        point.rollback()
        assert caught.value.orig.sqlstate == '42501'
    point = discovery.begin_nested()
    discovery.exec_driver_sql('SET LOCAL ROLE anon')
    with pytest.raises(Exception) as caught:
        discovery.exec_driver_sql("select public.sb_company_discovery('TEST')")
    point.rollback()
    assert caught.value.orig.sqlstate == '42501'


def dart_snapshot(conn, english='Alpine Synthetic Research', lease='90000000-0000-4000-8000-000000000003'):
    items = [{'provider_company_id': str(i).zfill(8), 'ticker': str(i).zfill(6),
              'name': f'합성기업{i}', 'market': 'KR'} for i in range(100, 200)]
    items[1]['official_english_name'] = english
    assert admin(conn, 'claim', {'provider': 'dart', 'lease': lease}) is True
    return {'provider': 'dart', 'lease': lease, 'sha': 'b' * 64,
            'object_key': 'directory/dart/' + 'b' * 64 + '.zip', 'items': items}


@pytest.mark.parametrize('ticker', ['0068Y0', '0017J0'])
def test_official_alphanumeric_stock_codes_survive_snapshot_search_and_activation(discovery, ticker):
    discovery.exec_driver_sql('RESET ROLE')
    snapshot = dart_snapshot(discovery)
    snapshot['items'][1]['ticker'] = ticker
    assert admin(discovery, 'save', snapshot) == {'count': 100}
    assert discovery.exec_driver_sql('select count(*) from app_private.company_directory where active').scalar() == 100
    stored = discovery.execute(text("select provider_company_id,source_sha256 from app_private.company_directory where provider='dart' and ticker=:ticker"), {'ticker': ticker}).one()
    assert tuple(stored) == ('00000101', 'b' * 64)
    discovery.exec_driver_sql('SET LOCAL ROLE authenticated')
    found = discovery.execute(text('select public.sb_company_discovery(:q)'), {'q': ticker.lower()}).scalar()
    assert found['total'] == 1
    assert found['items'][0]['ticker'] == ticker and found['items'][0]['company_id'] is None
    discovery.exec_driver_sql('RESET ROLE')
    selected = {'provider': 'dart', 'provider_company_id': '00000101', 'ticker': ticker}
    company = admin(discovery, 'activate', selected)
    assert company['ticker'] == ticker and company['provider_company_id'] == '00000101'
    assert company['name'] == '합성기업101'
    assert admin(discovery, 'activate', selected)['id'] == company['id']
    # A valid-looking code still cannot activate a different/unlisted identity.
    point = discovery.begin_nested()
    with pytest.raises(Exception) as caught:
        admin(discovery, 'activate', {**selected, 'provider_company_id': '99999999'})
    point.rollback()
    assert caught.value.orig.sqlstate == 'PT404'
    discovery.exec_driver_sql('SET LOCAL ROLE authenticated')
    for function, action in (('sb_workspace', 'company_lookup'), ('sb_redesign_workspace', 'design_directory'),
                             ('sb_customer_workspace', 'catalog')):
        result = discovery.execute(text(f"select public.{function}(:a,cast(:p as jsonb))"),
                                   {'a': action, 'p': json.dumps({'q': ticker.lower()})}).scalar()
        rows = result if isinstance(result, list) else result['items']
        assert [(row['id'], row['ticker']) for row in rows] == [(company['id'], ticker)]


@pytest.mark.parametrize('ticker,corp_id', [
    ('0068y0', '00000101'), ('0068Y', '00000101'), ('0068Y00', '00000101'),
    ('006-Y0', '00000101'), ('006 Y0', '00000101'), ('００６８Y0', '00000101'),
    ('0068가0', '00000101'), ('', '00000101'), ('0068Y0', '00000A01'),
])
def test_invalid_dart_stock_code_or_corporation_id_cannot_replace_snapshot(discovery, ticker, corp_id):
    discovery.exec_driver_sql('RESET ROLE')
    admin(discovery, 'save', dart_snapshot(discovery))
    discovery.exec_driver_sql("update app_private.company_directory_sources set last_success_at=null,last_attempt_at=null where provider='dart'")
    invalid = dart_snapshot(discovery, lease='90000000-0000-4000-8000-000000000004')
    invalid['items'][1].update(ticker=ticker, provider_company_id=corp_id)
    point = discovery.begin_nested()
    with pytest.raises(Exception) as caught:
        admin(discovery, 'save', invalid)
    point.rollback()
    assert caught.value.orig.sqlstate == 'PT422'
    assert discovery.exec_driver_sql('select count(*) from app_private.company_directory where active').scalar() == 100
    assert discovery.exec_driver_sql("select ticker from app_private.company_directory where provider='dart' and provider_company_id='00000101'").scalar() == '000101'


def test_official_english_names_find_the_same_identity_in_discovery_and_registered_search(discovery):
    discovery.exec_driver_sql('RESET ROLE')
    snapshot = dart_snapshot(discovery)
    assert admin(discovery, 'save', snapshot)['count'] == 100
    discovery.exec_driver_sql('SET LOCAL ROLE authenticated')
    before = discovery.exec_driver_sql("select public.sb_company_discovery('alpine-synthetic research')").scalar()
    assert before['total'] == 1
    assert before['items'][0]['name'] == '합성기업101'
    assert before['items'][0]['company_id'] is None
    # Search is read-only; activation retains the official primary display name.
    discovery.exec_driver_sql('RESET ROLE')
    selected = {'provider': 'dart', 'provider_company_id': '00000101', 'ticker': '000101'}
    company = admin(discovery, 'activate', selected)
    assert company['name'] == '합성기업101'
    stored = discovery.exec_driver_sql("select official_english_name,source_sha256 from app_private.company_directory where provider='dart' and ticker='000101'").one()
    assert tuple(stored) == ('Alpine Synthetic Research', 'b' * 64)
    # Same ticker with a different official identity must not acquire the alias.
    discovery.exec_driver_sql("""insert into public.companies(id,name,ticker,market,provider,provider_company_id,is_demo,created_at)
      values ('20000000-0000-4000-8000-000000000093','Unrelated synthetic issuer','000101','KR','dart','99999999',false,now())""")
    discovery.exec_driver_sql('SET LOCAL ROLE authenticated')
    for query in ('ALPINE Synthetic Research', 'alpine-synthetic', '합성기업101', '000101'):
        payload = json.dumps({'q': query})
        found = discovery.execute(text('select public.sb_company_discovery(:q)'), {'q': query}).scalar()
        assert found['items'][0]['company_id'] == company['id']
        for function, action in (('sb_workspace', 'company_lookup'), ('sb_redesign_workspace', 'design_directory'),
                                 ('sb_customer_workspace', 'catalog')):
            result = discovery.execute(text(f"select public.{function}(:a,cast(:p as jsonb))"), {'a': action, 'p': payload}).scalar()
            rows = result if isinstance(result, list) else result['items']
            assert any(row['id'] == company['id'] for row in rows)
            if 'alpine' in query.lower():
                assert {row['id'] for row in rows} == {company['id']}
    assert 'official_english_name' not in before['items'][0]
    assert 'source_sha256' not in str(before) and 'raw_object_key' not in str(before)


@pytest.mark.parametrize('invalid', [False, 123, ['injected'], {'name': 'injected'}, '', ' ', 'X' * 501])
def test_invalid_official_english_name_cannot_replace_a_valid_snapshot(discovery, invalid):
    discovery.exec_driver_sql('RESET ROLE')
    snapshot = dart_snapshot(discovery)
    admin(discovery, 'save', snapshot)
    discovery.exec_driver_sql("update app_private.company_directory_sources set last_success_at=null,last_attempt_at=null where provider='dart'")
    invalid_snapshot = dart_snapshot(discovery, invalid, '90000000-0000-4000-8000-000000000004')
    point = discovery.begin_nested()
    with pytest.raises(Exception) as caught:
        admin(discovery, 'save', invalid_snapshot)
    point.rollback()
    assert caught.value.orig.sqlstate == 'PT422'
    assert discovery.exec_driver_sql("select official_english_name from app_private.company_directory where provider='dart' and ticker='000101'").scalar() == 'Alpine Synthetic Research'
    assert discovery.exec_driver_sql('select count(*) from app_private.company_directory where active').scalar() == 100


def test_missing_names_and_snapshot_updates_preserve_display_names_and_remove_old_aliases(discovery):
    discovery.exec_driver_sql('RESET ROLE')
    snapshot = dart_snapshot(discovery)
    admin(discovery, 'save', snapshot)
    selected = {'provider': 'dart', 'provider_company_id': '00000101', 'ticker': '000101'}
    company = admin(discovery, 'activate', selected)
    discovery.exec_driver_sql("update app_private.company_directory_sources set last_success_at=null,last_attempt_at=null where provider='dart'")
    replacement = dart_snapshot(discovery, None, '90000000-0000-4000-8000-000000000004')
    admin(discovery, 'save', replacement)
    assert discovery.exec_driver_sql("select official_english_name from app_private.company_directory where provider='dart' and ticker='000101'").scalar() is None
    assert discovery.execute(text('select name from public.companies where id=:id'), {'id': company['id']}).scalar() == '합성기업101'
    discovery.exec_driver_sql('SET LOCAL ROLE authenticated')
    assert discovery.exec_driver_sql("select public.sb_company_discovery('Alpine Synthetic Research')").scalar()['items'] == []
    assert discovery.exec_driver_sql("select public.sb_workspace('company_lookup','{\"q\":\"Alpine Synthetic Research\"}')").scalar() == []


def test_normalized_queries_work_in_all_live_search_projections(discovery):
    discovery.exec_driver_sql('RESET ROLE')
    discovery.exec_driver_sql("""insert into public.companies(id,name,ticker,market,provider,provider_company_id,is_demo,created_at)
      values ('20000000-0000-4000-8000-000000000092','SK하이닉스','000660','KOSPI','dart','00164779',false,now())""")
    discovery.exec_driver_sql('SET LOCAL ROLE authenticated')
    for query in ('SK 하이닉스', 'sk-hynix', '에스케이 하이닉스', '000660'):
        payload = json.dumps({'q': query})
        lookup = discovery.execute(text("select public.sb_workspace('company_lookup',cast(:p as jsonb))"), {'p': payload}).scalar()
        directory = discovery.execute(text("select public.sb_redesign_workspace('design_directory',cast(:p as jsonb))"), {'p': payload}).scalar()
        catalog = discovery.execute(text("select public.sb_customer_workspace('catalog',cast(:p as jsonb))"), {'p': json.dumps({'q': query, 'kind': 'company'})}).scalar()
        assert lookup[0]['ticker'] == directory['items'][0]['ticker'] == catalog['items'][0]['ticker'] == '000660'
    assert discovery.exec_driver_sql("select public.sb_workspace('company_lookup','{\"q\":\"---\"}')").scalar() == []


def test_snapshot_activation_idempotency_provenance_and_failed_refresh(discovery):
    discovery.exec_driver_sql('RESET ROLE')
    lease = '90000000-0000-4000-8000-000000000001'
    assert admin(discovery, 'claim', {'provider': 'sec', 'lease': lease}) is True
    items = [{'provider_company_id': str(i).zfill(10), 'ticker': f'TEST{i}', 'name': f'Synthetic {i}', 'market': 'US'} for i in range(100, 200)]
    payload = {'provider': 'sec', 'lease': lease, 'sha': 'a' * 64, 'object_key': 'directory/sec/' + 'a' * 64 + '.json', 'items': items}
    assert admin(discovery, 'save', payload)['count'] == 100
    selected = {'provider': 'sec', 'provider_company_id': '0000000101', 'ticker': 'TEST101'}
    before = discovery.exec_driver_sql('select count(*) from public.companies').scalar()
    first = admin(discovery, 'activate', selected)
    assert admin(discovery, 'activate', selected)['id'] == first['id']
    assert discovery.exec_driver_sql('select count(*) from public.companies').scalar() == before + 1
    assert discovery.exec_driver_sql('select count(*) from app_private.company_directory').scalar() == 100
    assert admin(discovery, 'activate', {'company_id': C})['ticker'] == 'TEST'
    discovery.exec_driver_sql('SET LOCAL ROLE authenticated')
    result = discovery.execute(text('select public.sb_company_discovery(:q)'), {'q': 'TEST101'}).scalar()
    assert result['items'][0]['company_id'] == first['id']
    assert result['source_status'] == 'partial'
    assert 'raw_object_key' not in str(result) and 'source_sha256' not in str(result)
    # A discovery query never creates additional active collection records.
    assert discovery.execute(text('select public.sb_company_discovery(:q)'), {'q': 'Synthetic 199'}).scalar()['items'][0]['company_id'] is None


def test_unknown_identity_cannot_be_registered_and_hydration_is_leased(discovery):
    discovery.exec_driver_sql('RESET ROLE')
    point = discovery.begin_nested()
    with pytest.raises(Exception) as caught:
        admin(discovery, 'activate', {'provider': 'sec', 'provider_company_id': '0000000999', 'ticker': 'FAKE'})
    point.rollback()
    assert caught.value.orig.sqlstate == 'PT404'
    lease = '90000000-0000-4000-8000-000000000001'
    assert admin(discovery, 'hydration_claim', {'company_id': C, 'lease': lease}) == {'claimed': True, 'ready': False}
    assert admin(discovery, 'hydration_claim', {'company_id': C, 'lease': '90000000-0000-4000-8000-000000000002'}) == {'claimed': False, 'ready': False}
    admin(discovery, 'hydration_finish', {'company_id': C, 'lease': lease, 'code': None})
    assert admin(discovery, 'hydration_claim', {'company_id': C, 'lease': lease}) == {'claimed': False, 'ready': True}


def test_numeric_excerpt_projection_requires_source_bound_approval(discovery):
    result = {
        'validation': 'quote_substring_and_numeric_check',
        'source_url': 'https://www.sec.gov/Archives/edgar/data/1/test.htm',
        'normalized_excerpt': 'Synthetic revenue was 42 units. Synthetic qualitative statement.',
        'claims': [{'text': 'Synthetic numeric claim', 'quote': 'Synthetic revenue was 42 units.'},
                   {'text': 'Synthetic qualitative claim', 'quote': 'Synthetic qualitative statement.'}],
    }
    discovery.exec_driver_sql('RESET ROLE')
    discovery.execute(text("""insert into public.us_analyses(filing_id,status,model,source_sha256,result)
        values(cast(:f as uuid),'needs_review','synthetic',repeat('0',64),cast(:r as jsonb))"""),
                      {'f': F, 'r': json.dumps(result)})

    def company():
        discovery.exec_driver_sql('SET LOCAL ROLE authenticated')
        return discovery.execute(text("select public.sb_customer_workspace('company',jsonb_build_object('id',cast(:c as text)))"), {'c': C}).scalar()

    assert company()['numeric_evidence'] == []
    discovery.exec_driver_sql('RESET ROLE')
    discovery.execute(text("update public.us_analyses set status='approved' where filing_id=cast(:f as uuid)"), {'f': F})
    assert company()['numeric_evidence'] == []  # No approval timestamp: never guess one.
    discovery.exec_driver_sql('RESET ROLE')
    discovery.execute(text("""insert into public.audit_logs(id,action,target_id,details,created_at)
        values(gen_random_uuid()::text,'us_analysis_review',:f,'{"status":"approved"}',now()+interval '1 second')"""), {'f': F})
    projected = company()
    assert projected['facts'] == []
    assert len(projected['numeric_evidence']) == 1
    evidence = projected['numeric_evidence'][0]
    assert evidence['quote'] == 'Synthetic revenue was 42 units.'
    assert evidence['filing_id'] == F and evidence['kind'] == 'us_analysis'
    assert all(key not in evidence for key in ('unit', 'period', 'value_raw', 'basis'))
    discovery.exec_driver_sql('RESET ROLE')
    result['claims'][0]['quote'] = 'Unsupported 99 units.'
    discovery.execute(text('update public.us_analyses set result=cast(:r as jsonb) where filing_id=cast(:f as uuid)'), {'r': json.dumps(result), 'f': F})
    assert company()['numeric_evidence'] == []


def test_collector_prioritizes_overdue_followed_issuers(discovery):
    discovery.execute(text("select public.sb_user_action('watch_add',jsonb_build_object('company_id',cast(:c as text)))"), {'c': C})
    discovery.exec_driver_sql('RESET ROLE')
    discovery.execute(text("update public.companies set last_ingested_at=now()-interval '3 hours' where id=:c"), {'c': C})
    discovery.exec_driver_sql("""insert into public.companies(id,name,ticker,market,provider,provider_company_id,is_demo,created_at,last_ingested_at)
        values('20000000-0000-4000-8000-000000000099','Older unmonitored issuer','OLD','US','sec','0000000099',false,now(),now()-interval '90 days')""")
    selected = discovery.exec_driver_sql('select public.sb_collection_candidates()').scalar()
    assert selected[0]['id'] == C
    assert len(selected) == 1
