"""Concurrent SEC calendar ingests cannot overwrite a newer accepted filing revision."""
import os
import threading
import time
import uuid
from urllib.parse import urlsplit, urlunsplit

import pytest
from test_calendar_sec_filing import ROOT, filing_manifest, ingest
from test_calendar_sec_filing import filing_db as filing_db
from test_calendar_sec_filing import onboard_db as onboard_db
from test_calendar_sec_filing import sec_ir_db as sec_ir_db
from test_calendar_sec_ir import SOURCE
from test_calendar_sec_ir import ingest as ingest_ir
from test_calendar_sec_ir import manifest as ir_manifest
from test_micron_calendar_ingestion import calendar_db as base_calendar_db

pytestmark = pytest.mark.postgres
MIGRATION = ROOT / 'supabase/migrations/20261102052159_calendar_sec_filing_ingest_lock.sql'


@pytest.fixture
def isolated_calendar_database(monkeypatch):
    """Separate connections need committed fixtures, confined to an owned temporary DB."""
    import psycopg
    from psycopg import sql

    base_url = os.getenv('SB_TEST_CALENDAR_POSTGRES_URL')
    if not base_url:
        pytest.skip('Disposable calendar PostgreSQL URL not supplied')
    parsed = urlsplit(base_url)
    assert parsed.hostname in ('localhost', '127.0.0.1') and parsed.path.endswith('_test')
    database = 'calendar_sec_lock_' + uuid.uuid4().hex + '_test'
    isolated_url = urlunsplit(parsed._replace(path='/' + database))
    with psycopg.connect(base_url, dbname='postgres', autocommit=True) as admin:
        admin.execute(sql.SQL('CREATE DATABASE {} TEMPLATE template0').format(sql.Identifier(database)))
        monkeypatch.setenv('SB_TEST_CALENDAR_POSTGRES_URL', isolated_url)
        try:
            yield isolated_url
        finally:
            # Only this fixture's generated database is eligible for cleanup.
            assert database.startswith('calendar_sec_lock_') and database.endswith('_test')
            admin.execute(sql.SQL('DROP DATABASE {} WITH (FORCE)').format(sql.Identifier(database)))


@pytest.fixture
def calendar_db(isolated_calendar_database, request):
    yield from base_calendar_db.__wrapped__(request)


@pytest.fixture
def locked_filing_db(isolated_calendar_database, filing_db):
    connection, cur = filing_db
    before = cur.execute("select proacl::text from pg_proc where oid='public.sb_calendar_ingest_sec_ir(text,text,text,text)'::regprocedure").fetchone()[0]
    legacy = cur.execute("select pg_get_functiondef('app_private.calendar_ingest_sec_ir_v1(text,text,text,text)'::regprocedure)").fetchone()[0]
    cur.execute(MIGRATION.read_text(), prepare=False)
    assert cur.execute("select proacl::text from pg_proc where oid='public.sb_calendar_ingest_sec_ir(text,text,text,text)'::regprocedure").fetchone()[0] == before
    assert cur.execute("select pg_get_functiondef('app_private.calendar_ingest_sec_ir_v1(text,text,text,text)'::regprocedure)").fetchone()[0] == legacy
    connection.commit()
    yield connection, cur, isolated_calendar_database


def test_older_concurrent_filing_cannot_overwrite_newer_provenance_or_saved_identity(locked_filing_db):
    import psycopg

    connection, cur, url = locked_filing_db
    baseline = filing_manifest(filing_age=2, filing_sequence=1)
    newer = filing_manifest(filing_age=0, filing_sequence=3)
    older = filing_manifest(filing_age=1, filing_sequence=2)
    assert ingest(cur, baseline) == 1
    identifier = cur.execute('select id from calendar_items where source_key=%s', (SOURCE,)).fetchone()[0]
    connection.commit()
    started = threading.Event()
    outcome = []
    older_pid = []

    def ingest_older():
        with psycopg.connect(url) as competing:
            competing.execute("set statement_timeout='10s'")
            older_pid.append(competing.info.backend_pid)
            started.set()
            try:
                ingest(competing.cursor(), older)
                competing.commit()
                outcome.append('accepted')
            except psycopg.Error as error:
                competing.rollback()
                outcome.append(str(error))

    # Leave the newer revision uncommitted. Without the wrapper lock, the older
    # request reads the previous revision, waits only at the row upsert, then wins.
    assert ingest(cur, newer) == 1
    contender = threading.Thread(target=ingest_older, daemon=True)
    contender.start()
    try:
        assert started.wait(5), 'Competing database connection did not start'
        with psycopg.connect(url, autocommit=True) as observer:
            deadline = time.monotonic() + 5
            while True:
                waiting = observer.execute('select wait_event_type from pg_stat_activity where pid=%s', (older_pid[0],)).fetchone()
                if waiting and waiting[0] == 'Lock':
                    break
                assert contender.is_alive() and time.monotonic() < deadline, 'Older ingest did not reach the concurrent write boundary'
                time.sleep(0.01)
        connection.commit()
        contender.join(10)
        assert not contender.is_alive(), 'Competing ingest did not finish after the newer commit'
        row = cur.execute("""select c.id,s.provenance#>>'{filing,filing_date}',s.provenance#>>'{filing,accession}'
            from calendar_items c join app_private.calendar_snapshots s on s.id=c.source_snapshot_id
            where c.source_key=%s""", (SOURCE,)).fetchone()
        expected = (identifier, newer['filing']['filing_date'], newer['filing']['accession'])
        assert row == expected, {'older_outcome': outcome, 'actual': row, 'expected': expected}
        assert len(outcome) == 1 and 'calendar_filing_conflict' in outcome[0], outcome
        assert cur.execute('select app_private.sb_calendar_confirmed(%s)', (identifier,)).fetchone()[0]
    finally:
        connection.rollback()
        contender.join(12)


@pytest.mark.parametrize('q4', [False, True])
def test_existing_ir_and_q4_branch_still_ingests_idempotently_with_same_visibility(locked_filing_db, q4):
    _, cur, _ = locked_filing_db
    value = ir_manifest(q4=q4)
    assert ingest_ir(cur, value) == 1
    identifier = cur.execute('select id from calendar_items where source_key=%s', (SOURCE,)).fetchone()[0]
    assert ingest_ir(cur, value) == 1
    assert cur.execute('select id from calendar_items where source_key=%s', (SOURCE,)).fetchall() == [(identifier,)]
    assert cur.execute('select app_private.sb_calendar_confirmed(%s)', (identifier,)).fetchone()[0]
    cur.execute('SET LOCAL ROLE authenticated')
    assert cur.execute('select id from calendar_items where source_key=%s', (SOURCE,)).fetchall() == [(identifier,)]
    cur.execute('RESET ROLE')


def test_wrapper_and_private_branch_access_controls_are_preserved(locked_filing_db):
    _, cur, _ = locked_filing_db
    for role in ('anon', 'authenticated'):
        assert not cur.execute("select has_function_privilege(%s,'public.sb_calendar_ingest_sec_ir(text,text,text,text)','execute')", (role,)).fetchone()[0]
    assert cur.execute("select has_function_privilege('service_role','public.sb_calendar_ingest_sec_ir(text,text,text,text)','execute')").fetchone()[0]
    for role in ('anon', 'authenticated', 'service_role'):
        assert not cur.execute("select has_function_privilege(%s,'app_private.calendar_ingest_sec_ir_v1(text,text,text,text)','execute')", (role,)).fetchone()[0]
