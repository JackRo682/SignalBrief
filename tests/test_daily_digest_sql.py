"""Only disposable PostgreSQL; never run synthetic records on production."""
import json
from pathlib import Path

import psycopg
import pytest
from test_provider_delivery_sql import seed

pytest_plugins = ['test_provider_delivery_sql']


@pytest.fixture
def digest_db(provider_db):
    c = provider_db
    c.execute("ALTER TABLE public.user_preferences ADD COLUMN daily_digest boolean NOT NULL DEFAULT false")
    c.execute("ALTER TABLE public.notifications ADD COLUMN created_at timestamptz DEFAULT now()")
    c.execute("INSERT INTO app_private.us_config VALUES('resend_domain_verified','true')")
    c.execute((Path(__file__).parents[1] / 'docs/sql/daily-digest.sql').read_text(encoding='utf-8'))
    return c


def setup_digest(c):
    u = seed(c)
    c.execute("SELECT set_config('test.user_id',%s,false)", (u,))
    c.execute("SELECT sb_digest_preferences('{\"enabled\":true,\"time\":\"00:00\"}')")
    c.execute("UPDATE public.user_preferences SET digest_enabled_at=now()-interval '3 days'")
    c.execute("INSERT INTO public.notifications(id,user_id,event_id,created_at) VALUES('n1',%s,'event-1',((now() AT TIME ZONE 'Asia/Seoul')::date-1+time '12:00') AT TIME ZONE 'Asia/Seoul')", (u,))
    return u


def test_digest_opt_in_identity_validation_and_privileges(digest_db):
    c = digest_db
    u = seed(c)
    with pytest.raises(psycopg.Error, match='authentication_required'):
        c.execute("SELECT sb_digest_preferences('{}')")
    c.execute("SELECT set_config('test.user_id',%s,false)", (u,))
    c.execute('SET ROLE authenticated')
    assert not c.execute("SELECT sb_digest_preferences('{}')").fetchone()[0]['enabled']
    for payload in [{'enabled':'true'}, {'time':'25:00'}, {'user_id':u}, {'time':None}]:
        with pytest.raises(psycopg.Error, match='invalid_preferences'):
            c.execute('SELECT sb_digest_preferences(%s)', (json.dumps(payload),))
    for fn in ['sb_digest_enqueue()', "sb_email_unsubscribe('a')", 'sb_email_claim()']:
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            c.execute('SELECT '+fn)
    c.execute('RESET ROLE')


def test_digest_deduplicates_and_respects_opt_out(digest_db):
    c = digest_db
    setup_digest(c)
    assert c.execute('SELECT sb_digest_enqueue()').fetchone()[0] == 1
    assert c.execute('SELECT sb_digest_enqueue()').fetchone()[0] == 0
    task = c.execute('SELECT sb_email_claim()').fetchone()[0]
    assert 'Synthetic reviewed event' in task['body']
    assert '/events/event-1' in task['body']
    assert c.execute('SELECT sb_email_permitted(%s)', (task['id'],)).fetchone()[0]
    c.execute("SELECT sb_digest_preferences('{\"enabled\":false}')")
    assert not c.execute('SELECT sb_email_permitted(%s)', (task['id'],)).fetchone()[0]


def test_empty_days_and_pre_consent_history_are_not_sent(digest_db):
    c = digest_db
    setup_digest(c)
    c.execute('UPDATE public.user_preferences SET digest_enabled_at=now()')
    assert c.execute('SELECT sb_digest_enqueue()').fetchone()[0] == 0
    c.execute("UPDATE public.user_preferences SET digest_enabled_at=now()-interval '3 days'")
    c.execute("UPDATE public.events SET state='retracted'")
    assert c.execute('SELECT sb_digest_enqueue()').fetchone()[0] == 0


def test_quiet_hours_defer_without_consuming_attempts(digest_db):
    c = digest_db
    u = setup_digest(c)
    assert c.execute('SELECT sb_digest_enqueue()').fetchone()[0] == 1
    c.execute("INSERT INTO public.workspace_preferences VALUES(%s,'{\"timezone\":\"Asia/Seoul\",\"quiet_enabled\":true,\"quiet_start\":\"00:00\",\"quiet_end\":\"00:00\"}')", (u,))
    assert c.execute('SELECT sb_email_claim()').fetchone()[0] is None
    assert c.execute('SELECT attempts FROM app_private.email_outbox').fetchone()[0] == 0
    c.execute("UPDATE public.workspace_preferences SET value='{\"quiet_enabled\":false}'")
    assert c.execute('SELECT sb_email_claim()').fetchone()[0]


def test_digest_is_queued_at_due_time_even_when_quiet(digest_db):
    c = digest_db
    u = setup_digest(c)
    c.execute("INSERT INTO public.workspace_preferences VALUES(%s,'{\"timezone\":\"Asia/Seoul\",\"quiet_enabled\":true,\"quiet_start\":\"00:00\",\"quiet_end\":\"00:00\"}')", (u,))
    assert c.execute('SELECT sb_digest_enqueue()').fetchone()[0] == 1
    assert c.execute('SELECT sb_email_claim()').fetchone()[0] is None


@pytest.mark.parametrize(('at_time','expected'), [('2026-10-17 13:00Z',True), ('2026-10-17 21:59Z',True), ('2026-10-17 22:00Z',False), ('2026-10-17 12:59Z',False)])
def test_overnight_quiet_boundary(digest_db, at_time, expected):
    c = digest_db
    u = seed(c)
    c.execute("INSERT INTO public.workspace_preferences VALUES(%s,'{\"timezone\":\"Asia/Seoul\",\"quiet_enabled\":true,\"quiet_start\":\"22:00\",\"quiet_end\":\"07:00\"}')", (u,))
    assert c.execute('SELECT app_private.email_quiet(%s,%s)', (u,at_time)).fetchone()[0] is expected


def test_unsubscribe_is_scoped_idempotent_and_suppresses_queued_mail(digest_db):
    c = digest_db
    setup_digest(c)
    c.execute('SELECT sb_digest_enqueue()')
    token = c.execute('SELECT unsubscribe_token FROM app_private.email_outbox').fetchone()[0]
    assert not c.execute("SELECT sb_email_unsubscribe(%s)", ('0'*64,)).fetchone()[0]
    for _ in range(2):
        assert c.execute('SELECT sb_email_unsubscribe(%s)', (token,)).fetchone()[0]
    assert c.execute('SELECT daily_digest OR email_notifications FROM public.user_preferences').fetchone()[0] is False
    assert c.execute('SELECT state FROM app_private.email_outbox').fetchone()[0] == 'suppressed'


def test_retraction_and_muting_rechecked_at_dispatch(digest_db):
    c = digest_db
    u = setup_digest(c)
    c.execute('SELECT sb_digest_enqueue()')
    task = c.execute('SELECT sb_email_claim()').fetchone()[0]
    c.execute("INSERT INTO public.workspace_preferences VALUES(%s,'{\"muted_companies\":[\"company-1\"]}')", (u,))
    assert not c.execute('SELECT sb_email_permitted(%s)', (task['id'],)).fetchone()[0]
    c.execute('DELETE FROM public.workspace_preferences')
    c.execute("UPDATE public.events SET state='retracted'")
    assert not c.execute('SELECT sb_email_permitted(%s)', (task['id'],)).fetchone()[0]
