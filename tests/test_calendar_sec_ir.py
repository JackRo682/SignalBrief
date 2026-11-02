"""Synthetic SEC-filed IR discovery manifests, safe onboarding and authenticated visibility."""
import copy
import hashlib
import json
from datetime import date, timedelta

import pytest
from test_calendar_onboarding import ROOT, add_dart, dart_manifest, finish, nvidia_manifest, ready
from test_calendar_onboarding import calendar_db as calendar_db
from test_calendar_onboarding import ingest as ingest_q4
from test_calendar_onboarding import onboard_db as onboard_db
from test_micron_calendar_ingestion import snapshot

pytestmark = pytest.mark.postgres
MIGRATION = ROOT / 'supabase/migrations/20261102020437_calendar_sec_ir_discovery.sql'
COMPANY = '10000000-0000-4000-8000-000000000096'
CIK = '0000000996'
SOURCE = f'sec-ir-{CIK}'
IR = 'https://investors.synthetic-corp.com/'
SUBMISSIONS = f'https://data.sec.gov/submissions/CIK{CIK}.json'


def add_company(cur, cid=COMPANY, cik=CIK, ticker='SYN', demo=False):
    cur.execute("""insert into companies(id,name,ticker,market,provider,provider_company_id,is_demo,created_at)
        values(%s,'Synthetic official issuer',%s,'NASDAQ','sec',%s,%s,now())""", (cid, ticker, cik, demo))


@pytest.fixture
def sec_ir_db(onboard_db):
    connection, cur = onboard_db
    add_company(cur)
    cur.execute(MIGRATION.read_text(), prepare=False)
    yield connection, cur


def manifest(q4=False, filed=False):
    day = (date.today() + timedelta(days=7)).isoformat()
    source_url = f'https://www.sec.gov/edgar/browse/?CIK={CIK}'
    documents = [{'role': 'submissions', 'url': SUBMISSIONS, 'raw_sha256': 'a' * 64,
                  'object_key': f'calendar/{SOURCE}/discovery/{"a" * 64}.json'}]
    binding = {'url': IR, 'document_url': SUBMISSIONS, 'quote': IR, 'location': 'submissions.investorWebsite'}
    if filed:
        accession = f'{CIK}-{str(date.today().year)[-2:]}-000001'
        primary = f'https://www.sec.gov/Archives/edgar/data/{int(CIK)}/{accession.replace("-", "")}/report.htm'
        exhibit = primary.replace('report.htm', 'earnings.htm')
        for role, url, parent, sha in [('primary', primary, SUBMISSIONS, 'c' * 64), ('exhibit', exhibit, primary, 'd' * 64)]:
            documents.append({'role': role, 'url': url, 'parent_url': parent, 'accession': accession,
                              'filing_date': date.today().isoformat(), 'raw_sha256': sha,
                              'object_key': f'calendar/{SOURCE}/discovery/{sha}.html'})
        binding.update(document_url=exhibit, quote=f'Investor Relations | {IR}', location='anchor/explicit-investor-relations-url')
    documents.append({'role': 'ir', 'url': IR, 'parent_url': binding['document_url'], 'raw_sha256': 'b' * 64,
                      'object_key': f'calendar/{SOURCE}/discovery/{"b" * 64}.html'})
    entry = {'key': f'quarter:{date.today().year}:Q3', 'title': 'Synthetic earnings call', 'occurs_on': day,
             'quote': f'Synthetic earnings call {day}', 'timezone': None, 'location': 'tables[0].rows[1].earnings-date',
             'source_url': IR, 'raw_sha256': 'b' * 64}
    result = {'schema': 'signalbrief.calendar.sec-ir.v1', 'adapter': 'sec-ir', 'source_key': SOURCE,
              'source_url': source_url, 'company_id': COMPANY, 'provider': 'sec', 'provider_company_id': CIK,
              'ticker': 'SYN', 'complete': True, 'window': snapshot()['window'], 'documents': documents,
              'issuer_name': 'Synthetic official issuer, Inc.', 'issuer_evidence': [{
                  'source_url': IR, 'raw_sha256': 'b' * 64, 'label': 'Synthetic Official Issuer - Investor Relations', 'location': 'title[0]'}],
              'binding': binding, 'event_source_url': IR, 'format': 'structured-html', 'entries': [entry]}
    if q4:
        nested = snapshot()
        nested.update(source_key=SOURCE, source_url=IR, adapter='q4-events', company_id=COMPANY,
                      provider='sec', provider_company_id=CIK, ticker='SYN', tag_policy='official-events')
        for page in nested['pages']:
            page['url'] = page['url'].replace('https://investors.micron.com', IR.rstrip('/'))
            page['object_key'] = page['object_key'].replace('micron-ir', SOURCE)
        digest = hashlib.sha256(json.dumps(nested, separators=(',', ':')).encode()).hexdigest()
        result.update(format='q4', q4=nested, q4_manifest={'raw_sha256': digest, 'object_key': f'calendar/{SOURCE}/{digest}.json'})
        result['entries'] = [{**nested['entries'][0], 'key': 'q4:' + nested['entries'][0]['key'],
                              'source_url': IR, 'raw_sha256': nested['pages'][0]['raw_sha256']}]
    return result


def archived(cur, value, missing=None):
    raw = json.dumps(value, separators=(',', ':'))
    digest = hashlib.sha256(raw.encode()).hexdigest()
    path = f'calendar/{SOURCE}/{digest}.json'
    names = [path, *(d['object_key'] for d in value['documents'])]
    if value.get('q4'):
        names += [value['q4_manifest']['object_key'], *(p['object_key'] for p in value['q4']['pages'])]
    for name in names:
        if name != missing:
            cur.execute("insert into storage.objects(bucket_id,name) values('signalbrief-raw',%s)", (name,))
    return SOURCE, digest, path, raw


def ingest(cur, value, missing=None):
    return cur.execute('select sb_calendar_ingest_sec_ir(%s,%s,%s,%s)', archived(cur, value, missing)).fetchone()[0]


def test_canonical_existing_and_new_issuers_queue_without_static_name_list_or_early_dispatch(sec_ir_db):
    _, cur = sec_ir_db
    assert cur.execute('select count(*) from net.requests').fetchone()[0] == 0
    assert cur.execute('select adapter,company_id,provider_company_id from app_private.calendar_sources where key=%s', (SOURCE,)).fetchone() == ('sec-ir', COMPANY, CIK)
    assert cur.execute('select state from app_private.calendar_refresh_queue where source_key=%s', (SOURCE,)).fetchone()[0] == 'pending'
    ready(cur)
    assert cur.execute('select count(*) from app_private.calendar_runs where source_key=%s', (SOURCE,)).fetchone()[0] == 0
    for key in ['micron-ir', 'nvidia-ir']:
        finish(cur, key)
    assert cur.execute('select count(*) from app_private.calendar_runs where source_key=%s', (SOURCE,)).fetchone()[0] == 0
    assert cur.execute("select sb_calendar_sec_ir_ready('sec-ir-v1')").fetchone()[0] == 1
    assert cur.execute('select state from app_private.calendar_refresh_queue where source_key=%s', (SOURCE,)).fetchone()[0] == 'running'
    add_company(cur, '10000000-0000-4000-8000-000000000097', '0000000997', 'ARBITRARY')
    assert cur.execute("select state from app_private.calendar_refresh_queue where source_key='sec-ir-0000000997'").fetchone()[0] == 'running'
    cur.execute('select sb_calendar_request_company(%s)', (COMPANY,))
    assert cur.execute('select count(*) from app_private.calendar_runs where source_key=%s', (SOURCE,)).fetchone()[0] == 1


def test_empty_database_replays_and_preserves_catalog_priority(onboard_db):
    _, cur = onboard_db
    cur.execute(MIGRATION.read_text(), prepare=False)
    assert cur.execute("select count(*) from app_private.calendar_sources where adapter='sec-ir'").fetchone()[0] == 0
    add_company(cur)
    assert cur.execute('select company_id from app_private.calendar_sources where key=%s', (SOURCE,)).fetchone()[0] == COMPANY
    assert cur.execute("select count(*) from app_private.calendar_sources where company_id in (select id from companies where ticker in ('MU','NVDA')) and adapter='sec-ir'").fetchone()[0] == 0


def test_disabled_and_conflicting_sources_do_not_get_overwritten(sec_ir_db):
    import psycopg
    connection, cur = sec_ir_db
    cur.execute('update app_private.calendar_sources set enabled=false where key=%s', (SOURCE,))
    cur.execute('select sb_calendar_request_company(%s)', (COMPANY,))
    assert not cur.execute('select enabled from app_private.calendar_sources where key=%s', (SOURCE,)).fetchone()[0]
    cur.execute("update app_private.calendar_sources set provider_company_id='0000000997' where key=%s", (SOURCE,))
    with pytest.raises(psycopg.Error, match='calendar_source_conflict'), connection.transaction():
        cur.execute('select sb_calendar_request_company(%s)', (COMPANY,))


def test_ingestion_and_readiness_are_service_only_and_archive_is_private(sec_ir_db):
    import psycopg
    connection, cur = sec_ir_db
    for signature in ['sb_calendar_sec_ir_ready(text)', 'sb_calendar_ingest_sec_ir(text,text,text,text)']:
        for role in ['anon', 'authenticated']:
            assert not cur.execute("select has_function_privilege(%s,%s,'execute')", (role, 'public.' + signature)).fetchone()[0]
        assert cur.execute("select has_function_privilege('service_role',%s,'execute')", ('public.' + signature,)).fetchone()[0]
    args = archived(cur, manifest())
    cur.execute('SET LOCAL ROLE service_role')
    assert cur.execute('select sb_calendar_ingest_sec_ir(%s,%s,%s,%s)', args).fetchone()[0] == 1
    cur.execute('RESET ROLE')
    cur.execute('SET LOCAL ROLE authenticated')
    assert cur.execute('select count(*) from calendar_items').fetchone()[0] == 1
    assert cur.execute('select count(*) from storage.objects').fetchone()[0] == 0
    with pytest.raises(psycopg.Error), connection.transaction():
        cur.execute('select * from app_private.calendar_snapshots')


@pytest.mark.parametrize('q4,filed', [(False, False), (False, True), (True, True)])
def test_idempotent_exact_provenance_and_existing_calendar_visibility(sec_ir_db, q4, filed):
    _, cur = sec_ir_db
    value = manifest(q4, filed)
    assert ingest(cur, value) == 1
    before = cur.execute('select id from calendar_items where source_key=%s', (SOURCE,)).fetchone()[0]
    assert ingest(cur, value) == 1
    row = cur.execute('select id,company_id,source_url,occurs_on::text,quote from calendar_items where source_key=%s', (SOURCE,)).fetchone()
    assert row == (before, COMPANY, IR, value['entries'][0]['occurs_on'], value['entries'][0]['quote'])
    assert cur.execute('select app_private.sb_calendar_confirmed(%s)', (before,)).fetchone()[0]
    assert ingest_q4(cur, nvidia_manifest()) == 1
    assert cur.execute("select app_private.sb_calendar_confirmed(id) from calendar_items where source_key='nvidia-ir'").fetchone()[0]
    assert cur.execute('select count(*) from app_private.calendar_snapshots where source_key=%s', (SOURCE,)).fetchone()[0] == 1


def test_pending_discovery_is_not_claimed_as_verified_coverage(sec_ir_db):
    _, cur = sec_ir_db
    actor = '10000000-0000-4000-8000-000000000099'
    cur.execute("insert into auth.users(id,email,raw_user_meta_data) values(%s,'synthetic@example.invalid','{}')", (actor,))
    cur.execute("select set_config('request.jwt.claim.sub',%s,true)", (actor,))
    before = cur.execute('select app_content_private.calendar_coverage(%s)', (COMPANY,)).fetchone()[0]
    assert before['selected']['source_count'] == 0 and before['selected']['pending']
    assert COMPANY in before['pending_company_ids']
    ingest(cur, manifest())
    after = cur.execute('select app_content_private.calendar_coverage(%s)', (COMPANY,)).fetchone()[0]
    assert after['selected']['source_count'] == 1 and after['selected']['last_success_at']


def test_existing_dart_receipt_visibility_remains_provenance_bound_after_extension(sec_ir_db):
    _, cur = sec_ir_db
    key = add_dart(cur)
    assert ingest_q4(cur, dart_manifest(), kind='dart_ir') == 1
    item_id = cur.execute('select id from calendar_items where source_key=%s', (key,)).fetchone()[0]
    assert cur.execute('select app_private.sb_calendar_confirmed(%s)', (item_id,)).fetchone()[0]
    cur.execute("update calendar_items set source_url='https://dart.fss.or.kr/' where id=%s", (item_id,))
    assert not cur.execute('select app_private.sb_calendar_confirmed(%s)', (item_id,)).fetchone()[0]


@pytest.mark.parametrize('mutation', ['cik', 'company', 'binding_host', 'filing_parent', 'filing_cik', 'future_filing',
                                     'source_url', 'missing_ir', 'entry_hash', 'entry_date', 'entry_timezone', 'entry_location',
                                     'counterparty', 'missing_identity', 'identity_hash', 'identity_location'])
def test_invalid_provenance_rejects_atomically_and_preserves_existing_event(sec_ir_db, mutation):
    import psycopg
    connection, cur = sec_ir_db
    value = manifest(filed=True)
    ingest(cur, value)
    changed = copy.deepcopy(value)
    if mutation == 'cik':
        changed['provider_company_id'] = '0000000997'
    elif mutation == 'company':
        changed['company_id'] = '10000000-0000-4000-8000-000000000097'
    elif mutation == 'binding_host':
        changed['binding']['url'] = 'https://private.invalid/'
    elif mutation == 'filing_parent':
        changed['documents'][2]['parent_url'] = 'https://www.sec.gov/unrelated'
    elif mutation == 'filing_cik':
        changed['documents'][1]['url'] = changed['documents'][1]['url'].replace('/996/', '/997/')
    elif mutation == 'future_filing':
        changed['documents'][1]['filing_date'] = (date.today() + timedelta(days=1)).isoformat()
    elif mutation == 'source_url':
        changed['entries'][0]['source_url'] = changed['source_url']
    elif mutation == 'missing_ir':
        changed['documents'] = changed['documents'][:-1]
    elif mutation == 'entry_hash':
        changed['entries'][0]['raw_sha256'] = 'f' * 64
    elif mutation == 'entry_date':
        changed['entries'][0]['occurs_on'] = (date.today() - timedelta(days=100)).isoformat()
    elif mutation == 'entry_timezone':
        changed['entries'][0]['timezone'] = 'America/New_York'
    elif mutation == 'counterparty':
        changed['issuer_evidence'][0]['label'] = 'Counterparty Corporation - Investor Relations'
    elif mutation == 'missing_identity':
        changed['issuer_evidence'] = []
    elif mutation == 'identity_hash':
        changed['issuer_evidence'][0]['raw_sha256'] = 'f' * 64
    elif mutation == 'identity_location':
        changed['issuer_evidence'][0]['location'] = 'ticker-substring-in-body'
    else:
        changed['entries'][0]['location'] = 'inferred-date'
    with pytest.raises(psycopg.Error), connection.transaction():
        ingest(cur, changed)
    assert cur.execute('select count(*) from calendar_items where source_key=%s', (SOURCE,)).fetchone()[0] == 1
    assert cur.execute('select app_private.sb_calendar_confirmed(id) from calendar_items where source_key=%s', (SOURCE,)).fetchone()[0]


@pytest.mark.parametrize('missing', ['submissions', 'primary', 'exhibit', 'ir', 'q4_page', 'q4_manifest', 'outer'])
def test_missing_original_or_manifest_cannot_ingest(sec_ir_db, missing):
    import psycopg
    connection, cur = sec_ir_db
    value = manifest(q4=True, filed=True)
    if missing in ['submissions', 'primary', 'exhibit', 'ir']:
        path = next(d['object_key'] for d in value['documents'] if d['role'] == missing)
    elif missing == 'q4_page':
        path = value['q4']['pages'][0]['object_key']
    elif missing == 'q4_manifest':
        path = value['q4_manifest']['object_key']
    else:
        digest = hashlib.sha256(json.dumps(value, separators=(',', ':')).encode()).hexdigest()
        path = f'calendar/{SOURCE}/{digest}.json'
    with pytest.raises(psycopg.Error), connection.transaction():
        ingest(cur, value, path)
    assert cur.execute('select count(*) from calendar_items where source_key=%s', (SOURCE,)).fetchone()[0] == 0


@pytest.mark.parametrize('field,value', [('source_url', 'https://www.sec.gov/'), ('occurs_on', '2001-01-01'),
                                       ('quote', 'Invented fact'), ('source_location', 'unknown'), ('title', 'Wrong title')])
def test_tampered_public_projection_is_not_visible(sec_ir_db, field, value):
    _, cur = sec_ir_db
    ingest(cur, manifest())
    cur.execute(f'update calendar_items set {field}=%s where source_key=%s', (value, SOURCE))
    assert not cur.execute('select app_private.sb_calendar_confirmed(id) from calendar_items where source_key=%s', (SOURCE,)).fetchone()[0]


def test_verified_empty_selection_does_not_infer_cancellation_and_origin_changes_require_review(sec_ir_db):
    import psycopg
    connection, cur = sec_ir_db
    value = manifest()
    ingest(cur, value)
    before = cur.execute('select id from calendar_items where source_key=%s', (SOURCE,)).fetchone()[0]
    value['entries'] = []
    assert ingest(cur, value) == 0
    assert cur.execute('select app_private.sb_calendar_confirmed(%s)', (before,)).fetchone()[0]
    with pytest.raises(psycopg.Error, match='calendar_source_change_requires_review'), connection.transaction():
        ingest(cur, manifest(q4=True))


@pytest.mark.parametrize('mutation', ['short_nonfinal', 'missing_tail', 'wrong_host', 'wrong_policy', 'wrong_entry_page'])
def test_partial_or_unbound_q4_manifest_is_rejected(sec_ir_db, mutation):
    import psycopg
    connection, cur = sec_ir_db
    value = manifest(q4=True)
    if mutation == 'short_nonfinal':
        tail = copy.deepcopy(value['q4']['pages'][-1])
        value['q4']['pages'][-1]['count'] = 1
        tail['page_number'] = 2
        tail['url'] = tail['url'].replace('pageNumber=1', 'pageNumber=2')
        value['q4']['pages'].append(tail)
    elif mutation == 'missing_tail':
        value['q4']['pages'].pop()
    elif mutation == 'wrong_host':
        value['q4']['pages'][0]['url'] = value['q4']['pages'][0]['url'].replace('synthetic-corp.com', 'foreign-corp.com')
    elif mutation == 'wrong_policy':
        value['q4']['tag_policy'] = 'webcast'
    else:
        value['entries'][0]['raw_sha256'] = value['q4']['pages'][-1]['raw_sha256']
    with pytest.raises(psycopg.Error), connection.transaction():
        ingest(cur, value)
