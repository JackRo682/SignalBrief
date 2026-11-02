"""Bounded IR navigation labels preserve exact issuer and archived-source validation."""
import copy

import pytest
from test_calendar_sec_filing import ROOT
from test_calendar_sec_filing import calendar_db as calendar_db
from test_calendar_sec_filing import filing_db as filing_db
from test_calendar_sec_filing import onboard_db as onboard_db
from test_calendar_sec_filing import sec_ir_db as sec_ir_db
from test_calendar_sec_ir import IR, SOURCE, ingest, manifest

pytestmark = pytest.mark.postgres
MIGRATION = ROOT / 'supabase/migrations/20261102051058_calendar_ir_navigation_labels.sql'
ISSUER = 'Synthetic Official Issuer, Inc.'


@pytest.fixture
def labels_db(filing_db):
    connection, cur = filing_db
    legal_definition = cur.execute("select pg_get_functiondef('app_private.calendar_issuer_name(text)'::regprocedure)").fetchone()[0]
    acl = cur.execute("select proacl::text from pg_proc where oid='app_private.calendar_ir_issuer_label(text)'::regprocedure").fetchone()[0]
    cur.execute(MIGRATION.read_text(), prepare=False)
    assert cur.execute("select pg_get_functiondef('app_private.calendar_issuer_name(text)'::regprocedure)").fetchone()[0] == legal_definition
    assert cur.execute("select proacl::text from pg_proc where oid='app_private.calendar_ir_issuer_label(text)'::regprocedure").fetchone()[0] == acl
    yield connection, cur


@pytest.mark.parametrize('label', [
    f'{ISSUER} - Events & Presentations - Events',
    f'Investor Relations | Events — {ISSUER} | Events and Presentations - Events Calendar',
    f'Events - Investor Overview - {ISSUER} - Events - Events Calendar',
    f'{ISSUER} - Events - Events - Events - Events',
    f'  {ISSUER}   —  Events & Presentations   — Events ',
])
def test_nested_same_issuer_navigation_ingests_with_original_label_and_authenticated_visibility(labels_db, label):
    _, cur = labels_db
    value = manifest()
    value['issuer_evidence'][0]['label'] = label
    assert ingest(cur, value) == 1
    identifier = cur.execute('select id from calendar_items where source_key=%s', (SOURCE,)).fetchone()[0]
    assert cur.execute('select app_private.sb_calendar_confirmed(%s)', (identifier,)).fetchone()[0]
    assert cur.execute("select provenance#>>'{issuer_evidence,0,label}' from app_private.calendar_snapshots where source_key=%s", (SOURCE,)).fetchone()[0] == label
    cur.execute('SET LOCAL ROLE authenticated')
    assert cur.execute('select id from calendar_items where source_key=%s', (SOURCE,)).fetchone()[0] == identifier
    cur.execute('RESET ROLE')


@pytest.mark.parametrize('label', [
    'Foreign Counterparty Corporation - Events & Presentations - Events',
    f'{ISSUER} and Foreign Counterparty - Events & Presentations - Events',
    f'{ISSUER} - Earnings Estimates - Events',
    f'{ISSUER} - Events - Events - Events - Events - Events',
    f'{ISSUER} - Events & Presentations - Events - Foreign Counterparty',
])
def test_foreign_unknown_or_excessive_navigation_labels_cannot_verify_an_issuer(labels_db, label):
    import psycopg
    connection, cur = labels_db
    value = manifest()
    assert ingest(cur, value) == 1
    changed = copy.deepcopy(value)
    changed['issuer_evidence'][0]['label'] = label
    with pytest.raises(psycopg.Error, match='invalid_ir_issuer_identity'), connection.transaction():
        ingest(cur, changed)
    assert cur.execute('select count(*) from calendar_items where source_key=%s', (SOURCE,)).fetchone()[0] == 1
    assert cur.execute('select app_private.sb_calendar_confirmed(id) from calendar_items where source_key=%s', (SOURCE,)).fetchone()[0]


@pytest.mark.parametrize('field,value', [
    ('provider_company_id', '0000000997'),
    ('company_id', '10000000-0000-4000-8000-000000000097'),
    ('ticker', 'FOREIGN'),
    ('source_key', 'sec-ir-0000000997'),
])
def test_navigation_normalization_does_not_weaken_canonical_ids(labels_db, field, value):
    import psycopg
    connection, cur = labels_db
    changed = manifest()
    changed['issuer_evidence'][0]['label'] = f'{ISSUER} - Events & Presentations - Events'
    changed[field] = value
    with pytest.raises(psycopg.Error), connection.transaction():
        ingest(cur, changed)
    assert cur.execute('select count(*) from calendar_items where source_key=%s', (SOURCE,)).fetchone()[0] == 0


def test_nested_matching_root_cannot_hide_a_foreign_second_official_page(labels_db):
    import psycopg
    connection, cur = labels_db
    value = manifest()
    value['issuer_evidence'][0]['label'] = f'{ISSUER} - Events & Presentations - Events'
    url, digest = IR + 'events/', 'c' * 64
    value['documents'].append({'role': 'events', 'url': url, 'parent_url': IR,
                               'raw_sha256': digest, 'object_key': f'calendar/{SOURCE}/discovery/{digest}.html'})
    value['issuer_evidence'].append({'source_url': url, 'raw_sha256': digest,
                                     'label': 'Foreign Counterparty Incorporated - Events - Events Calendar', 'location': 'title[0]'})
    with pytest.raises(psycopg.Error, match='invalid_ir_issuer_identity'), connection.transaction():
        ingest(cur, value)


def test_private_helper_acl_and_legal_name_rules_remain_unchanged(labels_db):
    _, cur = labels_db
    for role in ('anon', 'authenticated', 'service_role'):
        assert not cur.execute("select has_function_privilege(%s,'app_private.calendar_ir_issuer_label(text)','execute')", (role,)).fetchone()[0]
    assert cur.execute('select app_private.calendar_issuer_name(%s)', (ISSUER,)).fetchone()[0] == 'synthetic official issuer'
    assert cur.execute("select prosecdef,provolatile,proconfig from pg_proc where oid='app_private.calendar_ir_issuer_label(text)'::regprocedure").fetchone() == (False, 'i', ['search_path=""'])
