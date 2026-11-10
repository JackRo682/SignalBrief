"""Request-local reuse preserves DTOs, access rules and fresh personal state."""
import json
from pathlib import Path
from statistics import median
from time import perf_counter

import pytest
from sqlalchemy import text
from test_company_official_overview import overview as overview
from test_discovery_reliability import discovery as discovery
from test_home_snapshot import customer, identity
from test_home_snapshot import home as home
from test_home_snapshot import populated as populated
from test_workspace_schema import A, B
from test_workspace_schema import db as db
from test_workspace_schema import own as own

pytestmark = pytest.mark.postgres
ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / 'supabase/migrations/20261110062943_workspace_read_reuse.sql'
OPERATIONS = [
    ('catalog', {'kind': 'company', 'limit': 50}),
    ('catalog', {'kind': 'document', 'days': 30, 'sort': 'newest', 'limit': 50}),
    ('catalog', {'kind': 'analysis', 'sort': 'newest', 'limit': 2}),
    ('catalog', {'q': 'Synthetic', 'limit': 3, 'offset': 1}),
    ('saved_list', {'kind': 'analysis', 'sort': 'newest'}),
    ('saved_list', {'kind': 'document', 'sort': 'oldest'}),
    ('saved_list', {'kind': 'history'}), ('saved_list', {}),
    ('source_overview', {'scope': 'all', 'days': 30}),
    ('source_overview', {'scope': 'following', 'days': 0}),
    ('content_notifications', {}),
]


def apply(conn):
    conn.exec_driver_sql('RESET ROLE')
    with conn.connection.driver_connection.cursor() as cursor:
        cursor.execute(MIGRATION.read_text(), prepare=False)
    identity(conn)


def outputs(conn):
    result = {}
    for user in (A, B):
        identity(conn, user)
        for action, payload in OPERATIONS:
            result[user, action, json.dumps(payload)] = customer(conn, action, payload)
    return result


def test_read_results_and_account_isolation_are_identical(populated):
    before = outputs(populated)
    apply(populated)
    assert outputs(populated) == before
    assert before[A, 'saved_list', '{}'] != before[B, 'saved_list', '{}']


def test_one_projection_and_immediate_read_after_write(populated):
    apply(populated)
    populated.exec_driver_sql('RESET ROLE')
    body = populated.exec_driver_sql("""SELECT prosrc FROM pg_proc
        WHERE oid='app_content_private.workspace(text,jsonb)'::regprocedure""").scalar()
    for start, end in [('source_overview', 'catalog'), ('catalog', 'resource'), ('saved_list', 'save')]:
        branch = body.split(f" WHEN '{start}' THEN", 1)[1].split(f" WHEN '{end}' THEN", 1)[0]
        assert branch.count('app_private.sb_customer_resources()') == 1
        assert 'request_resources AS MATERIALIZED' in branch
    identity(populated)
    assert customer(populated, 'content_notifications')['unread_count'] > 0
    customer(populated, 'content_notification_read', {'all': True})
    assert customer(populated, 'content_notifications')['unread_count'] == 0
    assert customer(populated, 'source_overview')['unread_count'] == 0
    identity(populated, B)
    assert customer(populated, 'content_notifications')['unread_count'] > 0


@pytest.mark.parametrize('user', [None, B])
def test_private_projection_remains_private(populated, user):
    apply(populated)
    populated.exec_driver_sql('RESET ROLE')
    populated.exec_driver_sql('SET LOCAL ROLE anon' if user is None else 'SET LOCAL ROLE authenticated')
    populated.execute(text("SELECT set_config('request.jwt.claim.sub',:u,true)"), {'u': user or ''})
    point = populated.begin_nested()
    with pytest.raises(Exception) as caught:
        populated.exec_driver_sql('SELECT * FROM app_private.sb_customer_notifications()')
    point.rollback()
    assert caught.value.orig.sqlstate == '42501'


def test_read_benchmark_preserves_output(populated, capsys):
    cases = [('catalog', {'kind': 'company', 'limit': 50}),
             ('saved_list', {'kind': 'analysis'}), ('source_overview', {'scope': 'following'})]

    def measure():
        values = {}
        for action, payload in cases:
            timings = []
            for _ in range(3):
                start = perf_counter()
                response = customer(populated, action, payload)
                timings.append((perf_counter() - start) * 1000)
            values[action] = {'median_ms': round(median(timings), 3), 'response': response}
        return values

    before = measure()
    apply(populated)
    after = measure()
    assert {k: v['response'] for k, v in before.items()} == {k: v['response'] for k, v in after.items()}
    # Timing is diagnostic, not a flaky correctness gate on shared CI machines.
    with capsys.disabled():
        print('READ_REUSE_BENCHMARK', json.dumps({k: {'before_ms': before[k]['median_ms'],
              'after_ms': after[k]['median_ms']} for k in before}))
