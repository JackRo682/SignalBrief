"""Synthetic correction families keep canonical dates, row IDs, and saved references."""
import copy
import hashlib
import json
from datetime import date, timedelta

import pytest
from test_calendar_dart_ingestion import replace_receipt
from test_calendar_onboarding import DART, ROOT, add_dart, archive_manifest, dart_manifest, ingest
from test_calendar_onboarding import calendar_db as calendar_db
from test_calendar_onboarding import onboard_db as onboard_db

pytestmark = pytest.mark.postgres
OWNER = '10000000-0000-4000-8000-000000000081'
OTHER = '10000000-0000-4000-8000-000000000082'


def family_snapshot(*, root_age=10, corrections=1, occurrence_offset=8, receipt_sequence=800001):
    """A v1 original and its v2 explicit, fully archived synthetic family.

    Metadata is synthetic, as in the existing SQL archive fixture. The actual
    parser tests independently prove that these links come from original HTML.
    """
    original = dart_manifest()
    today = date.fromisoformat(original['receipt_window']['end'])
    root = (today - timedelta(days=root_age)).strftime('%Y%m%d') + f'{receipt_sequence:06}'
    replace_receipt(original, root)
    selected_day = (today + timedelta(days=occurrence_offset)).isoformat()
    result = copy.deepcopy(original)
    result['schema'] = 'signalbrief.calendar.dart-ir.v2'
    receipts = [root, *(today.strftime('%Y%m%d') + f'{receipt_sequence + 1 + index:06}' for index in range(corrections))]
    documents = []
    for index, receipt in enumerate(receipts):
        # A refetched original main page now lists the explicit correction chain;
        # its original body remains unchanged while that navigation hash changes.
        main_sha = hashlib.sha256(('synthetic main:' + receipt + ':' + ','.join(receipts)).encode()).hexdigest()
        body_sha = (original['documents'][0]['body_sha256'] if index == 0 else
                    hashlib.sha256(('synthetic current body:' + receipt).encode()).hexdigest())
        documents.append({
            'receipt_no': receipt, 'root_receipt_no': root, 'corrected': index > 0,
            'family_receipts': receipts.copy(),
            'main_url': f'https://dart.fss.or.kr/dsaf001/main.do?rcpNo={receipt}',
            'main_sha256': main_sha,
            'main_object_key': f"calendar/{result['source_key']}/documents/{main_sha}.html",
            'body_url': f'https://dart.fss.or.kr/report/viewer.do?rcpNo={receipt}&dcmNo={123 + index}&eleId=0&offset=0&length=0&dtd=HTML',
            'body_sha256': body_sha,
            'body_object_key': f"calendar/{result['source_key']}/documents/{body_sha}.html",
        })
    result['documents'] = documents
    result['families'] = [{'root_receipt_no': root, 'latest_receipt_no': receipts[-1], 'receipt_nos': receipts.copy()}]
    result['entries'][0].update(
        key=root, receipt_no=receipts[-1], occurs_on=selected_day,
        quote=f'1. 일시 및 장소 일시 {selected_day} 09:00',
        source_url=documents[-1]['main_url'], body_sha256=documents[-1]['body_sha256'],
    )
    listed = sum(receipt[:8] >= (today - timedelta(days=90)).strftime('%Y%m%d') for receipt in receipts)
    result['pages'][0].update(count=listed, total_count=listed, total_page=1)
    return original, result


def selected_row(cur, source):
    return cur.execute("""SELECT id,company_id,source_event_key,occurs_on,source_url,quote,
        source_snapshot_id,calendar_status FROM calendar_items WHERE source_key=%s
        ORDER BY source_event_key""", (source,)).fetchall()


@pytest.fixture
def saved_db(onboard_db):
    connection, cur = onboard_db
    reference = (ROOT / 'supabase/reference-migrations/20261003_reference_screens.sql').read_text()
    cur.execute(reference[reference.index('CREATE TABLE public.calendar_reminders'):
                          reference.index('CREATE OR REPLACE FUNCTION public.sb_reference_preferences')], prepare=False)
    # Use the shipped owner-scoped save/list API, without loading unrelated screens.
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


def test_latest_correction_updates_original_id_and_saved_owner_reference_in_place(saved_db):
    _, cur = saved_db
    source = add_dart(cur)
    original, current = family_snapshot()
    assert ingest(cur, original, 'dart_ir') == 1
    before = selected_row(cur, source)[0]
    cur.execute("SELECT set_config('request.jwt.claim.sub',%s,true)", (OWNER,))
    cur.execute('SET LOCAL ROLE authenticated')
    cur.execute("SELECT sb_user_action('watch_add',jsonb_build_object('company_id',%s::text))", (DART,))
    saved = cur.execute('SELECT sb_reference_reminders(%s::jsonb)',
                        (json.dumps({'action': 'set', 'calendar_id': before[0], 'enabled': True}),)).fetchone()[0]
    assert saved['saved']
    saved_at = cur.execute('SELECT created_at FROM calendar_reminders WHERE calendar_id=%s', (before[0],)).fetchone()[0]
    cur.execute('RESET ROLE')
    assert ingest(cur, current, 'dart_ir') == 1
    assert ingest(cur, current, 'dart_ir') == 1
    after = selected_row(cur, source)
    assert len(after) == 1
    assert after[0][:3] == before[:3]
    assert after[0][3:6] == (date.fromisoformat(current['entries'][0]['occurs_on']),
                            current['entries'][0]['source_url'], current['entries'][0]['quote'])
    assert after[0][6] != before[6] and after[0][7] == 'confirmed'
    assert cur.execute('SELECT count(*) FROM app_private.calendar_snapshots').fetchone()[0] == 2
    assert cur.execute('SELECT provenance FROM app_private.calendar_snapshots WHERE id=%s', (before[6],)).fetchone()[0] == original
    cur.execute('SET LOCAL ROLE authenticated')
    assert cur.execute('SELECT sb_reference_reminders(\'{"action":"list"}\')').fetchone()[0] == [{'calendar_id': before[0]}]
    assert cur.execute("""SELECT r.calendar_id,r.created_at,c.occurs_on,c.source_url
        FROM calendar_reminders r JOIN calendar_items c ON c.id=r.calendar_id""").fetchall() == [
            (before[0], saved_at, date.fromisoformat(current['entries'][0]['occurs_on']), current['entries'][0]['source_url'])]
    cur.execute("SELECT set_config('request.jwt.claim.sub',%s,true)", (OTHER,))
    assert cur.execute('SELECT sb_reference_reminders(\'{"action":"list"}\')').fetchone()[0] == []
    assert cur.execute('SELECT count(*) FROM calendar_reminders').fetchone()[0] == 0


def test_cold_complete_family_creates_one_root_key_with_latest_source(onboard_db):
    _, cur = onboard_db
    source = add_dart(cur)
    _, manifest = family_snapshot(corrections=2)
    assert ingest(cur, manifest, 'dart_ir') == 1
    rows = selected_row(cur, source)
    assert len(rows) == 1
    assert rows[0][2] == manifest['families'][0]['root_receipt_no']
    assert rows[0][4].endswith(manifest['families'][0]['latest_receipt_no'])
    assert cur.execute('SELECT app_private.sb_calendar_confirmed(%s)', (rows[0][0],)).fetchone()[0]


def test_matching_titles_and_dates_do_not_merge_distinct_explicit_families(onboard_db):
    _, cur = onboard_db
    source = add_dart(cur)
    first = family_snapshot()[1]
    second = family_snapshot(root_age=9, receipt_sequence=800101)[1]
    assert first['entries'][0]['title'] == second['entries'][0]['title']
    assert first['entries'][0]['occurs_on'] == second['entries'][0]['occurs_on']
    combined = copy.deepcopy(first)
    for key in ('families', 'documents', 'entries'):
        combined[key] += second[key]
    count = first['pages'][0]['count'] + second['pages'][0]['count']
    combined['pages'][0].update(count=count, total_count=count)
    assert ingest(cur, combined, 'dart_ir') == 2
    rows = selected_row(cur, source)
    assert len(rows) == 2 and rows[0][0] != rows[1][0]
    expected = {entry['key']: entry['source_url'] for entry in combined['entries']}
    assert {row[2]: row[4] for row in rows} == expected
    assert all(cur.execute('SELECT app_private.sb_calendar_confirmed(%s)', (row[0],)).fetchone()[0] for row in rows)


def test_explicit_older_root_is_allowed_only_with_a_current_selected_receipt(onboard_db):
    _, cur = onboard_db
    source = add_dart(cur)
    _, manifest = family_snapshot(root_age=120)
    assert manifest['pages'][0]['total_count'] == 1 and len(manifest['documents']) == 2
    assert ingest(cur, manifest, 'dart_ir') == 1
    assert selected_row(cur, source)[0][2] == manifest['families'][0]['root_receipt_no']


def test_unchanged_v1_original_can_upgrade_to_singleton_v2_without_changing_identity(onboard_db):
    _, cur = onboard_db
    source = add_dart(cur)
    original, current = family_snapshot(corrections=0, occurrence_offset=7)
    assert ingest(cur, original, 'dart_ir') == 1
    before = selected_row(cur, source)[0]
    assert ingest(cur, current, 'dart_ir') == 1
    after = selected_row(cur, source)[0]
    assert after[:6] == before[:6]
    assert after[6] != before[6] and after[7] == 'confirmed'
    assert cur.execute('SELECT app_private.sb_calendar_confirmed(%s)', (after[0],)).fetchone()[0]


def test_version_upgrade_cannot_change_evidence_without_a_newer_correction_receipt(onboard_db):
    import psycopg

    connection, cur = onboard_db
    source = add_dart(cur)
    original, conflict = family_snapshot(corrections=0, occurrence_offset=8)
    assert original['entries'][0]['key'] == conflict['entries'][0]['receipt_no']
    assert original['entries'][0]['occurs_on'] != conflict['entries'][0]['occurs_on']
    assert ingest(cur, original, 'dart_ir') == 1
    before = selected_row(cur, source)
    with pytest.raises(psycopg.Error), connection.transaction():
        ingest(cur, conflict, 'dart_ir')
    assert selected_row(cur, source) == before
    assert cur.execute('SELECT count(*) FROM app_private.calendar_snapshots').fetchone()[0] == 1


@pytest.mark.parametrize('cold', [True, False])
@pytest.mark.parametrize('offset', [-120, 600])
def test_source_stated_outside_display_window_date_is_preserved_without_fabrication(onboard_db, cold, offset):
    _, cur = onboard_db
    source = add_dart(cur)
    original, current = family_snapshot(occurrence_offset=offset)
    prior_id = None
    if not cold:
        assert ingest(cur, original, 'dart_ir') == 1
        prior_id = selected_row(cur, source)[0][0]
    assert ingest(cur, current, 'dart_ir') == 1
    row = selected_row(cur, source)[0]
    if prior_id:
        assert row[0] == prior_id
    assert row[3] == date.fromisoformat(current['entries'][0]['occurs_on'])
    assert str(row[3]) in row[5]
    assert cur.execute('SELECT app_private.sb_calendar_confirmed(%s)', (row[0],)).fetchone()[0]


@pytest.mark.parametrize('stale', ['v1_original', 'earlier_correction', 'newer_missing_previous'])
def test_stale_snapshot_cannot_downgrade_a_verified_latest_correction(onboard_db, stale):
    import psycopg

    connection, cur = onboard_db
    source = add_dart(cur)
    original, latest = family_snapshot(corrections=2, occurrence_offset=9)
    assert ingest(cur, latest, 'dart_ir') == 1
    before = selected_row(cur, source)
    previous = original if stale == 'v1_original' else family_snapshot(corrections=1)[1]
    if stale == 'newer_missing_previous':
        previous = family_snapshot(corrections=3)[1]
        missing = latest['families'][0]['latest_receipt_no']
        previous['documents'] = [document for document in previous['documents'] if document['receipt_no'] != missing]
        previous['families'][0]['receipt_nos'].remove(missing)
        for document in previous['documents']:
            document['family_receipts'].remove(missing)
        previous['pages'][0]['count'] -= 1
        previous['pages'][0]['total_count'] -= 1
    with pytest.raises(psycopg.Error), connection.transaction():
        ingest(cur, previous, 'dart_ir')
    assert selected_row(cur, source) == before
    assert cur.execute('SELECT count(*) FROM app_private.calendar_snapshots').fetchone()[0] == 1


@pytest.mark.parametrize('field', ['occurrence', 'title', 'quote'])
def test_same_latest_receipt_with_conflicting_facts_does_not_replace_verified_evidence(onboard_db, field):
    import psycopg

    connection, cur = onboard_db
    source = add_dart(cur)
    _, manifest = family_snapshot()
    assert ingest(cur, manifest, 'dart_ir') == 1
    before = selected_row(cur, source)
    conflict = copy.deepcopy(manifest)
    if field == 'occurrence':
        changed = (date.fromisoformat(conflict['entries'][0]['occurs_on']) + timedelta(days=1)).isoformat()
        conflict['entries'][0].update(occurs_on=changed, quote=f'1. 일시 및 장소 일시 {changed} 09:00')
    else:
        conflict['entries'][0][field] += ' changed'
    with pytest.raises(psycopg.Error), connection.transaction():
        ingest(cur, conflict, 'dart_ir')
    assert selected_row(cur, source) == before


def test_rearchived_body_and_new_locator_can_refresh_unchanged_selected_facts(onboard_db):
    _, cur = onboard_db
    source = add_dart(cur)
    _, manifest = family_snapshot()
    assert ingest(cur, manifest, 'dart_ir') == 1
    before = selected_row(cur, source)[0]
    refreshed = copy.deepcopy(manifest)
    body_sha = hashlib.sha256(b'Synthetic repackaged HTML; same source-stated schedule and quote.').hexdigest()
    refreshed['documents'][-1].update(
        body_sha256=body_sha, body_object_key=f'calendar/{source}/documents/{body_sha}.html',
    )
    refreshed['entries'][0].update(body_sha256=body_sha, location='99664/table/tr[2]/일시')
    assert ingest(cur, refreshed, 'dart_ir') == 1
    after = selected_row(cur, source)[0]
    assert after[:6] == before[:6] and after[6] != before[6]
    assert cur.execute('SELECT source_location FROM calendar_items WHERE id=%s', (after[0],)).fetchone()[0] == '99664/table/tr[2]/일시'
    assert cur.execute('SELECT provenance FROM app_private.calendar_snapshots WHERE id=%s', (after[6],)).fetchone()[0] == refreshed
    assert cur.execute('SELECT count(*) FROM app_private.calendar_snapshots').fetchone()[0] == 2
    cur.execute('SET LOCAL ROLE authenticated')
    assert cur.execute('SELECT id FROM calendar_items WHERE id=%s', (after[0],)).fetchone()[0] == before[0]


@pytest.mark.parametrize('mutation', [
    'missing_family', 'missing_root_document', 'missing_latest_document', 'duplicate_family',
    'duplicate_root_entry', 'unselected_entry', 'wrong_root_key', 'latest_url_is_original',
    'latest_hash_is_original', 'root_marked_corrected', 'correction_marked_original',
    'contradictory_member_family', 'unordered_family', 'foreign_family_root', 'family_missing_current',
    'latest_outside_receipt_window', 'orphan_document', 'wrong_company',
])
def test_incomplete_conflicting_or_cross_family_lineage_cannot_change_existing_date(onboard_db, mutation):
    import psycopg

    connection, cur = onboard_db
    source = add_dart(cur)
    original, current = family_snapshot()
    assert ingest(cur, original, 'dart_ir') == 1
    before = selected_row(cur, source)
    broken = copy.deepcopy(current)
    family, entry = broken['families'][0], broken['entries'][0]
    if mutation == 'missing_family':
        broken.pop('families')
    elif mutation == 'missing_root_document':
        broken['documents'].pop(0)
    elif mutation == 'missing_latest_document':
        broken['documents'].pop()
    elif mutation == 'duplicate_family':
        broken['families'].append(copy.deepcopy(family))
    elif mutation == 'duplicate_root_entry':
        broken['entries'].append(copy.deepcopy(entry))
    elif mutation == 'unselected_entry':
        entry['receipt_no'] = family['root_receipt_no']
    elif mutation == 'wrong_root_key':
        entry['key'] = family['latest_receipt_no']
    elif mutation == 'latest_url_is_original':
        entry['source_url'] = broken['documents'][0]['main_url']
    elif mutation == 'latest_hash_is_original':
        entry['body_sha256'] = broken['documents'][0]['body_sha256']
    elif mutation == 'root_marked_corrected':
        broken['documents'][0]['corrected'] = True
    elif mutation == 'correction_marked_original':
        broken['documents'][-1]['corrected'] = False
    elif mutation == 'contradictory_member_family':
        broken['documents'][0]['family_receipts'] = [family['root_receipt_no']]
    elif mutation == 'unordered_family':
        family['receipt_nos'].reverse()
        for document in broken['documents']:
            document['family_receipts'].reverse()
    elif mutation == 'foreign_family_root':
        broken['documents'][-1]['root_receipt_no'] = family['root_receipt_no'][:-1] + '9'
    elif mutation == 'family_missing_current':
        family['receipt_nos'] = [family['root_receipt_no']]
    elif mutation == 'latest_outside_receipt_window':
        today = date.fromisoformat(broken['receipt_window']['end'])
        latest = (today + timedelta(days=1)).strftime('%Y%m%d') + '800002'
        old = family['latest_receipt_no']
        family['latest_receipt_no'] = latest
        family['receipt_nos'][-1] = latest
        entry['receipt_no'] = latest
        entry['source_url'] = entry['source_url'].replace(old, latest)
        for document in broken['documents']:
            document['family_receipts'][-1] = latest
        document = broken['documents'][-1]
        document['receipt_no'] = latest
        document['main_url'] = document['main_url'].replace(old, latest)
        document['body_url'] = document['body_url'].replace(old, latest)
    elif mutation == 'orphan_document':
        orphan = copy.deepcopy(broken['documents'][0])
        prior = orphan['receipt_no']
        receipt = prior[:-1] + '9'
        orphan['receipt_no'] = receipt
        orphan['main_url'] = orphan['main_url'].replace(prior, receipt)
        orphan['body_url'] = orphan['body_url'].replace(prior, receipt)
        broken['documents'].append(orphan)
    else:
        broken['company_id'] = '10000000-0000-4000-8000-000000000083'
    with pytest.raises(psycopg.Error), connection.transaction():
        ingest(cur, broken, 'dart_ir')
    assert selected_row(cur, source) == before
    assert cur.execute('SELECT count(*) FROM app_private.calendar_snapshots').fetchone()[0] == 1


@pytest.mark.parametrize('member,kind', [(0, 'main'), (0, 'body'), (1, 'main'), (1, 'body')])
def test_every_original_and_correction_member_must_be_archived_before_replacement(onboard_db, member, kind):
    import psycopg

    connection, cur = onboard_db
    source = add_dart(cur)
    original, current = family_snapshot()
    assert ingest(cur, original, 'dart_ir') == 1
    before = selected_row(cur, source)
    values = archive_manifest(cur, current)
    cur.execute('DELETE FROM storage.objects WHERE name=%s', (current['documents'][member][kind + '_object_key'],))
    with pytest.raises(psycopg.Error, match='calendar_archive_missing'), connection.transaction():
        cur.execute('SELECT sb_calendar_ingest_dart_ir(%s,%s,%s,%s)', values)
    assert selected_row(cur, source) == before


def test_tampered_corrected_row_source_is_not_publicly_verified(onboard_db):
    _, cur = onboard_db
    source = add_dart(cur)
    _, current = family_snapshot()
    assert ingest(cur, current, 'dart_ir') == 1
    row = selected_row(cur, source)[0]
    cur.execute('UPDATE calendar_items SET source_url=%s WHERE id=%s', (current['documents'][0]['main_url'], row[0]))
    assert not cur.execute('SELECT app_private.sb_calendar_confirmed(%s)', (row[0],)).fetchone()[0]
    cur.execute('SET LOCAL ROLE authenticated')
    assert cur.execute('SELECT id FROM calendar_items WHERE id=%s', (row[0],)).fetchall() == []
