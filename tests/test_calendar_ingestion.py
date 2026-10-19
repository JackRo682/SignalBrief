"""Official calendar storage, correction, withdrawal and RLS on a disposable DB."""
import importlib.util
import json
import os
from datetime import date, timedelta
from pathlib import Path
from urllib.parse import urlsplit

import pytest

ROOT = Path(__file__).resolve().parents[1]


@pytest.mark.postgres
def test_official_calendar_ingestion_and_access():
    import psycopg

    url = os.getenv("SB_TEST_CALENDAR_POSTGRES_URL")
    if not url:
        pytest.skip("Disposable calendar PostgreSQL URL not supplied")
    parsed = urlsplit(url)
    assert parsed.hostname in ("localhost", "127.0.0.1") and parsed.path.endswith("_test")
    spec = importlib.util.spec_from_file_location("calendar_baseline", ROOT / "scripts/hosted_baseline.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    with psycopg.connect(url) as connection:
        with connection.cursor() as cur:
            assert cur.execute("select to_regclass('public.users')").fetchone()[0] is None
            cur.execute("""
                DO $$ BEGIN
                  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
                  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
                  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
                END $$;
                CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb);
                CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
                $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
                GRANT USAGE ON SCHEMA auth TO authenticated,anon;
                CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean);
                CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text);
                ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
                GRANT USAGE ON SCHEMA storage TO authenticated; GRANT SELECT ON storage.objects TO authenticated;
                CREATE SCHEMA extensions; CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
            """, prepare=False)
            cur.execute(module.baseline(), prepare=False)
            for migration in sorted((ROOT / "supabase/hosted").glob("*.sql")):
                cur.execute(migration.read_text(encoding="utf-8"), prepare=False)
            migration = next((ROOT / "supabase/migrations").glob("*_official_calendar_ingestion.sql"))
            cur.execute(migration.read_text(encoding="utf-8"), prepare=False)
            reference = (ROOT / "supabase/reference-migrations/20261003_reference_screens.sql").read_text(encoding="utf-8")
            reminder_schema = reference[reference.index("CREATE TABLE public.calendar_reminders"):reference.index("CREATE OR REPLACE FUNCTION public.sb_reference_preferences")]
            cur.execute(reminder_schema, prepare=False)
            reminder_migration = next((ROOT / "supabase/migrations").glob("*_official_calendar_reminders.sql"))
            cur.execute(reminder_migration.read_text(encoding="utf-8"), prepare=False)
            cur.execute("""
                INSERT INTO companies(id,name,ticker,market,provider,provider_company_id,is_demo,created_at)
                VALUES('10000000-0000-4000-8000-000000000001','Microsoft','MSFT','NASDAQ','sec','123',false,now());
            """)
            day = (date.today() + timedelta(days=5)).isoformat()
            quote = "Official Earnings Call " + day
            entries = [{"key": "quarter-1", "title": "Earnings call", "occurs_on": day,
                        "quote": quote, "timezone": "America/Los_Angeles", "location": "eventsData.Events[0]"}]

            def ingest(items, sha="a" * 64, text=quote):
                return cur.execute("select sb_calendar_ingest(%s,%s,%s,%s,%s::jsonb)",
                                   ("microsoft-ir", sha, f"calendar/microsoft-ir/{sha}.html", text,
                                    json.dumps(items))).fetchone()[0]

            assert ingest(entries) == 1
            item_id = cur.execute("select id from calendar_items").fetchone()[0]
            assert ingest(entries) == 1
            assert cur.execute("select count(*) from calendar_items").fetchone()[0] == 1
            assert cur.execute("select count(*) from app_private.calendar_snapshots").fetchone()[0] == 1
            for bad in [{**entries[0], "occurs_on": "2026-02-30"},
                        {**entries[0], "quote": "not in original"}, {**entries[0], "timezone": None}]:
                with pytest.raises(psycopg.Error), connection.transaction():
                    ingest([bad])
            assert cur.execute("select occurs_on::text from calendar_items").fetchone()[0] == day
            changed_day = (date.today() + timedelta(days=6)).isoformat()
            changed_quote = "Official Earnings Call " + changed_day
            changed = [{**entries[0], "occurs_on": changed_day, "quote": changed_quote}]
            assert ingest(changed, "b" * 64, changed_quote) == 1
            assert cur.execute("select id,occurs_on::text from calendar_items").fetchone() == (item_id, changed_day)
            assert cur.execute("select count(*) from app_private.calendar_snapshots").fetchone()[0] == 2
            assert cur.execute("select app_private.sb_calendar_confirmed(%s)", (item_id,)).fetchone()[0]
            cur.execute("SET LOCAL ROLE authenticated")
            assert cur.execute("select count(*) from calendar_items").fetchone()[0] == 1
            with pytest.raises(psycopg.errors.InsufficientPrivilege), connection.transaction():
                cur.execute("select * from app_private.calendar_snapshots")
            with pytest.raises(psycopg.errors.InsufficientPrivilege), connection.transaction():
                cur.execute("select sb_calendar_sources()")
            cur.execute("RESET ROLE")
            cur.execute("INSERT INTO auth.users VALUES('10000000-0000-4000-8000-000000000071','a@example.invalid','{}')")
            cur.execute("SET LOCAL ROLE authenticated")
            cur.execute("SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000071',true)")
            cur.execute("SELECT sb_initialize_profile()")
            reminder = json.dumps({"action": "set", "calendar_id": item_id, "enabled": True})
            with pytest.raises(psycopg.Error, match="calendar_not_found"), connection.transaction():
                cur.execute("SELECT sb_reference_reminders(%s::jsonb)", (reminder,))
            cur.execute("SELECT sb_user_action('watch_add','{\"company_id\":\"10000000-0000-4000-8000-000000000001\"}')")
            assert cur.execute("SELECT sb_reference_reminders(%s::jsonb)", (reminder,)).fetchone()[0]["saved"]
            assert len(cur.execute("SELECT sb_reference_reminders('{\"action\":\"list\"}')").fetchone()[0]) == 1
            cur.execute("SELECT sb_user_action('subscription_create',jsonb_build_object('token',repeat('a',64)))")
            assert len(cur.execute("SELECT sb_calendar_subscription_feed(repeat('a',64))").fetchone()[0]) == 1
            cur.execute("RESET ROLE")
            ingest([], "c" * 64, "No upcoming events")
            assert not cur.execute("select app_private.sb_calendar_confirmed(%s)", (item_id,)).fetchone()[0]
            cur.execute("SET LOCAL ROLE authenticated")
            assert cur.execute("select count(*) from calendar_items").fetchone()[0] == 0
            assert cur.execute("SELECT sb_calendar_subscription_feed(repeat('a',64))").fetchone()[0] == []
            with pytest.raises(psycopg.Error, match="calendar_not_found"), connection.transaction():
                cur.execute("SELECT sb_reference_reminders(%s::jsonb)", (reminder,))
            cur.execute("RESET ROLE")
            cur.execute("INSERT INTO app_private.calendar_runs(token_hash) VALUES('task')")
            assert cur.execute("select sb_calendar_claim('task')").fetchone()[0]
            assert not cur.execute("select sb_calendar_claim('task')").fetchone()[0]
            assert not cur.execute("select sb_calendar_claim('missing')").fetchone()[0]
        connection.rollback()
