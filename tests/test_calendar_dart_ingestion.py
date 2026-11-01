"""Independent PostgreSQL checks of DART IR provenance and public visibility.

All identities and manifests are synthetic. Raw object metadata stands in for the
private archive; the separate Edge parser suite verifies the original bytes.
"""
import copy
from datetime import date, timedelta

import pytest
from test_calendar_onboarding import DART, add_dart, archive_manifest, dart_manifest, ingest
from test_calendar_onboarding import calendar_db as calendar_db
from test_calendar_onboarding import onboard_db as onboard_db

pytestmark = pytest.mark.postgres
ACTOR = '10000000-0000-4000-8000-000000000096'
OTHER = '10000000-0000-4000-8000-000000000097'


def authenticated(cur):
    cur.execute("""INSERT INTO auth.users(id,email,raw_user_meta_data)
        VALUES(%s,'synthetic-dart-reader@example.invalid','{}')""", (ACTOR,))
    cur.execute("SELECT set_config('request.jwt.claim.sub',%s,true)", (ACTOR,))
    cur.execute('SET LOCAL ROLE authenticated')


def replace_receipt(manifest, receipt):
    """Keep all dependent links coherent when exercising the receipt-date guard."""
    document = manifest['documents'][0]
    previous = document['receipt_no']
    document['receipt_no'] = receipt
    document['main_url'] = document['main_url'].replace(previous, receipt)
    document['body_url'] = document['body_url'].replace(previous, receipt)
    manifest['entries'][0]['key'] = receipt
    manifest['entries'][0]['source_url'] = document['main_url']


def test_authenticated_read_preserves_exact_date_evidence_and_keeps_archives_private(onboard_db):
    import psycopg

    connection, cur = onboard_db
    source = add_dart(cur)
    manifest = dart_manifest()
    values = archive_manifest(cur, manifest)
    cur.execute('SET LOCAL ROLE service_role')
    assert cur.execute('SELECT sb_calendar_ingest_dart_ir(%s,%s,%s,%s)', values).fetchone()[0] == 1
    cur.execute('RESET ROLE')
    row = cur.execute("""SELECT id,company_id,title,occurs_on,quote,source_url,
        source_timezone,source_location,source_event_key,source_snapshot_id
        FROM calendar_items WHERE source_key=%s""", (source,)).fetchone()
    entry = manifest['entries'][0]
    assert row[1:9] == (DART, entry['title'], date.fromisoformat(entry['occurs_on']),
                        entry['quote'], entry['source_url'], None, entry['location'], entry['key'])
    snapshot = cur.execute("""SELECT raw_sha256,object_key,raw_format,provenance
        FROM app_private.calendar_snapshots WHERE id=%s""", (row[9],)).fetchone()
    assert snapshot == (values[1], values[2], 'json', manifest)
    authenticated(cur)
    assert cur.execute('SELECT id FROM calendar_items').fetchall() == [(row[0],)]
    assert cur.execute('SELECT count(*) FROM storage.objects').fetchone()[0] == 0
    for table in ('calendar_snapshots', 'calendar_sources', 'calendar_refresh_queue'):
        with pytest.raises(psycopg.errors.InsufficientPrivilege), connection.transaction():
            cur.execute(f'SELECT * FROM app_private.{table}')
    # A reader cannot alter a verified official row through the public table.
    with pytest.raises(psycopg.errors.InsufficientPrivilege), connection.transaction():
        cur.execute('UPDATE calendar_items SET title=%s WHERE id=%s', ('Untrusted change', row[0]))
    assert cur.execute('SELECT title FROM calendar_items WHERE id=%s', (row[0],)).fetchone()[0] == entry['title']


@pytest.mark.parametrize('role', ['anon', 'authenticated'])
def test_untrusted_roles_cannot_ingest_an_otherwise_valid_archived_manifest(onboard_db, role):
    import psycopg

    connection, cur = onboard_db
    add_dart(cur)
    values = archive_manifest(cur, dart_manifest())
    cur.execute(f'SET LOCAL ROLE {role}')
    with pytest.raises(psycopg.errors.InsufficientPrivilege), connection.transaction():
        cur.execute('SELECT sb_calendar_ingest_dart_ir(%s,%s,%s,%s)', values)
    cur.execute('RESET ROLE')
    assert cur.execute('SELECT count(*) FROM calendar_items').fetchone()[0] == 0


@pytest.mark.parametrize('mutation', ['root_url', 'other_receipt_url', 'receipt_key', 'date', 'same_ticker_other_issuer'])
def test_dart_visibility_requires_the_specific_manifest_entry_and_canonical_issuer(onboard_db, mutation):
    _, cur = onboard_db
    source = add_dart(cur)
    manifest = dart_manifest()
    assert ingest(cur, manifest, 'dart_ir') == 1
    event = cur.execute('SELECT id FROM calendar_items WHERE source_key=%s', (source,)).fetchone()[0]
    assert cur.execute('SELECT app_private.sb_calendar_confirmed(%s)', (event,)).fetchone()[0]
    if mutation == 'root_url':
        cur.execute("UPDATE calendar_items SET source_url='https://dart.fss.or.kr/' WHERE id=%s", (event,))
    elif mutation == 'other_receipt_url':
        cur.execute("UPDATE calendar_items SET source_url=source_url||'0' WHERE id=%s", (event,))
    elif mutation == 'receipt_key':
        cur.execute("UPDATE calendar_items SET source_event_key=source_event_key||'0' WHERE id=%s", (event,))
    elif mutation == 'date':
        cur.execute('UPDATE calendar_items SET occurs_on=occurs_on+1 WHERE id=%s', (event,))
    else:
        cur.execute("""INSERT INTO companies(id,name,ticker,market,provider,provider_company_id,is_demo,created_at)
            VALUES(%s,'Same name and ticker, different provider','099991','KR','sec','0000000997',false,now())""", (OTHER,))
        cur.execute('UPDATE calendar_items SET company_id=%s WHERE id=%s', (OTHER, event))
    assert not cur.execute('SELECT app_private.sb_calendar_confirmed(%s)', (event,)).fetchone()[0]
    authenticated(cur)
    assert cur.execute('SELECT id FROM calendar_items WHERE id=%s', (event,)).fetchall() == []


@pytest.mark.parametrize('mutation', ['disabled_source', 'wrong_source_provider', 'wrong_source_corporation', 'demo_company'])
def test_source_identity_and_visibility_changes_fail_closed(onboard_db, mutation):
    import psycopg

    connection, cur = onboard_db
    source = add_dart(cur)
    manifest = dart_manifest()
    assert ingest(cur, manifest, 'dart_ir') == 1
    event = cur.execute('SELECT id FROM calendar_items WHERE source_key=%s', (source,)).fetchone()[0]
    if mutation == 'disabled_source':
        cur.execute('UPDATE app_private.calendar_sources SET enabled=false WHERE key=%s', (source,))
    elif mutation == 'wrong_source_provider':
        cur.execute("UPDATE app_private.calendar_sources SET provider='sec' WHERE key=%s", (source,))
    elif mutation == 'wrong_source_corporation':
        cur.execute("UPDATE app_private.calendar_sources SET provider_company_id='00999992' WHERE key=%s", (source,))
    else:
        cur.execute('UPDATE companies SET is_demo=true WHERE id=%s', (DART,))
    with pytest.raises(psycopg.Error), connection.transaction():
        ingest(cur, manifest, 'dart_ir')
    authenticated(cur)
    assert cur.execute('SELECT id FROM calendar_items WHERE id=%s', (event,)).fetchall() == []


@pytest.mark.parametrize('which', ['manifest', 'list', 'main', 'body'])
def test_each_private_original_must_exist_before_any_dart_item_is_published(onboard_db, which):
    import psycopg

    connection, cur = onboard_db
    add_dart(cur)
    manifest = dart_manifest()
    values = archive_manifest(cur, manifest)
    path = {'manifest': values[2], 'list': manifest['pages'][0]['object_key'],
            'main': manifest['documents'][0]['main_object_key'],
            'body': manifest['documents'][0]['body_object_key']}[which]
    cur.execute('DELETE FROM storage.objects WHERE name=%s', (path,))
    with pytest.raises(psycopg.Error, match='calendar_archive_missing'), connection.transaction():
        cur.execute('SELECT sb_calendar_ingest_dart_ir(%s,%s,%s,%s)', values)
    assert cur.execute('SELECT count(*) FROM calendar_items').fetchone()[0] == 0
    assert cur.execute('SELECT count(*) FROM app_private.calendar_snapshots').fetchone()[0] == 0


@pytest.mark.parametrize('mutation', [
    'viewer_origin', 'viewer_receipt', 'main_archive_source', 'duplicate_document', 'duplicate_entry',
    'page_order', 'page_issuer', 'changing_totals', 'old_receipt', 'future_receipt',
    'invalid_receipt_date', 'invalid_occurrence', 'unquoted_date', 'wrong_receipt_window',
])
def test_invalid_document_pagination_or_date_cannot_replace_verified_evidence(onboard_db, mutation):
    import psycopg

    connection, cur = onboard_db
    source = add_dart(cur)
    manifest = dart_manifest()
    assert ingest(cur, manifest, 'dart_ir') == 1
    before = cur.execute("""SELECT id,occurs_on,source_snapshot_id,calendar_status FROM calendar_items
        WHERE source_key=%s""", (source,)).fetchone()
    broken = copy.deepcopy(manifest)
    document, page, entry = broken['documents'][0], broken['pages'][0], broken['entries'][0]
    today = date.fromisoformat(broken['receipt_window']['end'])
    if mutation == 'viewer_origin':
        document['body_url'] = document['body_url'].replace('dart.fss.or.kr', 'untrusted.invalid')
    elif mutation == 'viewer_receipt':
        document['body_url'] = document['body_url'].replace(document['receipt_no'], document['receipt_no'][:-1] + '2')
    elif mutation == 'main_archive_source':
        document['main_object_key'] = document['main_object_key'].replace(source, 'dart-ir-00999992')
    elif mutation == 'duplicate_document':
        broken['documents'].append(copy.deepcopy(document))
        page.update(count=2, total_count=2)
    elif mutation == 'duplicate_entry':
        second = copy.deepcopy(broken)
        replace_receipt(second, document['receipt_no'][:-1] + '2')
        broken['documents'].append(second['documents'][0])
        broken['entries'].append(copy.deepcopy(entry))
        page.update(count=2, total_count=2)
    elif mutation == 'page_order':
        page['page_number'] = 2
    elif mutation == 'page_issuer':
        page['url'] = page['url'].replace('corp_code=00999991', 'corp_code=00999992')
    elif mutation == 'changing_totals':
        page.update(count=100, total_count=101, total_page=2)
        second = copy.deepcopy(page)
        second.update(page_number=2, count=1, total_count=102,
                      url=page['url'].replace('page_no=1', 'page_no=2'))
        broken['pages'].append(second)
    elif mutation in ('old_receipt', 'future_receipt'):
        day = today + timedelta(days=-91 if mutation == 'old_receipt' else 1)
        replace_receipt(broken, day.strftime('%Y%m%d') + '800001')
    elif mutation == 'invalid_receipt_date':
        replace_receipt(broken, f'{today.year}0230800001')
    elif mutation == 'invalid_occurrence':
        entry['quote'] = entry['quote'].replace(entry['occurs_on'], f'{today.year}-02-30')
        entry['occurs_on'] = f'{today.year}-02-30'
    elif mutation == 'unquoted_date':
        entry['quote'] = 'The source does not state an occurrence date.'
    else:
        broken['receipt_window']['end'] = (today - timedelta(days=1)).isoformat()
    with pytest.raises(psycopg.Error), connection.transaction():
        ingest(cur, broken, 'dart_ir')
    assert cur.execute("""SELECT id,occurs_on,source_snapshot_id,calendar_status FROM calendar_items
        WHERE source_key=%s""", (source,)).fetchone() == before
    assert cur.execute('SELECT count(*) FROM app_private.calendar_snapshots').fetchone()[0] == 1


def test_receipt_window_uses_korean_date_even_with_a_different_database_session_zone(onboard_db):
    _, cur = onboard_db
    add_dart(cur)
    cur.execute("SET LOCAL TIME ZONE 'Etc/GMT+12'")
    korean_day = cur.execute("SELECT (current_timestamp AT TIME ZONE 'Asia/Seoul')::date").fetchone()[0]
    manifest = dart_manifest()
    assert manifest['receipt_window'] == {'start': (korean_day - timedelta(days=90)).isoformat(),
                                         'end': korean_day.isoformat()}
    assert ingest(cur, manifest, 'dart_ir') == 1
    assert cur.execute('SELECT source_timezone FROM calendar_items').fetchone()[0] is None
