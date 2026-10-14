"""Production SQL behavior in a fresh disposable database; all records are synthetic."""
import os
from pathlib import Path
from uuid import uuid4

import psycopg
import pytest
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict, make_conninfo

pytestmark = pytest.mark.postgres


@pytest.fixture
def provider_db():
    url = os.getenv("SB_TEST_POSTGRES_URL", "").replace("postgresql+psycopg://", "postgresql://")
    if not url:
        pytest.skip("Requires disposable PostgreSQL")
    params = conninfo_to_dict(url)
    database = "sb_provider_test_" + uuid4().hex
    assert database.startswith("sb_provider_test_")
    root = psycopg.connect(url, autocommit=True)
    root.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(database)))
    connection = psycopg.connect(make_conninfo(**{**params, "dbname": database}), autocommit=True)
    try:
        connection.execute("""
        DO $$ BEGIN
          IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
          IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
          IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
        END $$;
        CREATE SCHEMA app_private; CREATE SCHEMA auth; CREATE SCHEMA vault; CREATE SCHEMA extensions;
        CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
        CREATE TABLE vault.decrypted_secrets(name text,decrypted_secret text);
        CREATE TABLE app_private.us_config(key text PRIMARY KEY,value jsonb);
        INSERT INTO app_private.us_config VALUES('email_enabled','true');
        CREATE TABLE public.users(id varchar(36) PRIMARY KEY);
        CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz);
        CREATE TABLE public.events(id varchar(36) PRIMARY KEY,company_id text,title text,state text);
        CREATE TABLE public.notifications(id varchar(36) PRIMARY KEY,user_id varchar(36),event_id varchar(36));
        CREATE TABLE public.user_preferences(user_id varchar(36) PRIMARY KEY,email_notifications boolean DEFAULT false,updated_at timestamptz);
        CREATE TABLE public.workspace_preferences(user_id varchar(36) PRIMARY KEY,value jsonb);
        CREATE TABLE public.dart_filings(id uuid PRIMARY KEY,filing_date date,receipt text,source_url text);
        CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$
          SELECT nullif(current_setting('test.user_id',true),'')::uuid
        $$;
        CREATE FUNCTION app_private.sb_is_admin() RETURNS boolean LANGUAGE sql AS $$
          SELECT auth.uid()='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'::uuid
        $$;
        GRANT USAGE ON SCHEMA public TO authenticated,anon,service_role;
        """)
        directory = Path(__file__).resolve().parents[1] / "docs" / "sql"
        connection.execute((directory / "delivery.sql").read_text())
        connection.execute((directory / "dart-documents.sql").read_text())
        yield connection
    finally:
        connection.close()
        root.execute(sql.SQL("DROP DATABASE {}").format(sql.Identifier(database)))
        root.close()


def seed(connection):
    user = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb"
    connection.execute("INSERT INTO public.users VALUES(%s)", (user,))
    connection.execute(
        "INSERT INTO auth.users VALUES(%s,'synthetic@example.test',now())", (user,)
    )
    connection.execute("INSERT INTO public.user_preferences(user_id) VALUES(%s)", (user,))
    connection.execute(
        "INSERT INTO public.events VALUES('event-1','company-1','Synthetic reviewed event','published')"
    )
    return user


def test_email_preferences_require_identity_and_cannot_change_another_user(provider_db):
    user = seed(provider_db)
    other = "cccccccc-cccc-4ccc-cccc-cccccccccccc"
    provider_db.execute("INSERT INTO public.users VALUES(%s)", (other,))
    provider_db.execute("INSERT INTO public.user_preferences(user_id) VALUES(%s)", (other,))
    with pytest.raises(psycopg.Error, match="authentication_required"):
        provider_db.execute("SELECT sb_email_preferences(true)")
    provider_db.execute("SELECT set_config('test.user_id',%s,false)", (user,))
    provider_db.execute("SET ROLE authenticated")
    assert provider_db.execute("SELECT sb_email_preferences(true)").fetchone()[0]["enabled"]
    with pytest.raises(psycopg.Error, match="permission denied"):
        provider_db.execute("SELECT sb_email_claim()")
    provider_db.execute("RESET ROLE")
    assert provider_db.execute(
        "SELECT email_notifications FROM public.user_preferences WHERE user_id=%s", (other,)
    ).fetchone()[0] is False


def test_outbox_rechecks_consent_and_event_publication(provider_db):
    user = seed(provider_db)
    provider_db.execute(
        "UPDATE public.user_preferences SET email_notifications=true WHERE user_id=%s", (user,)
    )
    provider_db.execute("INSERT INTO public.notifications VALUES('notice-1',%s,'event-1')", (user,))
    task = provider_db.execute("SELECT sb_email_claim()").fetchone()[0]
    assert task["recipient"] == "synthetic@example.test"
    assert provider_db.execute("SELECT sb_email_permitted(%s)", (task["id"],)).fetchone()[0]
    provider_db.execute(
        "UPDATE public.user_preferences SET email_notifications=false WHERE user_id=%s", (user,)
    )
    assert not provider_db.execute("SELECT sb_email_permitted(%s)", (task["id"],)).fetchone()[0]
    provider_db.execute(
        "UPDATE public.user_preferences SET email_notifications=true WHERE user_id=%s", (user,)
    )
    provider_db.execute("UPDATE public.events SET state='retracted' WHERE id='event-1'")
    assert not provider_db.execute("SELECT sb_email_permitted(%s)", (task["id"],)).fetchone()[0]


def test_delivery_events_are_idempotent_and_cannot_downgrade_delivery(provider_db):
    task = provider_db.execute("""
        INSERT INTO app_private.email_outbox(kind,recipient,subject,body)
        VALUES('test','synthetic@example.test','Synthetic test','Synthetic body') RETURNING id
    """).fetchone()[0]
    provider_db.execute("SELECT sb_email_claim()")
    provider_db.execute("SELECT sb_email_finish(%s,'synthetic-message',NULL,false)", (task,))
    for event, kind in [("event-1", "email.delivered"), ("event-2", "email.sent")]:
        provider_db.execute(
            "SELECT sb_email_event(%s,%s,'synthetic-message',now())", (event, kind)
        )
    provider_db.execute("SELECT sb_email_event('event-1','email.delivered','synthetic-message',now())")
    assert provider_db.execute(
        "SELECT state FROM app_private.email_outbox WHERE id=%s", (task,)
    ).fetchone()[0] == "delivered"
    assert provider_db.execute("SELECT count(*) FROM app_private.email_events").fetchone()[0] == 2
    provider_db.execute("SELECT sb_email_event('event-3','email.complained','synthetic-message',now())")
    assert not provider_db.execute("SELECT sb_email_permitted(%s)", (task,)).fetchone()[0]


def test_early_complaint_callback_still_suppresses_future_sends(provider_db):
    task = provider_db.execute("""
        INSERT INTO app_private.email_outbox(kind,recipient,subject,body)
        VALUES('test','race@example.test','Synthetic race test','Synthetic body') RETURNING id
    """).fetchone()[0]
    provider_db.execute("SELECT sb_email_claim()")
    provider_db.execute("SELECT sb_email_event('early-event','email.complained','early-message',now())")
    provider_db.execute("SELECT sb_email_finish(%s,'early-message',NULL,false)", (task,))
    assert provider_db.execute(
        "SELECT state FROM app_private.email_outbox WHERE id=%s", (task,)
    ).fetchone()[0] == "complained"
    assert not provider_db.execute("SELECT sb_email_permitted(%s)", (task,)).fetchone()[0]


def test_dart_claims_are_not_repeated_and_drafts_require_an_admin(provider_db):
    filing = uuid4()
    provider_db.execute(
        "INSERT INTO public.dart_filings VALUES(%s,current_date,'20260101000001','https://dart.fss.or.kr')",
        (filing,),
    )
    assert provider_db.execute("SELECT sb_dart_document_claim()").fetchone()[0]["id"] == str(filing)
    assert provider_db.execute("SELECT sb_dart_document_claim()").fetchone()[0] is None
    with pytest.raises(psycopg.Error, match="admin_required"):
        provider_db.execute("SELECT sb_dart_review(%s,'approved','Synthetic test review')", (filing,))
