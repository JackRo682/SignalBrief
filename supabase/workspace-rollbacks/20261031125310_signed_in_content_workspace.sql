-- Apply after reverting the web deployment to its legacy RPC routing.
-- Preserve saved/history identities, source data, private functions and alerts.
-- The existing sb_workspace and sb_document_detail RPCs were never replaced.
BEGIN;
ALTER TABLE public.us_analyses DISABLE TRIGGER us_content_notification;
ALTER TABLE public.dart_analyses DISABLE TRIGGER dart_content_notification;
REVOKE EXECUTE ON FUNCTION public.sb_customer_workspace(text,jsonb) FROM authenticated;
REVOKE EXECUTE ON FUNCTION app_content_private.workspace(text,jsonb) FROM authenticated;
CREATE OR REPLACE FUNCTION app_private.sb_workspace_notification_gate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v jsonb; t time; a time; b time; company text; tz text; BEGIN
 SELECT value INTO v FROM public.workspace_preferences WHERE user_id=NEW.user_id;IF NOT FOUND THEN v:='{"daily_cap":3,"timezone":"Asia/Seoul","quiet_enabled":false,"muted_companies":[]}';END IF;
 PERFORM 1 FROM public.users WHERE id=NEW.user_id FOR UPDATE;
 SELECT company_id INTO company FROM public.events WHERE id=NEW.event_id;
 IF coalesce(v->'muted_companies','[]') ? company THEN RETURN NULL;END IF;
 tz:=coalesce(v->>'timezone','Asia/Seoul');t:=(now() AT TIME ZONE tz)::time;
 IF coalesce((v->>'quiet_enabled')::boolean,false) THEN a:=(v->>'quiet_start')::time;b:=(v->>'quiet_end')::time;
  IF a=b OR (a<b AND t>=a AND t<b) OR (a>b AND (t>=a OR t<b)) THEN RETURN NULL;END IF;END IF;
 IF (SELECT count(*) FROM public.notifications WHERE user_id=NEW.user_id AND (created_at AT TIME ZONE tz)::date=(now() AT TIME ZONE tz)::date)>=coalesce((v->>'daily_cap')::integer,3) THEN RETURN NULL;END IF;
 RETURN NEW;END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
