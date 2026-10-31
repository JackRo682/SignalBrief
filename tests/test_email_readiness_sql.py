"""Readiness and consent regression tests; disposable database and synthetic mail only."""
import json
from pathlib import Path

import psycopg
import pytest
from test_provider_delivery_sql import seed

pytest_plugins = ['test_provider_delivery_sql']
pytestmark = pytest.mark.postgres
ROOT = Path(__file__).resolve().parents[1]
MIGRATION = '20261031132007_email_readiness_gate.sql'


@pytest.fixture
def readiness_db(provider_db):
    c = provider_db
    c.execute('CREATE SCHEMA app_content_private')
    c.execute('ALTER TABLE public.user_preferences ADD COLUMN daily_digest boolean NOT NULL DEFAULT false')
    c.execute('ALTER TABLE public.notifications ADD COLUMN created_at timestamptz DEFAULT now()')
    c.execute((ROOT / 'docs/sql/daily-digest.sql').read_text())
    # Function definitions only: never install cron or invoke external network requests.
    scheduling = (ROOT / 'docs/sql/notification-schedule.sql').read_text()
    c.execute(scheduling.split('SELECT cron.schedule(')[0])
    c.execute((ROOT / 'supabase/workspace-migrations' / MIGRATION).read_text())
    return c


def configured(c):
    for key, value in {
        'email_enabled': True,
        'resend_from': 'alerts@example.test',
        'resend_domain_verified': True,
        'email_delivery_verified': True,
        'email_dispatch_verified': True,
    }.items():
        c.execute('INSERT INTO app_private.us_config VALUES(%s,%s) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
                  (key, json.dumps(value)))
    c.execute("INSERT INTO vault.decrypted_secrets VALUES('signalbrief::RESEND_API_KEY','synthetic-resend-key'),('signalbrief::RESEND_WEBHOOK_SECRET','whsec_synthetic')")


def test_both_settings_use_same_unavailable_state_and_preserve_consent(readiness_db):
    c = readiness_db
    u = seed(c)
    c.execute('UPDATE user_preferences SET email_notifications=true,daily_digest=true,digest_enabled_at=now()')
    c.execute("SELECT set_config('test.user_id',%s,false)", (u,))
    c.execute('SET ROLE authenticated')
    email = c.execute('SELECT sb_email_preferences()').fetchone()[0]
    digest = c.execute("SELECT sb_digest_preferences('{}')").fetchone()[0]
    assert email == {'available': False, 'enabled': False, 'preference_enabled': True}
    assert digest == {'available': False, 'enabled': False, 'preference_enabled': True, 'time': '09:00'}
    with pytest.raises(psycopg.Error, match='email_unavailable'):
        c.execute('SELECT sb_email_preferences(true)')
    with pytest.raises(psycopg.Error, match='verified_email_required'):
        c.execute("SELECT sb_digest_preferences('{\"enabled\":true}')")
    for name in ('sb_email_readiness()', 'sb_email_claim()', 'sb_digest_enqueue()'):
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            c.execute('SELECT '+name)
    c.execute('RESET ROLE')
    assert c.execute('SELECT email_notifications AND daily_digest FROM user_preferences').fetchone()[0]
    c.execute("INSERT INTO notifications(id,user_id,event_id) VALUES('blocked-notice',%s,'event-1')", (u,))
    assert c.execute('SELECT count(*) FROM app_private.email_outbox').fetchone()[0] == 0
    assert c.execute('SELECT sb_digest_enqueue()').fetchone()[0] == 0
    assert c.execute('SELECT app_private.enqueue_notifications()').fetchone()[0] is None
    assert c.execute('SELECT count(*) FROM app_private.notification_tasks').fetchone()[0] == 0


@pytest.mark.parametrize(('key', 'secret', 'check'), [
    ('email_enabled', False, 'enabled'),
    ('resend_from', False, 'sender'),
    ('resend_domain_verified', False, 'domain_verified'),
    ('email_delivery_verified', False, 'delivery_verified'),
    ('email_dispatch_verified', False, 'dispatch_verified'),
    ('signalbrief::RESEND_API_KEY', True, 'credentials'),
    ('signalbrief::RESEND_WEBHOOK_SECRET', True, 'webhook'),
])
def test_each_required_check_fails_closed_without_exposing_credentials(readiness_db, key, secret, check):
    c = readiness_db
    configured(c)
    ready = c.execute('SELECT sb_email_readiness()').fetchone()[0]
    assert ready['available'] is True and all(ready['checks'].values())
    assert 'synthetic' not in json.dumps(ready) and 'example.test' not in json.dumps(ready)
    c.execute('DELETE FROM '+('vault.decrypted_secrets WHERE name=%s' if secret else 'app_private.us_config WHERE key=%s'), (key,))
    c.execute('SET ROLE service_role')
    blocked = c.execute('SELECT sb_email_readiness()').fetchone()[0]
    assert blocked['available'] is False and blocked['checks'][check] is False
    assert c.execute('SELECT sb_email_claim()').fetchone()[0] is None
    assert c.execute('SELECT sb_digest_enqueue()').fetchone()[0] == 0
    c.execute('RESET ROLE')
    c.execute('SET ROLE anon')
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        c.execute('SELECT sb_email_readiness()')
    c.execute('RESET ROLE')


def test_disabled_delivery_preserves_queue_attempts_and_unsubscribe_still_works(readiness_db):
    c = readiness_db
    u = seed(c)
    configured(c)
    c.execute('UPDATE user_preferences SET email_notifications=true,daily_digest=true')
    c.execute("INSERT INTO notifications(id,user_id,event_id) VALUES('ready-notice',%s,'event-1')", (u,))
    task = c.execute('SELECT id,unsubscribe_token FROM app_private.email_outbox').fetchone()
    c.execute("UPDATE app_private.us_config SET value='false' WHERE key='email_dispatch_verified'")
    assert c.execute('SELECT sb_email_claim()').fetchone()[0] is None
    assert c.execute('SELECT state,attempts FROM app_private.email_outbox').fetchone() == ('pending', 0)
    c.execute("UPDATE app_private.email_outbox SET state='running',recipient='synthetic@example.test' WHERE id=%s", (task[0],))
    assert c.execute('SELECT sb_email_permitted(%s)', (task[0],)).fetchone()[0] is False
    c.execute("UPDATE app_private.email_outbox SET state='pending' WHERE id=%s", (task[0],))
    for _ in range(2):
        assert c.execute('SELECT sb_email_unsubscribe(%s)', (task[1],)).fetchone()[0] is True
    assert c.execute('SELECT email_notifications OR daily_digest FROM user_preferences').fetchone()[0] is False
    assert c.execute('SELECT state,attempts FROM app_private.email_outbox').fetchone() == ('suppressed', 0)


def test_explicit_opt_out_remains_available_and_is_scoped_to_actor(readiness_db):
    c = readiness_db
    u = seed(c)
    other = 'cccccccc-cccc-4ccc-cccc-cccccccccccc'
    c.execute('INSERT INTO public.users VALUES(%s)', (other,))
    c.execute('INSERT INTO user_preferences(user_id,email_notifications,daily_digest) VALUES(%s,true,true)', (other,))
    c.execute('UPDATE user_preferences SET email_notifications=true,daily_digest=true WHERE user_id=%s', (u,))
    c.execute("SELECT set_config('test.user_id',%s,false)", (u,))
    c.execute('SET ROLE authenticated')
    assert c.execute('SELECT sb_email_preferences(false)').fetchone()[0]['preference_enabled'] is False
    assert c.execute("SELECT sb_digest_preferences('{\"enabled\":false}')").fetchone()[0]['preference_enabled'] is False
    c.execute('RESET ROLE')
    assert c.execute('SELECT email_notifications AND daily_digest FROM user_preferences WHERE user_id=%s', (other,)).fetchone()[0] is True


def test_rollback_restores_prior_rpc_availability_without_changing_user_data(readiness_db):
    c = readiness_db
    u = seed(c)
    c.execute("SELECT set_config('test.user_id',%s,false)", (u,))
    c.execute('UPDATE user_preferences SET email_notifications=true')
    c.execute("INSERT INTO app_private.email_outbox(user_id,subject,body) VALUES(%s,'Synthetic preserved subject','Synthetic preserved body')", (u,))
    assert c.execute('SELECT sb_email_preferences()').fetchone()[0]['available'] is False
    c.execute((ROOT / 'supabase/workspace-rollbacks' / MIGRATION).read_text())
    assert c.execute('SELECT sb_email_preferences()').fetchone()[0]['available'] is True
    assert c.execute('SELECT email_notifications FROM user_preferences WHERE user_id=%s', (u,)).fetchone()[0] is True
    assert c.execute('SELECT count(*) FROM app_private.email_outbox').fetchone()[0] == 1
    c.execute((ROOT / 'supabase/workspace-migrations' / MIGRATION).read_text())
    assert c.execute('SELECT sb_email_preferences()').fetchone()[0]['available'] is False
    assert c.execute('SELECT count(*) FROM app_private.email_outbox').fetchone()[0] == 1
