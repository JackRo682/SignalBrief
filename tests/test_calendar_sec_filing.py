"""Independent SEC-filed event evidence and stable saved-calendar identity checks."""
import copy
import hashlib
import json
from datetime import date, timedelta

import pytest
from test_calendar_sec_ir import COMPANY, ROOT, SOURCE, SUBMISSIONS, manifest
from test_calendar_sec_ir import calendar_db as calendar_db
from test_calendar_sec_ir import ingest as ingest_ir
from test_calendar_sec_ir import onboard_db as onboard_db
from test_calendar_sec_ir import sec_ir_db as sec_ir_db

pytestmark = pytest.mark.postgres
MIGRATION = ROOT / 'supabase/migrations/20261102051053_calendar_sec_filed_events.sql'
OWNER = '10000000-0000-4000-8000-000000000081'
OTHER = '10000000-0000-4000-8000-000000000082'


@pytest.fixture
def filing_db(sec_ir_db):
    connection, cur = sec_ir_db
    cur.execute(MIGRATION.read_text(), prepare=False)
    yield connection, cur


@pytest.fixture
def saved_filing_db(filing_db):
    connection, cur = filing_db
    reference = (ROOT / 'supabase/reference-migrations/20261003_reference_screens.sql').read_text()
    cur.execute(reference[reference.index('CREATE TABLE public.calendar_reminders'):
                          reference.index('CREATE OR REPLACE FUNCTION public.sb_reference_preferences')], prepare=False)
    dashboard = (ROOT / 'supabase/migrations/20261101014441_screenshot_dashboard.sql').read_text()
    cur.execute(dashboard[dashboard.index('CREATE OR REPLACE FUNCTION public.sb_reference_reminders'):], prepare=False)
    for actor in (OWNER, OTHER):
        cur.execute("INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES(%s,%s,'{}')",
                    (actor, f'{actor}@example.invalid'))
        cur.execute("SELECT set_config('request.jwt.claim.sub',%s,true)", (actor,))
        cur.execute('SET LOCAL ROLE authenticated')
        cur.execute('SELECT sb_initialize_profile()')
        cur.execute('RESET ROLE')
    yield connection, cur


def filing_manifest(*, primary=False, offset=7, quarter=3, filing_age=0, filing_sequence=1):
    """Synthetic raw-archive metadata; parser tests bind actual source originals."""
    value = manifest(filed=True)
    value['documents'] = value['documents'][:2 if primary else 3]
    previous_accession = value['documents'][1]['accession']
    accession = previous_accession[:-6] + f'{filing_sequence:06}'
    for document in value['documents'][1:]:
        document['accession'] = accession
        for field in ('url', 'parent_url'):
            document[field] = document[field].replace(previous_accession.replace('-', ''), accession.replace('-', ''))
    selected = value['documents'][-1]
    issuer = 'Synthetic official issuer, Inc.'
    occurrence = date.today() + timedelta(days=offset)
    fiscal_year = date.today().year
    period = f'{("first", "second", "third", "fourth")[quarter - 1]} quarter {fiscal_year}'
    date_text = f'{occurrence:%B} {occurrence.day}, {occurrence.year}'
    quote = f'{issuer} will provide a live webcast of its {period} financial results conference call on {date_text}'
    prefix = 'Official exhibit — 📄. '
    normalized = prefix + quote + '. Additional filing disclosure.'
    normalized_sha = hashlib.sha256(normalized.encode()).hexdigest()
    filing_date = (date.today() - timedelta(days=filing_age)).isoformat()
    for document in value['documents']:
        if document['role'] != 'submissions':
            document['filing_date'] = filing_date
    location = f'normalized-text[{len(prefix)}:{len(prefix) + len(quote)}]'
    entry = {'key': f'quarter:{fiscal_year}:Q{quarter}', 'title': f'SYN {fiscal_year} Q{quarter} earnings',
             'occurs_on': occurrence.isoformat(), 'quote': quote, 'timezone': None, 'location': location,
             'source_url': selected['url'], 'raw_sha256': selected['raw_sha256']}
    value.update(schema='signalbrief.calendar.sec-filing.v1', format='sec-filing', complete=False,
                 coverage='explicit-sec-announcement', fallback_reason='calendar_relay_upstream_failed',
                 issuer_name=issuer, issuer_evidence=[], event_source_url=selected['url'], entries=[entry],
                 binding={'url': selected['url'], 'document_url': selected['url'], 'quote': quote, 'location': location},
                 filing={'source_url': selected['url'], 'raw_sha256': selected['raw_sha256'],
                         'accession': selected['accession'], 'filing_date': filing_date, 'form_type': '8-K',
                         'normalized_text': normalized, 'normalized_sha256': normalized_sha,
                         'normalized_object_key': f'calendar/{SOURCE}/normalized/{normalized_sha}.txt',
                         'issuer_label': issuer, 'quote_start': len(prefix), 'quote_end': len(prefix) + len(quote),
                         'period_text': period, 'fiscal_year': fiscal_year, 'quarter': quarter, 'date_text': date_text})
    return value


def archived(cur, value, missing=None):
    raw = json.dumps(value, separators=(',', ':'))
    digest = hashlib.sha256(raw.encode()).hexdigest()
    path = f'calendar/{SOURCE}/{digest}.json'
    paths = [path, *(document['object_key'] for document in value['documents']), value['filing']['normalized_object_key']]
    for name in paths:
        if name != missing:
            cur.execute("insert into storage.objects(bucket_id,name) values('signalbrief-raw',%s)", (name,))
    return SOURCE, digest, path, raw


def ingest(cur, value, missing=None):
    return cur.execute('select sb_calendar_ingest_sec_ir(%s,%s,%s,%s)', archived(cur, value, missing)).fetchone()[0]


def rows(cur):
    return cur.execute("""select id,company_id,source_event_key,occurs_on::text,source_url,quote,
        source_snapshot_id,calendar_status from calendar_items where source_key=%s order by source_event_key""",
                       (SOURCE,)).fetchall()


@pytest.mark.parametrize('primary', [False, True])
def test_archived_explicit_filing_event_is_idempotent_date_only_and_visible(filing_db, primary):
    _, cur = filing_db
    value = filing_manifest(primary=primary)
    assert ingest(cur, value) == 1
    before = rows(cur)
    assert ingest(cur, value) == 1
    assert rows(cur) == before
    item = before[0]
    assert item[1:6] == (COMPANY, value['entries'][0]['key'], value['entries'][0]['occurs_on'],
                        value['filing']['source_url'], value['entries'][0]['quote'])
    assert cur.execute('select app_private.sb_calendar_confirmed(%s)', (item[0],)).fetchone()[0]
    assert cur.execute('select source_timezone from calendar_items where id=%s', (item[0],)).fetchone()[0] is None
    provenance = cur.execute('select provenance from app_private.calendar_snapshots where id=%s', (item[6],)).fetchone()[0]
    assert provenance == value and provenance['complete'] is False
    assert provenance['coverage'] == 'explicit-sec-announcement'
    assert cur.execute('select count(*) from app_private.calendar_snapshots where source_key=%s', (SOURCE,)).fetchone()[0] == 1
    cur.execute('SET LOCAL ROLE authenticated')
    assert cur.execute('select id from calendar_items where source_key=%s', (SOURCE,)).fetchall() == [(item[0],)]
    assert cur.execute('select count(*) from storage.objects').fetchone()[0] == 0


@pytest.mark.parametrize('missing', ['submissions', 'primary', 'exhibit', 'normalized', 'manifest'])
def test_each_original_normalized_evidence_and_manifest_must_be_archived(filing_db, missing):
    import psycopg
    connection, cur = filing_db
    value = filing_manifest()
    if missing == 'normalized':
        path = value['filing']['normalized_object_key']
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
    'complete', 'coverage', 'unsafe_fallback', 'empty', 'duplicate', 'company', 'cik', 'ticker',
    'source', 'foreign_filing', 'filing_parent', 'future_filing', 'filing_form', 'issuer',
    'normalized_hash', 'quote_offset', 'byte_offset', 'quote', 'date', 'date_text', 'period',
    'quarter', 'fiscal_year', 'event_key', 'timezone', 'location', 'source_hash', 'binding',
])
def test_invalid_filing_evidence_is_atomic_and_keeps_the_verified_event(filing_db, mutation):
    import psycopg
    connection, cur = filing_db
    value = filing_manifest()
    assert ingest(cur, value) == 1
    before = rows(cur)
    changed = copy.deepcopy(value)
    entry, filing = changed['entries'][0], changed['filing']
    if mutation == 'complete':
        changed['complete'] = True
    elif mutation == 'coverage':
        changed['coverage'] = 'complete-official-calendar'
    elif mutation == 'unsafe_fallback':
        changed['fallback_reason'] = 'private_or_reserved_address'
    elif mutation == 'empty':
        changed['entries'] = []
    elif mutation == 'duplicate':
        changed['entries'].append(copy.deepcopy(entry))
    elif mutation == 'company':
        changed['company_id'] = '10000000-0000-4000-8000-000000000097'
    elif mutation == 'cik':
        changed['provider_company_id'] = '0000000997'
    elif mutation == 'ticker':
        changed['ticker'] = 'OTHER'
    elif mutation == 'source':
        changed['source_url'] = 'https://www.sec.gov/'
    elif mutation == 'foreign_filing':
        changed['documents'][-1]['url'] = changed['documents'][-1]['url'].replace('/996/', '/997/')
    elif mutation == 'filing_parent':
        changed['documents'][-1]['parent_url'] = SUBMISSIONS
    elif mutation == 'future_filing':
        filing['filing_date'] = (date.today() + timedelta(days=1)).isoformat()
        for document in changed['documents'][1:]:
            document['filing_date'] = filing['filing_date']
    elif mutation == 'filing_form':
        filing['form_type'] = '10-K'
    elif mutation == 'issuer':
        filing['issuer_label'] = 'Counterparty Corporation'
    elif mutation == 'normalized_hash':
        filing['normalized_text'] += '\nUnbound added content.'
    elif mutation == 'quote_offset':
        filing['quote_start'] += 1
    elif mutation == 'byte_offset':
        # PostgreSQL/JavaScript evidence offsets count code points, never UTF-8 bytes.
        prefix = filing['normalized_text'][:filing['quote_start']]
        difference = len(prefix.encode()) - len(prefix)
        filing['quote_start'] += difference
        filing['quote_end'] += difference
        entry['location'] = f"normalized-text[{filing['quote_start']}:{filing['quote_end']}]"
        changed['binding']['location'] = entry['location']
    elif mutation == 'quote':
        entry['quote'] = 'Invented earnings webcast.'
    elif mutation == 'date':
        entry['occurs_on'] = (date.fromisoformat(entry['occurs_on']) + timedelta(days=1)).isoformat()
    elif mutation == 'date_text':
        filing['date_text'] = 'January 1, 2000'
    elif mutation == 'period':
        filing['period_text'] = f'first quarter {date.today().year}'
    elif mutation == 'quarter':
        filing['quarter'] = 1
    elif mutation == 'fiscal_year':
        filing['fiscal_year'] -= 1
    elif mutation == 'event_key':
        entry['key'] = 'unbound-quarter'
    elif mutation == 'timezone':
        entry['timezone'] = 'America/New_York'
    elif mutation == 'location':
        entry['location'] = 'inferred-announcement'
    elif mutation == 'source_hash':
        entry['raw_sha256'] = 'f' * 64
    else:
        changed['binding']['url'] = 'https://investors.counterparty.com/'
    with pytest.raises(psycopg.Error), connection.transaction():
        ingest(cur, changed)
    assert rows(cur) == before
    assert cur.execute('select app_private.sb_calendar_confirmed(%s)', (before[0][0],)).fetchone()[0]
    assert cur.execute('select count(*) from app_private.calendar_snapshots where source_key=%s', (SOURCE,)).fetchone()[0] == 1


def test_one_explicit_quarter_does_not_withdraw_other_verified_quarters(filing_db):
    _, cur = filing_db
    first = filing_manifest(quarter=2)
    second = filing_manifest(quarter=3, offset=8)
    assert ingest(cur, first) == 1
    before = rows(cur)[0]
    assert ingest(cur, second) == 1
    assert len(rows(cur)) == 2 and before in rows(cur)
    assert all(cur.execute('select app_private.sb_calendar_confirmed(%s)', (row[0],)).fetchone()[0] for row in rows(cur))


def test_changed_occurrence_and_stale_filing_do_not_replace_a_verified_quarter(filing_db):
    import psycopg
    connection, cur = filing_db
    assert ingest(cur, filing_manifest(filing_sequence=2)) == 1
    before = rows(cur)
    for changed in (filing_manifest(offset=8, filing_sequence=2),
                    filing_manifest(filing_age=1, filing_sequence=2), filing_manifest(filing_sequence=1)):
        with pytest.raises(psycopg.Error, match='calendar_filing_conflict'), connection.transaction():
            ingest(cur, changed)
        assert rows(cur) == before


@pytest.mark.parametrize('first', ['filing', 'q4'])
def test_q4_to_filing_format_changes_still_require_explicit_review(filing_db, first):
    import psycopg
    connection, cur = filing_db
    if first == 'filing':
        assert ingest(cur, filing_manifest()) == 1
    else:
        assert ingest_ir(cur, manifest(q4=True, filed=True)) == 1
    before = rows(cur)
    with pytest.raises(psycopg.Error, match='calendar_source_change_requires_review'), connection.transaction():
        if first == 'filing':
            ingest_ir(cur, manifest(q4=True, filed=True))
        else:
            ingest(cur, filing_manifest())
    assert rows(cur) == before


@pytest.mark.parametrize('field,value', [
    ('source_url', 'https://www.sec.gov/'), ('occurs_on', '2000-01-01'), ('quote', 'Invented event'),
    ('source_location', 'unknown'), ('source_event_key', 'quarter:2000:Q1'), ('title', 'Unbound title'),
])
def test_tampered_public_filing_projection_is_not_visible(filing_db, field, value):
    _, cur = filing_db
    ingest(cur, filing_manifest())
    item_id = rows(cur)[0][0]
    cur.execute(f'update calendar_items set {field}=%s where id=%s', (value, item_id))
    assert not cur.execute('select app_private.sb_calendar_confirmed(%s)', (item_id,)).fetchone()[0]


@pytest.mark.parametrize('role', ['anon', 'authenticated'])
def test_fallback_ingestion_remains_inaccessible_to_clients(filing_db, role):
    import psycopg
    connection, cur = filing_db
    args = archived(cur, filing_manifest())
    assert not cur.execute("select has_function_privilege(%s,'public.sb_calendar_ingest_sec_ir(text,text,text,text)','execute')", (role,)).fetchone()[0]
    cur.execute(f'SET LOCAL ROLE {role}')
    with pytest.raises(psycopg.Error) as caught, connection.transaction():
        cur.execute('select sb_calendar_ingest_sec_ir(%s,%s,%s,%s)', args)
    assert caught.value.sqlstate == '42501'


def test_table_and_filing_share_saved_quarter_identity_without_cross_owner_visibility(saved_filing_db):
    _, cur = saved_filing_db
    table = manifest(filed=True)
    assert ingest_ir(cur, table) == 1
    item_id = rows(cur)[0][0]
    cur.execute("SELECT set_config('request.jwt.claim.sub',%s,true)", (OWNER,))
    cur.execute('SET LOCAL ROLE authenticated')
    cur.execute("SELECT sb_user_action('watch_add',jsonb_build_object('company_id',%s::text))", (COMPANY,))
    assert cur.execute('select sb_reference_reminders(%s::jsonb)',
                       (json.dumps({'action': 'set', 'calendar_id': item_id, 'enabled': True}),)).fetchone()[0]['saved']
    saved_at = cur.execute('select created_at from calendar_reminders where calendar_id=%s', (item_id,)).fetchone()[0]
    cur.execute('RESET ROLE')
    for value, collect in ((filing_manifest(), ingest), (table, ingest_ir), (filing_manifest(), ingest)):
        assert collect(cur, value) == 1
        assert len(rows(cur)) == 1 and rows(cur)[0][0] == item_id
        assert cur.execute('select app_private.sb_calendar_confirmed(%s)', (item_id,)).fetchone()[0]
        cur.execute('SET LOCAL ROLE authenticated')
        assert cur.execute('select sb_reference_reminders(\'{"action":"list"}\')').fetchone()[0] == [{'calendar_id': item_id}]
        assert cur.execute('select created_at from calendar_reminders where calendar_id=%s', (item_id,)).fetchone()[0] == saved_at
        cur.execute("SELECT set_config('request.jwt.claim.sub',%s,true)", (OTHER,))
        assert cur.execute('select sb_reference_reminders(\'{"action":"list"}\')').fetchone()[0] == []
        cur.execute('RESET ROLE')
        cur.execute("SELECT set_config('request.jwt.claim.sub',%s,true)", (OWNER,))
