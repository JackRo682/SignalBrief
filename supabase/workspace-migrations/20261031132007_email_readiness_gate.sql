-- Keep email unavailable until all operational checks are explicitly verified.
-- No consent, credentials, verification flags, queue rows or schedules are changed.
-- The only exposed readiness endpoint is service-role-only; it returns booleans.
GRANT USAGE ON SCHEMA app_content_private TO service_role;
CREATE OR REPLACE FUNCTION app_content_private.email_readiness() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH config AS (SELECT coalesce(jsonb_object_agg(key,value),'{}'::jsonb) v FROM app_private.us_config),
 checks AS (SELECT jsonb_build_object(
  'enabled',coalesce(v->'email_enabled'='true'::jsonb,false),
  'sender',coalesce(v->>'resend_from' ~ '^[A-Za-z0-9.!#$%&''*+/=?^_{|}~-]+@[A-Za-z0-9.-]+[.][A-Za-z]{2,}$',false),
  'domain_verified',coalesce(v->'resend_domain_verified'='true'::jsonb,false),
  'credentials',EXISTS(SELECT 1 FROM vault.decrypted_secrets WHERE name='signalbrief::RESEND_API_KEY' AND length(trim(decrypted_secret))>0),
  'webhook',EXISTS(SELECT 1 FROM vault.decrypted_secrets WHERE name='signalbrief::RESEND_WEBHOOK_SECRET' AND decrypted_secret ~ '^whsec_.+'),
  'delivery_verified',coalesce(v->'email_delivery_verified'='true'::jsonb,false),
  'dispatch_verified',coalesce(v->'email_dispatch_verified'='true'::jsonb,false)) v FROM config)
 SELECT jsonb_build_object('available',(SELECT bool_and(value='true'::jsonb) FROM jsonb_each(checks.v)),'checks',v) FROM checks
$$;
REVOKE ALL ON FUNCTION app_content_private.email_readiness() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app_content_private.email_readiness() TO service_role;
CREATE OR REPLACE FUNCTION public.sb_email_readiness() RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT app_content_private.email_readiness()
$$;
REVOKE ALL ON FUNCTION public.sb_email_readiness() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sb_email_readiness() TO service_role;

CREATE OR REPLACE FUNCTION app_private.queue_email_notification() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.user_preferences WHERE user_id=NEW.user_id AND email_notifications) AND
 (app_content_private.email_readiness()->>'available')::boolean THEN
 INSERT INTO app_private.email_outbox(notification_id,user_id,subject,body)
 SELECT NEW.id,NEW.user_id,'SignalBrief: '||left(e.title,100),
 'A reviewed event is available: '||e.title||E'\nhttps://signalbrief.online/events/'||e.id||E'\nManage email alerts: https://signalbrief.online/settings/notifications'
 FROM public.events e WHERE e.id=NEW.event_id AND e.state='published'
 ON CONFLICT(notification_id) DO NOTHING;
 END IF;RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.sb_email_preferences(enabled boolean DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE uid text:=(SELECT auth.uid())::text;active boolean;BEGIN
 IF uid IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='PT401';END IF;
 active:=(app_content_private.email_readiness()->>'available')::boolean;
 IF enabled IS NOT NULL THEN
 IF enabled AND NOT coalesce(active,false) THEN RAISE EXCEPTION 'email_unavailable' USING ERRCODE='PT409';END IF;
 UPDATE public.user_preferences SET email_notifications=enabled,updated_at=now() WHERE user_id=uid;
 IF NOT FOUND THEN RAISE EXCEPTION 'preferences_missing' USING ERRCODE='PT409';END IF;END IF;
 RETURN jsonb_build_object('available',coalesce(active,false),'enabled',active AND coalesce((SELECT email_notifications FROM public.user_preferences WHERE user_id=uid),false),'preference_enabled',coalesce((SELECT email_notifications FROM public.user_preferences WHERE user_id=uid),false));
END $$;

CREATE OR REPLACE FUNCTION public.sb_digest_preferences(p jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u text:=(SELECT auth.uid())::text; active boolean; r public.user_preferences%rowtype;
BEGIN
 IF u IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='PT401'; END IF;
 IF p IS NULL OR jsonb_typeof(p)<>'object' OR p - ARRAY['enabled','time'] <> '{}' OR
 (p ? 'enabled' AND jsonb_typeof(p->'enabled')<>'boolean') OR
 (p ? 'time' AND (jsonb_typeof(p->'time')<>'string' OR (p->>'time') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')) THEN
 RAISE EXCEPTION 'invalid_preferences' USING ERRCODE='PT422'; END IF;
 active:=(app_content_private.email_readiness()->>'available')::boolean;
 IF p->>'enabled'='true' AND (NOT active OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id::text=u AND email_confirmed_at IS NOT NULL)) THEN
 RAISE EXCEPTION 'verified_email_required' USING ERRCODE='PT409'; END IF;
 UPDATE public.user_preferences SET
 digest_enabled_at=CASE WHEN p->>'enabled'='true' AND NOT daily_digest THEN now() ELSE digest_enabled_at END,
 daily_digest=coalesce((p->>'enabled')::boolean,daily_digest),digest_time=coalesce((p->>'time')::time,digest_time),updated_at=CASE WHEN p<>'{}' THEN now() ELSE updated_at END
 WHERE user_id=u RETURNING * INTO r;
 IF NOT FOUND THEN RAISE EXCEPTION 'preferences_missing' USING ERRCODE='PT409'; END IF;
 IF p->>'enabled'='false' THEN UPDATE app_private.email_outbox SET state='suppressed',error_code='unsubscribed',updated_at=now() WHERE user_id=u AND kind='digest' AND state IN ('pending','retry'); END IF;
 RETURN jsonb_build_object('available',active,'enabled',active AND r.daily_digest,'preference_enabled',r.daily_digest,'time',to_char(r.digest_time,'HH24:MI'));
END $$;

CREATE OR REPLACE FUNCTION public.sb_digest_enqueue() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r record; d date; added integer:=0; n integer;
BEGIN
 IF NOT (app_content_private.email_readiness()->>'available')::boolean THEN RETURN 0; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(20261018,5);
 FOR r IN SELECT p.*,coalesce(w.value,'{}') AS v,coalesce(w.value->>'timezone','Asia/Seoul') AS tz FROM public.user_preferences p
 LEFT JOIN public.workspace_preferences w ON w.user_id=p.user_id JOIN auth.users a ON a.id::text=p.user_id AND a.email_confirmed_at IS NOT NULL
 WHERE p.daily_digest AND p.digest_enabled_at IS NOT NULL LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=r.tz) THEN CONTINUE; END IF;
  IF (now() AT TIME ZONE r.tz)::time<r.digest_time THEN CONTINUE; END IF;
  d:=(now() AT TIME ZONE r.tz)::date-1;
  INSERT INTO app_private.email_outbox(user_id,kind,digest_date,event_ids,subject,body)
  SELECT r.user_id,'digest',d,jsonb_agg(x.event_id ORDER BY x.created_at),
  'SignalBrief 일일 요약 · '||d::text,
  '검토 후 게시된 전날의 앱 알림입니다. ('||r.tz||E')\n\n'||string_agg(left(x.title,250)||E'\nhttps://signalbrief.online/events/'||x.event_id,E'\n\n' ORDER BY x.created_at)||E'\n\n알림 설정: https://signalbrief.online/settings/notifications'
  FROM (SELECT DISTINCT ON (e.id) e.id AS event_id,e.title,n.created_at FROM public.notifications n JOIN public.events e ON e.id=n.event_id
   WHERE n.user_id=r.user_id AND e.state='published' AND n.created_at>=r.digest_enabled_at
   AND n.created_at>=d::timestamp AT TIME ZONE r.tz AND n.created_at<(d+1)::timestamp AT TIME ZONE r.tz
   AND NOT (coalesce(r.v->'muted_companies','[]') ? e.company_id::text)
   ORDER BY e.id,n.created_at LIMIT 50) x HAVING count(*)>0
  ON CONFLICT(user_id,digest_date) WHERE kind='digest' DO NOTHING;
  GET DIAGNOSTICS n=ROW_COUNT;added:=added+n;
 END LOOP;
 RETURN added;
END $$;

CREATE OR REPLACE FUNCTION public.sb_email_permitted(eid uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE q app_private.email_outbox%rowtype; v jsonb;
BEGIN
 IF NOT (app_content_private.email_readiness()->>'available')::boolean THEN RETURN false;END IF;
 SELECT * INTO q FROM app_private.email_outbox WHERE id=eid;
 IF NOT FOUND OR q.state<>'running' THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM app_private.email_suppressions WHERE address_hash=encode(extensions.digest(lower(q.recipient),'sha256'),'hex')) THEN RETURN false; END IF;
 IF q.kind='test' THEN RETURN true; END IF;
 IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id::text=q.user_id AND email=q.recipient AND email_confirmed_at IS NOT NULL) OR app_private.email_quiet(q.user_id) THEN RETURN false; END IF;
 SELECT value INTO v FROM public.workspace_preferences WHERE user_id=q.user_id;
 IF q.kind='digest' THEN
  RETURN EXISTS(SELECT 1 FROM public.user_preferences WHERE user_id=q.user_id AND daily_digest)
  AND jsonb_array_length(q.event_ids)>0 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(q.event_ids) x(id)
   LEFT JOIN public.events e ON e.id=x.id WHERE e.id IS NULL OR e.state<>'published' OR coalesce(v->'muted_companies','[]') ? e.company_id::text);
 END IF;
 RETURN EXISTS(SELECT 1 FROM public.user_preferences WHERE user_id=q.user_id AND email_notifications)
 AND EXISTS(SELECT 1 FROM public.notifications n JOIN public.events e ON e.id=n.event_id WHERE n.id=q.notification_id AND n.user_id=q.user_id AND e.state='published' AND NOT (coalesce(v->'muted_companies','[]') ? e.company_id::text));
END $$;

CREATE OR REPLACE FUNCTION public.sb_email_claim() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE q app_private.email_outbox%rowtype; mail text;
BEGIN
 IF NOT (app_content_private.email_readiness()->>'available')::boolean THEN RETURN NULL;END IF;
 UPDATE app_private.email_outbox SET state='failed',error_code='retry_window_expired',updated_at=now()
 WHERE state IN ('pending','retry','running') AND (created_at<=now()-interval '48 hours' OR first_attempt_at<=now()-interval '20 hours' OR (attempts>=3 AND coalesce(lease_until,now())<=now()));
 SELECT * INTO q FROM app_private.email_outbox WHERE
 (((state='pending' OR state='retry') AND next_attempt_at<=now()) OR (state='running' AND lease_until<now()))
 AND attempts<3 AND NOT app_private.email_quiet(user_id) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN NULL; END IF;
 mail:=q.recipient;
 IF q.kind<>'test' THEN
 SELECT email INTO mail FROM auth.users WHERE id::text=q.user_id AND email_confirmed_at IS NOT NULL;
 IF q.attempts>0 AND mail IS DISTINCT FROM q.recipient THEN mail:=NULL; END IF;
 END IF;
 UPDATE app_private.email_outbox SET state='running',attempts=attempts+1,first_attempt_at=coalesce(first_attempt_at,now()),lease_until=now()+interval '2 minutes',recipient=mail,updated_at=now() WHERE id=q.id;
 IF mail IS NULL THEN UPDATE app_private.email_outbox SET state='suppressed',error_code='verified_recipient_required' WHERE id=q.id;RETURN NULL; END IF;
 RETURN jsonb_build_object('id',q.id,'recipient',mail,'subject',q.subject,'body',q.body||CASE WHEN q.kind<>'test' THEN E'\n\nUnsubscribe / 이메일 수신 거부: https://xabzzhtdmqsaqdauthbu.supabase.co/functions/v1/signalbrief-notifications/unsubscribe?token='||q.unsubscribe_token ELSE '' END,'unsubscribe_url',CASE WHEN q.kind<>'test' THEN 'https://xabzzhtdmqsaqdauthbu.supabase.co/functions/v1/signalbrief-notifications/unsubscribe?token='||q.unsubscribe_token ELSE NULL END);
END $$;

CREATE OR REPLACE FUNCTION app_private.enqueue_notifications() RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE token text; request_id bigint;
BEGIN
 IF NOT (app_content_private.email_readiness()->>'available')::boolean THEN RETURN NULL; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(20261018,6);
 DELETE FROM app_private.notification_tasks WHERE expires_at<now()-interval '1 day';
 token:=encode(extensions.gen_random_bytes(32),'hex');
 INSERT INTO app_private.notification_tasks(token_hash,expires_at) VALUES(encode(extensions.digest(token,'sha256'),'hex'),now()+interval '4 minutes');
 SELECT net.http_post(url:='https://xabzzhtdmqsaqdauthbu.supabase.co/functions/v1/signalbrief-notifications',headers:=jsonb_build_object('Content-Type','application/json','x-signalbrief-task',token),body:='{}'::jsonb,timeout_milliseconds:=120000) INTO request_id;
 RETURN request_id;
END $$;

-- Preserve explicit endpoint privileges even if a deployed function was absent.
REVOKE ALL ON FUNCTION app_private.queue_email_notification(),app_private.enqueue_notifications(),
 public.sb_email_preferences(boolean),public.sb_digest_preferences(jsonb),public.sb_digest_enqueue(),
 public.sb_email_permitted(uuid),public.sb_email_claim() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sb_email_preferences(boolean),public.sb_digest_preferences(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sb_digest_enqueue(),public.sb_email_permitted(uuid),public.sb_email_claim() TO service_role;
NOTIFY pgrst,'reload schema';
