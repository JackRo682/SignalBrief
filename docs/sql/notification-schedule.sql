CREATE TABLE IF NOT EXISTS app_private.notification_tasks(token_hash text PRIMARY KEY,expires_at timestamptz NOT NULL,claimed_at timestamptz);
ALTER TABLE app_private.notification_tasks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.notification_tasks FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.sb_notifications_authorize(h text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 UPDATE app_private.notification_tasks SET claimed_at=now() WHERE token_hash=h AND claimed_at IS NULL AND expires_at>now();
 RETURN FOUND;
END $$;
CREATE OR REPLACE FUNCTION app_private.enqueue_notifications() RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE token text; request_id bigint;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM app_private.us_config WHERE key='email_enabled' AND value='true') THEN RETURN NULL; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(20261018,6);
 DELETE FROM app_private.notification_tasks WHERE expires_at<now()-interval '1 day';
 token:=encode(extensions.gen_random_bytes(32),'hex');
 INSERT INTO app_private.notification_tasks(token_hash,expires_at) VALUES(encode(extensions.digest(token,'sha256'),'hex'),now()+interval '4 minutes');
 SELECT net.http_post(url:='https://xabzzhtdmqsaqdauthbu.supabase.co/functions/v1/signalbrief-notifications',headers:=jsonb_build_object('Content-Type','application/json','x-signalbrief-task',token),body:='{}'::jsonb,timeout_milliseconds:=120000) INTO request_id;
 RETURN request_id;
END $$;
REVOKE ALL ON FUNCTION public.sb_notifications_authorize(text),app_private.enqueue_notifications() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sb_notifications_authorize(text) TO service_role;
SELECT cron.schedule('signalbrief-notifications','*/5 * * * *','select app_private.enqueue_notifications();');
NOTIFY pgrst,'reload schema';
