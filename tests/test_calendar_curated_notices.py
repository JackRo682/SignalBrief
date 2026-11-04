"""Synthetic notice staging, one-use worker, immutable evidence and RLS contracts."""
import base64
import copy
import hashlib
import json
from datetime import date, datetime, timedelta, timezone

import pytest
from test_calendar_sec_ir import ROOT
from test_calendar_sec_ir import calendar_db as calendar_db
from test_calendar_sec_ir import onboard_db as onboard_db
from test_calendar_sec_ir import sec_ir_db as sec_ir_db

pytestmark = pytest.mark.postgres
MIGRATION = ROOT / 'supabase/migrations/20261104121333_curated_official_calendar_notices.sql'
COMPANY = '10000000-0000-4000-8000-000000000081'
URL = 'https://www.apple.com/newsroom/2026/11/synthetic-notice/'


@pytest.fixture
def notice_db(sec_ir_db):
    connection, cur = sec_ir_db
    cur.execute("""CREATE TABLE public.dart_filings(id uuid DEFAULT gen_random_uuid(),company_id text,
        receipt text,source_url text,title text,filing_date date,source_sha256 text,source_object_key text);""")
    cur.execute("""INSERT INTO companies(id,name,ticker,market,provider,provider_company_id,is_demo,created_at)
        VALUES(%s,'Synthetic official issuer Apple','AAPL','NASDAQ','sec','0000320193',false,now());""",
                (COMPANY,), prepare=False)
    before = cur.execute("select oid,proacl::text from pg_proc where oid='app_private.sb_calendar_confirmed(text)'::regprocedure").fetchone()
    prior = cur.execute("select pg_get_functiondef('app_private.sb_calendar_confirmed(text)'::regprocedure)").fetchone()[0]
    cur.execute(MIGRATION.read_text(), prepare=False)
    assert cur.execute("select oid,proacl::text from pg_proc where oid='app_private.sb_calendar_confirmed(text)'::regprocedure").fetchone() == before
    copied = cur.execute("select pg_get_functiondef('app_private.calendar_confirmed_before_notices(text)'::regprocedure)").fetchone()[0]
    assert copied.replace('calendar_confirmed_before_notices', 'sb_calendar_confirmed') == prior
    # Ordinary sources remain pending but are isolated from this fixture's dispatch.
    cur.execute("update app_private.calendar_refresh_queue set state='idle'")
    yield connection, cur


def notice():
    day = date.today() + timedelta(days=7)
    token = f'{day:%B} {day.day}, {day.year}'
    quote = f'Synthetic dividend is payable on {token}.'
    text = f'Apple 😀 {quote}'
    raw = f'<title>Apple</title><p>😀 {quote}</p>'.encode()
    digest = hashlib.sha256(raw).hexdigest()
    text_digest = hashlib.sha256(text.encode()).hexdigest()
    key = 'notice-sec-0000320193-' + hashlib.sha256(URL.encode()).hexdigest()[:24]
    start = text.index(quote)
    value = {'schema': 'signalbrief.calendar.curated-notice.v1', 'adapter': 'curated-notice', 'complete': False,
             'source_key': key, 'source_url': URL, 'document_url': URL, 'company_id': COMPANY, 'provider': 'sec',
             'provider_company_id': '0000320193', 'ticker': 'AAPL', 'format': 'html', 'encoding': 'utf-8',
             'raw_sha256': digest, 'raw_bytes': len(raw), 'raw_object_key': f'calendar/{key}/originals/{digest}.html',
             'normalized_sha256': text_digest, 'normalized_object_key': f'calendar/{key}/normalized/{text_digest}.txt',
             'normalization': 'html-text-v1', 'extraction': 'deterministic-v1', 'fetched_at': datetime.now(timezone.utc).isoformat(),
             'published_on': None, 'publication_precision': 'unknown', 'publication_timezone': None,
             'issuer_quote': 'Apple', 'issuer_start': 0, 'issuer_end': 5,
             'entries': [{'key': 'synthetic-payment', 'title': 'Synthetic dividend payment', 'event_type': 'dividend_payment',
                          'occurs_on': str(day), 'date_token': token, 'quote': quote, 'quote_start': start,
                          'quote_end': start + len(quote), 'location': f'normalized-text[{start}:{start + len(quote)}]', 'timezone': None}]}
    return value, text, raw


def stage(cur, value, text, raw=None):
    manifest = json.dumps(value, ensure_ascii=False, separators=(',', ':'))
    key = cur.execute('select sb_calendar_notice_stage(%s,%s)', (manifest, text)).fetchone()[0]
    if raw is not None:
        for offset in range(0, len(raw), 64000):
            data = base64.b64encode(raw[offset:offset + 64000]).decode()
            assert cur.execute('select sb_calendar_notice_chunk(%s,%s,%s)', (key, offset // 64000, data)).fetchone()[0] == min(64000, len(raw) - offset)
    return key, manifest


def dispatch(cur, key):
    cur.execute("select sb_calendar_notice_worker_ready('curated-notice-v1')")
    cur.execute('update app_private.calendar_worker_control set ready=true')
    assert cur.execute('select sb_calendar_notice_dispatch(%s)', (key,)).fetchone()[0] == 1
    token = cur.execute('select token_hash from app_private.calendar_runs where source_key=%s and finished_at is null', (key,)).fetchone()[0]
    assert cur.execute('select sb_calendar_claim(%s)', (token,)).fetchone()[0]
    return token


def archive(cur, value, manifest):
    digest = hashlib.sha256(manifest.encode()).hexdigest()
    path = f'calendar/{value["source_key"]}/{digest}.json'
    for item in [path, value['raw_object_key'], value['normalized_object_key']]:
        cur.execute("insert into storage.objects(bucket_id,name) values('signalbrief-raw',%s)", (item,))
    return digest, path


def ingest(cur, key, token, manifest, values):
    return cur.execute('select sb_calendar_ingest_notice(%s,%s,%s,%s,%s)', (key, token, *values, manifest)).fetchone()[0]


def test_source_bound_notice_is_visible_idempotent_and_completed_retry_needs_no_original_chunks(notice_db):
    _, cur = notice_db
    value, text, raw = notice()
    key, manifest = stage(cur, value, text, raw)
    assert cur.execute('select count(*) from app_private.calendar_source_catalog where key=%s', (key,)).fetchone()[0] == 0
    token = dispatch(cur, key)
    payload = cur.execute('select sb_calendar_notice_payload(%s,%s)', (key, token)).fetchone()[0]
    assert base64.b64decode(payload['raw_base64']) == raw
    assert payload['normalized_text'] == text and payload['manifest_text'] == manifest
    values = archive(cur, value, manifest)
    assert ingest(cur, key, token, manifest, values) == 1
    identifier = cur.execute('select id from calendar_items where source_key=%s', (key,)).fetchone()[0]
    assert ingest(cur, key, token, manifest, values) == 1
    assert cur.execute('select id from calendar_items where source_key=%s', (key,)).fetchall() == [(identifier,)]
    assert cur.execute('select count(*) from app_private.calendar_notice_chunks where source_key=%s', (key,)).fetchone()[0] == 0
    assert cur.execute('select sb_calendar_notice_payload(%s,%s)', (key, token)).fetchone()[0] == {'completed': True, 'count': 1}
    assert cur.execute('select app_private.sb_calendar_confirmed(%s)', (identifier,)).fetchone()[0]
    cur.execute('SET LOCAL ROLE authenticated')
    assert cur.execute('select id from calendar_items where source_key=%s', (key,)).fetchall() == [(identifier,)]
    cur.execute('RESET ROLE')
    cur.execute('select sb_calendar_finish(%s,%s::jsonb)', (token, json.dumps([{'source': key, 'status': 'verified'}])))
    assert cur.execute('select sb_calendar_notice_dispatch(%s)', (key,)).fetchone()[0] == 0


@pytest.mark.parametrize('mutation', ['company', 'provider', 'source_url', 'document_url', 'raw_path', 'text_hash',
                                     'offset', 'quote', 'day', 'type', 'timezone', 'empty', 'duplicate', 'null_precision'])
def test_invalid_notice_cannot_register_a_source_or_publish(notice_db, mutation):
    import psycopg

    connection, cur = notice_db
    value, text, _ = notice()
    if mutation == 'company':
        value['company_id'] = 'another-issuer'
    elif mutation == 'provider':
        value['provider_company_id'] = '0000000999'
    elif mutation == 'source_url':
        value['source_url'] = 'https://www.apple.com.attacker.invalid/newsroom/fake/'
    elif mutation == 'document_url':
        value['document_url'] = 'https://127.0.0.1/metadata'
    elif mutation == 'raw_path':
        value['raw_object_key'] = 'other/data.html'
    elif mutation == 'text_hash':
        text += ' forged'
    elif mutation == 'offset':
        value['entries'][0]['quote_start'] += 1
    elif mutation == 'quote':
        value['entries'][0]['quote'] = 'Invented date'
    elif mutation == 'day':
        value['entries'][0]['occurs_on'] = str(date.today() + timedelta(days=8))
    elif mutation == 'type':
        value['entries'][0]['event_type'] = 'annual_meeting'
    elif mutation == 'timezone':
        value['entries'][0]['timezone'] = 'Asia/Seoul'
    elif mutation == 'empty':
        value['entries'] = []
    elif mutation == 'duplicate':
        value['entries'] *= 2
    elif mutation == 'null_precision':
        value['publication_precision'] = None
    with pytest.raises(psycopg.Error), connection.transaction():
        stage(cur, value, text)
    assert cur.execute("select count(*) from app_private.calendar_sources where adapter='curated-notice'").fetchone()[0] == 0


@pytest.mark.parametrize('mutation', ['absent', 'wrong_bytes', 'part_gap', 'conflicting_chunk'])
def test_original_chunks_are_bounded_complete_and_hash_verified_before_dispatch(notice_db, mutation):
    import psycopg

    connection, cur = notice_db
    value, text, raw = notice()
    key, _ = stage(cur, value, text)
    if mutation == 'conflicting_chunk':
        stage(cur, value, text, raw)
    with pytest.raises(psycopg.Error), connection.transaction():
        if mutation != 'absent':
            wrong = b'X' * len(raw)
            cur.execute('select sb_calendar_notice_chunk(%s,%s,%s)', (key, 1 if mutation == 'part_gap' else 0, base64.b64encode(wrong).decode()))
        dispatch(cur, key)
    assert cur.execute('select count(*) from app_private.calendar_runs where source_key=%s', (key,)).fetchone()[0] == 0


@pytest.mark.parametrize('mutation', ['unclaimed', 'expired', 'wrong_source', 'wrong_token', 'finished', 'missing_archive', 'manifest_hash'])
def test_task_authority_and_all_archives_are_required_for_ingest(notice_db, mutation):
    import psycopg

    connection, cur = notice_db
    value, text, raw = notice()
    key, manifest = stage(cur, value, text, raw)
    token = dispatch(cur, key)
    values = archive(cur, value, manifest)
    if mutation == 'unclaimed':
        cur.execute('update app_private.calendar_runs set claimed_at=NULL where token_hash=%s', (token,))
    elif mutation == 'expired':
        cur.execute("update app_private.calendar_runs set expires_at=now()-interval '1 second' where token_hash=%s", (token,))
    elif mutation == 'wrong_source':
        key = 'microsoft-ir'
    elif mutation == 'wrong_token':
        token = '0' * 64
    elif mutation == 'finished':
        cur.execute('update app_private.calendar_runs set finished_at=now() where token_hash=%s', (token,))
    elif mutation == 'missing_archive':
        cur.execute('delete from storage.objects where name=%s', (value['raw_object_key'],))
    else:
        values = ('0' * 64, values[1])
    with pytest.raises(psycopg.Error), connection.transaction():
        ingest(cur, key, token, manifest, values)
    assert cur.execute("select count(*) from calendar_items where source_key like 'notice-%'").fetchone()[0] == 0
    assert cur.execute('select count(*) from app_private.calendar_notice_chunks').fetchone()[0] == 1


def test_stage_revisions_do_not_silently_overwrite_existing_identity_or_data(notice_db):
    import psycopg

    connection, cur = notice_db
    value, text, raw = notice()
    key, manifest = stage(cur, value, text, raw)
    assert stage(cur, value, text, raw)[0] == key
    changed = copy.deepcopy(value)
    changed['entries'][0]['title'] = 'Different title'
    with pytest.raises(psycopg.Error, match='notice_revision_requires_review'), connection.transaction():
        stage(cur, changed, text)
    assert cur.execute('select manifest_text from app_private.calendar_notice_staging where source_key=%s', (key,)).fetchone()[0] == manifest
    cur.execute('update app_private.calendar_sources set enabled=false where key=%s', (key,))
    with pytest.raises(psycopg.Error, match='calendar_source_conflict'), connection.transaction():
        stage(cur, value, text)


def test_worker_readiness_is_explicit_and_all_public_rpcs_are_service_only(notice_db):
    import psycopg

    connection, cur = notice_db
    value, text, raw = notice()
    key, _ = stage(cur, value, text, raw)
    with pytest.raises(psycopg.Error, match='notice_worker_not_ready'), connection.transaction():
        cur.execute('select sb_calendar_notice_dispatch(%s)', (key,))
    signatures = ['sb_calendar_notice_stage(text,text)', 'sb_calendar_notice_chunk(text,integer,text)',
                  'sb_calendar_notice_dispatch(text)', 'sb_calendar_notice_payload(text,text)',
                  'sb_calendar_ingest_notice(text,text,text,text,text)', 'sb_calendar_notice_worker_ready(text)']
    for signature in signatures:
        for role in ('anon', 'authenticated'):
            assert not cur.execute('select has_function_privilege(%s,%s,%s)', (role, 'public.' + signature, 'execute')).fetchone()[0]
        assert cur.execute('select has_function_privilege(%s,%s,%s)', ('service_role', 'public.' + signature, 'execute')).fetchone()[0]
    for table in ('calendar_notice_staging', 'calendar_notice_chunks', 'calendar_notice_authorities'):
        for role in ('anon', 'authenticated', 'service_role'):
            assert not cur.execute('select has_table_privilege(%s,%s,%s)', (role, 'app_private.' + table, 'select')).fetchone()[0]
    for role in ('anon', 'authenticated', 'service_role'):
        assert not cur.execute("select has_function_privilege(%s,'app_private.calendar_confirmed_before_notices(text)','execute')", (role,)).fetchone()[0]


@pytest.mark.parametrize('token,year,month,result', [('2026-02-30', None, None, None), ('November 31, 2026', None, None, None),
    ('11월 16', None, None, None), ('11월 16', 2026, None, '2026-11-16'), ('17일', 2026, 11, '2026-11-17'),
    ('2026년 11월 06일', None, None, '2026-11-06'), ('Nov. 13, 2026', None, None, '2026-11-13'),
    ('11/15/26', None, None, '2026-11-15'), ('December 1', 2026, None, '2026-12-01')])
def test_postgres_independently_parses_only_explicit_date_tokens(notice_db, token, year, month, result):
    _, cur = notice_db
    assert cur.execute('select app_private.calendar_notice_date(%s,%s,%s)::text', (token, year, month)).fetchone()[0] == result


@pytest.mark.parametrize('column,value', [('title', 'tampered'), ('occurs_on', '2026-01-01'), ('quote', 'invented'), ('source_location', 'wrong'), ('source_url', 'https://attacker.invalid/')])
def test_new_visibility_cannot_be_bypassed_using_the_old_non_dart_branch(notice_db, column, value):
    from psycopg import sql

    _, cur = notice_db
    m, text, raw = notice()
    key, manifest = stage(cur, m, text, raw)
    token = dispatch(cur, key)
    ingest(cur, key, token, manifest, archive(cur, m, manifest))
    identifier = cur.execute('select id from calendar_items where source_key=%s', (key,)).fetchone()[0]
    cur.execute(sql.SQL('update calendar_items set {}=%s where id=%s').format(sql.Identifier(column)), (value, identifier))
    assert not cur.execute('select app_private.sb_calendar_confirmed(%s)', (identifier,)).fetchone()[0]
    cur.execute('SET LOCAL ROLE authenticated')
    assert cur.execute('select id from calendar_items where id=%s', (identifier,)).fetchall() == []
    cur.execute('RESET ROLE')


@pytest.mark.parametrize('mutation', ['none_html', 'none_dart4', 'wrong_company', 'wrong_receipt', 'wrong_dtd', 'wrong_encoding', 'missing_list_archive', 'wrong_publication'])
def test_dart_notice_requires_the_existing_company_bound_receipt_and_exact_viewer_contract(notice_db, mutation):
    import psycopg

    connection, cur = notice_db
    value, text, _ = notice()
    company = '10000000-0000-4000-8000-000000000082'
    receipt = date.today().strftime('%Y%m%d') + '800123'
    url = 'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=' + receipt
    key = 'notice-dart-00999981-' + hashlib.sha256(url.encode()).hexdigest()[:24]
    value.update(company_id=company, provider='dart', provider_company_id='00999981', ticker='099981',
                 source_url=url, source_key=key, encoding='utf-8', published_on=str(date.today()),
                 publication_precision='date', publication_timezone='Asia/Seoul',
                 document_url=f'https://dart.fss.or.kr/report/viewer.do?rcpNo={receipt}&dcmNo=123&eleId=0&offset=0&length=0&dtd=HTML')
    value['raw_object_key'] = f'calendar/{key}/originals/{value["raw_sha256"]}.html'
    value['normalized_object_key'] = f'calendar/{key}/normalized/{value["normalized_sha256"]}.txt'
    cur.execute("""insert into companies(id,name,ticker,market,provider,provider_company_id,is_demo,created_at)
        values(%s,'Synthetic Korean issuer','099981','KOSPI','dart','00999981',false,now())""", (company,))
    list_path = 'dart/lists/' + 'b' * 64 + '.json'
    cur.execute("""insert into dart_filings(company_id,receipt,source_url,title,filing_date,source_sha256,source_object_key)
        values(%s,%s,%s,'Synthetic notice',%s,%s,%s)""", (company, receipt, url, date.today(), 'b' * 64, list_path))
    if mutation != 'missing_list_archive':
        cur.execute("insert into storage.objects(bucket_id,name) values('signalbrief-raw',%s)", (list_path,))
    if mutation in ('none_dart4', 'wrong_encoding'):
        value['document_url'] = value['document_url'].replace('dtd=HTML', 'dtd=dart4.xsd')
    if mutation == 'wrong_company':
        cur.execute('update dart_filings set company_id=%s where receipt=%s', (COMPANY, receipt))
    elif mutation == 'wrong_receipt':
        value['document_url'] = value['document_url'].replace(receipt, '20000101800123')
    elif mutation == 'wrong_dtd':
        value['document_url'] = value['document_url'].replace('dtd=HTML', 'dtd=unreviewed.xsd')
    elif mutation == 'wrong_encoding':
        value['encoding'] = 'euc-kr'
    elif mutation == 'wrong_publication':
        value['published_on'] = str(date.today() - timedelta(days=1))
    if mutation.startswith('none'):
        assert stage(cur, value, text)[0] == key
    else:
        with pytest.raises(psycopg.Error, match='invalid_notice_dart_binding'), connection.transaction():
            stage(cur, value, text)


def test_partial_date_requires_explicit_source_year_and_compressed_range_is_verified(notice_db):
    import psycopg

    connection, cur = notice_db
    value, _, _ = notice()
    first = date.today() + timedelta(days=7)
    last = first + timedelta(days=1)
    # Avoid crossing a month in this compressed same-month fixture.
    if last.month != first.month:
        first += timedelta(days=2)
        last = first + timedelta(days=1)
    context = f'Conference {first.year}'
    start_token, end_token = f'{first.month}월 {first.day}', f'{last.day}일'
    quote = f'Synthetic conference {start_token}~{end_token}'
    text = 'Apple ' + context + ' ' + quote
    digest = hashlib.sha256(text.encode()).hexdigest()
    value.update(normalized_sha256=digest, normalized_object_key=f'calendar/{value["source_key"]}/normalized/{digest}.txt')
    entry = value['entries'][0]
    entry.update(event_type='conference', title=f'Synthetic conference · {first}–{last}', occurs_on=str(first), ends_on=str(last),
                 quote=quote, quote_start=text.index(quote), quote_end=len(text), location=f'normalized-text[{text.index(quote)}:{len(text)}]',
                 date_token=start_token, end_date_token=end_token)
    with pytest.raises(psycopg.Error, match='invalid_notice_event_date'), connection.transaction():
        stage(cur, value, text)
    entry.update(year_context_quote=context, year_context_token=str(first.year), year_context_start=6, year_context_end=6 + len(context))
    assert stage(cur, value, text)[0] == value['source_key']
    changed = copy.deepcopy(value)
    changed['entries'][0]['ends_on'] = str(last + timedelta(days=1))
    with pytest.raises(psycopg.Error, match='invalid_notice_event_range'), connection.transaction():
        stage(cur, changed, text)
