"""Real PostgreSQL replay of listing evidence, canonical identities and quota queues.

All source bytes/identities are synthetic. Storage and pg_net are platform doubles;
the SQL validators, RPC privilege checks and production migrations are unchanged.
"""
import base64
import copy
import hashlib
import json
from datetime import date, datetime, timedelta, timezone
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
REGISTRY = ROOT / 'supabase/migrations/20261104135359_listed_universe_registry.sql'
QUEUES = ROOT / 'supabase/migrations/20261104135646_universe_collection_fairness.sql'
DIRECTORY_SHA = 'a' * 64


def sql(conn, statement, **parameters):
    result = conn.execute(text(statement), parameters)
    return result.scalar() if result.returns_rows else None


def denied(conn, callback, code='PT422'):
    point = conn.begin_nested()
    with pytest.raises(Exception) as caught:
        callback()
    point.rollback()
    assert caught.value.orig.sqlstate == code


@pytest.fixture
def universe(finance):
    finance.exec_driver_sql('RESET ROLE')
    with finance.connection.driver_connection.cursor() as cursor:
        cursor.execute("""CREATE SCHEMA net;
          CREATE TABLE net.requests(id bigserial PRIMARY KEY,url text,headers jsonb,body jsonb,timeout_ms integer);
          CREATE FUNCTION net.http_post(url text,body jsonb,headers jsonb,timeout_milliseconds integer)
          RETURNS bigint LANGUAGE plpgsql AS $$ DECLARE result bigint; BEGIN
            INSERT INTO net.requests(url,body,headers,timeout_ms) VALUES($1,$2,$3,$4) RETURNING id INTO result;
            RETURN result;
          END $$;""", prepare=False)
        collector = (ROOT / 'docs/sql/collector.sql').read_text()
        cursor.execute(collector[collector.index('CREATE OR REPLACE FUNCTION public.sb_us_secrets()'):], prepare=False)
        cursor.execute((ROOT / 'docs/sql/dart-retry.sql').read_text(), prepare=False)
        for name in ('20261101072155_company_picker_discovery_filters.sql',
                     '20261101072157_micron_q4_calendar.sql',
                     '20261101103903_calendar_source_onboarding.sql',
                     '20261104124412_sec_fund_report_analysis.sql'):
            cursor.execute((ROOT / 'supabase/migrations' / name).read_text(), prepare=False)
        before = {name: sql(finance, 'select pg_get_functiondef(cast(:name as regprocedure))', name=name)
                  for name in ('public.sb_us_reserve(text,numeric,boolean)', 'public.sb_us_review(uuid,text,text)',
                               'public.sb_dart_review(uuid,text,text)')}
        cursor.execute(REGISTRY.read_text(), prepare=False)
        cursor.execute(QUEUES.read_text(), prepare=False)
        cursor.execute((ROOT / 'supabase/migrations/20261104142200_company_monitoring_page_scope.sql').read_text(), prepare=False)
    for name, definition in before.items():
        assert sql(finance, 'select pg_get_functiondef(cast(:name as regprocedure))', name=name) == definition
    finance.exec_driver_sql("update app_private.universe_sources set min_rows=1")
    finance.exec_driver_sql("update app_private.us_config set value='1' where key='ai_daily_budget_usd'")
    finance.exec_driver_sql("""update app_private.company_directory_sources set last_success_at=now(),
      source_sha256=repeat('a',64),raw_object_key='directory/'||provider||'/'||repeat('a',64)||
      case when provider='sec' then '.json' else '.zip' end;
      insert into storage.objects(bucket_id,name,metadata)
      select 'signalbrief-raw',raw_object_key,'{"size":123}' from app_private.company_directory_sources;""")
    yield finance


def listing(ticker='NEW', issuer='0000000081', instrument='equity_share', row=1):
    return {'market': 'NYSE', 'ticker': ticker, 'name': f'Synthetic {ticker} security',
            'instrument_type': instrument, 'eligible': True, 'exclusion_reason': None,
            'aliases': [ticker], 'provider': 'sec', 'provider_company_id': issuer,
            'mapping_status': 'mapped', 'mapping_ticker': ticker, 'mapping_source_sha256': DIRECTORY_SHA,
            'source_row': row, 'evidence': {'source_line': f'{ticker}|Synthetic {ticker} security|N|N'}}


def manifest(conn, entries=None, source='nasdaq_traded'):
    entries = entries or [listing()]
    for item in entries:
        if item['mapping_status'] == 'mapped':
            sql(conn, """insert into app_private.company_directory(provider,provider_company_id,ticker,name,market,source_sha256,fetched_at)
              values(:p,:i,:t,'Canonical synthetic issuer',:m,:sha,now()) on conflict do nothing""",
                p=item['provider'], i=item['provider_company_id'], t=item['mapping_ticker'], m=item['market'], sha=DIRECTORY_SHA)
    raw = ('Synthetic official source 😀\n' + '\n'.join(x['ticker'] for x in entries)).encode()
    value = {'version': 'listed-universe-v1', 'source_key': source,
             'source_url': 'https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqtraded.txt',
             'source_request': {'method': 'GET', 'fields': {}}, 'coverage_scope': 'all_listed_securities',
             'as_of': str(date.today()), 'fetched_at': datetime.now(timezone.utc).isoformat(),
             'raw_sha256': hashlib.sha256(raw).hexdigest(), 'raw_bytes': len(raw),
             'parser_version': 'synthetic-test-v1', 'complete': True, 'items': entries}
    return value, raw


def stage(conn, value, raw):
    body = json.dumps(value, ensure_ascii=False, separators=(',', ':'))
    staged = sql(conn, 'select sb_universe_stage(:body)', body=body)
    for offset in range(0, len(raw), 64000):
        sql(conn, 'select sb_universe_chunk(cast(:id as uuid),:part,:data)', id=staged['snapshot_id'],
            part=offset // 64000, data=base64.b64encode(raw[offset:offset + 64000]).decode())
    return staged, body


def claim(conn, staged):
    sql(conn, "select sb_universe_worker_ready('listed-universe-v1')")
    assert sql(conn, 'select sb_universe_dispatch(cast(:id as uuid))', id=staged['snapshot_id'])['status'] == 'queued'
    token = sql(conn, 'select token_hash from app_private.universe_snapshots where id=cast(:id as uuid)', id=staged['snapshot_id'])
    payload = sql(conn, 'select sb_universe_claim(:h)', h=token)
    assert payload['snapshot_id'] == staged['snapshot_id']
    assert sql(conn, 'select sb_universe_claim(:h)', h=token) is None
    return token, payload


def finish(conn, staged, value, body, token, archive=True):
    if archive:
        for key, size in ((staged['raw_object_key'], value['raw_bytes']), (staged['manifest_object_key'], len(body.encode()))):
            sql(conn, "insert into storage.objects(bucket_id,name,metadata) values('signalbrief-raw',:key,jsonb_build_object('size',cast(:size as bigint)))", key=key, size=size)
    return sql(conn, 'select sb_universe_finish(:h,:raw_sha,:raw_key,:manifest_sha,:manifest_key)', h=token,
               raw_sha=value['raw_sha256'], raw_key=staged['raw_object_key'], manifest_sha=staged['manifest_sha256'], manifest_key=staged['manifest_object_key'])


def apply(conn, value, raw):
    staged, body = stage(conn, value, raw)
    token, payload = claim(conn, staged)
    assert b''.join(base64.b64decode(p['data_base64']) for p in payload['chunks']) == raw
    assert finish(conn, staged, value, body, token)['status'] == 'applied'
    return staged, body, token


def test_full_snapshot_archives_listing_aliases_and_registers_one_canonical_issuer(universe):
    common, preferred = listing('NEW'), listing('NEW.P', instrument='preferred_equity', row=2)
    value, raw = manifest(universe, [preferred, common])
    preferred['source_row'] = 2
    staged, body, token = apply(universe, value, raw)
    assert sql(universe, 'select count(*) from app_private.universe_chunks') == 0
    assert finish(universe, staged, value, body, token, archive=False)['status'] == 'applied'
    before = sql(universe, 'select count(*) from companies')
    result = sql(universe, 'select sb_universe_register(50)')
    assert result == {'created_issuers': 1, 'attached_listings': 2, 'remaining_issuers': 0}
    assert sql(universe, 'select count(*) from companies') == before + 1
    issuer = universe.exec_driver_sql("select name,ticker from companies where provider_company_id='0000000081'").one()
    assert tuple(issuer) == ('Canonical synthetic issuer', 'NEW')
    assert sql(universe, 'select count(distinct company_id) from app_private.universe_listings') == 1
    assert sql(universe, 'select sb_universe_register(50)')['created_issuers'] == 0
    assert sql(universe, 'select count(*) from us_analyses') == 0
    assert sql(universe, 'select count(*) from watchlist_items') == 0
    assert sql(universe, 'select count(*) from net.requests') == 1  # archival worker only


def test_existing_company_identity_is_preserved_and_unresolved_stays_in_denominator(universe):
    known = listing('TEST', issuer='0000000001')
    unresolved = listing('NOVEL', row=2)
    unresolved.update(provider=None, provider_company_id=None, mapping_status='unresolved', mapping_ticker=None, mapping_source_sha256=None)
    value, raw = manifest(universe, [known, unresolved])
    apply(universe, value, raw)
    assert sql(universe, 'select sb_universe_register(50)')['created_issuers'] == 0
    assert sql(universe, "select company_id from app_private.universe_listings where ticker='TEST'") == C
    assert sql(universe, "select company_id from app_private.universe_listings where ticker='NOVEL'") is None
    assert sql(universe, 'select name from companies where id=:id', id=C) == 'Synthetic Company'
    universe.exec_driver_sql('SET LOCAL ROLE authenticated')
    coverage = sql(universe, 'select sb_universe_coverage()')
    nyse = coverage['markets'][0]
    assert nyse['eligible_listings'] == 2 and nyse['unresolved_listings'] == 1
    assert nyse['registered_issuers'] == 1 and nyse['issuers_with_filings'] == 1
    assert nyse['issuers_with_approved_analysis'] == 0
    assert coverage['calendar_timezone'] == 'Asia/Seoul'
    assert 'raw_object_key' not in json.dumps(coverage) and 'manifest_text' not in json.dumps(coverage)


@pytest.mark.parametrize('mutation', ['source', 'market', 'raw_sha', 'future', 'partial', 'duplicate', 'mapping', 'archive', 'alias', 'excluded', 'request_filter'])
def test_invalid_or_unproven_listing_snapshot_is_rejected_atomically(universe, mutation):
    value, raw = manifest(universe)
    if mutation == 'source':
        value['source_url'] = 'https://www.nasdaqtrader.com.attacker.invalid/list'
    elif mutation == 'market':
        value['items'][0]['market'] = 'OTC'
    elif mutation == 'raw_sha':
        value['raw_sha256'] = 'z' * 64
    elif mutation == 'future':
        value['fetched_at'] = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()
    elif mutation == 'partial':
        value['complete'] = False
    elif mutation == 'duplicate':
        value['items'] *= 2
    elif mutation == 'mapping':
        value['items'][0]['provider_company_id'] = '0000000099'
    elif mutation == 'archive':
        universe.exec_driver_sql('delete from storage.objects')
    elif mutation == 'alias':
        value['items'][0]['aliases'] = ['OTHER']
    elif mutation == 'excluded':
        value['items'][0]['eligible'] = False
    elif mutation == 'request_filter':
        value['source_request']['fields'] = {'limit': '1000'}
    denied(universe, lambda: stage(universe, value, raw))
    assert sql(universe, 'select count(*) from app_private.universe_snapshots') == 0
    assert sql(universe, 'select count(*) from app_private.universe_listings') == 0


def test_original_chunks_are_immutable_and_actual_archives_are_required(universe):
    value, raw = manifest(universe)
    staged, body = stage(universe, value, raw)
    denied(universe, lambda: sql(universe, 'select sb_universe_chunk(cast(:id as uuid),0,:data)',
                                id=staged['snapshot_id'], data=base64.b64encode(b'x' * len(raw)).decode()), 'PT409')
    token, _ = claim(universe, staged)
    denied(universe, lambda: finish(universe, staged, value, body, token, archive=False))
    assert sql(universe, 'select count(*) from app_private.universe_listings') == 0
    assert finish(universe, staged, value, body, token)['status'] == 'applied'


def test_bounded_manifest_upload_is_resumable_hash_checked_and_unicode_safe(universe):
    value, _ = manifest(universe)
    body = json.dumps(value, ensure_ascii=False, separators=(',', ':'))
    digest = hashlib.sha256(body.encode()).hexdigest()
    parts = [body[:200], body[200:]]
    assert sql(universe, 'select sb_universe_manifest_begin(:d,:bytes,2)', d=digest, bytes=len(body.encode()))['status'] == 'receiving'
    sql(universe, 'select sb_universe_manifest_part(:d,0,:part)', d=digest, part=parts[0])
    denied(universe, lambda: sql(universe, 'select sb_universe_manifest_commit(:d)', d=digest))
    denied(universe, lambda: sql(universe, 'select sb_universe_manifest_part(:d,0,:part)', d=digest, part=parts[0] + 'x'), 'PT409')
    sql(universe, 'select sb_universe_manifest_part(:d,1,:part)', d=digest, part=parts[1])
    staged = sql(universe, 'select sb_universe_manifest_commit(:d)', d=digest)
    assert staged['manifest_sha256'] == digest
    assert sql(universe, 'select count(*) from app_private.universe_manifest_parts') == 0
    assert sql(universe, 'select sb_universe_manifest_commit(:d)', d=digest) == staged


def test_absent_listing_is_missing_not_falsely_delisted_and_identity_change_is_conflict(universe):
    entries = [listing('NEW' + str(i), issuer=str(81 + i).zfill(10), row=i + 1) for i in range(10)]
    value, raw = manifest(universe, entries)
    apply(universe, value, raw)
    sql(universe, 'select sb_universe_register(100)')
    later, later_raw = manifest(universe, entries[:-1])
    later['fetched_at'] = (datetime.now(timezone.utc) + timedelta(seconds=1)).isoformat()
    apply(universe, later, later_raw)
    assert sql(universe, "select listing_status from app_private.universe_listings where ticker='NEW9'") == 'missing_from_latest'
    assert sql(universe, "select count(*) from companies where ticker='NEW9'") == 1
    conflict = copy.deepcopy(entries[:-1])
    conflict[0]['provider_company_id'] = '0000000999'
    universe.exec_driver_sql("update app_private.company_directory set active=false where ticker='NEW0' and provider_company_id='0000000081'")
    changed, changed_raw = manifest(universe, conflict)
    changed['fetched_at'] = (datetime.now(timezone.utc) + timedelta(seconds=2)).isoformat()
    apply(universe, changed, changed_raw)
    assert sql(universe, "select mapping_status from app_private.universe_listings where ticker='NEW0'") == 'conflict'
    assert sql(universe, "select company_id from app_private.universe_listings where ticker='NEW0'") is None


def test_registered_official_alias_search_returns_canonical_company(universe):
    item = listing('NEW.A')
    item.update(mapping_ticker='NEW-A', aliases=['NEW.A', 'NEW-A'], market='NYSE_AMERICAN')
    value, raw = manifest(universe, [item])
    apply(universe, value, raw)
    sql(universe, 'select sb_universe_register(50)')
    universe.exec_driver_sql('SET LOCAL ROLE authenticated')
    result = sql(universe, "select sb_company_discovery_filtered('NEW.A','{\"market_group\":\"overseas\"}')")
    assert result['items'][0]['ticker'] == 'NEW.A'
    assert result['items'][0]['company_id'] is not None
    assert result['items'][0]['market'] == 'NYSE_AMERICAN'


@pytest.mark.parametrize('role', ['anon', 'authenticated'])
def test_universe_mutations_and_originals_are_never_client_accessible(universe, role):
    universe.exec_driver_sql(f'SET LOCAL ROLE {role}')
    for statement in ("select sb_universe_stage('{}')", 'select sb_universe_register(50)',
                      "select sb_universe_manifest_begin(repeat('a',64),5,1)",
                      'select * from app_private.universe_listings', 'select * from app_private.universe_chunks',
                      "select sb_collection_finish('anything','verified',null,null)"):
        denied(universe, lambda: sql(universe, statement), '42501')


def test_metadata_leases_rotate_failures_and_quota_does_not_consume_retry(universe):
    sql(universe, """insert into companies(id,name,ticker,market,provider,provider_company_id,is_demo,created_at)
      values('20000000-0000-4000-8000-000000000081','New synthetic','NEW','NYSE','sec','0000000081',false,now())""")
    first = sql(universe, 'select sb_collection_candidates()')[0]
    second = sql(universe, 'select sb_collection_candidates()')[0]
    assert first['id'] != second['id']
    sql(universe, 'select sb_collection_finish(:c,\'blocked\',\'daily_request_limit\',cast(:l as uuid))', c=first['id'], l=first['collection_lease_id'])
    state = universe.execute(text('select failure_count,next_attempt_at>now() from app_private.company_collection_state where company_id=:c'), {'c': first['id']}).one()
    assert tuple(state) == (0, True)
    denied(universe, lambda: sql(universe, 'select sb_collection_finish(:c,\'verified\',null,cast(:l as uuid))', c=first['id'], l=first['collection_lease_id']), 'PT409')
    sql(universe, "insert into app_private.us_usage(day,provider,calls,reserved_usd) values(current_date,'sec',500,0)")
    assert sql(universe, 'select sb_collection_candidates()') == []


def test_old_collector_success_reconciles_after_lease_expiry(universe):
    candidate = sql(universe, 'select sb_collection_candidates()')[0]
    sql(universe, 'update companies set last_ingested_at=clock_timestamp() where id=:c', c=candidate['id'])
    sql(universe, "update app_private.company_collection_state set lease_until=now()-interval '1 second' where company_id=:c", c=candidate['id'])
    assert sql(universe, 'select sb_collection_candidates()') == []
    assert sql(universe, 'select failure_count from app_private.company_collection_state where company_id=:c', c=candidate['id']) == 0


def test_analysis_quota_race_defers_without_permanent_third_attempt(universe):
    assert str(sql(universe, 'select sb_collector_analysis_pick()')) == F
    sql(universe, "select sb_collector_analysis_finish(cast(:f as uuid),'blocked','daily_request_limit')", f=F)
    row = universe.exec_driver_sql('select attempt_count,next_attempt_at>now() from app_private.collector_analysis_attempts').one()
    assert tuple(row) == (0, True)
    assert sql(universe, 'select sb_collector_analysis_pick()') is None
    universe.exec_driver_sql("update app_private.collector_analysis_attempts set attempted_at=now()-interval '1 day',next_attempt_at=now()-interval '1 second'")
    assert str(sql(universe, 'select sb_collector_analysis_pick()')) == F


def test_financial_quota_defers_and_preserves_attempt_budget(universe):
    lease = '90000000-0000-4000-8000-000000000081'
    body = json.dumps({'company_id': C, 'lease': lease})
    assert sql(universe, "select sb_company_financial_admin('claim',cast(:p as jsonb))", p=body)['claimed']
    body = json.dumps({'company_id': C, 'lease': lease, 'code': 'daily_request_limit'})
    assert sql(universe, "select sb_company_financial_admin('fail',cast(:p as jsonb))", p=body)['status'] == 'pending'
    assert sql(universe, 'select attempt_count from app_private.company_financial_sources where company_id=:c', c=C) == 0
    assert sql(universe, 'select sb_financial_collection_pick()') is None
    assert not sql(universe, "select sb_company_financial_admin('claim',cast(:p as jsonb))", p=body)['claimed']


def seed_korean(conn, issuer='00000081', ticker='000081'):
    company = '20000000-0000-4000-8000-' + issuer.zfill(12)
    sql(conn, """insert into companies(id,name,ticker,market,provider,provider_company_id,is_demo,created_at)
      values(:c,'Synthetic Korean issuer',:ticker,'KOSPI','dart',:issuer,false,now())""", c=company, ticker=ticker, issuer=issuer)
    return company


@pytest.mark.parametrize('quota_code', ['daily_request_limit', 'quota_exceeded', 'dart_quota_exceeded'])
def test_dart_document_quota_defers_until_next_day_without_manual_retry(universe, quota_code):
    company = seed_korean(universe)
    filing = sql(universe, """insert into dart_filings(company_id,receipt,title,filing_date,source_url,source_sha256,source_object_key,publication_precision,publication_timezone)
      values(:c,'20261104000081','Synthetic notice',current_date,'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20261104000081',
       repeat('b',64),'dart/lists/synthetic.json','date','Asia/Seoul') returning id""", c=company)
    assert sql(universe, 'select sb_dart_document_claim()')['id'] == str(filing)
    sql(universe, "select sb_dart_document_finish(cast(:id as uuid),'blocked',:code)", id=filing, code=quota_code)
    assert sql(universe, 'select state from app_private.dart_document_attempts where filing_id=:id', id=filing) == 'quota_deferred'
    assert sql(universe, 'select sb_dart_document_claim()') is None
    sql(universe, "update app_private.dart_document_attempts set next_attempt_at=now()-interval '1 second' where filing_id=:id", id=filing)
    assert sql(universe, 'select sb_dart_document_claim()')['id'] == str(filing)
    assert sql(universe, 'select count(*) from app_private.dart_document_retries') == 0


def test_calendar_allocation_is_inside_global_cap_and_quota_preflight_never_dispatches(universe):
    seed_korean(universe)
    universe.exec_driver_sql("DO $$ BEGIN FOR i IN 1..250 LOOP PERFORM sb_calendar_provider_reserve('dart');END LOOP;END $$;")
    assert sql(universe, "select calls from app_private.us_usage where day=current_date and provider='dart'") == 250
    denied(universe, lambda: sql(universe, "select sb_calendar_provider_reserve('dart')"), 'PT429')
    assert sql(universe, "select calls from app_private.calendar_provider_usage where day=current_date and provider='dart'") == 250
    assert sql(universe, "select calls from app_private.us_usage where day=current_date and provider='dart'") == 250
    universe.exec_driver_sql('update app_private.calendar_worker_control set ready=true')
    assert sql(universe, 'select app_private.dispatch_calendar_refresh()') == 0
    assert sql(universe, 'select count(*) from net.requests') == 0
    assert sql(universe, "select attempts from app_private.calendar_refresh_queue where source_key='dart-ir-00000081'") == 0
    # Metadata remains runnable; the calendar suballocation did not spend its room.
    assert any(item['provider'] == 'dart' for item in sql(universe, 'select sb_collection_candidates()'))


def test_global_provider_cap_rolls_back_calendar_allocation_reservation(universe):
    sql(universe, "insert into app_private.us_usage(day,provider,calls,reserved_usd) values(current_date,'sec',500,0)")
    denied(universe, lambda: sql(universe, "select sb_calendar_provider_reserve('sec')"), 'PT429')
    assert sql(universe, "select count(*) from app_private.calendar_provider_usage where provider='sec'") == 0
    assert sql(universe, "select calls from app_private.us_usage where day=current_date and provider='sec'") == 500


def test_calendar_quota_result_refunds_attempt_and_leaves_source_pending(universe):
    seed_korean(universe)
    run = sql(universe, """insert into app_private.calendar_runs(token_hash,source_key,claimed_at)
      values(repeat('c',64),'dart-ir-00000081',now()) returning id""")
    sql(universe, """update app_private.calendar_refresh_queue set state='running',attempts=3,run_id=:run,
      lease_until=now()+interval '5 minutes' where source_key='dart-ir-00000081'""", run=run)
    sql(universe, """select sb_calendar_finish(repeat('c',64),
      '[{"source":"dart-ir-00000081","status":"failed","code":"dart_quota_exceeded"}]')""")
    state = universe.exec_driver_sql("select state,attempts,next_attempt_at>now() from app_private.calendar_refresh_queue where source_key='dart-ir-00000081'").one()
    assert tuple(state) == ('pending', 2, True)
    assert sql(universe, 'select count(*) from net.requests') == 0


def test_three_first_pass_turns_and_one_stale_turn_prevent_either_group_starving(universe):
    sql(universe, "update companies set last_ingested_at=now()-interval '1 day' where id=:c", c=C)
    for number in range(81, 85):
        sql(universe, """insert into companies(id,name,ticker,market,provider,provider_company_id,is_demo,created_at)
          values(:c,'Synthetic new issuer',:ticker,'NASDAQ','sec',:issuer,false,now())""",
            c=f'20000000-0000-4000-8000-{number:012}', ticker=f'N{number}', issuer=f'{number:010}')
    picked = []
    for _ in range(4):
        candidate = sql(universe, 'select sb_collection_candidates()')[0]
        picked.append(candidate['id'])
        sql(universe, 'update companies set last_ingested_at=clock_timestamp() where id=:c', c=candidate['id'])
        sql(universe, "select sb_collection_finish(:c,'verified',null,cast(:l as uuid))", c=candidate['id'], l=candidate['collection_lease_id'])
    assert C not in picked[:3] and picked[3] == C
    assert len(set(picked)) == 4


def overview(conn, payload):
    return sql(conn, "select sb_customer_workspace('source_overview',cast(:p as jsonb))", p=json.dumps(payload))


def test_visible_page_monitoring_empty_and_single_company_scopes(universe):
    other = seed_korean(universe)
    universe.exec_driver_sql('SET LOCAL ROLE authenticated')
    empty = overview(universe, {'scope': 'all', 'days': 0, 'company_ids': []})
    assert empty['companies'] == empty['filing_count'] == empty['published_count'] == 0
    assert empty['monitoring'] == empty['filings'] == empty['analyses'] == empty['calendar'] == []
    selected = overview(universe, {'scope': 'all', 'days': 0, 'company_ids': [C]})
    assert selected['companies'] == selected['filing_count'] == 1
    assert [row['company_id'] for row in selected['monitoring']] == [C]
    assert all(row['company_id'] == C for row in selected['filings'])
    assert other not in json.dumps(selected)


def test_visible_page_monitoring_rejects_unbounded_ambiguous_or_invalid_filters(universe):
    universe.exec_driver_sql('SET LOCAL ROLE authenticated')
    payloads = [
        {'company_ids': [f'20000000-0000-4000-8000-{number:012}' for number in range(51)]},
        {'company_ids': [C], 'company_id': C}, {'company_ids': [C, C]},
        {'company_ids': ['not-an-id']}, {'company_ids': [None]}, {'company_ids': C},
    ]
    for payload in payloads:
        denied(universe, lambda p=payload: overview(universe, {'scope': 'all', **p}))


def test_legacy_monitoring_without_page_filter_preserves_existing_all_company_scope(universe):
    other = seed_korean(universe)
    universe.exec_driver_sql('SET LOCAL ROLE authenticated')
    legacy = overview(universe, {'scope': 'all', 'days': 0})
    assert legacy['companies'] == 2 and legacy['filing_count'] == 1
    assert {row['company_id'] for row in legacy['monitoring']} == {C, other}
    assert overview(universe, {'scope': 'all', 'company_id': C})['companies'] == 1


def test_reused_directory_ticker_cannot_bind_to_an_arbitrary_issuer(universe):
    value, raw = manifest(universe)
    sql(universe, """insert into app_private.company_directory(provider,provider_company_id,ticker,name,market,source_sha256,fetched_at)
      values('sec','0000000999','NEW','Different issuer','OTC',:sha,now())""", sha=DIRECTORY_SHA)
    denied(universe, lambda: stage(universe, value, raw))
    assert sql(universe, 'select count(*) from app_private.universe_snapshots') == 0


def test_other_source_alias_cannot_select_between_conflicting_canonical_issuers(universe):
    value, raw = manifest(universe)
    value['items'][0]['aliases'].append('OTHER')
    sql(universe, """insert into app_private.company_directory(provider,provider_company_id,ticker,name,market,source_sha256,fetched_at)
      values('sec','0000000099','OTHER','Different synthetic issuer','NYSE',:sha,now())""", sha=DIRECTORY_SHA)
    denied(universe, lambda: stage(universe, value, raw))
    assert sql(universe, 'select count(*) from app_private.universe_snapshots') == 0
    # A different exact-case CQS spelling is not an SEC alias for the selected symbol.
    value['items'][0]['aliases'] = ['NEW', 'OTHERpA']
    sql(universe, "update app_private.company_directory set ticker='OTHERPA' where provider_company_id='0000000099'")
    assert stage(universe, value, raw)[0]['status'] == 'staged'
    assert sql(universe, 'select count(*) from app_private.universe_snapshots') == 1


def test_unknown_instrument_is_reported_as_held_not_a_verified_nonstock_exclusion(universe):
    held = listing('OPAQUE')
    held.update(instrument_type='other_non_etf_security', eligible=False, exclusion_reason='instrument_classification_unresolved')
    excluded = listing('ETF', row=2)
    excluded.update(instrument_type='exchange_traded_product', eligible=False, exclusion_reason='official_etf_flag')
    value, raw = manifest(universe, [held, excluded])
    apply(universe, value, raw)
    assert sql(universe, 'select sb_universe_register(50)')['created_issuers'] == 0
    universe.exec_driver_sql('SET LOCAL ROLE authenticated')
    market = sql(universe, 'select sb_universe_coverage()')['markets'][0]
    assert market['listings'] == 2 and market['eligible_listings'] == 0
    assert market['classification_pending_listings'] == market['excluded_listings'] == 1
