"""Research integration regressions against disposable PostgreSQL; all data synthetic."""
import json
from uuid import uuid4

import pytest
from sqlalchemy import text
from test_workspace_schema import A, B, C, F
from test_workspace_schema import db as db


def call(conn, action, p=None):
    return conn.execute(text('select public.sb_research(:a,cast(:p as jsonb))'),
                        {'a': action, 'p': json.dumps(p or {})}).scalar()


def identity(conn, user, admin=False):
    conn.exec_driver_sql('RESET ROLE')
    if admin:
        conn.execute(text('insert into app_private.sb_admin_users(user_id) values(:u) on conflict do nothing'),
                     {'u': user})
    conn.exec_driver_sql('SET LOCAL ROLE authenticated')
    conn.execute(text("select set_config('request.jwt.claim.sub',:u,true)"), {'u': user})
    conn.exec_driver_sql('select public.sb_initialize_profile()')


@pytest.fixture
def conn(db):
    save = db.begin_nested()
    identity(db, A, True)
    yield db
    save.rollback()


def denied(conn, action, p, code):
    point = conn.begin_nested()
    with pytest.raises(Exception) as caught:
        call(conn, action, p)
    point.rollback()
    assert caught.value.orig.sqlstate == code


def experiment(conn, design='between'):
    variant = {'content': 'Synthetic financial source revenue is 123 USD in FY2025.',
               'question': 'What is the revenue?', 'answer': '123',
               'source_url': 'https://www.sec.gov/Archives/edgar/data/1/test.htm'}
    value = {'name': 'Synthetic study', 'hypothesis': 'Synthetic test hypothesis only.', 'screen': 'event',
             'design': design, 'ratio': 50, 'metric': 'accuracy',
             'consent_text': 'Synthetic research consent with deletion and ninety day retention.',
             'config': {'A': variant, 'B': {**variant, 'answer': '456'}}}
    eid = call(conn, 'experiment_create', value)['id']
    call(conn, 'experiment_status', {'id': eid, 'status': 'running'})
    return eid


def test_access_and_no_direct_table_read(conn):
    identity(conn, B)
    for action in ['experiments', 'datasets', 'evaluations', 'quality', 'reliability', 'reports']:
        denied(conn, action, {}, 'PT403')
    point = conn.begin_nested()
    with pytest.raises(Exception):
        conn.exec_driver_sql('select * from app_private.research_participants')
    point.rollback()


def test_between_assignment_exposure_submission_and_withdrawal(conn):
    eid = experiment(conn)
    identity(conn, B)
    before = call(conn, 'study', {'id': eid})
    assert before['step'] is None and before['joined'] is False
    denied(conn, 'join', {'id': eid, 'consent': False, 'consent_version': 'research-v1'}, 'PT409')
    joined = call(conn, 'join', {'id': eid, 'consent': True, 'consent_version': 'research-v1'})
    assert 'answer' not in joined['step']
    assert joined == call(conn, 'join', {'id': eid, 'consent': True, 'consent_version': 'research-v1'})
    denied(conn, 'submit', {'id': eid, 'phase': 0, 'answer': '123', 'confidence': 3}, 'PT409')
    call(conn, 'expose', {'id': eid, 'phase': 0})
    call(conn, 'expose', {'id': eid, 'phase': 0})
    call(conn, 'study_event', {'id': eid, 'phase': 0, 'active_ms': 1000, 'evidence_opened': True})
    for _ in range(2):
        call(conn, 'submit', {'id': eid, 'phase': 0, 'answer': '123', 'confidence': 3})
    assert call(conn, 'study', {'id': eid})['complete'] is True
    identity(conn, A)
    result = call(conn, 'experiment', {'id': eid})
    assert sum(g['exposed'] for g in result['groups']) == 1
    assert sum(g['completed'] for g in result['groups']) == 1
    assert len(result['participants']) == 1
    assert 'user_id' not in result['participants'][0]
    identity(conn, B)
    call(conn, 'withdraw', {'id': eid})
    denied(conn, 'join', {'id': eid, 'consent': True, 'consent_version': 'research-v1'}, 'PT403')
    identity(conn, A)
    assert not call(conn, 'experiment', {'id': eid})['participants']
    assert sum(g['exposed'] for g in call(conn, 'reports')['experiments'][0]['groups']) == 0


def test_crossover_stable_sequence_and_phase_isolation(conn):
    eid = experiment(conn, 'crossover')
    identity(conn, B)
    call(conn, 'join', {'id': eid, 'consent': True, 'consent_version': 'research-v1'})
    denied(conn, 'expose', {'id': eid, 'phase': 1}, 'PT409')
    call(conn, 'expose', {'id': eid, 'phase': 0})
    call(conn, 'submit', {'id': eid, 'phase': 0, 'answer': '123', 'confidence': 4})
    assert call(conn, 'study', {'id': eid})['phase'] == 1
    call(conn, 'submit', {'id': eid, 'phase': 0, 'answer': '123', 'confidence': 4})
    assert call(conn, 'study', {'id': eid})['phase'] == 1
    call(conn, 'expose', {'id': eid, 'phase': 1})
    call(conn, 'submit', {'id': eid, 'phase': 1, 'answer': '456', 'confidence': 4})
    identity(conn, A)
    result = call(conn, 'experiment', {'id': eid})
    assert all(g['assigned'] == 1 and g['exposed'] == 1 for g in result['groups'])
    assert {p['variant'] for p in result['participants']} == {'A', 'B'}


def test_consent_dedupe_and_delete(conn):
    event = {'id': str(uuid4()), 'session_id': str(uuid4()), 'page_id': str(uuid4()),
             'screen': 'today', 'device': 'desktop', 'kind': 'view', 'active_ms': 0}
    assert call(conn, 'track', event)['recorded'] is False
    conn.exec_driver_sql('RESET ROLE')
    conn.execute(text('update public.users set analytics_consent=true where id=:u'), {'u': A})
    identity(conn, A)
    call(conn, 'track', event)
    call(conn, 'track', event)
    result = call(conn, 'analytics')
    assert result['views'] == 1 and result['users'] == 1
    denied(conn, 'track', {**event, 'question': 'must never collect'}, 'PT422')
    call(conn, 'analytics_delete')
    assert call(conn, 'analytics')['views'] == 0


def test_dataset_independence_holdout_freeze_and_run_idempotency(conn):
    conn.exec_driver_sql('RESET ROLE')
    conn.execute(text("update public.companies set ticker='AAPL' where id=:c"), {'c': C})
    previous = str(uuid4())
    conn.execute(text("""insert into public.us_filings(id,company_id,accession,form,filing_date,document_url,source_url,source_sha256)
       values(:p,:c,'0000000001-25-000001','10-K','2025-10-01','https://www.sec.gov/Archives/edgar/data/1/previous.htm',
       'https://data.sec.gov/submissions/CIK0000000001.json',repeat('0',64))"""), {'p': previous, 'c': C})
    identity(conn, A)
    dataset = call(conn, 'dataset_create', {'name': 'Synthetic SEC comparison', 'split': 'review'})['id']
    value = {'dataset_id': dataset, 'filing_id': F, 'previous_filing_id': previous, 'field': 'Revenue',
             'period': 'FY2026', 'previous_period': 'FY2025', 'unit': 'USD', 'expected': '123.45',
             'previous_expected': '100', 'answerable': True,
             'quote': 'Synthetic revenue 123.45 USD FY2026', 'previous_quote': 'Synthetic revenue 100 USD FY2025'}
    cid = call(conn, 'case_create', value)['id']
    denied(conn, 'case_review', {'id': cid, 'status': 'approved', 'reason': 'Synthetic independent review'}, 'PT403')
    denied(conn, 'evaluation_create', {'dataset_id': dataset, 'method': 'C', 'idempotency_key': str(uuid4())}, 'PT409')
    holdout = call(conn, 'dataset_create', {'name': 'Synthetic holdout', 'split': 'holdout'})['id']
    denied(conn, 'case_create', {**value, 'dataset_id': holdout}, 'PT409')
    identity(conn, B, True)
    call(conn, 'case_review', {'id': cid, 'status': 'approved', 'reason': 'Independent synthetic test review'})
    run = {'dataset_id': dataset, 'method': 'C', 'idempotency_key': str(uuid4())}
    rid = call(conn, 'evaluation_create', run)['id']
    assert call(conn, 'evaluation_create', run)['id'] == rid
    assert call(conn, 'evaluation', {'id': rid})['status'] == 'queued'
    denied(conn, 'case_review', {'id': cid, 'status': 'held', 'reason': 'Cannot mutate frozen gold'}, 'PT409')
    denied(conn, 'case_create', value, 'PT409')


def test_empty_reports_quality_reliability_and_fault_evidence(conn):
    assert call(conn, 'quality')['analyses'] == []
    assert call(conn, 'reliability')['api_error_rate'] is None
    assert call(conn, 'reports')['evaluations'] == []
    denied(conn, 'check_record', {'name': 'fault injection', 'environment': 'production',
                                'status': 'passed', 'evidence': 'Never inject production faults'}, 'PT403')
    call(conn, 'check_record', {'name': 'denied admin access', 'environment': 'local',
                              'status': 'passed', 'evidence': 'Disposable SQL integration denied PT403'})
    assert len(call(conn, 'reliability')['checks']) == 1


def test_metrics_are_server_only_and_retention_purges_expired_records(conn):
    point = conn.begin_nested()
    with pytest.raises(Exception):
        conn.exec_driver_sql('select public.sb_research_observe(500,123)')
    point.rollback()
    conn.exec_driver_sql('RESET ROLE')
    conn.exec_driver_sql('SET LOCAL ROLE service_role')
    conn.exec_driver_sql('select public.sb_research_observe(500,123)')
    conn.exec_driver_sql('select public.sb_research_observe(200,321)')
    identity(conn, A)
    metrics = call(conn, 'reliability')
    assert metrics['api_requests'] == 2 and metrics['api_error_rate'] == 0.5
    assert metrics['api_latency_ms'] == 222
    eid = experiment(conn)
    identity(conn, B)
    call(conn, 'join', {'id': eid, 'consent': True, 'consent_version': 'research-v1'})
    call(conn, 'expose', {'id': eid, 'phase': 0})
    conn.exec_driver_sql('RESET ROLE')
    conn.execute(text("update app_private.research_participants set expires_at=now()-interval '1 day' where experiment_id=:id"), {'id': eid})
    conn.exec_driver_sql('SET LOCAL ROLE service_role')
    conn.exec_driver_sql('select public.sb_research_retention()')
    identity(conn, A)
    assert not call(conn, 'experiment', {'id': eid})['participants']
    conn.exec_driver_sql('RESET ROLE')
    assert conn.exec_driver_sql('select count(*) from app_private.research_observations').scalar() == 0


def test_budget_changes_are_bounded_and_audited(conn):
    call(conn, 'evaluation_budget', {'usd': 1})
    assert call(conn, 'datasets')['daily_budget_usd'] == 1
    denied(conn, 'evaluation_budget', {'usd': 100}, 'PT422')
    identity(conn, B)
    denied(conn, 'evaluation_budget', {'usd': 1}, 'PT403')
