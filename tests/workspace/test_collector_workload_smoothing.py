"""Real enqueue SQL with network/cron test doubles in a disposable database."""
from pathlib import Path

import psycopg
import pytest
from sqlalchemy import text
from test_workspace_schema import db as db
from test_workspace_schema import own as own

pytestmark = pytest.mark.postgres
ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / 'supabase/migrations/20261110062950_collector_workload_smoothing.sql'


@pytest.fixture
def collector(own):
    conn = own
    conn.exec_driver_sql('RESET ROLE')
    conn.exec_driver_sql("""
      CREATE SCHEMA net;
      CREATE FUNCTION net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer)
      RETURNS bigint LANGUAGE sql AS $$SELECT 100::bigint$$;
      CREATE SCHEMA cron;
      CREATE TABLE cron.job(jobid bigint,jobname text,schedule text,active boolean);
      INSERT INTO cron.job VALUES(2,'signalbrief-official-filings','*/15 * * * *',true),
        (3,'signalbrief-notifications','*/5 * * * *',true);
      CREATE FUNCTION cron.alter_job(job_id bigint,schedule text) RETURNS void
      LANGUAGE sql AS $$UPDATE cron.job SET schedule=alter_job.schedule WHERE jobid=job_id$$;
    """)
    original = (ROOT / 'docs/sql/collector.sql').read_text()
    enqueue = original.split('CREATE OR REPLACE FUNCTION app_private.enqueue_collector()', 1)[1]
    enqueue = 'CREATE OR REPLACE FUNCTION app_private.enqueue_collector()' + enqueue.split('END $$;', 1)[0] + 'END $$;'
    with conn.connection.driver_connection.cursor() as cur:
        cur.execute(enqueue, prepare=False)
        cur.execute(MIGRATION.read_text(), prepare=False)
    conn.exec_driver_sql("""INSERT INTO app_private.us_config(key,value)
        VALUES('scheduled_ingestion_enabled','true') ON CONFLICT(key) DO UPDATE SET value='true'""")
    return conn


def test_disabled_collection_stays_disabled(collector):
    collector.exec_driver_sql("UPDATE app_private.us_config SET value='false' WHERE key='scheduled_ingestion_enabled'")
    assert collector.exec_driver_sql('SELECT app_private.enqueue_collector()').scalar() is None
    assert collector.exec_driver_sql('SELECT count(*) FROM app_private.collector_runs').scalar() == 0


def test_enqueue_replay_and_expiry_remain_bounded(collector):
    assert collector.exec_driver_sql('SELECT app_private.enqueue_collector()').scalar() == 100
    assert collector.exec_driver_sql('SELECT app_private.enqueue_collector()').scalar() is None
    collector.exec_driver_sql("UPDATE app_private.collector_runs SET expires_at=now()-interval '1 second'")
    assert collector.exec_driver_sql('SELECT app_private.enqueue_collector()').scalar() == 100
    assert collector.exec_driver_sql("SELECT count(*) FROM app_private.collector_runs WHERE state='pending'").scalar() == 1
    assert collector.exec_driver_sql("SELECT summary->>'code' FROM app_private.collector_runs WHERE state='error'").scalar() == 'lease_expired'


def test_busy_enqueue_returns_without_waiting(collector):
    url = collector.engine.url.render_as_string(hide_password=False).replace('postgresql+psycopg', 'postgresql')
    with psycopg.connect(url, autocommit=True) as other:
        other.execute('SELECT pg_advisory_lock(20261014,1)')
        try:
            collector.exec_driver_sql("SET LOCAL statement_timeout='500ms'")
            assert collector.exec_driver_sql('SELECT app_private.enqueue_collector()').scalar() is None
            assert collector.exec_driver_sql('SELECT count(*) FROM app_private.collector_runs').scalar() == 0
        finally:
            other.execute('SELECT pg_advisory_unlock(20261014,1)')


def test_cadence_and_other_jobs_are_preserved(collector):
    rows = collector.execute(text('SELECT jobname,schedule,active FROM cron.job ORDER BY jobid')).all()
    assert rows == [('signalbrief-official-filings', '7,22,37,52 * * * *', True),
                    ('signalbrief-notifications', '*/5 * * * *', True)]
    definition = collector.exec_driver_sql("SELECT indexdef FROM pg_indexes WHERE indexname='collector_runs_active_expiry'").scalar()
    assert 'expires_at' in definition and 'pending' in definition and 'running' in definition
