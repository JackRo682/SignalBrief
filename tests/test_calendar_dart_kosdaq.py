"""Verified K/70050 IR matrices retain the existing archive and correction gates."""
import copy
import json
from datetime import date, timedelta

import pytest
from test_calendar_dart_corrections import family_snapshot, selected_row
from test_calendar_onboarding import ROOT, add_dart, archive_manifest, dart_manifest, ingest
from test_calendar_onboarding import calendar_db as calendar_db
from test_calendar_onboarding import onboard_db as onboard_db

pytestmark = pytest.mark.postgres
MIGRATION = ROOT / 'supabase/migrations/20261104143223_calendar_dart_kosdaq_70050.sql'


@pytest.fixture
def kosdaq_db(onboard_db):
    connection, cur = onboard_db
    cur.execute(MIGRATION.read_text(), prepare=False)
    yield connection, cur


def kosdaq_manifest(*, corrections=0, duration=0, occurrence_offset=8):
    _, manifest = family_snapshot(corrections=corrections, occurrence_offset=occurrence_offset)
    for document in manifest['documents']:
        document['template_id'] = '70050'
    entry = manifest['entries'][0]
    start = entry['occurs_on']
    end = (date.fromisoformat(start) + timedelta(days=duration)).isoformat()
    entry.update(location='70050/table/tr[2]/시작일',
                 quote=f'1. 일시 행사일 시간(현지시간) 시작일 종료일 시작시간 종료시간 {start} {end} 09:00 10:00')
    if duration:
        entry['ends_on'] = end
        entry['title'] += f' · 기간 시작 ({start}–{end})'
    return manifest


@pytest.mark.parametrize('duration', [0, 2, 31])
def test_archived_kosdaq_event_is_confirmed_date_only_and_idempotent(kosdaq_db, duration):
    _, cur = kosdaq_db
    source = add_dart(cur, market='KOSDAQ')
    manifest = kosdaq_manifest(duration=duration)
    assert ingest(cur, manifest, 'dart_ir') == 1
    before = selected_row(cur, source)
    assert ingest(cur, manifest, 'dart_ir') == 1
    assert selected_row(cur, source) == before
    row = before[0]
    assert row[3] == date.fromisoformat(manifest['entries'][0]['occurs_on'])
    assert row[-1] == 'confirmed'
    assert cur.execute('SELECT source_timezone FROM calendar_items WHERE id=%s', (row[0],)).fetchone()[0] is None
    assert cur.execute('SELECT app_private.sb_calendar_confirmed(%s)', (row[0],)).fetchone()[0]
    assert cur.execute('SELECT provenance FROM app_private.calendar_snapshots WHERE id=%s', (row[6],)).fetchone()[0] == manifest
    cur.execute('SET LOCAL ROLE authenticated')
    assert cur.execute('SELECT id FROM calendar_items WHERE id=%s', (row[0],)).fetchone()[0] == row[0]


@pytest.mark.parametrize('mutation', [
    'missing_end', 'null_end', 'wrong_end', 'quoted_end_mismatch', 'unlabelled_range',
    'reversed_dates', 'overlong_range', 'missing_matrix_labels', 'wrong_location',
    'missing_template', 'numeric_template', 'wrong_template', 'legacy_schema', 'timezone',
])
def test_malformed_or_unproven_kosdaq_range_cannot_publish(kosdaq_db, mutation):
    import psycopg

    connection, cur = kosdaq_db
    source = add_dart(cur, market='KOSDAQ')
    manifest = kosdaq_manifest(duration=2)
    entry = manifest['entries'][0]
    if mutation == 'missing_end':
        entry.pop('ends_on')
    elif mutation == 'null_end':
        entry['ends_on'] = None
    elif mutation == 'wrong_end':
        entry['ends_on'] = entry['occurs_on']
    elif mutation == 'quoted_end_mismatch':
        entry['quote'] = entry['quote'].replace(entry['ends_on'], entry['occurs_on'])
    elif mutation == 'unlabelled_range':
        entry['title'] = 'Synthetic issuer official IR presentation'
    elif mutation in ('reversed_dates', 'overlong_range'):
        changed = (date.fromisoformat(entry['occurs_on']) + timedelta(days=-1 if mutation == 'reversed_dates' else 32)).isoformat()
        entry['quote'] = entry['quote'].replace(entry['ends_on'], changed)
        entry['title'] = entry['title'].replace(entry['ends_on'], changed)
        entry['ends_on'] = changed
    elif mutation == 'missing_matrix_labels':
        entry['quote'] = entry['quote'].replace('시작일 종료일', '행사일 결정일')
    elif mutation == 'wrong_location':
        entry['location'] = '99664/table/tr[2]/일시'
    elif mutation == 'missing_template':
        manifest['documents'][0].pop('template_id')
    elif mutation in ('numeric_template', 'wrong_template'):
        manifest['documents'][0]['template_id'] = 70050 if mutation == 'numeric_template' else '99664'
    elif mutation == 'legacy_schema':
        manifest['schema'] = 'signalbrief.calendar.dart-ir.v1'
    else:
        entry['timezone'] = 'Asia/Seoul'
    with pytest.raises(psycopg.Error), connection.transaction():
        ingest(cur, manifest, 'dart_ir')
    assert selected_row(cur, source) == []
    assert cur.execute('SELECT count(*) FROM app_private.calendar_snapshots').fetchone()[0] == 0


@pytest.mark.parametrize('market', ['KOSPI', 'KR'])
def test_70050_requires_verified_kosdaq_source_market(kosdaq_db, market):
    import psycopg

    connection, cur = kosdaq_db
    add_dart(cur, market=market)
    with pytest.raises(psycopg.Error, match='invalid_calendar_document'), connection.transaction():
        ingest(cur, kosdaq_manifest(), 'dart_ir')


def test_kosdaq_correction_preserves_root_identity_and_rejects_unannounced_revision(kosdaq_db):
    import psycopg

    connection, cur = kosdaq_db
    source = add_dart(cur, market='KOSDAQ')
    original = kosdaq_manifest()
    assert ingest(cur, original, 'dart_ir') == 1
    before = selected_row(cur, source)[0]
    corrected = kosdaq_manifest(corrections=1, occurrence_offset=10)
    assert ingest(cur, corrected, 'dart_ir') == 1
    current = selected_row(cur, source)
    assert current[0][:3] == before[:3]
    assert current[0][3] == date.fromisoformat(corrected['entries'][0]['occurs_on'])
    conflicting = copy.deepcopy(corrected)
    conflicting['entries'][0]['title'] += ' changed without a new receipt'
    with pytest.raises(psycopg.Error, match='calendar_revision_conflict'), connection.transaction():
        ingest(cur, conflicting, 'dart_ir')
    with pytest.raises(psycopg.Error, match='stale_calendar_revision'), connection.transaction():
        ingest(cur, original, 'dart_ir')
    assert selected_row(cur, source) == current


@pytest.mark.parametrize('member,kind', [(0, 'main'), (0, 'body'), (1, 'main'), (1, 'body')])
def test_kosdaq_requires_original_and_corrected_archives(kosdaq_db, member, kind):
    import psycopg

    connection, cur = kosdaq_db
    source = add_dart(cur, market='KOSDAQ')
    manifest = kosdaq_manifest(corrections=1)
    values = archive_manifest(cur, manifest)
    cur.execute('DELETE FROM storage.objects WHERE name=%s', (manifest['documents'][member][kind + '_object_key'],))
    with pytest.raises(psycopg.Error, match='calendar_archive_missing'), connection.transaction():
        cur.execute('SELECT sb_calendar_ingest_dart_ir(%s,%s,%s,%s)', values)
    assert selected_row(cur, source) == []


def test_legacy_99664_and_service_only_privileges_are_preserved(kosdaq_db):
    import psycopg

    connection, cur = kosdaq_db
    add_dart(cur, market='KOSPI')
    assert ingest(cur, dart_manifest(), 'dart_ir') == 1
    for signature in [
        'public.sb_calendar_ingest_dart_ir(text,text,text,text)',
        'app_private.calendar_dart_ir_entry_format_valid(jsonb,jsonb,text,boolean)',
    ]:
        for role in ('anon', 'authenticated'):
            assert not cur.execute("SELECT has_function_privilege(%s,%s,'EXECUTE')", (role, signature)).fetchone()[0]
        assert cur.execute("SELECT has_function_privilege('service_role',%s,'EXECUTE')", (signature,)).fetchone()[0]
    values = archive_manifest(cur, dart_manifest())
    with pytest.raises(psycopg.Error, match='permission denied'), connection.transaction():
        cur.execute('SET LOCAL ROLE authenticated')
        cur.execute('SELECT sb_calendar_ingest_dart_ir(%s,%s,%s,%s)', values)
    item = kosdaq_manifest(duration=2)['entries'][0]
    item.pop('ends_on')
    assert cur.execute('SELECT app_private.calendar_dart_ir_entry_format_valid(%s::jsonb,%s::jsonb,%s,true)',
                       (json.dumps(item), json.dumps(kosdaq_manifest(duration=2)['documents']), 'KOSDAQ')).fetchone()[0] is False
