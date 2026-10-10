"""Replay real SQL in a disposable PostgreSQL database, never a remote/user DB.

All rows are explicit synthetic fixtures. Auth/Storage/Vault platform schemas are
minimal test doubles; hosted/reference/US/workspace migrations themselves are real.
"""
import importlib.util
import json
import os
from decimal import Decimal
from pathlib import Path
from urllib.parse import urlsplit

import pytest
from sqlalchemy import create_engine, text

pytestmark = pytest.mark.postgres

ROOT = Path(__file__).resolve().parents[2]
A = '10000000-0000-4000-8000-000000000071'
B = '10000000-0000-4000-8000-000000000072'
C = '20000000-0000-4000-8000-000000000001'
F = '30000000-0000-4000-8000-000000000001'
T = '40000000-0000-4000-8000-000000000001'


@pytest.fixture(scope='module')
def db():
    url = os.getenv('SB_TEST_WORKSPACE_POSTGRES_URL')
    if not url:
        pytest.skip('Requires a disposable loopback workspace PostgreSQL database')
    parsed = urlsplit(url.replace('postgresql+psycopg', 'postgresql', 1))
    if parsed.hostname not in ('localhost', '127.0.0.1') or not parsed.path.endswith('_test'):
        pytest.fail('Production forbidden: require loopback database ending in _test')
    engine = create_engine(url)
    connection = engine.connect()
    transaction = connection.begin()
    assert connection.exec_driver_sql("select to_regclass('public.users')").scalar() is None
    connection.exec_driver_sql("""
        CREATE ROLE authenticator NOLOGIN;
        CREATE ROLE anon NOLOGIN;
        CREATE ROLE authenticated NOLOGIN;
        CREATE ROLE service_role NOLOGIN BYPASSRLS;
        CREATE SCHEMA auth;
        CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb);
        CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
        $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
        CREATE TABLE auth.mfa_factors(id uuid,user_id uuid,status text);
        CREATE TABLE auth.sessions(id uuid,user_id uuid,created_at timestamptz,updated_at timestamptz,refreshed_at timestamptz,not_after timestamptz,user_agent text,aal text);
        CREATE TABLE auth.audit_log_entries(id uuid,created_at timestamptz,payload jsonb);
        GRANT USAGE ON SCHEMA auth TO authenticated,anon;
        GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated,anon;
        CREATE SCHEMA storage;
        CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
        CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text,metadata jsonb);
        ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
        GRANT USAGE ON SCHEMA storage TO authenticated;
        GRANT SELECT,INSERT,DELETE ON storage.objects TO authenticated;
        CREATE SCHEMA vault;
        CREATE TABLE vault.secrets(id uuid PRIMARY KEY,name text,created_at timestamptz);
        CREATE TABLE vault.decrypted_secrets(id uuid,name text,decrypted_secret text);
    """)
    spec = importlib.util.spec_from_file_location('hosted_baseline', ROOT / 'scripts/hosted_baseline.py')
    baseline = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(baseline)
    connection.exec_driver_sql(baseline.baseline())
    files = [*sorted((ROOT / 'supabase/hosted').glob('*.sql')),
             *sorted((ROOT / 'supabase/reference-migrations').glob('*.sql')),
             *sorted((ROOT / 'supabase/us-migrations').glob('*.sql')),
             *sorted((ROOT / 'supabase/workspace-migrations').glob('*.sql')),
             *sorted((ROOT / 'supabase/research-migrations').glob('*.sql'))]
    for migration in files:
        if migration.name == 'BASELINE_GENERATED.sql':
            continue
        with connection.connection.driver_connection.cursor() as cursor:
            cursor.execute(migration.read_text(), prepare=False)
    seed = """
        INSERT INTO auth.users VALUES (:a,'a@example.invalid','{"name":"Synthetic A"}'),(:b,'b@example.invalid','{"name":"Synthetic B"}');
        INSERT INTO public.companies(id,name,ticker,market,provider,provider_company_id,is_demo,created_at)
        VALUES (:c,'Synthetic Company','TEST','NASDAQ','sec','0000000001',false,now()),
        ('20000000-0000-4000-8000-000000000002','Excluded demo','DEMO','NASDAQ','sec','0000000002',true,now());
        INSERT INTO public.us_filings(id,company_id,accession,form,filing_date,document_url,source_url,source_sha256)
        VALUES (:f,:c,'0000000001-26-000001','10-K','2026-10-01','https://www.sec.gov/Archives/edgar/data/1/test.htm','https://data.sec.gov/submissions/CIK0000000001.json',repeat('0',64));
        INSERT INTO auth.sessions VALUES
        ('50000000-0000-4000-8000-000000000001',:a,now(),now(),NULL,NULL,'Synthetic browser','aal1'),
        ('50000000-0000-4000-8000-000000000002',:b,now(),now(),NULL,NULL,'Other private device','aal1');
    """
    for statement in seed.split(";"):
        if statement.strip():
            connection.execute(text(statement), {"a": A, "b": B, "c": C, "f": F})
    yield connection
    transaction.rollback()
    connection.close()
    engine.dispose()


@pytest.fixture
def own(db):
    nested = db.begin_nested()
    db.exec_driver_sql('SET LOCAL ROLE authenticated')
    db.execute(text("SELECT set_config('request.jwt.claim.sub',:u,true)"), {'u': A})
    db.exec_driver_sql('SELECT public.sb_initialize_profile()')
    yield db
    nested.rollback()


def rpc(db, action, payload=None):
    return db.execute(text('SELECT public.sb_workspace(:action,cast(:payload AS jsonb))'),
                      {'action': action, 'payload': json.dumps(payload or {})}).scalar()


def document_rpc(db, payload):
    return db.execute(text('SELECT public.sb_document_detail(cast(:payload AS jsonb))'),
                      {'payload': json.dumps(payload)}).scalar()


def document_denied(db, payload, code):
    point = db.begin_nested()
    with pytest.raises(Exception) as caught:
        document_rpc(db, payload)
    point.rollback()
    assert caught.value.orig.sqlstate == code


def seed_reviewed_document(db, chunks=1, state='published', is_demo=False,
                           published_days_ago=0, has_publication_marker=True):
    """Synthetic reviewed evidence satisfying the replayed release-hardening rules."""
    from datetime import datetime, timedelta, timezone
    from uuid import uuid4

    from signalbrief.models import AIRun, Brief, Chunk, Document, Event, Fact, RawBlob, Validation

    stamp = datetime.now(timezone.utc) - timedelta(days=published_days_ago)
    doc, run, event = [str(uuid4()) for _ in range(3)]
    sha = uuid4().hex * 2
    full_quote = 'Synthetic reviewed source quote: 999999999999.12345678 USD. ' * 100
    db.exec_driver_sql('RESET ROLE')
    db.execute(RawBlob.__table__.insert().values(sha256=sha, object_key=f'private/{doc}', byte_length=123456,
                                               content_type='application/pdf'))
    db.execute(Document.__table__.insert().values(id=doc, company_id=C, provider='sec', external_id=doc,
        title='Synthetic reviewed filing', form_type='10-K', source_url=f'https://www.sec.gov/Archives/{doc}.pdf',
        download_url=f'https://private.example.invalid/{doc}', published_at=stamp, publication_date=stamp.date(),
        publication_precision='timestamp', publication_timezone='America/New_York', raw_sha256=sha,
        provider_metadata={'private_provider_field': 'must-not-leak'}, state='complete', is_demo=is_demo))
    db.execute(AIRun.__table__.insert().values(id=run, document_id=doc, stage='extract', model='synthetic-test',
        prompt_version='test', pipeline_version='test', status='validated', validation_result={}))
    db.execute(Event.__table__.insert().values(id=event, company_id=C, document_id=doc, run_id=run, revision='test',
        title='Synthetic reviewed event', event_type='earnings', state=state, published_at=stamp,
        published_to_users_at=stamp if state in ('published', 'superseded') and has_publication_marker else None))
    db.execute(Brief.__table__.insert().values(event_id=event, headline='Synthetic reviewed headline',
        what_happened=full_quote, interpretation='Synthetic interpretation', uncertainty='Synthetic uncertainty',
        monitor_next='Synthetic next check', template_version='test'))
    facts, readable = [], []
    for index in range(chunks + 1):
        chunk, fact = str(uuid4()), str(uuid4())
        db.execute(Chunk.__table__.insert().values(id=chunk, document_id=doc, ordinal=index, parser_version='test',
            text=full_quote if index < chunks else 'UNREVIEWED EXCERPT MUST NOT LEAK', text_sha256=uuid4().hex * 2,
            char_start=index * 10000, char_end=index * 10000 + len(full_quote), location=f'Synthetic section {index + 1}'))
        if index < chunks:
            db.execute(Fact.__table__.insert().values(id=fact, event_id=event, chunk_id=chunk, field='revenue',
                quote=full_quote, value_raw='999999999999.12345678', unit='USD', period='FY 2026',
                scope='consolidated', basis='reported', validation_status='supported'))
            # A supported fact alone is insufficient: the final sb_event_visible
            # also requires persisted supported validation verdicts for its lineage.
            db.execute(Validation.__table__.insert().values(event_id=event, claim_key=f'fact.{index}',
                status='supported', reason='Synthetic exact quote and numeric value are present in this chunk.',
                validator_version='synthetic-test'))
            facts.append(fact)
            readable.append(chunk)
    db.exec_driver_sql('SET LOCAL ROLE authenticated')
    return {'id': doc, 'event': event, 'facts': facts, 'chunks': readable, 'quote': full_quote, 'sha': sha}


def test_document_detail_returns_exact_reviewed_material_and_safe_metadata(own):
    doc = seed_reviewed_document(own)
    payload = {'id': doc['id'], 'kind': 'document'}
    result = document_rpc(own, payload)
    assert result['document']['id'] == doc['id']
    assert result['metadata']['mime_type'] == 'application/pdf'
    assert result['metadata']['size_bytes'] == 123456
    assert result['metadata']['page_count'] is None
    assert result['metadata']['raw_sha256'] == doc['sha']
    assert result['metadata']['publication_timezone'] == 'America/New_York'
    assert result['summaries'][0]['text'] == doc['quote']
    assert result['facts'][0]['value_raw'] == '999999999999.12345678'
    assert result['facts'][0]['quote'] == doc['quote']
    assert result['facts'][0]['event_id'] == doc['event']
    assert result['sections'][0]['content'] == doc['quote']
    assert result['sections_total'] == 1 and result['next_section_offset'] is None
    assert result['sections'][0]['page_start'] is None
    assert result['events'][0]['id'] == doc['event']
    assert result['counts'] == {'summaries': 1, 'facts': 1, 'events': 1, 'related': 1}
    encoded = json.dumps(result)
    for forbidden in ['object_key', 'download_url', 'private_provider_field', 'private.example.invalid', 'UNREVIEWED EXCERPT']:
        assert forbidden not in encoded
    rpc(own, 'save', {'id': doc['id'], 'kind': 'document', 'saved': True})
    assert document_rpc(own, payload)['document']['is_saved'] is True
    own.execute(text("SELECT set_config('request.jwt.claim.sub',:u,true)"), {'u': B})
    assert document_rpc(own, payload)['document']['is_saved'] is False


def test_document_detail_sections_are_paginated_without_repeating_or_truncating(own):
    doc = seed_reviewed_document(own, chunks=13)
    first = document_rpc(own, {'id': doc['id'], 'kind': 'document'})
    second = document_rpc(own, {'id': doc['id'], 'kind': 'document', 'section_offset': first['next_section_offset']})
    assert first['sections_total'] == second['sections_total'] == 13
    assert len(first['sections']) == 12 and len(second['sections']) == 1
    assert first['next_section_offset'] == 12 and second['next_section_offset'] is None
    assert [x['id'] for x in first['sections'] + second['sections']] == doc['chunks']
    assert all(x['content'] == doc['quote'] for x in first['sections'] + second['sections'])


def test_document_detail_does_not_invent_filing_pdf_pages_or_analysis(own):
    result = document_rpc(own, {'id': F, 'kind': 'filing'})
    assert result['document']['publication_precision'] == 'date'
    assert result['metadata']['provider'] == 'sec'
    assert result['metadata']['raw_sha256'] == '0' * 64  # Archived SEC submissions envelope.
    for key in ['mime_type', 'size_bytes', 'page_count', 'publication_timezone']:
        assert result['metadata'][key] is None
    assert result['summaries'] == result['facts'] == result['sections'] == result['events'] == []
    assert result['sections_total'] == 0
    document_denied(own, {'id': F, 'kind': 'document'}, 'PT404')


def test_document_detail_rejects_hidden_documents_and_identity_or_offset_injection(own):
    for state, demo in [('needs_review', False), ('rejected', False), ('published', True)]:
        doc = seed_reviewed_document(own, state=state, is_demo=demo)
        document_denied(own, {'id': doc['id'], 'kind': 'document'}, 'PT404')
    for payload in [None, [], {}, {'id': F, 'kind': 'company'}, {'id': "' OR 1=1 --", 'kind': 'filing'},
                    {'id': F, 'kind': 'filing', 'user_id': B}]:
        document_denied(own, payload, 'PT422')
    for offset in [-1, 1.5, '12', None, 2147483601]:
        document_denied(own, {'id': F, 'kind': 'filing', 'section_offset': offset}, 'PT422')


def test_document_detail_links_prior_evidence_only_to_a_visible_current_event(own):
    from signalbrief.models import Change

    # Explicit boundary: a superseded origin without its own publication marker
    # is not a public event. The existing hardening predicate still permits its
    # validated facts through a published current comparison; do not relax it.
    previous = seed_reviewed_document(own, state='superseded', published_days_ago=1,
                                      has_publication_marker=False)
    document_denied(own, {'id': previous['id'], 'kind': 'document'}, 'PT404')
    current = seed_reviewed_document(own)
    own.exec_driver_sql('RESET ROLE')
    own.execute(Change.__table__.insert().values(event_id=current['event'], current_fact_id=current['facts'][0],
        previous_fact_id=previous['facts'][0], field='revenue', change_type='increased'))
    own.exec_driver_sql('SET LOCAL ROLE authenticated')
    result = document_rpc(own, {'id': previous['id'], 'kind': 'document'})
    assert result['summaries'] == []
    assert result['facts'][0]['origin_event_id'] == previous['event']
    assert result['facts'][0]['event_id'] == current['event']
    assert result['events'][0]['id'] == current['event']
    assert result['sections'][0]['content'] == previous['quote']
    own.exec_driver_sql('RESET ROLE')
    own.execute(text("UPDATE public.events SET state='rejected' WHERE id=:id"), {'id': previous['event']})
    own.exec_driver_sql('SET LOCAL ROLE authenticated')
    document_denied(own, {'id': previous['id'], 'kind': 'document'}, 'PT404')
    document_denied(own, {'id': current['id'], 'kind': 'document'}, 'PT404')


def test_document_detail_preserves_a_previously_published_superseded_origin(own):
    from signalbrief.models import Change

    previous = seed_reviewed_document(own, state='superseded', published_days_ago=1)
    current = seed_reviewed_document(own)
    own.exec_driver_sql('RESET ROLE')
    own.execute(Change.__table__.insert().values(event_id=current['event'], current_fact_id=current['facts'][0],
        previous_fact_id=previous['facts'][0], field='revenue', change_type='increased'))
    own.exec_driver_sql('SET LOCAL ROLE authenticated')
    result = document_rpc(own, {'id': previous['id'], 'kind': 'document'})
    assert result['summaries'][0]['event_id'] == previous['event']
    assert result['summaries'][0]['text'] == previous['quote']
    assert result['facts'][0]['event_id'] == result['facts'][0]['origin_event_id'] == previous['event']
    assert [event['id'] for event in result['events']] == [current['event'], previous['event']]
    assert result['sections'][0]['content'] == previous['quote']
    assert document_rpc(own, {'id': current['id'], 'kind': 'document'})['document']['id'] == current['id']


def test_document_detail_does_not_publish_a_current_event_with_an_unreviewed_ancestor(own):
    from signalbrief.models import Change

    previous = seed_reviewed_document(own, state='needs_review', published_days_ago=1)
    current = seed_reviewed_document(own)
    assert document_rpc(own, {'id': current['id'], 'kind': 'document'})['document']['id'] == current['id']
    own.exec_driver_sql('RESET ROLE')
    own.execute(Change.__table__.insert().values(event_id=current['event'], current_fact_id=current['facts'][0],
        previous_fact_id=previous['facts'][0], field='revenue', change_type='increased'))
    own.exec_driver_sql('SET LOCAL ROLE authenticated')
    assert own.execute(text('SELECT app_private.sb_event_visible(:id)'), {'id': current['event']}).scalar() is False
    document_denied(own, {'id': previous['id'], 'kind': 'document'}, 'PT404')
    document_denied(own, {'id': current['id'], 'kind': 'document'}, 'PT404')


@pytest.mark.parametrize('verdict', [None, 'unsupported'])
def test_document_detail_requires_a_persisted_supported_validation(own, verdict):
    doc = seed_reviewed_document(own)
    assert document_rpc(own, {'id': doc['id'], 'kind': 'document'})['document']['id'] == doc['id']
    own.exec_driver_sql('RESET ROLE')
    if verdict is None:
        own.execute(text('DELETE FROM public.validations WHERE event_id=:id'), {'id': doc['event']})
    else:
        own.execute(text('UPDATE public.validations SET status=:status WHERE event_id=:id'),
                    {'id': doc['event'], 'status': verdict})
    own.exec_driver_sql('SET LOCAL ROLE authenticated')
    document_denied(own, {'id': doc['id'], 'kind': 'document'}, 'PT404')


def test_document_detail_enforces_auth_mfa_and_narrow_function_privileges(own):
    payload = {'id': F, 'kind': 'filing'}
    own.exec_driver_sql('SET LOCAL ROLE anon')
    document_denied(own, payload, '42501')
    own.exec_driver_sql('RESET ROLE')
    own.execute(text("INSERT INTO auth.mfa_factors VALUES (gen_random_uuid(),:u,'verified')"), {'u': A})
    own.exec_driver_sql('SET LOCAL ROLE authenticated')
    document_denied(own, payload, 'PT403')
    own.execute(text("SELECT set_config('request.jwt.claims',:claims,true)"), {'claims': json.dumps({'sub': A, 'aal': 'aal2'})})
    assert document_rpc(own, payload)['document']['id'] == F
    assert own.exec_driver_sql("SELECT prosecdef FROM pg_proc WHERE oid='public.sb_document_detail(jsonb)'::regprocedure").scalar() is False
    assert own.exec_driver_sql("SELECT has_function_privilege('anon','public.sb_document_detail(jsonb)','EXECUTE')").scalar() is False
    assert own.exec_driver_sql("SELECT has_function_privilege('anon','app_mobile_private.document_detail(jsonb)','EXECUTE')").scalar() is False
    own.execute(text("SELECT set_config('request.jwt.claim.sub','',true)"))
    document_denied(own, payload, 'PT401')


def denied(db, action, payload, code):
    savepoint = db.begin_nested()
    with pytest.raises(Exception) as caught:
        rpc(db, action, payload)
    savepoint.rollback()
    assert caught.value.orig.sqlstate == code


def test_default_preferences_and_actual_catalog(own):
    assert rpc(own, 'preferences')['version'] == 0
    assert rpc(own, 'preferences')['value']['history_enabled'] is False
    result = rpc(own, 'catalog')
    assert result['total'] == 2
    assert result['counts'] == {'company': 1, 'filing': 1}
    assert all(not x['is_saved'] for x in result['items'])
    assert rpc(own, 'catalog', {'kind': 'document'})['total'] == 1
    assert rpc(own, 'catalog', {'q': 'DEMO'})['total'] == 0
    assert rpc(own, 'catalog', {'q': "%' OR 1=1--"})['total'] == 0
    assert rpc(own, 'catalog', {'kind': 'company', 'market': 'NYSE'})['total'] == 0


def test_exact_resource_lookup_not_first_page(own):
    doc = rpc(own, 'resource', {'id': F, 'kind': 'filing'})
    assert doc['publication_precision'] == 'date'
    assert doc['id'] == F
    denied(own, 'resource', {'id': B, 'kind': 'filing'}, 'PT404')
    company = rpc(own, 'company', {'id': C})
    assert company['events'] == []
    assert company['facts'] == []
    assert company['documents'][0]['id'] == F
    assert company['holding'] is False


def test_preferences_reject_invalid_types_timezone_and_stale_writes(own):
    result = rpc(own, 'preferences_save', {'version': 0, 'value': {'theme': 'dark', 'locale': 'en'}})
    assert result['version'] == 1 and result['value']['theme'] == 'dark'
    denied(own, 'preferences_save', {'version': 0, 'value': {'theme': 'light'}}, 'PT409')
    for value in [{'timezone': 'Moon/Test'}, {'daily_cap': 0}, {'daily_cap': 1.5}, {'theme': 'banana'}, {'history_enabled': 'true'}, {'email_enabled': True}, {'quiet_start': '25:00'}, {'muted_companies': [B]}]:
        denied(own, 'preferences_save', {'version': 1, 'value': value}, 'PT422')
    assert rpc(own, 'preferences')['value']['theme'] == 'dark'


def test_bookmarks_are_durable_idempotent_and_owned(own):
    for _ in range(2):
        assert rpc(own, 'save', {'kind': 'filing', 'id': F, 'saved': True}) == {'saved': True}
    assert rpc(own, 'saved_list')['counts']['document'] == 1
    assert rpc(own, 'resource', {'id': F, 'kind': 'filing'})['is_saved'] is True
    own.execute(text("SELECT set_config('request.jwt.claim.sub',:u,true)"), {'u': B})
    assert rpc(own, 'saved_list')['items'] == []
    assert own.exec_driver_sql('select count(*) from public.workspace_saved').scalar() == 0
    rpc(own, 'save', {'kind': 'filing', 'id': F, 'saved': False})
    own.execute(text("SELECT set_config('request.jwt.claim.sub',:u,true)"), {'u': A})
    assert rpc(own, 'saved_list')['counts']['document'] == 1
    rpc(own, 'save', {'kind': 'filing', 'id': F, 'saved': False})
    assert rpc(own, 'saved_list')['items'] == []
    denied(own, 'save', {'kind': 'event', 'id': B, 'saved': True}, 'PT404')


def test_history_is_opt_in_clearable_and_isolated(own):
    rpc(own, 'visit', {'kind': 'company', 'id': C})
    rpc(own, 'search_record', {'query': 'TEST'})
    assert rpc(own, 'searches') == []
    rpc(own, 'preferences_save', {'version': 0, 'value': {'history_enabled': True}})
    rpc(own, 'visit', {'kind': 'company', 'id': C})
    rpc(own, 'search_record', {'query': 'TEST'})
    assert rpc(own, 'searches')[0]['query'] == 'TEST'
    assert rpc(own, 'saved_list', {'kind': 'history'})['counts']['history'] == 1
    rpc(own, 'preferences_save', {'version': 1, 'value': {'history_enabled': False}})
    assert rpc(own, 'searches') == []
    assert rpc(own, 'saved_list', {'kind': 'history'})['items'] == []


def searches_rpc(db, action, payload=None):
    return db.execute(text('SELECT public.sb_workspace_searches(:action,cast(:payload AS jsonb))'),
                      {'action': action, 'payload': json.dumps(payload if payload is not None else {})}).scalar()


def test_search_deletion_is_exact_idempotent_and_preserves_visits_and_saves(own):
    rpc(own, 'preferences_save', {'version': 0, 'value': {'history_enabled': True}})
    rpc(own, 'visit', {'kind': 'company', 'id': C})
    rpc(own, 'save', {'kind': 'filing', 'id': F, 'saved': True})
    rpc(own, 'search_record', {'query': 'TEST'})
    rpc(own, 'search_record', {'query': 'OTHER'})
    assert searches_rpc(own, 'search_delete', {'query': 'TEST'}) == {'deleted': 1}
    assert searches_rpc(own, 'search_delete', {'query': 'TEST'}) == {'deleted': 0}
    assert [x['query'] for x in rpc(own, 'searches')] == ['OTHER']
    assert rpc(own, 'saved_list', {'kind': 'history'})['counts']['history'] == 1
    assert rpc(own, 'saved_list')['counts']['document'] == 1
    assert searches_rpc(own, 'searches_clear') == {'cleared': True, 'deleted': 1}
    assert rpc(own, 'searches') == []
    assert rpc(own, 'saved_list', {'kind': 'history'})['counts']['history'] == 1
    assert rpc(own, 'saved_list')['counts']['document'] == 1


def test_search_controls_cannot_delete_another_account_or_accept_injected_fields(own):
    rpc(own, 'preferences_save', {'version': 0, 'value': {'history_enabled': True}})
    rpc(own, 'search_record', {'query': 'TEST'})
    own.execute(text("SELECT set_config('request.jwt.claim.sub',:u,true)"), {'u': B})
    assert searches_rpc(own, 'search_delete', {'query': 'TEST'}) == {'deleted': 0}
    assert searches_rpc(own, 'searches_clear') == {'cleared': True, 'deleted': 0}
    own.execute(text("SELECT set_config('request.jwt.claim.sub',:u,true)"), {'u': A})
    assert rpc(own, 'searches')[0]['query'] == 'TEST'
    for action, payload, code in [
        ('search_delete', {'query': ''}, 'PT422'),
        ('search_delete', {'query': 'x' * 101}, 'PT422'),
        ('search_delete', {'query': 'TEST', 'user_id': B}, 'PT422'),
        ('searches_clear', {'history': True}, 'PT422'),
        ('history_clear', {}, 'PT404'),
    ]:
        savepoint = own.begin_nested()
        with pytest.raises(Exception) as caught:
            searches_rpc(own, action, payload)
        savepoint.rollback()
        assert caught.value.orig.sqlstate == code
    assert rpc(own, 'searches')[0]['query'] == 'TEST'


def test_search_controls_deny_anonymous_calls_and_require_mfa(own):
    own.exec_driver_sql('SET LOCAL ROLE anon')
    savepoint = own.begin_nested()
    with pytest.raises(Exception) as caught:
        searches_rpc(own, 'searches_clear')
    savepoint.rollback()
    assert caught.value.orig.sqlstate == '42501'
    own.exec_driver_sql('RESET ROLE')
    own.execute(text("insert into auth.mfa_factors values (gen_random_uuid(),:u,'verified')"), {'u': A})
    own.exec_driver_sql('SET LOCAL ROLE authenticated')
    savepoint = own.begin_nested()
    with pytest.raises(Exception) as caught:
        searches_rpc(own, 'searches_clear')
    savepoint.rollback()
    assert caught.value.orig.sqlstate == 'PT403'
    own.execute(text("select set_config('request.jwt.claims',:claims,true)"), {'claims': json.dumps({'sub': A, 'aal': 'aal2'})})
    assert searches_rpc(own, 'searches_clear') == {'cleared': True, 'deleted': 0}


def onboarding_rpc(db, payload):
    return db.execute(text('SELECT public.sb_mobile_onboarding(cast(:payload AS jsonb))'),
                      {'payload': json.dumps(payload)}).scalar()


def user_action(db, action, payload):
    return db.execute(text('SELECT public.sb_user_action(:action,cast(:payload AS jsonb))'),
                      {'action': action, 'payload': json.dumps(payload)}).scalar()


def seed_onboarding_companies(db):
    """Additional real-shaped synthetic catalog rows, scoped to this test savepoint."""
    db.exec_driver_sql('RESET ROLE')
    db.exec_driver_sql("""
        INSERT INTO public.companies(id,name,ticker,market,provider,provider_company_id,is_demo,created_at)
        SELECT '20000000-0000-4000-8000-'||lpad(i::text,12,'0'),
               'Synthetic onboarding '||i,'ONBOARD'||i,'NASDAQ','sec',lpad(i::text,10,'0'),false,now()
        FROM generate_series(3,4) i
    """)
    db.exec_driver_sql('SET LOCAL ROLE authenticated')
    return ['20000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000004']


def test_onboarding_deltas_preserve_changes_from_another_screen_and_are_idempotent(own):
    concurrent, draft = seed_onboarding_companies(own)
    user_action(own, 'watch_add', {'company_id': C})
    user_action(own, 'positions', {'rows': [{'company_id': C, 'quantity': '10.25', 'average_cost': '12.5', 'currency': 'EUR'}]})
    # The onboarding screen has already read its original C selection here.
    # Another screen adds a different company before the stale draft is saved.
    user_action(own, 'watch_add', {'company_id': concurrent})
    user_action(own, 'positions', {'rows': [{'company_id': concurrent, 'quantity': '2.00000001', 'average_cost': '15.75', 'currency': 'GBP'}]})
    own.execute(text("SELECT set_config('request.jwt.claim.sub',:u,true)"), {'u': B})
    user_action(own, 'watch_add', {'company_id': C})
    user_action(own, 'positions', {'rows': [{'company_id': C, 'quantity': '4', 'average_cost': None, 'currency': 'CAD'}]})
    own.execute(text("SELECT set_config('request.jwt.claim.sub',:u,true)"), {'u': A})
    payload = {'company_ids': [draft], 'removed_company_ids': [C], 'positions': [
        {'company_id': draft, 'quantity': '99999999999999999999.12345678', 'average_cost': '99.50000001', 'currency': 'EUR'}
    ], 'analytics_consent': True}
    for _ in range(2):
        result = onboarding_rpc(own, payload)
        assert result['id'] == A and result['onboarding_completed'] is True
        assert result['analytics_consent'] is True
    watch = own.exec_driver_sql('SELECT public.sb_watchlist()').scalar()['items']
    assert {x['id'] for x in watch} == {concurrent, draft}
    positions = own.exec_driver_sql('SELECT public.sb_portfolio()').scalar()['positions']
    by_company = {x['company']['id']: x for x in positions}
    assert set(by_company) == {C, concurrent, draft}
    assert Decimal(by_company[C]['quantity']) == Decimal('10.25')
    assert by_company[C]['currency'] == 'EUR'
    assert Decimal(by_company[concurrent]['quantity']) == Decimal('2.00000001')
    assert Decimal(by_company[concurrent]['average_cost']) == Decimal('15.75')
    assert by_company[concurrent]['currency'] == 'GBP'
    assert Decimal(by_company[draft]['quantity']) == Decimal('99999999999999999999.12345678')
    assert Decimal(by_company[draft]['average_cost']) == Decimal('99.50000001')
    own.execute(text("SELECT set_config('request.jwt.claim.sub',:u,true)"), {'u': B})
    assert [x['id'] for x in own.exec_driver_sql('SELECT public.sb_watchlist()').scalar()['items']] == [C]
    other_position = own.exec_driver_sql('SELECT public.sb_portfolio()').scalar()['positions'][0]
    assert Decimal(other_position['quantity']) == Decimal('4') and other_position['currency'] == 'CAD'


def test_onboarding_empty_skip_preserves_existing_lists_costs_and_consent(own):
    user_action(own, 'profile', {'analytics_consent': True})
    user_action(own, 'watch_add', {'company_id': C})
    user_action(own, 'positions', {'rows': [{'company_id': C, 'quantity': '0.00000001', 'average_cost': None, 'currency': 'JPY'}]})
    before_watch = own.exec_driver_sql('SELECT public.sb_watchlist()').scalar()
    before_positions = own.exec_driver_sql('SELECT public.sb_portfolio()').scalar()
    before_alerts = own.exec_driver_sql('SELECT count(*) FROM public.alerts').scalar()
    for _ in range(2):
        result = onboarding_rpc(own, {'company_ids': [], 'removed_company_ids': [], 'positions': []})
        assert result['onboarding_completed'] is True and result['analytics_consent'] is True
        assert own.exec_driver_sql('SELECT public.sb_watchlist()').scalar() == before_watch
        assert own.exec_driver_sql('SELECT public.sb_portfolio()').scalar() == before_positions
        assert own.exec_driver_sql('SELECT count(*) FROM public.alerts').scalar() == before_alerts


def test_onboarding_skip_restores_scope_and_legacy_onboarding_keeps_its_default_alert(own):
    first, second = seed_onboarding_companies(own)
    own.execute(text("SELECT set_config('signalbrief.skip_default_alert_user',:scope,true)"), {'scope': 'synthetic-prior-scope'})
    onboarding_rpc(own, {'company_ids': [], 'removed_company_ids': [], 'positions': []})
    assert own.exec_driver_sql('SELECT count(*) FROM public.alerts').scalar() == 0
    assert own.exec_driver_sql("SELECT current_setting('signalbrief.skip_default_alert_user',true)").scalar() == 'synthetic-prior-scope'
    own.execute(text("SELECT set_config('request.jwt.claim.sub',:u,true)"), {'u': B})
    # A mobile skip for A must not change the existing legacy behavior for B.
    user_action(own, 'onboarding', {'company_ids': [C, first, second], 'analytics_consent': False})
    alerts = own.exec_driver_sql('SELECT name,enabled FROM public.alerts').all()
    assert alerts == [('내 종목의 중요한 변화', True)]


def test_onboarding_explicit_empty_completion_still_creates_the_normal_default(own):
    payload = {'company_ids': [], 'removed_company_ids': [], 'positions': [], 'analytics_consent': False}
    for _ in range(2):
        assert onboarding_rpc(own, payload)['onboarding_completed'] is True
        assert own.exec_driver_sql('SELECT count(*) FROM public.alerts').scalar() == 1


def test_onboarding_repeated_completion_does_not_restore_a_removed_alert(own):
    payload = {'company_ids': [], 'removed_company_ids': [], 'positions': [], 'analytics_consent': False}
    onboarding_rpc(own, payload)
    alert_id = own.exec_driver_sql('SELECT id FROM public.alerts').scalar()
    assert alert_id is not None
    user_action(own, 'alert_remove', {'id': alert_id})
    for value in [{'company_ids': [], 'removed_company_ids': [], 'positions': []}, payload]:
        assert onboarding_rpc(own, value)['onboarding_completed'] is True
        assert own.exec_driver_sql('SELECT count(*) FROM public.alerts').scalar() == 0


def test_onboarding_skip_preserves_an_existing_disabled_alert_exactly(own):
    user_action(own, 'alert_save', {'name': 'Synthetic private alert', 'event_types': ['earnings'], 'min_score': 0.9, 'enabled': False})
    before = own.exec_driver_sql('SELECT to_jsonb(a) FROM public.alerts a').all()
    onboarding_rpc(own, {'company_ids': [], 'removed_company_ids': [], 'positions': []})
    assert own.exec_driver_sql('SELECT to_jsonb(a) FROM public.alerts a').all() == before


def test_onboarding_rejects_invalid_payloads_without_partial_changes(own):
    draft, _ = seed_onboarding_companies(own)
    user_action(own, 'watch_add', {'company_id': C})
    user_action(own, 'positions', {'rows': [{'company_id': C, 'quantity': '10', 'average_cost': '12.5', 'currency': 'EUR'}]})
    before_watch = own.exec_driver_sql('SELECT public.sb_watchlist()').scalar()
    before_positions = own.exec_driver_sql('SELECT public.sb_portfolio()').scalar()
    valid = {'company_ids': [draft], 'removed_company_ids': [C], 'positions': []}
    row = {'company_id': draft, 'quantity': '1.5', 'average_cost': None, 'currency': 'USD'}
    invalid_payloads = [None, [], 'wrong', {}, {**valid, 'user_id': B},
        {**valid, 'company_ids': [draft, draft]}, {**valid, 'company_ids': [C]},
        {**valid, 'company_ids': ['not-a-uuid']}, {**valid, 'company_ids': [1]},
        {**valid, 'company_ids': ['20000000-0000-4000-8000-000000000002']},
        {**valid, 'company_ids': [draft] * 11}, {**valid, 'removed_company_ids': [C] * 51},
        {**valid, 'positions': [row] * 11}, {**valid, 'positions': [row, row]},
        {**valid, 'positions': [None]}, {**valid, 'analytics_consent': 'true'}]
    for patch in [{'quantity': '0'}, {'quantity': '0.00000000'}, {'quantity': '-1'},
                  {'quantity': '1e3'}, {'quantity': '1.000000001'}, {'quantity': '9' * 21},
                  {'quantity': 1}, {'average_cost': '-1'}, {'average_cost': 'NaN'},
                  {'average_cost': '1.000000001'}, {'average_cost': 0}, {'currency': 'BTC'},
                  {'company_id': B}, {'user_id': B}]:
        invalid_payloads.append({**valid, 'positions': [{**row, **patch}]})
    for payload in invalid_payloads:
        savepoint = own.begin_nested()
        with pytest.raises(Exception) as caught:
            onboarding_rpc(own, payload)
        savepoint.rollback()
        assert caught.value.orig.sqlstate == 'PT422', payload
    assert own.exec_driver_sql('SELECT public.sb_watchlist()').scalar() == before_watch
    assert own.exec_driver_sql('SELECT public.sb_portfolio()').scalar() == before_positions
    assert own.exec_driver_sql('SELECT onboarding_completed FROM public.users').scalar() is False


def test_onboarding_does_not_complete_when_a_late_write_fails(own):
    draft, _ = seed_onboarding_companies(own)
    user_action(own, 'watch_add', {'company_id': C})
    own.exec_driver_sql('RESET ROLE')
    # An isolated test trigger fails during the nested holding upsert, after the
    # watchlist delta has been written, proving whole-call transaction rollback.
    own.exec_driver_sql("""
        CREATE FUNCTION public.synthetic_reject_position() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'synthetic_write_rejected' USING ERRCODE='PT409'; END $$;
        CREATE TRIGGER synthetic_reject_position BEFORE INSERT ON public.positions
        FOR EACH ROW EXECUTE FUNCTION public.synthetic_reject_position()
    """)
    own.exec_driver_sql('SET LOCAL ROLE authenticated')
    savepoint = own.begin_nested()
    with pytest.raises(Exception) as caught:
        onboarding_rpc(own, {'company_ids': [draft], 'removed_company_ids': [C], 'positions': [
            {'company_id': draft, 'quantity': '1', 'average_cost': None, 'currency': 'USD'}]})
    savepoint.rollback()
    assert caught.value.orig.sqlstate == 'PT409'
    assert [x['id'] for x in own.exec_driver_sql('SELECT public.sb_watchlist()').scalar()['items']] == [C]
    assert own.exec_driver_sql('SELECT public.sb_portfolio()').scalar()['positions'] == []
    assert own.exec_driver_sql('SELECT onboarding_completed FROM public.users').scalar() is False


def test_onboarding_denies_anonymous_and_unassured_accounts(own):
    payload = {'company_ids': [], 'removed_company_ids': [], 'positions': []}
    own.exec_driver_sql('SET LOCAL ROLE anon')
    savepoint = own.begin_nested()
    with pytest.raises(Exception) as caught:
        onboarding_rpc(own, payload)
    savepoint.rollback()
    assert caught.value.orig.sqlstate == '42501'
    own.exec_driver_sql('SET LOCAL ROLE authenticated')
    own.execute(text("SELECT set_config('request.jwt.claim.sub',:u,true)"), {'u': T})
    savepoint = own.begin_nested()
    with pytest.raises(Exception) as caught:
        onboarding_rpc(own, payload)
    savepoint.rollback()
    assert caught.value.orig.sqlstate == 'PT401'
    own.execute(text("SELECT set_config('request.jwt.claim.sub',:u,true)"), {'u': A})
    own.exec_driver_sql('RESET ROLE')
    own.execute(text("insert into auth.mfa_factors values (gen_random_uuid(),:u,'verified')"), {'u': A})
    own.exec_driver_sql('SET LOCAL ROLE authenticated')
    savepoint = own.begin_nested()
    with pytest.raises(Exception) as caught:
        onboarding_rpc(own, payload)
    savepoint.rollback()
    assert caught.value.orig.sqlstate == 'PT403'
    own.execute(text("select set_config('request.jwt.claims',:claims,true)"), {'claims': json.dumps({'sub': A, 'aal': 'aal2'})})
    assert onboarding_rpc(own, payload)['onboarding_completed'] is True


def test_notification_preferences_touch_real_existing_delivery_configuration(own):
    result = rpc(own, 'notification_save', {'realtime_enabled': False, 'notify_min_score': .65})
    assert result == {'realtime_enabled': False, 'notify_min_score': .65}
    denied(own, 'notification_save', {'email_notifications': True}, 'PT422')
    assert own.exec_driver_sql('select realtime_enabled from public.user_preferences').scalar() is False


def test_own_sessions_and_export_do_not_disclose_others(own):
    security = rpc(own, 'security')
    assert len(security['sessions']) == 1
    assert security['sessions'][0]['user_agent'] == 'Synthetic browser'
    assert 'Other private device' not in json.dumps(security)
    assert 'encrypted_password' not in json.dumps(security)
    result = rpc(own, 'export')
    assert result['profile']['id'] == A
    assert B not in json.dumps(result)


def test_support_create_retry_conflict_ownership_and_admin(own):
    body = {'request_key': T, 'category': 'bug', 'title': 'Synthetic test', 'message': 'Synthetic request body'}
    ticket = rpc(own, 'ticket_create', body)
    assert rpc(own, 'ticket_create', body)['id'] == ticket['id']
    denied(own, 'ticket_create', {**body, 'title': 'different'}, 'PT409')
    denied(own, 'ticket_update', {'id': ticket['id'], 'state': 'resolved'}, 'PT403')
    assert len(rpc(own, 'tickets')) == 1
    own.execute(text("SELECT set_config('request.jwt.claim.sub',:u,true)"), {'u': B})
    assert rpc(own, 'tickets', {'admin': True}) == []
    own.exec_driver_sql('RESET ROLE')
    own.execute(text('insert into app_private.sb_admin_users(user_id) values (:u)'), {'u': B})
    own.exec_driver_sql('SET LOCAL ROLE authenticated')
    assert len(rpc(own, 'tickets', {'admin': True})) == 1
    rpc(own, 'ticket_update', {'id': ticket['id'], 'state': 'in_progress'})
    assert rpc(own, 'tickets', {'admin': True})[0]['state'] == 'in_progress'


def test_private_attachment_checks_match_storage_metadata_and_owner(own):
    ticket = rpc(own, 'ticket_create', {'request_key': T, 'category': 'bug', 'title': 'Test attachment', 'message': 'Synthetic'})
    path = f'{A}/{ticket["id"]}/{T}.png'
    own.execute(text("insert into storage.objects(bucket_id,name,metadata) values ('signalbrief-support',:p,jsonb_build_object('size',32,'mimetype','image/png'))"), {'p': path})
    body = {'ticket_id': ticket['id'], 'object_path': path, 'filename': 'fixture.png', 'mime_type': 'image/png', 'size_bytes': 31}
    denied(own, 'ticket_attach', body, 'PT404')
    body['size_bytes'] = 32
    assert rpc(own, 'ticket_attach', body) == {'attached': True}
    assert rpc(own, 'ticket_attach', body) == {'attached': True}
    own.execute(text("SELECT set_config('request.jwt.claim.sub',:u,true)"), {'u': B})
    denied(own, 'ticket_attach', body, 'PT404')
    assert own.exec_driver_sql("select count(*) from storage.objects where bucket_id='signalbrief-support'").scalar() == 0


def test_direct_writes_and_anonymous_calls_are_denied(own):
    for statement in ["UPDATE public.workspace_preferences SET value='{}'", 'SELECT * FROM app_private.sb_workspace_resources()']:
        sp = own.begin_nested()
        with pytest.raises(Exception):
            own.exec_driver_sql(statement)
        sp.rollback()
    own.exec_driver_sql('SET LOCAL ROLE anon')
    denied(own, 'catalog', {}, '42501')


def test_verified_mfa_requires_aal2_for_rpc_rls_and_pre_request(own):
    own.exec_driver_sql('RESET ROLE')
    own.execute(text("insert into auth.mfa_factors values (gen_random_uuid(),:u,'verified')"), {'u': A})
    own.exec_driver_sql('SET LOCAL ROLE authenticated')
    denied(own, 'catalog', {}, 'PT403')
    assert own.exec_driver_sql('select count(*) from public.users').scalar() == 0
    savepoint = own.begin_nested()
    with pytest.raises(Exception) as error:
        own.exec_driver_sql('select public.sb_require_mfa()')
    savepoint.rollback()
    assert error.value.orig.sqlstate == 'PT403'
    own.execute(text("select set_config('request.jwt.claims',:claims,true)"), {'claims': json.dumps({'sub': A, 'aal': 'aal2'})})
    own.exec_driver_sql('select public.sb_require_mfa()')
    assert rpc(own, 'catalog')['total'] == 2
    assert own.exec_driver_sql('select count(*) from public.users').scalar() == 1
    assert own.exec_driver_sql("select rolconfig::text from pg_roles where rolname='authenticator'").scalar().find('public.sb_require_mfa') >= 0


def test_upload_quota_includes_unlinked_storage_objects(own):
    ticket = rpc(own, 'ticket_create', {'request_key': T, 'category': 'bug', 'title': 'Bounded uploads', 'message': 'Synthetic'})
    for i in range(3):
        path = f'{A}/{ticket["id"]}/90000000-0000-4000-8000-{i:012d}.png'
        own.execute(text("insert into storage.objects(bucket_id,name,metadata) values ('signalbrief-support',:p,jsonb_build_object('size',32,'mimetype','image/png'))"), {'p': path})
    sp = own.begin_nested()
    with pytest.raises(Exception) as error:
        own.execute(text("insert into storage.objects(bucket_id,name,metadata) values ('signalbrief-support',:p,'{}')"), {'p': f'{A}/{ticket["id"]}/{T}.png'})
    sp.rollback()
    assert error.value.orig.sqlstate == 'PT429'


def test_ordinary_notifications_honor_mute_quiet_hours_and_daily_cap(own):
    from datetime import date, datetime, timezone
    from uuid import uuid4

    from signalbrief.models import AIRun, Alert, Document, Event, Notification, RawBlob

    rpc(own, 'notification_save', {'realtime_enabled': True, 'notify_min_score': 0})
    stamp = datetime.now(timezone.utc)
    doc, run, event = [str(uuid4()) for _ in range(3)]
    own.exec_driver_sql('RESET ROLE')
    own.execute(RawBlob.__table__.insert().values(sha256='a'*64, object_key='synthetic-notification-test', byte_length=1, content_type='text/plain'))
    own.execute(Document.__table__.insert().values(id=doc, company_id=C, provider='sec', external_id='synthetic-notification-test', title='Synthetic source', form_type='10-K', source_url='https://example.invalid/source', download_url='https://example.invalid/source', published_at=stamp, publication_date=date.today(), publication_precision='date', publication_timezone='UTC', raw_sha256='a'*64, is_demo=False))
    own.execute(AIRun.__table__.insert().values(id=run, document_id=doc, stage='synthetic', model='synthetic', prompt_version='test', pipeline_version='test'))
    own.execute(Event.__table__.insert().values(id=event, company_id=C, document_id=doc, run_id=run, revision='test', title='Synthetic event', event_type='earnings', published_at=stamp, state='published', published_to_users_at=stamp))
    own.exec_driver_sql('SET LOCAL ROLE authenticated')

    def publish():
        own.exec_driver_sql('RESET ROLE')
        alert = str(uuid4())
        own.execute(Alert.__table__.insert().values(id=alert, user_id=A, name='Synthetic rule'))
        result = own.execute(Notification.__table__.insert().values(user_id=A, alert_id=alert, event_id=event).returning(Notification.id)).scalar()
        own.exec_driver_sql('SET LOCAL ROLE authenticated')
        return result

    rpc(own, 'preferences_save', {'version': 0, 'value': {'muted_companies': [C]}})
    assert publish() is None
    rpc(own, 'preferences_save', {'version': 1, 'value': {'muted_companies': [], 'quiet_enabled': True, 'quiet_start': '00:00', 'quiet_end': '00:00'}})
    assert publish() is None
    rpc(own, 'preferences_save', {'version': 2, 'value': {'quiet_enabled': False, 'daily_cap': 1}})
    assert publish() is not None
    assert publish() is None
    rpc(own, 'notification_save', {'realtime_enabled': False})
    assert publish() is None
