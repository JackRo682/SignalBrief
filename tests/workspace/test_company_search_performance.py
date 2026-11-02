"""Catalogue-scale company search on disposable PostgreSQL, with a SQL time budget."""
from pathlib import Path

import pytest
import test_company_search_precision as precision_contract
from test_company_picker_discovery import filtered as filtered
from test_company_picker_discovery import search
from test_company_search_precision import activate, directory
from test_company_search_precision import (
    test_complete_latin_company_match_suppresses_substrings_before_cap as test_complete_latin_company_match_suppresses_substrings_before_cap,
)
from test_company_search_precision import (
    test_exact_v_ticker_wins_over_many_prefixes_and_punctuated_v_names as test_exact_v_ticker_wins_over_many_prefixes_and_punctuated_v_names,
)
from test_company_search_precision import (
    test_korean_alias_and_partial_name_coverage_is_not_suppressed as test_korean_alias_and_partial_name_coverage_is_not_suppressed,
)
from test_company_search_precision import (
    test_new_rank_helper_is_private_and_existing_auth_guards_remain as test_new_rank_helper_is_private_and_existing_auth_guards_remain,
)
from test_company_search_precision import (
    test_partial_queries_remain_usable_when_current_scope_has_no_strong_match as test_partial_queries_remain_usable_when_current_scope_has_no_strong_match,
)
from test_company_search_precision import (
    test_precision_is_read_only_and_leaves_generic_evidence_search_and_dashboard_untouched as test_precision_is_read_only_and_leaves_generic_evidence_search_and_dashboard_untouched,
)
from test_company_search_precision import (
    test_provider_and_market_filter_apply_before_strong_match_suppression as test_provider_and_market_filter_apply_before_strong_match_suppression,
)
from test_company_search_precision import (
    test_registered_exact_issuer_survives_discovery_dedupe_without_reintroducing_weak_rows as test_registered_exact_issuer_survives_discovery_dedupe_without_reintroducing_weak_rows,
)
from test_company_search_precision import (
    test_registered_partial_query_pagination_and_counts_remain_consistent as test_registered_partial_query_pagination_and_counts_remain_consistent,
)
from test_company_search_precision import (
    test_unregistered_strong_official_match_hides_registered_weak_company_rows as test_unregistered_strong_official_match_hides_registered_weak_company_rows,
)
from test_discovery_reliability import discovery as discovery
from test_workspace_schema import db as db
from test_workspace_schema import own as own

pytestmark = pytest.mark.postgres
ROOT = Path(__file__).resolve().parents[2]
MIGRATION = '20261102022052_company_search_catalogue_performance.sql'
baseline_precision = precision_contract.precise


@pytest.fixture
def precise(baseline_precision):
    baseline_precision.exec_driver_sql('RESET ROLE')
    with baseline_precision.connection.driver_connection.cursor() as cursor:
        cursor.execute((ROOT / 'supabase/migrations' / MIGRATION).read_text(), prepare=False)
    baseline_precision.exec_driver_sql('SET LOCAL ROLE authenticated')
    return baseline_precision


@pytest.fixture
def catalogue(precise):
    precise.exec_driver_sql('RESET ROLE')
    precise.exec_driver_sql("""insert into app_private.company_directory
      (provider,provider_company_id,ticker,name,market,source_sha256,fetched_at,active,official_english_name)
      select case when n<=10300 then 'sec' else 'dart' end,
        lpad((900000+n)::text,case when n<=10300 then 10 else 8 end,'0'),
        case when n<=10300 then 'X'||lpad(n::text,6,'0') else '8'||lpad(n::text,5,'0') end,
        case when n<=10300 then 'Synthetic Global Value Services Holdings Corporation '||n
          else '가상산업서비스기업 '||n end,
        case when n<=10300 then 'NASDAQ' else 'KR' end,repeat('f',64),now(),true,
        case when n>10300 then 'Synthetic Industry Services Corporation '||n end
      from generate_series(1,14500-(select count(*)::integer from app_private.company_directory where active)) n""")
    assert precise.exec_driver_sql('select count(*) from app_private.company_directory where active').scalar() == 14500
    precise.exec_driver_sql('ANALYZE app_private.company_directory')
    precise.exec_driver_sql('SET LOCAL ROLE authenticated')
    ids={}
    for provider, identity, ticker in [('sec','0000400001','V'),('sec','0000400002','TV'),
                                      ('sec','0000400000','MU'),('sec','0000400003','MSFT'),
                                      ('dart','00400001','100220'),('dart','00400002','035420')]:
        ids[ticker]=activate(precise,provider,identity,ticker)
    precise.info['catalogue_ids']=ids
    precise.exec_driver_sql("SET LOCAL statement_timeout='3s'")
    return precise


@pytest.mark.parametrize('query,expected',[
    ('visa',{'V'}),('V',{'V'}),('micro',{'MU','MSFT'}),('네이버',{'035420','100221'}),
])
def test_catalogue_scale_exact_partial_and_korean_queries_finish_inside_sql_budget(catalogue,query,expected):
    found=search(catalogue,query)
    assert {item['ticker'] for item in found['items']}==expected
    assert found['total']==len(expected)
    registered=directory(catalogue,query)
    assert {item['ticker'] for item in registered['items']}==expected.intersection(catalogue.info['catalogue_ids'])
    assert registered['total']==len(registered['items'])


def test_catalogue_scale_common_letter_and_empty_registered_query_remain_bounded(catalogue):
    common=search(catalogue,'e')
    assert common['total']>10000 and len(common['items'])==30
    registered=directory(catalogue,'e')
    assert registered['total']>=3
    empty=directory(catalogue,'',limit=2)
    assert len(empty['items'])==2 and empty['total']>=6 and empty['next_offset']==2
    assert 'search_text' not in empty['items'][0] and 'search_rank' not in empty['items'][0]


def test_catalogue_scale_alias_expansion_is_once_per_search(catalogue):
    catalogue.exec_driver_sql('RESET ROLE')
    catalogue.exec_driver_sql("SET LOCAL track_functions='all'")
    statement="select coalesce((select calls from pg_stat_xact_user_functions where funcid='app_private.sb_search_terms(text)'::regprocedure),0)"
    for operation in (lambda:search(catalogue,'visa'),lambda:directory(catalogue,'visa')):
        before=catalogue.exec_driver_sql(statement).scalar()
        catalogue.exec_driver_sql('SET LOCAL ROLE authenticated')
        operation()
        catalogue.exec_driver_sql('RESET ROLE')
        after=catalogue.exec_driver_sql(statement).scalar()
        assert after-before==1
