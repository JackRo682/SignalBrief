CREATE TABLE IF NOT EXISTS app_private.email_outbox(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),notification_id varchar(36) UNIQUE REFERENCES public.notifications(id),
 user_id varchar(36) REFERENCES public.users(id),kind text NOT NULL DEFAULT 'notification' CHECK(kind IN ('notification','test')),
 recipient text,subject text NOT NULL,body text NOT NULL,state text NOT NULL DEFAULT 'pending',
 provider_id text UNIQUE,attempts int NOT NULL DEFAULT 0,next_attempt_at timestamptz NOT NULL DEFAULT now(),
 lease_until timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),error_code text
);
CREATE TABLE IF NOT EXISTS app_private.email_events(event_id text PRIMARY KEY,email_id text NOT NULL,type text NOT NULL,occurred_at timestamptz NOT NULL);
CREATE INDEX IF NOT EXISTS email_events_message ON app_private.email_events(email_id);
CREATE TABLE IF NOT EXISTS app_private.email_suppressions(address_hash text PRIMARY KEY,reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
REVOKE ALL ON app_private.email_outbox,app_private.email_events,app_private.email_suppressions FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.sb_us_secrets() RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(jsonb_object_agg(substring(name from 14),decrypted_secret),'{}'::jsonb) FROM vault.decrypted_secrets WHERE name IN
 ('signalbrief::OPENAI_API_KEY','signalbrief::FMP_API_KEY','signalbrief::RESEND_API_KEY','signalbrief::GNEWS_API_KEY','signalbrief::SEC_CONTACT_EMAIL','signalbrief::DART_API_KEY','signalbrief::RESEND_WEBHOOK_SECRET','signalbrief::KIS_APP_KEY','signalbrief::KIS_APP_SECRET')
$$;
CREATE OR REPLACE FUNCTION app_private.queue_email_notification() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.user_preferences WHERE user_id=NEW.user_id AND email_notifications) AND
 EXISTS(SELECT 1 FROM app_private.us_config WHERE key='email_enabled' AND value='true') THEN
 INSERT INTO app_private.email_outbox(notification_id,user_id,subject,body)
 SELECT NEW.id,NEW.user_id,'SignalBrief: '||left(e.title,100),
 'A reviewed event is available: '||e.title||E'\nhttps://signalbrief.online/events/'||e.id||E'\nManage email alerts: https://signalbrief.online/settings/notifications'
 FROM public.events e WHERE e.id=NEW.event_id AND e.state='published'
 ON CONFLICT(notification_id) DO NOTHING;
 END IF;RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER queue_email_notification AFTER INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION app_private.queue_email_notification();
CREATE OR REPLACE FUNCTION public.sb_email_permitted(eid uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE q app_private.email_outbox%rowtype;v jsonb;tz text;t time;a time;b time;c text;BEGIN
 SELECT * INTO q FROM app_private.email_outbox WHERE id=eid;
 IF NOT FOUND THEN RETURN false;END IF;
 IF EXISTS(SELECT 1 FROM app_private.email_suppressions WHERE address_hash=encode(extensions.digest(lower(q.recipient),'sha256'),'hex')) THEN RETURN false;END IF;
 IF q.kind='test' THEN RETURN true;END IF;
 IF NOT EXISTS(SELECT 1 FROM public.user_preferences WHERE user_id=q.user_id AND email_notifications) THEN RETURN false;END IF;
 SELECT e.company_id INTO c FROM public.notifications n JOIN public.events e ON e.id=n.event_id WHERE n.id=q.notification_id AND e.state='published';
 IF NOT FOUND THEN RETURN false;END IF;
 SELECT value INTO v FROM public.workspace_preferences WHERE user_id=q.user_id;v:=coalesce(v,'{}');
 IF coalesce(v->'muted_companies','[]') ? c THEN RETURN false;END IF;
 tz:=coalesce(v->>'timezone','Asia/Seoul');t:=(now() AT TIME ZONE tz)::time;
 IF coalesce((v->>'quiet_enabled')::boolean,false) THEN a:=(v->>'quiet_start')::time;b:=(v->>'quiet_end')::time;
 IF a=b OR (a<b AND t>=a AND t<b) OR (a>b AND (t>=a OR t<b)) THEN RETURN false;END IF;END IF;
 RETURN EXISTS(SELECT 1 FROM auth.users u WHERE u.id::text=q.user_id AND u.email=q.recipient AND u.email_confirmed_at IS NOT NULL);
END $$;
CREATE OR REPLACE FUNCTION public.sb_email_claim() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE q app_private.email_outbox%rowtype;mail text;BEGIN
 SELECT * INTO q FROM app_private.email_outbox WHERE
 ((state='pending' OR state='retry') AND next_attempt_at<=now() OR state='running' AND lease_until<now())
 AND attempts<3 AND created_at>now()-interval '20 hours' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN NULL;END IF;
 mail:=q.recipient;
 IF q.kind='notification' THEN SELECT email INTO mail FROM auth.users WHERE id::text=q.user_id AND email_confirmed_at IS NOT NULL;END IF;
 UPDATE app_private.email_outbox SET state='running',attempts=attempts+1,lease_until=now()+interval '2 minutes',recipient=mail,updated_at=now() WHERE id=q.id;
 IF mail IS NULL THEN UPDATE app_private.email_outbox SET state='suppressed',error_code='verified_recipient_required' WHERE id=q.id;RETURN NULL;END IF;
 RETURN jsonb_build_object('id',q.id,'recipient',mail,'subject',q.subject,'body',q.body);
END $$;
CREATE OR REPLACE FUNCTION public.sb_email_finish(eid uuid,message_id text,error_code text DEFAULT NULL,retryable boolean DEFAULT false) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE observed text;BEGIN
 IF message_id IS NOT NULL THEN
 SELECT type INTO observed FROM app_private.email_events WHERE email_id=message_id ORDER BY
 CASE type WHEN 'email.complained' THEN 5 WHEN 'email.bounced' THEN 4 WHEN 'email.failed' THEN 4 WHEN 'email.suppressed' THEN 4 WHEN 'email.delivered' THEN 3 ELSE 1 END DESC,occurred_at DESC LIMIT 1;
 UPDATE app_private.email_outbox SET state=CASE observed WHEN 'email.delivered' THEN 'delivered' WHEN 'email.bounced' THEN 'bounced' WHEN 'email.complained' THEN 'complained' WHEN 'email.failed' THEN 'failed' WHEN 'email.suppressed' THEN 'suppressed' ELSE 'submitted' END,
 provider_id=message_id,updated_at=now() WHERE id=eid AND state='running';
 ELSE UPDATE app_private.email_outbox SET state=CASE WHEN sb_email_finish.error_code='consent_or_publication_changed' THEN 'suppressed' WHEN retryable AND attempts<3 THEN 'retry' ELSE 'failed' END,
 next_attempt_at=now()+interval '5 minutes',error_code=sb_email_finish.error_code,updated_at=now() WHERE id=eid AND state='running';END IF;
END $$;
CREATE OR REPLACE FUNCTION public.sb_email_event(event_id text,type text,email_id text,occurred_at timestamptz) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE q app_private.email_outbox%rowtype;BEGIN
 INSERT INTO app_private.email_events VALUES(event_id,email_id,type,occurred_at) ON CONFLICT DO NOTHING;
 IF NOT FOUND THEN RETURN;END IF;
 SELECT * INTO q FROM app_private.email_outbox WHERE provider_id=email_id FOR UPDATE;IF NOT FOUND THEN RETURN;END IF;
 IF type IN ('email.bounced','email.complained','email.suppressed') THEN
 INSERT INTO app_private.email_suppressions VALUES(encode(extensions.digest(lower(q.recipient),'sha256'),'hex'),type,now()) ON CONFLICT DO NOTHING;
 END IF;
 IF q.state NOT IN ('complained','bounced','failed','suppressed') AND
 (type IN ('email.bounced','email.complained','email.failed','email.suppressed') OR type='email.delivered' AND q.state<>'delivered') THEN
 UPDATE app_private.email_outbox SET state=substring(type from 7),updated_at=now() WHERE id=q.id;END IF;
END $$;
CREATE OR REPLACE FUNCTION public.sb_email_preferences(enabled boolean DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE uid text:=(SELECT auth.uid())::text;active boolean;BEGIN
 IF uid IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='PT401';END IF;
 SELECT value='true'::jsonb INTO active FROM app_private.us_config WHERE key='email_enabled';
 IF enabled IS NOT NULL THEN
 IF enabled AND NOT coalesce(active,false) THEN RAISE EXCEPTION 'email_unavailable' USING ERRCODE='PT409';END IF;
 UPDATE public.user_preferences SET email_notifications=enabled,updated_at=now() WHERE user_id=uid;
 IF NOT FOUND THEN RAISE EXCEPTION 'preferences_missing' USING ERRCODE='PT409';END IF;END IF;
 RETURN jsonb_build_object('available',coalesce(active,false),'enabled',coalesce((SELECT email_notifications FROM public.user_preferences WHERE user_id=uid),false));
END $$;
REVOKE ALL ON FUNCTION public.sb_us_secrets(),public.sb_email_claim(),public.sb_email_finish(uuid,text,text,boolean),public.sb_email_permitted(uuid),public.sb_email_event(text,text,text,timestamptz),public.sb_email_preferences(boolean),app_private.queue_email_notification() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sb_us_secrets(),public.sb_email_claim(),public.sb_email_finish(uuid,text,text,boolean),public.sb_email_permitted(uuid),public.sb_email_event(text,text,text,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.sb_email_preferences(boolean) TO authenticated;
NOTIFY pgrst,'reload schema';
