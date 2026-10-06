"""Replay real SQL in a disposable PostgreSQL database, never a remote/user DB.

All rows are explicit synthetic fixtures. Auth/Storage/Vault platform schemas are
minimal test doubles; hosted/reference/US/workspace migrations themselves are real.
"""
import importlib.util
import json
import os
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
             *sorted((ROOT / 'supabase/workspace-migrations').glob('*.sql'))]
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
