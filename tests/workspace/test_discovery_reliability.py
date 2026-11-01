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
    for name in ('20261101014441_screenshot_dashboard.sql', '20261101034637_company_discovery_reliability.sql'):
        with own.connection.driver_connection.cursor() as cursor:
            cursor.execute((ROOT / 'supabase/migrations' / name).read_text(), prepare=False)
    own.exec_driver_sql('SET LOCAL ROLE authenticated')
    return own


def admin(conn, op, payload):
    if op == 'activate':
        payload = {**payload, 'actor': A}
    return conn.execute(text('select public.sb_discovery_admin(:op,cast(:p as jsonb))'), {'op': op, 'p': json.dumps(payload)}).scalar()


def test_directory_is_private_and_mutations_are_service_only(discovery):
    for sql in ('select * from app_private.company_directory', "select public.sb_discovery_admin('activate','{}')"):
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
