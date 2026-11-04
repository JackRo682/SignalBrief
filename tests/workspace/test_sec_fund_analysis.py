"""Synthetic fund reports replay the actual queue migration in disposable PostgreSQL."""
from pathlib import Path

import pytest
from sqlalchemy import text
from test_company_financials import finance as finance
from test_discovery_reliability import discovery as discovery
from test_workspace_schema import C, F
from test_workspace_schema import db as db
from test_workspace_schema import own as own

pytestmark = pytest.mark.postgres
ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / 'supabase/migrations/20261104124412_sec_fund_report_analysis.sql'
FUND = '20000000-0000-4000-8000-000000000081'
REPORT = '30000000-0000-4000-8000-000000000081'
CURRENT = '30000000-0000-4000-8000-000000000082'


@pytest.fixture
def fund_queue(finance):
    finance.exec_driver_sql("update app_private.us_config set value='1' where key='ai_daily_budget_usd'")
    before = {name: finance.exec_driver_sql(f"select pg_get_functiondef('{name}'::regprocedure)").scalar()
              for name in ('public.sb_us_reserve(text,numeric,boolean)', 'public.sb_us_review(uuid,text,text)')}
    with finance.connection.driver_connection.cursor() as cursor:
        cursor.execute(MIGRATION.read_text(), prepare=False)
    for name, definition in before.items():
        assert finance.exec_driver_sql(f"select pg_get_functiondef('{name}'::regprocedure)").scalar() == definition
    yield finance


def seed_fund(conn, form='N-CSRS', refreshed=False):
    conn.execute(text("""insert into companies(id,name,ticker,market,provider,provider_company_id,is_demo,created_at,last_ingested_at)
      values (:c,'Synthetic registered fund','FUND','NYSE','sec','0000000081',false,now(),now()-interval '90 days')"""), {'c': FUND})
    conn.execute(text("""insert into us_filings(id,company_id,accession,form,filing_date,document_url,source_url,source_sha256)
      values (:f,:c,'0000000081-26-000001',:form,current_date-130,
      'https://www.sec.gov/Archives/edgar/data/81/000000008126000001/fund.htm',
      'https://data.sec.gov/submissions/CIK0000000081.json',repeat('a',64)),
      (:recent,:c,'0000000081-26-000002','8-K',current_date,
      'https://www.sec.gov/Archives/edgar/data/81/000000008126000002/current.htm',
      'https://data.sec.gov/submissions/CIK0000000081.json',repeat('b',64))"""),
                 {'c': FUND, 'f': REPORT, 'recent': CURRENT, 'form': form})
    if refreshed:
        conn.execute(text('update companies set last_ingested_at=clock_timestamp() where id=:c'), {'c': FUND})


def sec_candidate(conn):
    return next(row for row in conn.exec_driver_sql('select public.sb_collection_candidates()').scalar()
                if row['provider'] == 'sec')


@pytest.mark.parametrize('form', ['N-CSR', 'N-CSRS', 'N-CSR/A', 'N-CSRS/A'])
def test_requested_fund_waits_for_refresh_then_prefers_report_to_newer_8k(fund_queue, form):
    fund_queue.execute(text('update companies set is_demo=true where id=:c'), {'c': C})
    seed_fund(fund_queue, form)
    assert sec_candidate(fund_queue)['id'] == FUND
    assert fund_queue.exec_driver_sql('select public.sb_collector_analysis_pick()').scalar() is None
    assert fund_queue.exec_driver_sql('select count(*) from app_private.collector_analysis_attempts').scalar() == 0
    fund_queue.execute(text('update companies set last_ingested_at=clock_timestamp() where id=:c'), {'c': FUND})
    assert str(fund_queue.exec_driver_sql('select public.sb_collector_analysis_pick()').scalar()) == REPORT
    assert fund_queue.exec_driver_sql('select count(*) from us_analyses').scalar() == 0
    assert fund_queue.execute(text('select completed_at from app_private.company_analysis_requests where company_id=:c'), {'c': FUND}).scalar() is None


def test_failed_fresh_request_cannot_permanently_displace_watched_issuer(fund_queue):
    fund_queue.execute(text("select public.sb_user_action('watch_add',jsonb_build_object('company_id',cast(:c as text)))"), {'c': C})
    fund_queue.execute(text("update companies set last_ingested_at=now()-interval '3 hours' where id=:c"), {'c': C})
    seed_fund(fund_queue)
    assert sec_candidate(fund_queue)['id'] == FUND
    # No successful ingestion: the request remains durable but its priority expires.
    fund_queue.execute(text("update app_private.company_analysis_requests set requested_at=now()-interval '16 minutes' where company_id=:c"), {'c': FUND})
    assert sec_candidate(fund_queue)['id'] == C
    assert str(fund_queue.exec_driver_sql('select public.sb_collector_analysis_pick()').scalar()) == F
    assert fund_queue.execute(text('select count(*) from app_private.collector_analysis_attempts where filing_id=:f'), {'f': REPORT}).scalar() == 0


def test_dart_and_nonrequested_collection_ordering_remain_unchanged(fund_queue):
    watched = '20000000-0000-4000-8000-000000000083'
    other = '20000000-0000-4000-8000-000000000084'
    fund_queue.execute(text("""insert into companies(id,name,ticker,market,provider,provider_company_id,is_demo,created_at,last_ingested_at)
      values (:w,'Synthetic watched Korean issuer','000083','KOSPI','dart','00000083',false,now(),now()-interval '3 hours'),
      (:o,'Synthetic other Korean issuer','000084','KOSPI','dart','00000084',false,now(),now()-interval '90 days')"""), {'w': watched, 'o': other})
    fund_queue.execute(text("select public.sb_user_action('watch_add',jsonb_build_object('company_id',cast(:c as text)))"), {'c': watched})
    fund_queue.execute(text('insert into app_private.company_analysis_requests(company_id) values (:c)'), {'c': other})
    rows = fund_queue.exec_driver_sql('select public.sb_collection_candidates()').scalar()
    assert len(rows) == 2
    assert next(row['id'] for row in rows if row['provider'] == 'dart') == watched
    assert next(row['id'] for row in rows if row['provider'] == 'sec') == C
    assert all('analysis_requested_at' not in row and 'priority' not in row for row in rows)


def test_fund_retry_bounds_and_semantic_failures_remain_enforced(fund_queue):
    fund_queue.execute(text('update companies set is_demo=true where id=:c'), {'c': C})
    seed_fund(fund_queue, refreshed=True)
    fund_queue.execute(text('delete from us_filings where id=:f'), {'f': CURRENT})
    for attempt in (1, 2, 3):
        assert str(fund_queue.exec_driver_sql('select public.sb_collector_analysis_pick()').scalar()) == REPORT
        assert fund_queue.execute(text('select attempt_count from app_private.collector_analysis_attempts where filing_id=:f'), {'f': REPORT}).scalar() == attempt
        fund_queue.execute(text("select public.sb_collector_analysis_finish(:f,'blocked','request_timeout')"), {'f': REPORT})
        assert fund_queue.exec_driver_sql('select public.sb_collector_analysis_pick()').scalar() is None
        fund_queue.execute(text("update app_private.collector_analysis_attempts set attempted_at=now()-interval '16 minutes' where filing_id=:f"), {'f': REPORT})
    assert fund_queue.exec_driver_sql('select public.sb_collector_analysis_pick()').scalar() is None
    fund_queue.execute(text("update app_private.collector_analysis_attempts set attempt_count=1,code='numeric_citation_mismatch' where filing_id=:f"), {'f': REPORT})
    assert fund_queue.exec_driver_sql('select public.sb_collector_analysis_pick()').scalar() is None


def test_exhausted_day_stays_pending_without_attempt_or_lease_then_resumes(fund_queue):
    fund_queue.execute(text('update companies set is_demo=true where id=:c'), {'c': C})
    seed_fund(fund_queue, refreshed=True)
    fund_queue.exec_driver_sql("insert into app_private.us_usage(day,provider,calls,reserved_usd) values(current_date,'openai',20,0.135)")
    before = fund_queue.execute(text('select requested_at,completed_at from app_private.company_analysis_requests where company_id=:c'), {'c': FUND}).one()
    assert fund_queue.exec_driver_sql('select public.sb_collector_analysis_pick()').scalar() is None
    assert fund_queue.exec_driver_sql('select count(*) from app_private.collector_analysis_attempts').scalar() == 0
    assert fund_queue.exec_driver_sql('select count(*) from app_private.us_analysis_locks').scalar() == 0
    assert fund_queue.execute(text('select requested_at,completed_at from app_private.company_analysis_requests where company_id=:c'), {'c': FUND}).one() == before
    # Simulate tomorrow with historical synthetic usage; production never changes it.
    fund_queue.exec_driver_sql("update app_private.us_usage set day=current_date-1 where provider='openai'")
    assert str(fund_queue.exec_driver_sql('select public.sb_collector_analysis_pick()').scalar()) == REPORT
    assert fund_queue.execute(text('select attempt_count from app_private.collector_analysis_attempts where filing_id=:f'), {'f': REPORT}).scalar() == 1
    assert fund_queue.exec_driver_sql("select calls=20 and reserved_usd=0.135 from app_private.us_usage where provider='openai'").scalar() is True
    assert fund_queue.exec_driver_sql('select count(*) from us_analyses').scalar() == 0


@pytest.mark.parametrize('kind', ['missing', 'disabled', 'spent'])
def test_missing_disabled_or_spent_budget_does_not_claim(fund_queue, kind):
    seed_fund(fund_queue, refreshed=True)
    if kind == 'missing':
        fund_queue.exec_driver_sql("delete from app_private.us_config where key='ai_daily_budget_usd'")
    elif kind == 'disabled':
        fund_queue.exec_driver_sql("update app_private.us_config set value='0' where key='ai_daily_budget_usd'")
    else:
        fund_queue.exec_driver_sql("insert into app_private.us_usage(day,provider,calls,reserved_usd) values(current_date,'openai',10,1)")
    assert fund_queue.exec_driver_sql('select public.sb_collector_analysis_pick()').scalar() is None
    assert fund_queue.exec_driver_sql('select count(*) from app_private.collector_analysis_attempts').scalar() == 0


@pytest.mark.parametrize('role', ['anon', 'authenticated'])
def test_queue_functions_remain_inaccessible_to_clients(fund_queue, role):
    fund_queue.exec_driver_sql(f'SET LOCAL ROLE {role}')
    for statement in ('select public.sb_collection_candidates()', 'select public.sb_collector_analysis_pick()'):
        point = fund_queue.begin_nested()
        with pytest.raises(Exception) as error:
            fund_queue.exec_driver_sql(statement)
        point.rollback()
        assert error.value.orig.sqlstate == '42501'
