"""Home's bounded read uses the real customer projections on disposable PostgreSQL."""
import json
from pathlib import Path
from statistics import median
from time import perf_counter

import pytest
from sqlalchemy import text
from test_company_official_overview import DART_ID, profile_value, save_profile
from test_company_official_overview import overview as overview
from test_discovery_reliability import discovery as discovery
from test_workspace_schema import A, B, C, seed_reviewed_document
from test_workspace_schema import db as db
from test_workspace_schema import own as own

pytestmark = pytest.mark.postgres
ROOT = Path(__file__).resolve().parents[2]
MIGRATION = '20261109031209_home_snapshot.sql'


def identity(conn, user=A, role='authenticated'):
    conn.exec_driver_sql(f'SET LOCAL ROLE {role}')
    conn.execute(text("SELECT set_config('request.jwt.claim.sub',:u,true)"), {'u': user})


def today(conn):
    return str(conn.exec_driver_sql("SELECT (now() AT TIME ZONE 'Asia/Seoul')::date").scalar())


def snapshot(conn, payload=None):
    return conn.execute(text('SELECT public.sb_home_snapshot(cast(:p AS jsonb))'),
                        {'p': json.dumps({'today': today(conn)} if payload is None else payload)}).scalar()


def customer(conn, action, payload=None):
    return conn.execute(text('SELECT public.sb_customer_workspace(:a,cast(:p AS jsonb))'),
                        {'a': action, 'p': json.dumps(payload or {})}).scalar()


def denied(conn, payload, code, message=None):
    point = conn.begin_nested()
    with pytest.raises(Exception) as caught:
        conn.execute(text('SELECT public.sb_home_snapshot(cast(:p AS jsonb))'),
                     {'p': json.dumps(payload)})
    point.rollback()
    assert caught.value.orig.sqlstate == code
    if message:
        assert message in str(caught.value)


@pytest.fixture
def home(overview):
    conn = overview
    conn.exec_driver_sql('RESET ROLE')
    with conn.connection.driver_connection.cursor() as cursor:
        cursor.execute((ROOT / 'supabase/migrations' / MIGRATION).read_text(), prepare=False)
    conn.execute(text('UPDATE public.users SET onboarding_completed=true WHERE id=:u'), {'u': A})
    identity(conn, B)
    conn.exec_driver_sql('SELECT public.sb_initialize_profile()')
    conn.exec_driver_sql('RESET ROLE')
    conn.execute(text('UPDATE public.users SET onboarding_completed=true WHERE id=:u'), {'u': B})
    conn.execute(text('INSERT INTO public.workspace_preferences(user_id) VALUES(:a),(:b) ON CONFLICT DO NOTHING'),
                 {'a': A, 'b': B})
    identity(conn)
    return conn


@pytest.fixture
def populated(home):
    conn = home
    visible = seed_reviewed_document(conn, chunks=1)
    hidden = seed_reviewed_document(conn, chunks=1, state='needs_review')
    conn.info['home_documents'] = {'visible': visible, 'hidden': hidden}
    conn.exec_driver_sql('RESET ROLE')
    conn.execute(text("UPDATE public.events SET published_to_users_at=now()-interval '5 days' WHERE id=:id"),
                 {'id': visible['event']})
    save_profile(conn, profile_value(C, 'sec'), 'sec')
    conn.execute(text("""INSERT INTO public.watchlist_items(watchlist_id,company_id,created_at)
        SELECT id,:c,now() FROM public.watchlists WHERE user_id=:u AND name='관심종목'"""), {'u': A, 'c': C})
    conn.execute(text("""INSERT INTO public.watchlist_items(watchlist_id,company_id,created_at)
        SELECT id,:c,now() FROM public.watchlists WHERE user_id=:u AND name='관심종목'"""), {'u': B, 'c': DART_ID})
    conn.exec_driver_sql("""INSERT INTO public.us_filings
        (id,company_id,accession,form,filing_date,document_url,source_url,source_sha256)
        SELECT ('31000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
          '20000000-0000-4000-8000-000000000001',
          '0000000001-26-'||lpad((n+10)::text,6,'0'),'10-Q',
          (now() AT TIME ZONE 'Asia/Seoul')::date-CASE WHEN n=3 THEN 90 ELSE mod(n,10) END,
          'https://www.sec.gov/Archives/edgar/data/1/home-'||n||'.htm',
          'https://data.sec.gov/submissions/CIK0000000001.json',repeat('a',64)
        FROM generate_series(1,60) n""")
    conn.exec_driver_sql("""UPDATE public.user_preferences SET realtime_enabled=false;
        INSERT INTO public.us_analyses(filing_id,status,model,source_sha256,result,created_at)
        SELECT f.id,CASE WHEN n=4 THEN 'needs_review' ELSE 'approved' END,
          'synthetic',repeat('a',64),
          jsonb_build_object('validation','quote_substring_and_numeric_check',
            'source_url',CASE WHEN n=6 THEN 'https://invalid.example/' ELSE f.document_url END,
            'claims',jsonb_build_array(jsonb_build_object('text','Synthetic approved fact '||n,
              'quote',CASE WHEN n=5 THEN 'UNVERIFIED QUOTE' ELSE 'Archived synthetic evidence' END)),
            'normalized_excerpt','Archived synthetic evidence with context.',
            'uncertainty','Synthetic excerpt only'), now()-interval '200 days'
        FROM generate_series(1,6) n JOIN public.us_filings f
          ON f.id=('31000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
        INSERT INTO public.audit_logs(id,actor_id,action,target_id,details,created_at)
        SELECT gen_random_uuid()::text,'10000000-0000-4000-8000-000000000071','us_analysis_review',
          '31000000-0000-4000-8000-'||lpad(n::text,12,'0'),'{"status":"approved"}'::json,
          now()-make_interval(days=>CASE WHEN n=3 THEN 0 ELSE n END)
        FROM generate_series(1,6) n""")
    personal_seed = """INSERT INTO public.workspace_saved(user_id,kind,resource_id,created_at)
        VALUES (:a,'us_analysis','31000000-0000-4000-8000-000000000001',now()),
          (:a,'us_analysis','31000000-0000-4000-8000-000000000002',now()),
          (:a,'us_analysis','31000000-0000-4000-8000-000000000003',now()-interval '1 day'),
          (:a,'us_analysis','31000000-0000-4000-8000-000000000004',now()),
          (:a,'document',:doc,now()),(:a,'event',:event,now()),
          (:b,'us_analysis','31000000-0000-4000-8000-000000000003',now());
        INSERT INTO public.workspace_history(user_id,kind,resource_id,viewed_at)
        VALUES (:a,'company',:company,now()),(:b,'company',:dart,now());
        UPDATE public.workspace_preferences SET value=value||jsonb_build_object('history_enabled',true) WHERE user_id=:a;
        INSERT INTO public.content_notifications(user_id,kind,resource_id,company_id,created_at,read_at)
        VALUES (:a,'us_analysis','31000000-0000-4000-8000-000000000001',:company,now(),null),
          (:a,'us_analysis','31000000-0000-4000-8000-000000000002',:company,now(),now()),
          (:a,'us_analysis','31000000-0000-4000-8000-000000000004',:company,now(),null),
          (:b,'us_analysis','31000000-0000-4000-8000-000000000003',:company,now(),null)"""
    for statement in personal_seed.split(';'):
        if statement.strip():
            conn.execute(text(statement), {'a': A, 'b': B, 'doc': visible['id'],
                'event': visible['event'], 'company': C, 'dart': DART_ID})
    conn.exec_driver_sql("""INSERT INTO app_private.calendar_sources(key,ticker,market,url,adapter)
        VALUES ('home-synthetic','TEST','NASDAQ','https://calendar.example.invalid/official','synthetic');
        INSERT INTO app_private.calendar_snapshots(id,source_key,raw_sha256,object_key,normalized_text)
        VALUES ('81000000-0000-4000-8000-000000000001','home-synthetic',repeat('b',64),
          'synthetic/home-calendar','Archived synthetic date evidence.');
        INSERT INTO public.calendar_items
          (id,company_id,title,occurs_on,origin,quote,source_snapshot_id,source_key,source_event_key,
            source_url,source_timezone,verified_at,created_at,calendar_status)
        SELECT '82000000-0000-4000-8000-'||lpad(n::text,12,'0'),
          '20000000-0000-4000-8000-000000000001','Synthetic Home date '||n,
          (now() AT TIME ZONE 'Asia/Seoul')::date+CASE WHEN n=1 THEN 1 ELSE -n END,
          'official',CASE WHEN n=9 THEN 'NOT IN ARCHIVE' ELSE 'Archived synthetic date evidence.' END,
          '81000000-0000-4000-8000-000000000001','home-synthetic',n::text,
          'https://calendar.example.invalid/official','Asia/Seoul',now(),now(),
          CASE WHEN n=10 THEN 'withdrawn' ELSE 'confirmed' END FROM generate_series(1,10) n""")
    identity(conn)
    return conn


def test_snapshot_matches_existing_default_dtos_and_exact_ordering(populated):
    conn = populated
    result = snapshot(conn)
    assert set(result) == {'as_of', 'today', 'watchlist', 'monitoring', 'directory', 'documents',
                           'analyses', 'saved', 'notifications', 'dashboard'}
    for field, action, parameters in [
        ('directory', 'catalog', {'kind': 'company', 'limit': 50}),
        ('documents', 'catalog', {'kind': 'document', 'days': 30, 'sort': 'newest', 'limit': 50}),
        ('analyses', 'catalog', {'kind': 'analysis', 'sort': 'newest', 'limit': 2}),
        ('saved', 'saved_list', {'kind': 'analysis', 'sort': 'newest'}),
        ('notifications', 'content_notifications', {}),
    ]:
        assert result[field] == customer(conn, action, parameters), field
    assert result['watchlist'] == conn.exec_driver_sql('SELECT public.sb_watchlist()').scalar()
    assert result['monitoring'] == customer(conn, 'source_overview', {'scope': 'following', 'days': 0})['monitoring']
    assert result['dashboard'] == conn.execute(text("""SELECT public.sb_redesign_workspace('design_dashboard',
        jsonb_build_object('start_date',cast(:day AS date)-29,'end_date',cast(:day AS date),'company_id',''))"""),
        {'day': result['today']}).scalar()
    assert len(result['documents']['items']) == 50 and result['documents']['total'] > 50
    assert result['documents']['next_offset'] == 50
    assert len(result['analyses']['items']) == 2 and result['analyses']['total'] > 2
    assert result['analyses']['next_offset'] == 2
    assert result['dashboard']['event_count'] == 7 and len(result['dashboard']['events']) == 5
    assert result['monitoring'][0]['next_event']['id'].endswith('000000000001')
    assert result['monitoring'][0]['latest_analysis']['id'].endswith('000000000003')
    assert result['dashboard']['start_date'] != result['dashboard']['end_date']


def test_approved_projection_provenance_and_personal_state_remain_authoritative(populated):
    result = snapshot(populated)
    encoded = json.dumps(result)
    for forbidden in ['UNVERIFIED QUOTE', 'UNREVIEWED EXCERPT', 'private_provider_field',
                      'private.example.invalid', 'object_key', 'normalized_excerpt',
                      'source_object_key', 'NOT IN ARCHIVE']:
        assert forbidden not in encoded
    hidden = populated.info['home_documents']['hidden']
    assert hidden['event'] not in encoded and hidden['id'] not in encoded
    assert len(result['saved']['items']) == 3
    assert result['notifications']['unread_count'] == 1
    assert len(result['notifications']['items']) == 2
    company = next(item for item in result['directory']['items'] if item['id'] == C)
    assert company['official_overview']['company_id'] == C
    assert company['official_overview']['source_sha256'] == 'd' * 64
    assert company['official_overview']['source_url'].startswith('https://www.sec.gov/')
    assert all(item['is_saved'] for item in result['saved']['items'])
    identity(populated, B)
    other = snapshot(populated)
    assert [item['id'] for item in other['watchlist']['items']] == [DART_ID]
    assert [item['company_id'] for item in other['monitoring']] == [DART_ID]
    assert len(other['saved']['items']) == 1
    assert len(other['notifications']['items']) == other['notifications']['unread_count'] == 1
    assert {n['id'] for n in other['notifications']['items']}.isdisjoint(
        n['id'] for n in result['notifications']['items'])


def test_empty_follows_never_fall_back_to_all_company_monitoring(home):
    result = snapshot(home)
    assert result['watchlist']['items'] == result['monitoring'] == []
    assert result['directory']['total'] > 0
    assert customer(home, 'source_overview', {'scope': 'following'})['fallback_to_all'] is True
    assert result['saved']['items'] == result['notifications']['items'] == []


def function_calls(conn, signature):
    return conn.execute(text("""SELECT coalesce((SELECT calls FROM pg_stat_xact_user_functions
        WHERE funcid=cast(:signature AS regprocedure)),0)"""), {'signature': signature}).scalar()


def history_scans(conn):
    return conn.exec_driver_sql("""SELECT seq_scan+idx_scan FROM pg_stat_xact_user_tables
        WHERE relid='public.workspace_history'::regclass""").scalar()


def test_one_resource_projection_and_one_quota_acquisition(populated):
    conn = populated
    conn.exec_driver_sql('RESET ROLE')
    conn.exec_driver_sql("SET LOCAL track_functions='all'")
    signatures = ['app_private.sb_customer_resources()', 'public.sb_rate_limit()',
                  'public.sb_customer_workspace(text,jsonb)', 'app_private.sb_customer_notifications()']
    before = {signature: function_calls(conn, signature) for signature in signatures}
    identity(conn)
    day = today(conn)
    started = perf_counter()
    result = snapshot(conn, {'today': day})
    first_ms = (perf_counter()-started)*1000
    conn.exec_driver_sql('RESET ROLE')
    changes = {signature: function_calls(conn, signature)-before[signature] for signature in signatures}
    assert changes == dict(zip(signatures, [1, 1, 0, 0], strict=True))
    # Fixture-only diagnostics; the deterministic regression gate is the exact
    # projection/quota count above, never a hardware-dependent speedup ratio.
    identity(conn)
    samples = {'snapshot_ms': [], 'legacy_a_ms': [], 'legacy_b_ms': []}
    common = [('catalog', {'kind': 'company', 'limit': 50}),
              ('source_overview', {'scope': 'following', 'days': 0}),
              ('content_notifications', {})]
    extras = [('catalog', {'kind': 'document', 'days': 30, 'sort': 'newest', 'limit': 50}),
              ('catalog', {'kind': 'analysis', 'sort': 'newest', 'limit': 2}),
              ('saved_list', {'kind': 'analysis', 'sort': 'newest'})]
    for _ in range(3):
        started = perf_counter()
        snapshot(conn, {'today': day})
        samples['snapshot_ms'].append((perf_counter()-started)*1000)
        for variant in ('a', 'b'):
            started = perf_counter()
            conn.exec_driver_sql('SELECT public.sb_watchlist()').scalar()
            for action, parameters in common + (extras if variant == 'b' else []):
                customer(conn, action, parameters)
            if variant == 'a':
                conn.execute(text("SELECT public.sb_redesign_workspace('design_dashboard',cast(:p AS jsonb))"),
                    {'p': json.dumps({'start_date': result['dashboard']['start_date'],
                                     'end_date': day, 'company_id': ''})}).scalar()
            samples[f'legacy_{variant}_ms'].append((perf_counter()-started)*1000)
    print('SYNTHETIC_HOME_SQL_TIMING', json.dumps({
        'first_snapshot_ms': round(first_ms, 3), 'iterations': 3,
        'warm_medians': {key: round(median(values), 3) for key, values in samples.items()},
        'boundary': 'local PostgreSQL synthetic fixture; excludes HTTP, Auth, calendar and news',
    }, sort_keys=True))


def test_history_disabled_neither_returns_nor_reads_retained_history(populated):
    conn = populated
    conn.exec_driver_sql('RESET ROLE')
    conn.execute(text("""UPDATE public.workspace_preferences
        SET value=value||jsonb_build_object('history_enabled',false) WHERE user_id=:u"""), {'u': A})
    assert conn.execute(text('SELECT count(*) FROM public.workspace_history WHERE user_id=:u'), {'u': A}).scalar() == 1
    before = history_scans(conn)
    identity(conn)
    result = snapshot(conn)
    conn.exec_driver_sql('RESET ROLE')
    assert result['saved']['counts']['history'] == 0
    assert history_scans(conn) == before
    assert all(item['kind'] in ('us_analysis', 'dart_analysis') for item in result['saved']['items'])


@pytest.mark.parametrize('payload', [None, [], {}, {'today': None}, {'today': 123},
    {'today': '2026-11-09', 'user_id': B}, {'today': '2026-11-09', 'variant': 'admin'},
    {'today': '2026-02-30'}, {'today': '2026-11-9'}, {'today': 'infinity'},
    {'today': '2026-11-09', 'extra': 'x'*1100}])
def test_snapshot_rejects_unbounded_or_caller_owned_parameters(home, payload):
    denied(home, payload, 'PT422')


@pytest.mark.parametrize('role,user,expected', [
    ('anon', A, '42501'), ('authenticated', '', 'PT401'),
    ('authenticated', '10000000-0000-4000-8000-000000000099', 'PT401'),
])
def test_snapshot_requires_a_current_existing_identity(home, role, user, expected):
    identity(home, user, role)
    denied(home, {'today': today(home)}, expected)


def test_onboarding_and_mfa_are_enforced_before_any_projection(home):
    conn = home
    conn.exec_driver_sql('RESET ROLE')
    conn.exec_driver_sql("SET LOCAL track_functions='all'")
    conn.execute(text('UPDATE public.users SET onboarding_completed=false WHERE id=:u'), {'u': A})
    before = function_calls(conn, 'app_private.sb_customer_resources()')
    identity(conn)
    denied(conn, {'today': today(conn)}, 'PT403', 'onboarding_required')
    conn.exec_driver_sql('RESET ROLE')
    conn.execute(text('UPDATE public.users SET onboarding_completed=true WHERE id=:u'), {'u': A})
    conn.execute(text("INSERT INTO auth.mfa_factors(id,user_id,status) VALUES(gen_random_uuid(),:u,'verified')"), {'u': A})
    identity(conn)
    denied(conn, {'today': today(conn)}, 'PT403', 'mfa_required')
    conn.exec_driver_sql('RESET ROLE')
    assert function_calls(conn, 'app_private.sb_customer_resources()') == before
    conn.exec_driver_sql("SET LOCAL request.jwt.claims='{\"aal\":\"aal2\"}'")
    identity(conn)
    assert snapshot(conn)['today'] == today(conn)


def test_quota_rejection_is_preserved_and_other_account_remains_independent(home):
    conn = home
    conn.exec_driver_sql('RESET ROLE')
    conn.execute(text("""INSERT INTO public.rate_buckets(key,hits,expires_at)
        VALUES('web:'||:u||':'||floor(extract(epoch FROM now())/60)::text,120,now()+interval '2 minutes')
        ON CONFLICT(key) DO UPDATE SET hits=120"""), {'u': A})
    identity(conn)
    denied(conn, {'today': today(conn)}, 'PT429', 'rate_limit')
    identity(conn, B)
    assert snapshot(conn)['watchlist']['items'] == []


def test_query_failure_returns_an_error_without_partial_results_or_personal_writes(home):
    conn = home
    conn.exec_driver_sql('RESET ROLE')
    point = conn.begin_nested()
    conn.exec_driver_sql("""CREATE OR REPLACE FUNCTION app_private.sb_company_official_overview(cid text)
        RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
        BEGIN RAISE EXCEPTION 'synthetic_snapshot_source_unavailable' USING ERRCODE='PT503'; END $$""")
    before = conn.execute(text("SELECT coalesce(sum(hits),0) FROM public.rate_buckets WHERE key LIKE :prefix"),
                          {'prefix': f'web:{A}:%'}).scalar()
    identity(conn)
    denied(conn, {'today': today(conn)}, 'PT503', 'synthetic_snapshot_source_unavailable')
    conn.exec_driver_sql('RESET ROLE')
    assert conn.execute(text("SELECT coalesce(sum(hits),0) FROM public.rate_buckets WHERE key LIKE :prefix"),
                        {'prefix': f'web:{A}:%'}).scalar() == before
    point.rollback()
    identity(conn)
    assert snapshot(conn)['directory']['total'] > 0


def test_notification_page_limit_keeps_full_unread_count(home):
    conn = home
    conn.exec_driver_sql('RESET ROLE')
    conn.exec_driver_sql("""INSERT INTO public.us_filings
        (id,company_id,accession,form,filing_date,document_url,source_url,source_sha256)
        SELECT ('33000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
          '20000000-0000-4000-8000-000000000001',
          '0000000001-26-'||lpad((n+200)::text,6,'0'),'10-Q',current_date,
          'https://www.sec.gov/Archives/edgar/data/1/notification-'||n||'.htm',
          'https://data.sec.gov/submissions/CIK0000000001.json',repeat('e',64)
        FROM generate_series(1,105) n;
        INSERT INTO public.us_analyses(filing_id,status,model,source_sha256,result)
        SELECT f.id,'approved','synthetic',repeat('e',64),
          jsonb_build_object('validation','quote_substring_and_numeric_check','source_url',f.document_url,
            'claims',jsonb_build_array(jsonb_build_object('text','Synthetic supported excerpt','quote','Archived quote')),
            'normalized_excerpt','Archived quote with context.')
        FROM public.us_filings f WHERE f.id::text LIKE '33000000-%%';
        INSERT INTO public.content_notifications(user_id,kind,resource_id,company_id,created_at)
        SELECT '10000000-0000-4000-8000-000000000071','us_analysis',f.id,f.company_id,now()
        FROM public.us_filings f WHERE f.id::text LIKE '33000000-%%'""")
    identity(conn)
    result = snapshot(conn)
    assert len(result['notifications']['items']) == 100
    assert result['notifications']['unread_count'] == 105
    assert result['notifications'] == customer(conn, 'content_notifications')


def test_new_function_privileges_and_search_paths_preserve_private_boundary(home):
    conn = home
    conn.exec_driver_sql('RESET ROLE')
    for signature, definer in [('public.sb_home_snapshot(jsonb)', False),
                               ('app_content_private.home_snapshot(jsonb)', True)]:
        row = conn.execute(text("""SELECT prosecdef,proconfig,
            has_function_privilege('anon',oid,'EXECUTE') AS anon_execute,
            has_function_privilege('authenticated',oid,'EXECUTE') AS authenticated_execute
            FROM pg_proc WHERE oid=cast(:signature AS regprocedure)"""), {'signature': signature}).one()
        assert row.prosecdef is definer
        assert 'search_path=""' in row.proconfig
        assert row.anon_execute is False and row.authenticated_execute is True


def test_snapshot_has_no_personal_data_writes(populated):
    conn = populated
    conn.exec_driver_sql('RESET ROLE')
    tables = ['workspace_saved', 'workspace_history', 'content_notifications', 'notifications',
              'watchlists', 'watchlist_items', 'calendar_items', 'workspace_preferences']

    def fingerprints():
        return {table: conn.exec_driver_sql(f"""SELECT md5(coalesce(jsonb_agg(to_jsonb(t)
            ORDER BY to_jsonb(t)::text),'[]'::jsonb)::text) FROM public.{table} t""").scalar()
                for table in tables}

    before = fingerprints()
    identity(conn)
    snapshot(conn)
    conn.exec_driver_sql('RESET ROLE')
    assert fingerprints() == before


def test_catalogue_scale_snapshot_stays_bounded_and_keeps_exact_totals(home):
    conn = home
    conn.exec_driver_sql('RESET ROLE')
    conn.exec_driver_sql("""INSERT INTO public.us_filings
        (id,company_id,accession,form,filing_date,document_url,source_url,source_sha256)
        SELECT gen_random_uuid(),'20000000-0000-4000-8000-000000000001',
          '0000000001-26-'||lpad((n+100)::text,6,'0'),'10-Q',
          (now() AT TIME ZONE 'Asia/Seoul')::date,
          'https://www.sec.gov/Archives/edgar/data/1/scale-'||n||'.htm',
          'https://data.sec.gov/submissions/CIK0000000001.json',repeat('c',64)
        FROM generate_series(1,5000) n""")
    conn.exec_driver_sql('ANALYZE public.us_filings')
    conn.exec_driver_sql("SET LOCAL statement_timeout='3s'")
    identity(conn)
    result = snapshot(conn)
    assert result['documents']['total'] >= 5000 and len(result['documents']['items']) == 50
    assert result['dashboard']['filing_count'] >= 5000 and len(result['dashboard']['filings']) == 5
    assert result['monitoring'] == []
