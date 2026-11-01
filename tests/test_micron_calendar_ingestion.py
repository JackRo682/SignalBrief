"""Synthetic Q4 manifests prove archival/completeness before calendar replacement."""
import calendar
import hashlib
import importlib.util
import json
import os
from datetime import date, timedelta
from pathlib import Path
from urllib.parse import urlsplit

import pytest

ROOT = Path(__file__).resolve().parents[1]
pytestmark = pytest.mark.postgres
COMPANY = '10000000-0000-4000-8000-000000000092'
SOURCE_URL = 'https://investors.micron.com/events-and-presentations/'


@pytest.fixture
def calendar_db(request):
    import psycopg

    url = os.getenv('SB_TEST_CALENDAR_POSTGRES_URL')
    if not url:
        pytest.skip('Disposable calendar PostgreSQL URL not supplied')
    parsed = urlsplit(url)
    assert parsed.hostname in ('localhost', '127.0.0.1') and parsed.path.endswith('_test')
    spec = importlib.util.spec_from_file_location('calendar_baseline', ROOT / 'scripts/hosted_baseline.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    with psycopg.connect(url) as connection:
        with connection.cursor() as cur:
            assert cur.execute("select to_regclass('public.users')").fetchone()[0] is None
            cur.execute("""
                DO $$ BEGIN
                  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
                  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
                  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
                END $$;
                CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb);
                CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
                $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
                GRANT USAGE ON SCHEMA auth TO authenticated,anon;
                CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean);
                CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text);
                ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
                GRANT USAGE ON SCHEMA storage TO authenticated; GRANT SELECT ON storage.objects TO authenticated;
                CREATE SCHEMA extensions; CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
            """, prepare=False)
            cur.execute(module.baseline(), prepare=False)
            for migration in sorted((ROOT / 'supabase/hosted').glob('*.sql')):
                cur.execute(migration.read_text(), prepare=False)
            cur.execute((ROOT / 'supabase/migrations/20261019070909_official_calendar_ingestion.sql').read_text(),
                        prepare=False)
            if getattr(request, 'param', None) != 'cold':
                cur.execute("""INSERT INTO companies(id,name,ticker,market,provider,provider_company_id,is_demo,created_at)
                    VALUES(%s,'Synthetic official issuer','MU','NASDAQ','sec','0000723125',false,now())""", (COMPANY,))
            cur.execute((ROOT / 'supabase/migrations/20261101072157_micron_q4_calendar.sql').read_text(), prepare=False)
            yield connection, cur
        connection.rollback()


def feed_url(page):
    return ('https://investors.micron.com/feed/Event.svc/GetEventList?LanguageId=1&eventSelection=3&eventDateFilter=3'
            '&includeFinancialReports=false&includePresentations=false&includePressReleases=false&sortOperator=1'
            f'&pageSize=100&pageNumber={page}&tagList=&includeTags=true&year=-1&excludeSelection=1')


def snapshot(items=None):
    today = date.today()
    end_month = today.month + 18
    end_year = today.year + (end_month - 1) // 12
    end_month = (end_month - 1) % 12 + 1
    end = date(end_year, end_month, min(today.day, calendar.monthrange(end_year, end_month)[1]))
    day = (today + timedelta(days=7)).isoformat()
    if items is None:
        items = [{'key': '101', 'title': 'Synthetic official webcast', 'occurs_on': day,
                  'quote': f'Synthetic official webcast | {day} 10:00 ET',
                  'timezone': 'America/New_York', 'location': 'pages[0].GetEventListResult[0]'}]
    pages = []
    # An empty current selection still has an independently nonempty historical/source catalog.
    for page, count in enumerate([max(len(items), 1), 0]):
        raw = json.dumps({'synthetic_page': page, 'count': count}).encode()
        digest = hashlib.sha256(raw).hexdigest()
        pages.append({'url': feed_url(page), 'page_number': page, 'count': count, 'raw_sha256': digest,
                      'object_key': f'calendar/micron-ir/pages/{digest}.json'})
    return {'schema': 'signalbrief.calendar.q4.v1', 'source_key': 'micron-ir', 'source_url': SOURCE_URL,
            'adapter': 'micron-q4', 'complete': True, 'page_size': 100,
            'window': {'start': (today - timedelta(days=90)).isoformat(), 'end': end.isoformat()},
            'pages': pages, 'entries': items}


def archive(cur, manifest, missing=None):
    raw = json.dumps(manifest, separators=(',', ':'))
    digest = hashlib.sha256(raw.encode()).hexdigest()
    path = f'calendar/micron-ir/{digest}.json'
    for name in [path, *(page['object_key'] for page in manifest['pages'])]:
        if name != missing:
            cur.execute("insert into storage.objects(bucket_id,name) values('signalbrief-raw',%s)", (name,))
    return digest, path, raw


def ingest(cur, values):
    return cur.execute('select sb_calendar_ingest_q4(%s,%s,%s,%s)', ('micron-ir', *values)).fetchone()[0]


def test_complete_json_snapshot_is_idempotent_and_source_bound(calendar_db):
    _, cur = calendar_db
    values = archive(cur, snapshot())
    assert ingest(cur, values) == 1
    first = cur.execute("select id,company_id,source_event_key from calendar_items").fetchone()
    assert first[1:] == (COMPANY, '101')
    assert ingest(cur, values) == 1
    assert cur.execute('select count(*) from calendar_items').fetchone()[0] == 1
    assert cur.execute('select count(*) from app_private.calendar_snapshots').fetchone()[0] == 1
    assert cur.execute('select raw_format,provenance from app_private.calendar_snapshots').fetchone() == ('json', snapshot())
    assert cur.execute('select app_private.sb_calendar_confirmed(%s)', (first[0],)).fetchone()[0]
    assert cur.execute("select ticker,market from app_private.calendar_sources where key='micron-ir'").fetchone() == ('MU', 'NASDAQ')
    cur.execute('SET LOCAL ROLE authenticated')
    assert cur.execute('select count(*) from calendar_items').fetchone()[0] == 1


@pytest.mark.parametrize('mutation', ['partial', 'missing_tail', 'nonempty_tail', 'early_empty', 'short_nonfinal', 'empty_catalog', 'wrong_url',
                                     'wrong_source', 'wrong_window', 'wrong_page', 'duplicate_identity'])
def test_incomplete_or_changed_manifest_cannot_withdraw_verified_future_events(calendar_db, mutation):
    import psycopg

    connection, cur = calendar_db
    assert ingest(cur, archive(cur, snapshot())) == 1
    changed = snapshot([])
    if mutation == 'partial':
        changed['complete'] = False
    elif mutation == 'missing_tail':
        changed['pages'] = []
    elif mutation == 'nonempty_tail':
        changed['pages'][-1]['count'] = 1
    elif mutation == 'early_empty':
        changed['pages'][0]['count'] = 0
    elif mutation == 'empty_catalog':
        changed['pages'] = [{**changed['pages'][0], 'count': 0}]
    elif mutation == 'short_nonfinal':
        changed['pages'] = [
            {**changed['pages'][0], 'page_number': index, 'url': feed_url(index), 'count': count}
            for index, count in enumerate([1, 100, 0])
        ]
    elif mutation == 'wrong_url':
        changed['pages'][0]['url'] = 'https://untrusted.example.invalid/feed'
    elif mutation == 'wrong_source':
        changed['source_url'] = 'https://untrusted.example.invalid/'
    elif mutation == 'wrong_window':
        changed['window']['start'] = date.today().isoformat()
    elif mutation == 'wrong_page':
        changed['pages'][0]['page_number'] = 2
    else:
        changed = snapshot()
        changed['entries'] *= 2
        changed['pages'][0]['count'] = 2
    with pytest.raises(psycopg.Error), connection.transaction():
        ingest(cur, archive(cur, changed))
    assert cur.execute('select calendar_status from calendar_items').fetchone()[0] == 'confirmed'
    assert cur.execute('select count(*) from app_private.calendar_snapshots').fetchone()[0] == 1


@pytest.mark.parametrize('which', ['manifest', 'page', 'digest'])
def test_every_original_and_manifest_must_be_archived_and_hash_bound(calendar_db, which):
    import psycopg

    connection, cur = calendar_db
    value = snapshot()
    values = archive(cur, value, missing=value['pages'][0]['object_key'] if which == 'page' else None)
    if which == 'manifest':
        cur.execute('delete from storage.objects where name=%s', (values[1],))
    elif which == 'digest':
        values = (*values[:2], values[2] + ' ')
    with pytest.raises(psycopg.Error), connection.transaction():
        ingest(cur, values)
    assert cur.execute('select count(*) from calendar_items').fetchone()[0] == 0


def test_source_registration_waits_for_exact_activation_and_preserves_disabled_choice(calendar_db):
    _, cur = calendar_db
    cur.execute("delete from app_private.calendar_sources where key='micron-ir'")
    cur.execute("delete from companies where id=%s", (COMPANY,))
    assert all(source['key'] != 'micron-ir' for source in cur.execute('select sb_calendar_sources()').fetchone()[0])
    cur.execute("""INSERT INTO companies(id,name,ticker,market,provider,provider_company_id,is_demo,created_at)
        VALUES(%s,'Synthetic official issuer','MU','SEC','sec','0000723125',false,now())""", (COMPANY,))
    sources = cur.execute('select sb_calendar_sources()').fetchone()[0]
    assert next(source for source in sources if source['key'] == 'micron-ir')['market'] == 'SEC'
    cur.execute("update app_private.calendar_sources set enabled=false where key='micron-ir'")
    assert all(source['key'] != 'micron-ir' for source in cur.execute('select sb_calendar_sources()').fetchone()[0])
    assert not cur.execute("select enabled from app_private.calendar_sources where key='micron-ir'").fetchone()[0]


@pytest.mark.parametrize('calendar_db', ['cold'], indirect=True)
def test_fresh_migration_replays_without_activating_or_creating_a_company(calendar_db):
    _, cur = calendar_db
    assert cur.execute('select count(*) from companies').fetchone()[0] == 0
    assert all(source['key'] != 'micron-ir' for source in cur.execute('select sb_calendar_sources()').fetchone()[0])
    assert cur.execute("select count(*) from app_private.calendar_sources where key='micron-ir'").fetchone()[0] == 0


@pytest.mark.parametrize('column,value', [('adapter', 'microsoft'), ('url', 'https://untrusted.example.invalid/'),
                                        ('ticker', 'OTHER')])
def test_existing_source_identity_conflict_is_not_overwritten(calendar_db, column, value):
    import psycopg

    connection, cur = calendar_db
    assert column in {'adapter', 'url', 'ticker'}
    cur.execute(f"update app_private.calendar_sources set {column}=%s where key='micron-ir'", (value,))
    with pytest.raises(psycopg.Error, match='calendar_source_conflict'), connection.transaction():
        cur.execute('select sb_calendar_sources()')
    assert cur.execute(f"select {column} from app_private.calendar_sources where key='micron-ir'").fetchone()[0] == value


@pytest.mark.parametrize('mutation', [{'timezone': 'UTC'}, {'occurs_on': '2028-02-30'},
                                     {'location': 'pages[1].GetEventListResult[0]'}, {'location': 'pages[0].GetEventListResult[7]'}])
def test_unknown_zone_invalid_date_or_unbound_row_cannot_be_published(calendar_db, mutation):
    import psycopg

    connection, cur = calendar_db
    value = snapshot()
    value['entries'][0].update(mutation)
    with pytest.raises(psycopg.Error), connection.transaction():
        ingest(cur, archive(cur, value))
    assert cur.execute('select count(*) from calendar_items').fetchone()[0] == 0


def test_only_a_complete_empty_snapshot_withdraws_future_events(calendar_db):
    _, cur = calendar_db
    ingest(cur, archive(cur, snapshot()))
    cur.execute("select sb_calendar_source_error('micron-ir','source_http_503')")
    assert cur.execute('select calendar_status from calendar_items').fetchone()[0] == 'confirmed'
    assert ingest(cur, archive(cur, snapshot([]))) == 0
    assert cur.execute('select calendar_status from calendar_items').fetchone()[0] == 'withdrawn'
    assert cur.execute("select error_code,last_success_at is not null from app_private.calendar_sources where key='micron-ir'").fetchone() == (None, True)


def test_rpc_is_service_only_and_never_uses_a_same_ticker_different_issuer(calendar_db):
    import psycopg

    connection, cur = calendar_db
    values = archive(cur, snapshot())
    for role in ['anon', 'authenticated']:
        cur.execute(f'SET LOCAL ROLE {role}')
        with pytest.raises(psycopg.errors.InsufficientPrivilege), connection.transaction():
            ingest(cur, values)
        cur.execute('RESET ROLE')
    assert cur.execute("select has_function_privilege('service_role','public.sb_calendar_ingest_q4(text,text,text,text)','execute')").fetchone()[0]
    cur.execute("update companies set provider_company_id='0000000999' where id=%s", (COMPANY,))
    with pytest.raises(psycopg.Error), connection.transaction():
        ingest(cur, values)
    assert cur.execute('select count(*) from calendar_items').fetchone()[0] == 0
