import importlib.util
import os
from pathlib import Path
from urllib.parse import urlsplit

import pytest
from sqlalchemy import create_engine

ROOT = Path(__file__).resolve().parents[1]


def test_frozen_hosted_baseline_is_derived_without_mutable_models():
    spec = importlib.util.spec_from_file_location("hosted_baseline", ROOT / "scripts/hosted_baseline.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    sql = module.baseline()
    assert sql.count("CREATE TABLE") == 30
    assert "signalbrief-raw" in sql
    assert "row level security" in sql.lower()
    assert "postgresql://" not in sql


@pytest.mark.postgres
def test_hosted_migrations_replay_and_owner_rpc():
    url = os.getenv("SB_TEST_HOSTED_POSTGRES_URL")
    if not url:
        pytest.skip("No disposable hosted-schema PostgreSQL database supplied")
    parsed = urlsplit(url.replace("postgresql+psycopg", "postgresql", 1))
    if parsed.hostname not in ("localhost", "127.0.0.1") or not parsed.path.endswith("_test"):
        pytest.fail("Hosted replay requires a loopback database ending in _test; production is forbidden")
    spec = importlib.util.spec_from_file_location("hosted_baseline", ROOT / "scripts/hosted_baseline.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    engine = create_engine(url)
    with engine.begin() as connection:
        assert connection.exec_driver_sql("SELECT to_regclass('public.users')").scalar() is None
        connection.exec_driver_sql("""
            CREATE ROLE anon NOLOGIN;
            CREATE ROLE authenticated NOLOGIN;
            CREATE SCHEMA auth;
            CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb);
            CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
            $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
            GRANT USAGE ON SCHEMA auth TO authenticated,anon;
            GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated,anon;
            CREATE SCHEMA storage;
            CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean);
            CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text);
            ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
            GRANT USAGE ON SCHEMA storage TO authenticated;
            GRANT SELECT ON storage.objects TO authenticated;
        """)
        connection.exec_driver_sql(module.baseline())
        migrations = sorted((ROOT / "supabase/hosted").glob("*.sql"))
        assert len(migrations) >= 7
        for migration in migrations:
            # Execute without a parameter collection so PL/pgSQL format('%I', ...)
            # is not misinterpreted as a psycopg binding placeholder.
            with connection.connection.driver_connection.cursor() as cursor:
                cursor.execute(migration.read_text(encoding="utf-8"), prepare=False)
        connection.exec_driver_sql("""
            INSERT INTO auth.users VALUES
            ('10000000-0000-4000-8000-000000000071','a@example.invalid','{"name":"User A"}'),
            ('10000000-0000-4000-8000-000000000072','b@example.invalid','{"name":"User B"}');
            INSERT INTO public.companies(id,name,ticker,market,provider,provider_company_id,is_demo,created_at)
            SELECT '20000000-0000-4000-8000-'||lpad(i::text,12,'0'),'Fixture '||i,'FIX'||i,'test','fixture',i::text,false,now()
            FROM generate_series(1,3) i;
            SET LOCAL ROLE authenticated;
            SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000071',true);
        """)
        profile = connection.exec_driver_sql("SELECT public.sb_initialize_profile()").scalar()
        assert profile["is_admin"] is False
        connection.exec_driver_sql("""
            SELECT public.sb_user_action('preferences','{"experience":"intermediate","markets":["US"],"sectors":[],"alert_frequency":"normal"}');
            SELECT public.sb_user_action('onboarding',jsonb_build_object('company_ids',(SELECT jsonb_agg(id) FROM public.companies),'analytics_consent',false));
            SELECT public.sb_user_action('positions','{"rows":[{"company_id":"20000000-0000-4000-8000-000000000001","quantity":"10.25","average_cost":"100.50","currency":"USD"}]}');
        """)
        position = connection.exec_driver_sql("SELECT public.sb_portfolio()").scalar()["positions"][0]
        assert float(position["quantity"]) == 10.25
        assert float(position["average_cost"]) == 100.5
        assert connection.exec_driver_sql("SELECT min_score FROM public.alerts").scalar() == 0.4
        assert len(connection.exec_driver_sql("SELECT public.sb_watchlist()").scalar()["items"]) == 3
        calendar = connection.exec_driver_sql("SELECT public.sb_user_action('calendar_add','{\"title\":\"Review\",\"occurs_on\":\"2030-01-15\"}')").scalar()
        assert calendar["origin"] == "user"
        connection.exec_driver_sql("SELECT public.sb_user_action('subscription_create',jsonb_build_object('token',repeat('a',64)))")
        assert len(connection.exec_driver_sql("SELECT public.sb_calendar_subscription_feed(repeat('a',64))").scalar()) == 1
        connection.exec_driver_sql("SELECT public.sb_user_action('subscription_revoke')")
        assert connection.exec_driver_sql("SELECT public.sb_calendar_subscription_feed(repeat('a',64))").scalar() is None
        connection.exec_driver_sql("""
            SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000072',true);
            SELECT public.sb_initialize_profile();
        """)
        assert connection.exec_driver_sql("SELECT public.sb_portfolio()").scalar()["positions"] == []
        assert connection.exec_driver_sql("SELECT count(*) FROM public.calendar_items").scalar() == 0
        assert connection.exec_driver_sql("SELECT count(*) FROM public.alerts").scalar() == 0
        connection.exec_driver_sql("""
            DO $$ DECLARE denied boolean:=false; BEGIN
              BEGIN PERFORM public.sb_admin_catalog_sync('sec'); EXCEPTION WHEN SQLSTATE 'PT403' THEN denied:=true; END;
              IF NOT denied THEN RAISE EXCEPTION 'nonadmin catalog access'; END IF;
              denied:=false;
              BEGIN UPDATE public.users SET display_name='unauthorized'; EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
              IF NOT denied THEN RAISE EXCEPTION 'direct mutation allowed'; END IF;
            END $$;
        """)
    engine.dispose()
