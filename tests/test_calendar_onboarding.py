"""Local PostgreSQL contracts for canonical source onboarding and durable collection."""
import calendar
import copy
import hashlib
import json
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from test_micron_calendar_ingestion import COMPANY, ROOT, snapshot
from test_micron_calendar_ingestion import calendar_db as calendar_db

pytestmark = pytest.mark.postgres
NVDA = '10000000-0000-4000-8000-000000000093'
DART = '10000000-0000-4000-8000-000000000094'
DART_CODE = '00999991'
MIGRATION = ROOT / 'supabase/migrations/20261101103903_calendar_source_onboarding.sql'


@pytest.fixture
def onboard_db(calendar_db, request):
    connection, cur = calendar_db
    cur.execute("""
        CREATE SCHEMA IF NOT EXISTS app_content_private;
        CREATE OR REPLACE FUNCTION public.sb_require_mfa() RETURNS void LANGUAGE plpgsql AS $$ BEGIN END $$;
        CREATE SCHEMA net;
        CREATE TABLE net.requests(id bigserial PRIMARY KEY,url text,headers jsonb,body jsonb,timeout_ms integer);
        CREATE FUNCTION net.http_post(url text,body jsonb,headers jsonb,timeout_milliseconds integer)
        RETURNS bigint LANGUAGE plpgsql AS $$ DECLARE result bigint; BEGIN
          INSERT INTO net.requests(url,body,headers,timeout_ms) VALUES($1,$2,$3,$4) RETURNING id INTO result;
          RETURN result;
        END $$;
    """, prepare=False)
    if getattr(request, 'param', None) != 'empty':
        cur.execute("""INSERT INTO companies(id,name,ticker,market,provider,provider_company_id,is_demo,created_at)
            VALUES(%s,'Synthetic reviewed Q4 issuer','NVDA','NASDAQ','sec','0001045810',false,now())""", (NVDA,))
    cur.execute(MIGRATION.read_text(), prepare=False)
    yield connection, cur


def add_dart(cur, market='KR'):
    cur.execute("""INSERT INTO companies(id,name,ticker,market,provider,provider_company_id,is_demo,created_at)
        VALUES(%s,'Synthetic official Korean issuer','099991',%s,'dart',%s,false,now())""", (DART, market, DART_CODE))
    return f'dart-ir-{DART_CODE}'


def ready(cur):
    return cur.execute("select public.sb_calendar_worker_ready('calendar-onboarding-v1')").fetchone()[0]


def finish(cur, source, ok=True):
    token_hash = cur.execute("select token_hash from app_private.calendar_runs where source_key=%s and finished_at is null order by created_at desc limit 1", (source,)).fetchone()[0]
    assert cur.execute('select sb_calendar_claim(%s)', (token_hash,)).fetchone()[0]
    cur.execute('select sb_calendar_finish(%s,%s::jsonb)', (token_hash, json.dumps([{'source': source, 'status': 'verified' if ok else 'failed'}])))


def test_existing_canonical_backfill_is_durable_and_has_no_deployment_side_effect(onboard_db):
    _, cur = onboard_db
    assert cur.execute('select count(*) from net.requests').fetchone()[0] == 0
    assert cur.execute("select company_id,provider,provider_company_id,market from app_private.calendar_sources where key='nvidia-ir'").fetchone() == (NVDA, 'sec', '0001045810', 'NASDAQ')
    assert cur.execute("select state from app_private.calendar_refresh_queue where source_key='nvidia-ir'").fetchone()[0] == 'pending'
    assert ready(cur) == 2
    assert cur.execute('select count(*) from net.requests where timeout_ms=60000').fetchone()[0] == 2
    for token_hash, source in cur.execute('select token_hash,source_key from app_private.calendar_runs').fetchall():
        assert cur.execute('select sb_calendar_claim(%s)', (token_hash,)).fetchone()[0]
        assert not cur.execute('select sb_calendar_claim(%s)', (token_hash,)).fetchone()[0]
        rows = cur.execute('select sb_calendar_task_sources(%s)', (token_hash,)).fetchone()[0]
        assert len(rows) == 1 and rows[0]['key'] == source
        assert rows[0]['provider_company_id'] in ('0000723125', '0001045810')


@pytest.mark.parametrize('calendar_db', ['cold'], indirect=True)
@pytest.mark.parametrize('onboard_db', ['empty'], indirect=True)
def test_empty_schema_replays_and_later_verified_activation_dispatches_once(onboard_db):
    _, cur = onboard_db
    assert cur.execute('select count(*) from companies').fetchone()[0] == 0
    assert ready(cur) == 0
    cur.execute("""INSERT INTO companies(id,name,ticker,market,provider,provider_company_id,is_demo,created_at)
        VALUES(%s,'Synthetic newly activated issuer','NVDA','NASDAQ','sec','0001045810',false,now())""", (NVDA,))
    assert cur.execute('select count(*) from net.requests').fetchone()[0] == 1
    assert cur.execute("select state from app_private.calendar_refresh_queue where source_key='nvidia-ir'").fetchone()[0] == 'running'
    cur.execute('select sb_calendar_request_company(%s)', (NVDA,))
    assert cur.execute('select count(*) from net.requests').fetchone()[0] == 1


def test_new_dart_company_is_queued_while_unsupported_sec_company_is_not(onboard_db):
    _, cur = onboard_db
    source = add_dart(cur)
    cur.execute("""insert into companies(id,name,ticker,market,provider,provider_company_id,is_demo,created_at)
        values('10000000-0000-4000-8000-000000000095','Synthetic unsupported issuer','NOFEED','NASDAQ','sec','0000000995',false,now())""")
    assert cur.execute('select company_id,market from app_private.calendar_sources where key=%s', (source,)).fetchone() == (DART, 'KR')
    assert cur.execute('select state from app_private.calendar_refresh_queue where source_key=%s', (source,)).fetchone()[0] == 'pending'
    assert cur.execute("select sb_calendar_request_company('10000000-0000-4000-8000-000000000095')").fetchone()[0] == {'supported': False, 'pending': False}
    assert cur.execute('select count(*) from net.requests').fetchone()[0] == 0


def test_market_hydration_change_keeps_running_work_and_requests_one_followup(onboard_db):
    _, cur = onboard_db
    source = add_dart(cur)
    cur.execute("update app_private.calendar_sources set enabled=false where key in ('micron-ir','nvidia-ir')")
    assert ready(cur) == 1
    first_run = cur.execute('select run_id from app_private.calendar_refresh_queue where source_key=%s', (source,)).fetchone()[0]
    cur.execute("update companies set market='KOSPI' where id=%s", (DART,))
    assert cur.execute('select market from app_private.calendar_sources where key=%s', (source,)).fetchone()[0] == 'KOSPI'
    assert cur.execute('select run_id,rerun_requested,state from app_private.calendar_refresh_queue where source_key=%s', (source,)).fetchone() == (first_run, True, 'running')
    finish(cur, source)
    row = cur.execute('select run_id,rerun_requested,state,attempts from app_private.calendar_refresh_queue where source_key=%s', (source,)).fetchone()
    assert row[0] != first_run and row[1:] == (False, 'running', 1)
    assert cur.execute('select count(*) from net.requests').fetchone()[0] == 2


def test_global_legacy_run_does_not_discard_new_company_and_finish_drains_queue(onboard_db):
    _, cur = onboard_db
    cur.execute("insert into app_private.calendar_runs(token_hash,claimed_at) values(%s,now())", ('a' * 64,))
    add_dart(cur)
    assert ready(cur) == 0
    assert cur.execute("select count(*) from app_private.calendar_refresh_queue where state='pending'").fetchone()[0] == 3
    cur.execute('select sb_calendar_finish(%s,%s::jsonb)', ('a' * 64, '[]'))
    assert cur.execute('select count(*) from net.requests').fetchone()[0] == 2
    assert cur.execute("select count(*) from app_private.calendar_refresh_queue where state='pending'").fetchone()[0] == 1
    running = cur.execute("select source_key from app_private.calendar_refresh_queue where state='running' order by source_key limit 1").fetchone()[0]
    finish(cur, running)
    assert cur.execute('select count(*) from net.requests').fetchone()[0] == 3


def test_expired_lease_is_retried_and_stops_after_three_attempts(onboard_db):
    _, cur = onboard_db
    cur.execute("update app_private.calendar_sources set enabled=false where key='micron-ir'")
    ready(cur)
    for attempt in (1, 2, 3):
        cur.execute("update app_private.calendar_runs set expires_at=now()-interval '1 second' where source_key='nvidia-ir' and finished_at is null")
        cur.execute("update app_private.calendar_refresh_queue set lease_until=now()-interval '1 second' where source_key='nvidia-ir'")
        cur.execute('select app_private.dispatch_calendar_refresh()')
        state, attempts = cur.execute("select state,attempts from app_private.calendar_refresh_queue where source_key='nvidia-ir'").fetchone()
        assert (state, attempts) == (('running', attempt + 1) if attempt < 3 else ('failed', 3))
    assert cur.execute('select count(*) from net.requests').fetchone()[0] == 3
    assert cur.execute("select error_code from app_private.calendar_sources where key='nvidia-ir'").fetchone()[0] == 'refresh_lease_expired'


def test_disabled_source_and_conflicting_official_identity_are_never_overwritten(onboard_db):
    import psycopg
    connection, cur = onboard_db
    cur.execute("update app_private.calendar_sources set enabled=false where key='nvidia-ir'")
    cur.execute('select sb_calendar_request_company(%s)', (NVDA,))
    assert not cur.execute("select enabled from app_private.calendar_sources where key='nvidia-ir'").fetchone()[0]
    cur.execute("update app_private.calendar_sources set provider_company_id='0000000999' where key='nvidia-ir'")
    with pytest.raises(psycopg.Error, match='calendar_source_conflict'), connection.transaction():
        cur.execute('select sb_calendar_request_company(%s)', (NVDA,))


def test_queue_controls_are_service_only_and_unclaimed_tasks_cannot_read_sources(onboard_db):
    import psycopg
    connection, cur = onboard_db
    for signature in ['sb_calendar_worker_ready(text)', 'sb_calendar_request_company(text)', 'sb_calendar_task_sources(text)', 'sb_calendar_ingest_dart_ir(text,text,text,text)']:
        for role in ['anon', 'authenticated']:
            assert not cur.execute('select has_function_privilege(%s,%s,\'execute\')', (role, 'public.' + signature)).fetchone()[0]
        assert cur.execute('select has_function_privilege(\'service_role\',%s,\'execute\')', ('public.' + signature,)).fetchone()[0]
    ready(cur)
    token_hash = cur.execute('select token_hash from app_private.calendar_runs limit 1').fetchone()[0]
    with pytest.raises(psycopg.Error, match='invalid_calendar_task'), connection.transaction():
        cur.execute('select sb_calendar_task_sources(%s)', (token_hash,))


def test_coverage_exposes_only_public_company_ids_and_pending_state(onboard_db):
    _, cur = onboard_db
    add_dart(cur)
    actor = '10000000-0000-4000-8000-000000000099'
    cur.execute('insert into auth.users(id,email,raw_user_meta_data) values(%s,%s,\'{}\')', (actor, 'synthetic@example.invalid'))
    cur.execute("select set_config('request.jwt.claim.sub',%s,true)", (actor,))
    coverage = cur.execute('select app_content_private.calendar_coverage(%s)', (DART,)).fetchone()[0]
    assert coverage['pending_companies'] == 3
    assert set(coverage['pending_company_ids']) == {COMPANY, NVDA, DART}
    assert coverage['selected']['pending'] and coverage['selected']['source_count'] == 1
    assert not coverage['selected']['has_error']


def archive_manifest(cur, manifest):
    raw = json.dumps(manifest, separators=(',', ':'), ensure_ascii=False)
    digest = hashlib.sha256(raw.encode()).hexdigest()
    path = f"calendar/{manifest['source_key']}/{digest}.json"
    objects = [path, *(page['object_key'] for page in manifest['pages'])]
    for document in manifest.get('documents', []):
        objects.extend([document['main_object_key'], document['body_object_key']])
    for name in objects:
        cur.execute("insert into storage.objects(bucket_id,name) values('signalbrief-raw',%s)", (name,))
    return manifest['source_key'], digest, path, raw


def ingest(cur, manifest, kind='q4'):
    return cur.execute(f'select sb_calendar_ingest_{kind}(%s,%s,%s,%s)', archive_manifest(cur, manifest)).fetchone()[0]


def nvidia_manifest():
    manifest = snapshot()
    manifest.update(source_key='nvidia-ir', source_url='https://investor.nvidia.com/events-and-presentations/events-and-presentations/default.aspx',
                    adapter='q4-events', company_id=NVDA, provider='sec', provider_company_id='0001045810', ticker='NVDA')
    for page in manifest['pages']:
        page['url'] = page['url'].replace('investors.micron.com', 'investor.nvidia.com')
        page['object_key'] = page['object_key'].replace('micron-ir', 'nvidia-ir')
    manifest['entries'][0]['timezone'] = 'America/Los_Angeles'
    return manifest


def test_general_q4_ingests_and_is_visible_by_exact_canonical_issuer(onboard_db):
    _, cur = onboard_db
    manifest = nvidia_manifest()
    assert ingest(cur, manifest) == 1
    assert ingest(cur, manifest) == 1
    row = cur.execute("select id,company_id,source_timezone from calendar_items where source_key='nvidia-ir'").fetchone()
    assert row[1:] == (NVDA, 'America/Los_Angeles')
    assert cur.execute('select app_private.sb_calendar_confirmed(%s)', (row[0],)).fetchone()[0]
    cur.execute("update companies set provider_company_id='0000000993' where id=%s", (NVDA,))
    assert not cur.execute('select app_private.sb_calendar_confirmed(%s)', (row[0],)).fetchone()[0]


def dart_manifest(empty=False):
    today = datetime.now(ZoneInfo('Asia/Seoul')).date()
    end_month = today.month + 18
    end_year = today.year + (end_month - 1) // 12
    end_month = (end_month - 1) % 12 + 1
    end = date(end_year, end_month, min(today.day, calendar.monthrange(end_year, end_month)[1]))
    source = f'dart-ir-{DART_CODE}'
    receipt = today.strftime('%Y%m%d') + '800001'
    day = (today + timedelta(days=7)).isoformat()
    main = f'https://dart.fss.or.kr/dsaf001/main.do?rcpNo={receipt}'
    return {'schema': 'signalbrief.calendar.dart-ir.v1', 'adapter': 'dart-ir', 'source_key': source,
            'source_url': 'https://dart.fss.or.kr/', 'company_id': DART, 'provider': 'dart',
            'provider_company_id': DART_CODE, 'ticker': '099991', 'complete': True, 'page_size': 100,
            'receipt_window': {'start': (today - timedelta(days=90)).isoformat(), 'end': today.isoformat()},
            'window': {'start': (today - timedelta(days=90)).isoformat(), 'end': end.isoformat()},
            'pages': [{'page_number': 1, 'count': 0 if empty else 1, 'total_count': 0 if empty else 1,
                       'total_page': 0 if empty else 1, 'raw_sha256': 'a' * 64,
                       'object_key': f'calendar/{source}/lists/{"a" * 64}.json',
                       'url': f'https://opendart.fss.or.kr/api/list.json?corp_code={DART_CODE}&page_no=1&bgn_de={(today - timedelta(days=90)):%Y%m%d}&end_de={today:%Y%m%d}&page_count=100&sort=date&sort_mth=desc'}],
            'documents': [] if empty else [{'receipt_no': receipt, 'main_url': main, 'main_sha256': 'b' * 64,
                                           'main_object_key': f'calendar/{source}/documents/{"b" * 64}.html',
                                           'body_url': f'https://dart.fss.or.kr/report/viewer.do?rcpNo={receipt}&dcmNo=123&eleId=0&offset=0&length=0&dtd=HTML',
                                           'body_sha256': 'c' * 64, 'body_object_key': f'calendar/{source}/documents/{"c" * 64}.html'}],
            'entries': [] if empty else [{'key': receipt, 'title': 'Synthetic issuer · official IR presentation',
                                         'occurs_on': day, 'quote': f'1. 일시 및 장소 일시 {day} 09:00',
                                         'timezone': None, 'location': '99664/table/tr[0]/일시',
                                         'source_url': main, 'body_sha256': 'c' * 64}]}


def test_dart_receipt_is_archived_visible_idempotent_and_empty_window_never_withdraws(onboard_db):
    _, cur = onboard_db
    source = add_dart(cur)
    manifest = dart_manifest()
    assert ingest(cur, manifest, 'dart_ir') == 1
    assert ingest(cur, manifest, 'dart_ir') == 1
    row = cur.execute('select id,source_url,source_timezone,calendar_status from calendar_items where source_key=%s', (source,)).fetchone()
    assert row[1:] == (manifest['entries'][0]['source_url'], None, 'confirmed')
    assert cur.execute('select app_private.sb_calendar_confirmed(%s)', (row[0],)).fetchone()[0]
    assert ingest(cur, dart_manifest(empty=True), 'dart_ir') == 0
    assert cur.execute('select calendar_status from calendar_items where id=%s', (row[0],)).fetchone()[0] == 'confirmed'


@pytest.mark.parametrize('mutation', ['issuer', 'receipt_url', 'body_hash', 'timezone', 'partial', 'missing_archive', 'hash'])
def test_invalid_dart_snapshot_cannot_publish_or_withdraw_prior_events(onboard_db, mutation):
    import psycopg
    connection, cur = onboard_db
    source = add_dart(cur)
    manifest = dart_manifest()
    ingest(cur, manifest, 'dart_ir')
    broken = copy.deepcopy(manifest)
    if mutation == 'issuer':
        broken['provider_company_id'] = '00999992'
    elif mutation == 'receipt_url':
        broken['entries'][0]['source_url'] = 'https://dart.fss.or.kr/'
    elif mutation == 'body_hash':
        broken['entries'][0]['body_sha256'] = 'd' * 64
    elif mutation == 'timezone':
        broken['entries'][0]['timezone'] = 'Asia/Seoul'
    elif mutation == 'partial':
        broken['pages'][0]['total_count'] = 101
        broken['pages'][0]['total_page'] = 2
    values = list(archive_manifest(cur, broken))
    if mutation == 'missing_archive':
        cur.execute('delete from storage.objects where name=%s', (broken['documents'][0]['body_object_key'],))
    elif mutation == 'hash':
        values[3] += ' '
    with pytest.raises(psycopg.Error), connection.transaction():
        cur.execute('select sb_calendar_ingest_dart_ir(%s,%s,%s,%s)', values)
    assert cur.execute('select count(*),min(calendar_status) from calendar_items where source_key=%s', (source,)).fetchone() == (1, 'confirmed')
