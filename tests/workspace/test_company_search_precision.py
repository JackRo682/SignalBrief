"""Named search strings use synthetic issuer identities, never live catalogue writes."""
import json
from pathlib import Path

import pytest
from sqlalchemy import text
from test_company_picker_discovery import filtered as filtered
from test_company_picker_discovery import search
from test_discovery_reliability import admin
from test_discovery_reliability import discovery as discovery
from test_workspace_schema import db as db
from test_workspace_schema import own as own

pytestmark = pytest.mark.postgres
ROOT = Path(__file__).resolve().parents[2]
MIGRATION = '20261102020446_company_search_precision.sql'


@pytest.fixture
def precise(filtered):
    filtered.exec_driver_sql('RESET ROLE')
    before = {name: filtered.execute(text('select pg_get_functiondef(cast(:name as regprocedure))'),
                                    {'name': name}).scalar() for name in (
        'app_content_private.redesign(text,jsonb)', 'app_content_private.workspace(text,jsonb)',
        'public.sb_workspace(text,jsonb)', 'app_content_private.discovery_search_filtered(text,jsonb)')}
    with filtered.connection.driver_connection.cursor() as cursor:
        cursor.execute((ROOT / 'supabase/migrations' / MIGRATION).read_text(), prepare=False)
    filtered.info['precision_before'] = before
    filtered.exec_driver_sql("""update app_private.company_directory set
      ticker='V'||right(provider_company_id,5),name='A VISANG synthetic '||provider_company_id
      where provider='sec' and provider_company_id not in ('0000400000','0000400003')""")
    for identity, ticker, name in (
        ('0000400001', 'V', 'VISA INC.'),
        ('0000400002', 'TV', 'GRUPO TELEVISA, INC.'),
        ('0000400003', 'MSFT', 'MICROSOFT CORP.'),
        ('0000400006', 'VFC', 'V. F. Synthetic Corporation'),
    ):
        filtered.execute(text("""update app_private.company_directory set ticker=:ticker,name=:name,
          market='NYSE' where provider='sec' and provider_company_id=:identity"""),
                         {'identity': identity, 'ticker': ticker, 'name': name})
    filtered.exec_driver_sql("""update app_private.company_directory set name='비상교육',
      official_english_name='VISANG Education Inc.',ticker='100220'
      where provider='dart' and provider_company_id='00400001'""")
    filtered.exec_driver_sql("""update app_private.company_directory set name='NAVER',
      official_english_name='NAVER Corporation',ticker='035420'
      where provider='dart' and provider_company_id='00400002'""")
    filtered.exec_driver_sql("""update app_private.company_directory set name='네이버테스트',
      official_english_name='Synthetic Korean coverage',ticker='100221'
      where provider='dart' and provider_company_id='00400003'""")
    filtered.exec_driver_sql('SET LOCAL ROLE authenticated')
    return filtered


def directory(conn, q, **filters):
    return conn.execute(text("select public.sb_redesign_workspace('design_directory',cast(:p as jsonb))"),
                        {'p': json.dumps({'q': q, **filters})}).scalar()


def activate(conn, provider, identity, ticker, market=None):
    conn.exec_driver_sql('RESET ROLE')
    result = admin(conn, 'activate', {'provider': provider, 'provider_company_id': identity, 'ticker': ticker})
    if market:
        conn.execute(text('update public.companies set market=:market where id=:id'),
                     {'market': market, 'id': result['id']})
    conn.exec_driver_sql('SET LOCAL ROLE authenticated')
    return result['id']


@pytest.mark.parametrize('query', ['visa', 'VISA', 'ＶＩＳＡ', 'Visa Inc.', 'visa inc'])
def test_complete_latin_company_match_suppresses_substrings_before_cap(precise, query):
    found = search(precise, query)
    assert found['total'] == 1
    assert [(row['ticker'], row['name']) for row in found['items']] == [('V', 'VISA INC.')]
    assert 'rank' not in found['items'][0]


def test_exact_v_ticker_wins_over_many_prefixes_and_punctuated_v_names(precise):
    found = search(precise, 'V')
    assert found['total'] == 1 and [row['ticker'] for row in found['items']] == ['V']


def test_partial_queries_remain_usable_when_current_scope_has_no_strong_match(precise):
    found = search(precise, 'micro')
    assert found['total'] == 2 and {row['ticker'] for row in found['items']} == {'MU', 'MSFT'}
    weak = search(precise, 'vis')
    assert weak['total'] > 30 and len(weak['items']) == 30


def test_provider_and_market_filter_apply_before_strong_match_suppression(precise):
    # The strong overseas Visa does not hide a legitimate fallback in Korean scope.
    dart = search(precise, 'visa', provider='dart')
    assert dart['total'] == 1 and dart['items'][0]['ticker'] == '100220'
    issuer = activate(precise, 'dart', '00400001', '100220', 'KOSPI')
    kospi = search(precise, 'visa', market_group='kospi')
    assert kospi['total'] == 1 and kospi['items'][0]['company_id'] == issuer
    assert [row['id'] for row in directory(precise, 'visa', market_group='kospi')['items']] == [issuer]


def test_unregistered_strong_official_match_hides_registered_weak_company_rows(precise):
    activate(precise, 'dart', '00400001', '100220', 'KOSPI')
    activate(precise, 'sec', '0000400002', 'TV')
    # Visa is intentionally not activated: official discovery remains a read.
    official = search(precise, 'visa')
    assert official['items'][0]['company_id'] is None and official['total'] == 1
    registered = directory(precise, 'visa')
    assert registered['items'] == [] and registered['total'] == 0
    assert registered['counts']['company'] == 0 and registered['next_offset'] is None


def test_registered_exact_issuer_survives_discovery_dedupe_without_reintroducing_weak_rows(precise):
    visa = activate(precise, 'sec', '0000400001', 'V')
    activate(precise, 'dart', '00400001', '100220', 'KOSPI')
    activate(precise, 'sec', '0000400002', 'TV')
    activate(precise, 'sec', '0000400006', 'VFC')
    registered = directory(precise, 'visa')
    assert [row['id'] for row in registered['items']] == [visa]
    assert registered['total'] == 1 and 'search_rank' not in registered['items'][0]
    discovered = search(precise, 'visa')
    assert [row for row in discovered['items'] if row['company_id'] != visa] == []
    assert [row['id'] for row in directory(precise, 'V')['items']] == [visa]


def test_korean_alias_and_partial_name_coverage_is_not_suppressed(precise):
    found = search(precise, '네이버')
    assert found['items'][0]['ticker'] == '035420'
    assert {row['ticker'] for row in found['items']} == {'035420', '100221'}
    assert [row['ticker'] for row in search(precise, '마소')['items']] == ['MSFT']
    assert search(precise, '006260')['items'][0]['name'] == 'LS'


def test_registered_partial_query_pagination_and_counts_remain_consistent(precise):
    activate(precise, 'sec', '0000400000', 'MU')
    activate(precise, 'sec', '0000400003', 'MSFT')
    first = directory(precise, 'micro', limit=1)
    second = directory(precise, 'micro', limit=1, offset=1)
    assert first['total'] == 2 and first['counts']['company'] == 2 and first['next_offset'] == 1
    assert second['total'] == 2 and second['next_offset'] is None
    assert {row['ticker'] for row in first['items'] + second['items']} == {'MU', 'MSFT'}


def test_precision_is_read_only_and_leaves_generic_evidence_search_and_dashboard_untouched(precise):
    precise.exec_driver_sql('RESET ROLE')
    counts = {table: precise.exec_driver_sql(f'select count(*) from public.{table}').scalar()
              for table in ('companies', 'watchlists', 'watchlist_items', 'calendar_items')}
    before = precise.info['precision_before']
    for name in ('app_content_private.workspace(text,jsonb)', 'public.sb_workspace(text,jsonb)'):
        after = precise.execute(text('select pg_get_functiondef(cast(:name as regprocedure))'), {'name': name}).scalar()
        assert after == before[name]
    redesigned = precise.exec_driver_sql("select pg_get_functiondef('app_content_private.redesign(text,jsonb)'::regprocedure)").scalar()
    assert redesigned.split("ELSIF action='design_directory' THEN")[0] == before['app_content_private.redesign(text,jsonb)'].split("ELSIF action='design_directory' THEN")[0]
    assert 'PERFORM public.sb_require_mfa();' in redesigned and 'PERFORM public.sb_rate_limit();' in redesigned
    volatility = precise.exec_driver_sql("select provolatile from pg_proc where oid='app_private.sb_company_search_rank(text,text,text,text)'::regprocedure").scalar()
    assert volatility == 'i'
    precise.exec_driver_sql('SET LOCAL ROLE authenticated')
    search(precise, 'visa')
    directory(precise, 'visa')
    precise.exec_driver_sql('RESET ROLE')
    assert {table: precise.exec_driver_sql(f'select count(*) from public.{table}').scalar()
            for table in counts} == counts


def test_new_rank_helper_is_private_and_existing_auth_guards_remain(precise):
    for sql in ("select app_private.sb_company_search_rank('visa','Visa Inc','V','')",
                "select public.sb_discovery_admin('activate','{}')"):
        point = precise.begin_nested()
        with pytest.raises(Exception) as caught:
            precise.exec_driver_sql(sql)
        point.rollback()
        assert caught.value.orig.sqlstate == '42501'
    point = precise.begin_nested()
    precise.exec_driver_sql('SET LOCAL ROLE anon')
    with pytest.raises(Exception) as caught:
        search(precise, 'visa')
    point.rollback()
    assert caught.value.orig.sqlstate == '42501'
