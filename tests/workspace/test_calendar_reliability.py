"""Replay the calendar repair against real, disposable PostgreSQL only."""
import json
from pathlib import Path

import pytest
from sqlalchemy import text
from test_workspace_schema import A, B, C
from test_workspace_schema import db as db
from test_workspace_schema import own as own

pytestmark = pytest.mark.postgres
ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture
def calendar_fix(own):
    own.exec_driver_sql('RESET ROLE')
    with own.connection.driver_connection.cursor() as cursor:
        cursor.execute((ROOT / 'supabase/migrations/20261101040435_calendar_reliability.sql').read_text(), prepare=False)
    own.exec_driver_sql('SET LOCAL ROLE authenticated')
    return own


def action(conn, name, payload):
    return conn.execute(text('select public.sb_user_action(:name,cast(:p as jsonb))'),
                        {'name': name, 'p': json.dumps(payload)}).scalar()


def test_selected_company_survives_personal_event_creation(calendar_fix):
    event = action(calendar_fix, 'calendar_add', {'title': 'Synthetic review', 'occurs_on': '2030-01-15', 'company_id': C})
    assert event['company_id'] == C and event['user_id'] == A and event['origin'] == 'user'
    assert str(event['occurs_on']) == '2030-01-15'
    stored = calendar_fix.execute(text('select company_id from public.calendar_items where id=:id'), {'id': event['id']}).scalar()
    assert stored == C
    unscoped = action(calendar_fix, 'calendar_add', {'title': 'Synthetic personal note', 'occurs_on': '2030-01-16'})
    assert unscoped['company_id'] is None


@pytest.mark.parametrize('company_id', ['20000000-0000-4000-8000-000000000002', 'missing-company'])
def test_demo_and_unknown_companies_are_rejected(calendar_fix, company_id):
    point = calendar_fix.begin_nested()
    with pytest.raises(Exception) as caught:
        action(calendar_fix, 'calendar_add', {'title': 'Synthetic invalid', 'occurs_on': '2030-01-15', 'company_id': company_id})
    point.rollback()
    assert caught.value.orig.sqlstate == 'PT404'
    assert calendar_fix.exec_driver_sql('select count(*) from public.calendar_items').scalar() == 0


def test_other_user_cannot_read_or_remove_company_scoped_personal_event(calendar_fix):
    event = action(calendar_fix, 'calendar_add', {'title': 'Synthetic private', 'occurs_on': '2030-01-15', 'company_id': C})
    calendar_fix.execute(text("select set_config('request.jwt.claim.sub',:u,true)"), {'u': B})
    assert calendar_fix.exec_driver_sql('select count(*) from public.calendar_items').scalar() == 0
    action(calendar_fix, 'calendar_remove', {'id': event['id']})
    calendar_fix.execute(text("select set_config('request.jwt.claim.sub',:u,true)"), {'u': A})
    assert calendar_fix.exec_driver_sql('select count(*) from public.calendar_items').scalar() == 1
    action(calendar_fix, 'calendar_remove', {'id': event['id']})
    assert calendar_fix.exec_driver_sql('select count(*) from public.calendar_items').scalar() == 0


def test_coverage_distinguishes_unconnected_company_from_source_error(calendar_fix):
    coverage = calendar_fix.execute(text('select public.sb_calendar_coverage(:id)'), {'id': C}).scalar()
    assert coverage['registered_companies'] == 1 and coverage['covered_companies'] == 0
    assert coverage['selected'] == {'company_id': C, 'source_count': 0, 'last_success_at': None, 'has_error': False}
    calendar_fix.exec_driver_sql('RESET ROLE')
    calendar_fix.exec_driver_sql("update app_private.calendar_sources set ticker='TEST',market='NASDAQ',last_success_at=now()-interval '2 days',error_code='provider_unavailable' where key='microsoft-ir'")
    calendar_fix.exec_driver_sql('SET LOCAL ROLE authenticated')
    coverage = calendar_fix.execute(text('select public.sb_calendar_coverage(:id)'), {'id': C}).scalar()
    assert coverage['covered_companies'] == 1
    assert coverage['selected']['source_count'] == 1 and coverage['selected']['has_error'] is True
    assert coverage['selected']['last_success_at'] is not None
    assert 'error_code' not in str(coverage) and 'source_url' not in str(coverage)


def test_coverage_requires_authenticated_user_and_rejects_hidden_company(calendar_fix):
    for role, identity, expected in [('anon', A, '42501'), ('authenticated', '', 'PT401')]:
        point = calendar_fix.begin_nested()
        calendar_fix.exec_driver_sql(f'SET LOCAL ROLE {role}')
        calendar_fix.execute(text("select set_config('request.jwt.claim.sub',:u,true)"), {'u': identity})
        with pytest.raises(Exception) as caught:
            calendar_fix.exec_driver_sql('select public.sb_calendar_coverage()')
        point.rollback()
        assert caught.value.orig.sqlstate == expected
    point = calendar_fix.begin_nested()
    with pytest.raises(Exception) as caught:
        calendar_fix.exec_driver_sql("select public.sb_calendar_coverage('20000000-0000-4000-8000-000000000002')")
    point.rollback()
    assert caught.value.orig.sqlstate == 'PT404'
