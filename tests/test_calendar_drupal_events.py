"""Independent partial Drupal event-list provenance and saved-identity regressions."""
import copy
import hashlib
import json
from datetime import date, timedelta

import pytest
from test_calendar_sec_filing import OTHER, OWNER, ROOT, filing_manifest, rows
from test_calendar_sec_filing import calendar_db as calendar_db
from test_calendar_sec_filing import filing_db as filing_db
from test_calendar_sec_filing import ingest as ingest_filing
from test_calendar_sec_filing import onboard_db as onboard_db
from test_calendar_sec_filing import saved_filing_db as saved_filing_db
from test_calendar_sec_filing import sec_ir_db as sec_ir_db
from test_calendar_sec_ir import COMPANY, IR, SOURCE, SUBMISSIONS, manifest
from test_calendar_sec_ir import ingest as ingest_ir

pytestmark = pytest.mark.postgres
MIGRATION = ROOT / 'supabase/migrations/20261102054530_calendar_drupal_event_lists.sql'
LOCK = ROOT / 'supabase/migrations/20261102052159_calendar_sec_filing_ingest_lock.sql'
LABELS = ROOT / 'supabase/migrations/20261102051058_calendar_ir_navigation_labels.sql'


def apply_extension(cur):
    cur.execute(LABELS.read_text(), prepare=False)
    cur.execute(LOCK.read_text(), prepare=False)
    cur.execute(MIGRATION.read_text(), prepare=False)


@pytest.fixture
def drupal_db(filing_db):
    connection, cur = filing_db
    apply_extension(cur)
    yield connection, cur


@pytest.fixture
def saved_drupal_db(saved_filing_db):
    connection, cur = saved_filing_db
    apply_extension(cur)
    yield connection, cur


def bind_normalized(value):
    evidence = value['drupal']
    digest = hashlib.sha256(evidence['normalized_text'].encode()).hexdigest()
    evidence['normalized_sha256'] = digest
    evidence['normalized_object_key'] = f'calendar/{SOURCE}/normalized/{digest}.txt'


def drupal_manifest(*, offset=7, slug='synthetic-results', at_root=False, title='Synthetic earnings webcast'):
    """Synthetic archived HTML metadata with an exact visible local date, not a UTC inference."""
    value = manifest(filed=True)
    selected_url = IR if at_root else IR + 'events-and-presentations'
    selected_sha = 'b' * 64 if at_root else 'e' * 64
    if not at_root:
        value['documents'].append({'role': 'events', 'url': selected_url, 'parent_url': IR,
                                   'raw_sha256': selected_sha,
                                   'object_key': f'calendar/{SOURCE}/discovery/{selected_sha}.html'})
        value['issuer_evidence'].append({'source_url': selected_url, 'raw_sha256': selected_sha,
                                        'label': 'Synthetic Official Issuer - Events and Presentations',
                                        'location': 'title[0]'})
    occurrence = date.today() + timedelta(days=offset)
    date_text = f'{occurrence:%B} {occurrence.day}, {occurrence.year}'
    source_date = date_text + ' 4:30 PM PST'
    quote = title + ' ' + source_date
    history = 'Synthetic 📊 historical webcast January 15, 2000 4:30 PM PST'
    start = len(history) + 1
    event_path = '/events/event-details/' + slug
    entry = {'key': 'event:' + event_path, 'title': title, 'occurs_on': occurrence.isoformat(),
             'quote': quote, 'timezone': None,
             'location': f'drupal-list.articles[1].normalized-text[{start}:{start + len(quote)}]',
             'source_url': selected_url, 'raw_sha256': selected_sha, 'event_url': IR.rstrip('/') + event_path,
             'source_date': source_date, 'date_text': date_text, 'quote_start': start, 'quote_end': start + len(quote)}
    value.update(format='drupal-list', complete=False, coverage='published-event-list',
                 event_source_url=selected_url, entries=[entry],
                 drupal={'source_url': selected_url, 'raw_sha256': selected_sha,
                         'normalization': 'drupal-event-articles-text-v1',
                         'normalized_text': history + '\n' + quote, 'row_count': 2, 'pagination_detected': True})
    bind_normalized(value)
    return value


def archived(cur, value, missing=None):
    raw = json.dumps(value, separators=(',', ':'))
    digest = hashlib.sha256(raw.encode()).hexdigest()
    path = f'calendar/{SOURCE}/{digest}.json'
    paths = [path, *(document['object_key'] for document in value['documents']), value['drupal']['normalized_object_key']]
    for name in paths:
        if name != missing:
            cur.execute("insert into storage.objects(bucket_id,name) values('signalbrief-raw',%s)", (name,))
    return SOURCE, digest, path, raw


def ingest(cur, value, missing=None):
    return cur.execute('select sb_calendar_ingest_sec_ir(%s,%s,%s,%s)', archived(cur, value, missing)).fetchone()[0]


@pytest.mark.parametrize('at_root,offset', [(False, 7), (True, -7)])
def test_archived_list_is_idempotent_partial_and_binds_the_list_not_unfetched_detail(drupal_db, at_root, offset):
    _, cur = drupal_db
    value = drupal_manifest(at_root=at_root, offset=offset)
    assert ingest(cur, value) == 1
    before = rows(cur)
    assert ingest(cur, value) == 1 and rows(cur) == before
    item = before[0]
    assert item[1:6] == (COMPANY, value['entries'][0]['key'], value['entries'][0]['occurs_on'],
                        value['drupal']['source_url'], value['entries'][0]['quote'])
    assert item[4] != value['entries'][0]['event_url']
    assert all(document['url'] != value['entries'][0]['event_url'] for document in value['documents'])
    assert cur.execute('select source_timezone from calendar_items where id=%s', (item[0],)).fetchone()[0] is None
    assert cur.execute('select app_private.sb_calendar_confirmed(%s)', (item[0],)).fetchone()[0]
    assert cur.execute('select provenance from app_private.calendar_snapshots where id=%s', (item[6],)).fetchone()[0] == value
    assert cur.execute('select count(*) from app_private.calendar_snapshots where source_key=%s', (SOURCE,)).fetchone()[0] == 1
    cur.execute('SET LOCAL ROLE authenticated')
    assert cur.execute('select id from calendar_items where source_key=%s', (SOURCE,)).fetchall() == [(item[0],)]
    assert cur.execute('select count(*) from storage.objects').fetchone()[0] == 0


@pytest.mark.parametrize('missing', ['submissions', 'primary', 'exhibit', 'ir', 'events', 'normalized', 'manifest'])
def test_every_original_normalized_list_and_manifest_must_be_archived(drupal_db, missing):
    import psycopg
    connection, cur = drupal_db
    value = drupal_manifest()
    if missing == 'normalized':
        path = value['drupal']['normalized_object_key']
    elif missing == 'manifest':
        digest = hashlib.sha256(json.dumps(value, separators=(',', ':')).encode()).hexdigest()
        path = f'calendar/{SOURCE}/{digest}.json'
    else:
        path = next(document['object_key'] for document in value['documents'] if document['role'] == missing)
    with pytest.raises(psycopg.Error), connection.transaction():
        ingest(cur, value, missing=path)
    assert rows(cur) == []
    assert cur.execute('select count(*) from app_private.calendar_snapshots where source_key=%s', (SOURCE,)).fetchone()[0] == 0


@pytest.mark.parametrize('mutation', [
    'complete', 'coverage', 'company', 'cik', 'ticker', 'source', 'foreign_filing', 'filing_parent',
    'counterparty', 'identity_hash', 'identity_missing', 'normalized_hash', 'normalization', 'normalized_path',
    'quote_offset', 'byte_offset', 'article_index', 'quote', 'title', 'date', 'date_text', 'source_date',
    'date_without_year', 'invalid_day', 'cancelled',
    'event_host', 'event_path', 'event_query', 'event_fragment', 'event_credentials',
    'timezone', 'location', 'source_hash', 'detail_as_source', 'row_count', 'pagination_type', 'duplicate',
])
def test_invalid_evidence_rejects_the_whole_snapshot_without_changing_prior_events(drupal_db, mutation):
    import psycopg
    connection, cur = drupal_db
    value = drupal_manifest()
    assert ingest(cur, value) == 1
    before = rows(cur)
    changed = copy.deepcopy(value)
    entry, evidence = changed['entries'][0], changed['drupal']
    if mutation == 'complete':
        changed['complete'] = True
    elif mutation == 'coverage':
        changed['coverage'] = 'complete-official-calendar'
    elif mutation == 'company':
        changed['company_id'] = '10000000-0000-4000-8000-000000000097'
    elif mutation == 'cik':
        changed['provider_company_id'] = '0000000997'
    elif mutation == 'ticker':
        changed['ticker'] = 'OTHER'
    elif mutation == 'source':
        changed['source_url'] = 'https://www.sec.gov/'
    elif mutation == 'foreign_filing':
        changed['documents'][2]['url'] = changed['documents'][2]['url'].replace('/996/', '/997/')
    elif mutation == 'filing_parent':
        changed['documents'][2]['parent_url'] = SUBMISSIONS
    elif mutation == 'counterparty':
        changed['issuer_evidence'][-1]['label'] = 'Foreign Counterparty - Investor Relations'
    elif mutation == 'identity_hash':
        changed['issuer_evidence'][-1]['raw_sha256'] = 'f' * 64
    elif mutation == 'identity_missing':
        changed['issuer_evidence'].pop()
    elif mutation == 'normalized_hash':
        evidence['normalized_text'] += '\nUnbound text.'
    elif mutation == 'normalization':
        evidence['normalization'] = 'unspecified-parser'
    elif mutation == 'normalized_path':
        evidence['normalized_object_key'] = evidence['normalized_object_key'].replace(SOURCE, 'sec-ir-0000000997')
    elif mutation == 'quote_offset':
        entry['quote_start'] += 1
    elif mutation == 'byte_offset':
        prefix = evidence['normalized_text'][:entry['quote_start']]
        difference = len(prefix.encode()) - len(prefix)
        assert difference > 0
        entry['quote_start'] += difference
        entry['quote_end'] += difference
        entry['location'] = f"drupal-list.articles[1].normalized-text[{entry['quote_start']}:{entry['quote_end']}]"
    elif mutation == 'article_index':
        entry['location'] = entry['location'].replace('articles[1]', 'articles[0]')
    elif mutation == 'quote':
        entry['quote'] = 'Invented earnings date'
    elif mutation == 'title':
        entry['title'] = 'Invented title'
    elif mutation == 'date':
        entry['occurs_on'] = (date.fromisoformat(entry['occurs_on']) + timedelta(days=1)).isoformat()
    elif mutation == 'date_text':
        entry['date_text'] = 'January 1, 2000'
    elif mutation == 'source_date':
        entry['source_date'] += ' inferred'
    elif mutation in ('date_without_year', 'invalid_day', 'cancelled'):
        # Retain matching quotes, offsets and hashes: the semantic source gate
        # itself must reject ambiguous dates or a published cancellation.
        previous_quote = entry['quote']
        if mutation == 'date_without_year':
            entry['date_text'] = 'November 9'
            entry['source_date'] = 'November 9 4:30 PM PST'
        elif mutation == 'invalid_day':
            entry['date_text'] = f'February 30, {date.today().year}'
            entry['source_date'] = entry['date_text'] + ' 4:30 PM PST'
        else:
            entry['title'] += ' cancelled'
        entry['quote'] = entry['title'] + ' ' + entry['source_date']
        entry['quote_end'] = entry['quote_start'] + len(entry['quote'])
        entry['location'] = f"drupal-list.articles[1].normalized-text[{entry['quote_start']}:{entry['quote_end']}]"
        evidence['normalized_text'] = evidence['normalized_text'].replace(previous_quote, entry['quote'])
        bind_normalized(changed)
    elif mutation == 'event_host':
        entry['event_url'] = entry['event_url'].replace('investors.synthetic-corp.com', 'investors.counterparty.com')
    elif mutation == 'event_path':
        entry['event_url'] = entry['event_url'].replace('synthetic-results', 'another-event')
    elif mutation == 'event_query':
        entry['event_url'] += '?event=another'
    elif mutation == 'event_fragment':
        entry['event_url'] += '#unverified'
    elif mutation == 'event_credentials':
        entry['event_url'] = entry['event_url'].replace('https://', 'https://user:password@')
    elif mutation == 'timezone':
        entry['timezone'] = 'America/Los_Angeles'
    elif mutation == 'location':
        entry['location'] = 'unbound-location'
    elif mutation == 'source_hash':
        entry['raw_sha256'] = 'f' * 64
    elif mutation == 'detail_as_source':
        entry['source_url'] = entry['event_url']
    elif mutation == 'row_count':
        evidence['row_count'] = 201
    elif mutation == 'pagination_type':
        evidence['pagination_detected'] = 'false'
    else:
        changed['entries'].append(copy.deepcopy(entry))
    with pytest.raises(psycopg.Error), connection.transaction():
        ingest(cur, changed)
    assert rows(cur) == before
    assert cur.execute('select app_private.sb_calendar_confirmed(%s)', (before[0][0],)).fetchone()[0]
    assert cur.execute('select count(*) from app_private.calendar_snapshots where source_key=%s', (SOURCE,)).fetchone()[0] == 1


def test_a_partial_list_omitting_an_event_never_withdraws_it(drupal_db):
    _, cur = drupal_db
    assert ingest(cur, drupal_manifest()) == 1
    first = rows(cur)[0]
    assert ingest(cur, drupal_manifest(slug='another-webcast', offset=12)) == 1
    assert len(rows(cur)) == 2 and first in rows(cur)
    assert all(cur.execute('select app_private.sb_calendar_confirmed(%s)', (row[0],)).fetchone()[0] for row in rows(cur))


def test_a_recognized_historical_only_list_has_zero_current_entries_without_withdrawals(drupal_db):
    _, cur = drupal_db
    assert ingest(cur, drupal_manifest()) == 1
    before = rows(cur)
    historical = drupal_manifest()
    historical['entries'] = []
    historical['drupal']['normalized_text'] = historical['drupal']['normalized_text'].split('\n')[0]
    historical['drupal']['row_count'] = 1
    bind_normalized(historical)
    assert ingest(cur, historical) == 0
    assert rows(cur) == before
    assert cur.execute('select app_private.sb_calendar_confirmed(%s)', (before[0][0],)).fetchone()[0]


def test_an_unrecognized_empty_list_cannot_claim_success_or_withdraw_existing_events(drupal_db):
    import psycopg
    connection, cur = drupal_db
    assert ingest(cur, drupal_manifest()) == 1
    before = rows(cur)
    empty = drupal_manifest()
    empty['entries'] = []
    empty['drupal'].update(row_count=0, normalized_text='')
    bind_normalized(empty)
    with pytest.raises(psycopg.Error), connection.transaction():
        ingest(cur, empty)
    assert rows(cur) == before


def test_changed_date_for_the_same_detail_path_requires_review(drupal_db):
    import psycopg
    connection, cur = drupal_db
    assert ingest(cur, drupal_manifest()) == 1
    before = rows(cur)
    with pytest.raises(psycopg.Error), connection.transaction():
        ingest(cur, drupal_manifest(offset=8))
    assert rows(cur) == before


@pytest.mark.parametrize('format_name', ['structured-html', 'q4', 'sec-filing'])
@pytest.mark.parametrize('first', ['legacy', 'drupal'])
def test_existing_formats_work_and_switching_identity_formats_requires_review(drupal_db, format_name, first):
    import psycopg
    connection, cur = drupal_db
    legacy_value = filing_manifest() if format_name == 'sec-filing' else manifest(q4=format_name == 'q4', filed=True)
    collect_legacy = ingest_filing if format_name == 'sec-filing' else ingest_ir
    assert (collect_legacy(cur, legacy_value) if first == 'legacy' else ingest(cur, drupal_manifest())) == 1
    before = rows(cur)
    assert cur.execute('select app_private.sb_calendar_confirmed(%s)', (before[0][0],)).fetchone()[0]
    with pytest.raises(psycopg.Error, match='calendar_source_change_requires_review'), connection.transaction():
        if first == 'legacy':
            ingest(cur, drupal_manifest())
        else:
            collect_legacy(cur, legacy_value)
    assert rows(cur) == before


@pytest.mark.parametrize('field,value', [
    ('source_url', 'https://investors.synthetic-corp.com/events/event-details/synthetic-results'),
    ('occurs_on', '2000-01-01'), ('quote', 'Unbound quotation'), ('source_location', 'unknown'),
    ('source_event_key', 'event:/another-event'), ('title', 'Unbound title'),
])
def test_tampered_public_projection_is_not_visible(drupal_db, field, value):
    _, cur = drupal_db
    assert ingest(cur, drupal_manifest()) == 1
    identifier = rows(cur)[0][0]
    cur.execute(f'update calendar_items set {field}=%s where id=%s', (value, identifier))
    assert not cur.execute('select app_private.sb_calendar_confirmed(%s)', (identifier,)).fetchone()[0]


@pytest.mark.parametrize('role', ['anon', 'authenticated'])
def test_list_ingestion_remains_service_only_with_private_archives(drupal_db, role):
    import psycopg
    connection, cur = drupal_db
    args = archived(cur, drupal_manifest())
    assert not cur.execute("select has_function_privilege(%s,'public.sb_calendar_ingest_sec_ir(text,text,text,text)','execute')", (role,)).fetchone()[0]
    assert cur.execute("select has_function_privilege('service_role','public.sb_calendar_ingest_sec_ir(text,text,text,text)','execute')").fetchone()[0]
    for private_role in ('anon', 'authenticated', 'service_role'):
        assert not cur.execute("select has_function_privilege(%s,'app_private.calendar_drupal_evidence(text,jsonb)','execute')", (private_role,)).fetchone()[0]
    cur.execute(f'SET LOCAL ROLE {role}')
    with pytest.raises(psycopg.Error) as caught, connection.transaction():
        cur.execute('select sb_calendar_ingest_sec_ir(%s,%s,%s,%s)', args)
    assert caught.value.sqlstate == '42501'


def test_same_detail_identity_retains_saved_id_and_owner_isolation_on_refresh(saved_drupal_db):
    _, cur = saved_drupal_db
    assert ingest(cur, drupal_manifest()) == 1
    identifier = rows(cur)[0][0]
    cur.execute("SELECT set_config('request.jwt.claim.sub',%s,true)", (OWNER,))
    cur.execute('SET LOCAL ROLE authenticated')
    cur.execute("SELECT sb_user_action('watch_add',jsonb_build_object('company_id',%s::text))", (COMPANY,))
    assert cur.execute('select sb_reference_reminders(%s::jsonb)',
                       (json.dumps({'action': 'set', 'calendar_id': identifier, 'enabled': True}),)).fetchone()[0]['saved']
    saved_at = cur.execute('select created_at from calendar_reminders where calendar_id=%s', (identifier,)).fetchone()[0]
    cur.execute('RESET ROLE')
    assert ingest(cur, drupal_manifest(title='Synthetic quarterly results webcast')) == 1
    assert len(rows(cur)) == 1 and rows(cur)[0][0] == identifier
    assert cur.execute('select app_private.sb_calendar_confirmed(%s)', (identifier,)).fetchone()[0]
    cur.execute('SET LOCAL ROLE authenticated')
    assert cur.execute('select sb_reference_reminders(\'{"action":"list"}\')').fetchone()[0] == [{'calendar_id': identifier}]
    assert cur.execute('select created_at from calendar_reminders where calendar_id=%s', (identifier,)).fetchone()[0] == saved_at
    cur.execute("SELECT set_config('request.jwt.claim.sub',%s,true)", (OTHER,))
    assert cur.execute('select sb_reference_reminders(\'{"action":"list"}\')').fetchone()[0] == []
