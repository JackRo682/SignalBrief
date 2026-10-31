-- Re-enable the additive customer API after the data-preserving rollback.
-- No sources are reapproved, notifications backfilled, or user data modified.
BEGIN;
CREATE OR REPLACE FUNCTION app_private.sb_workspace_notification_gate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE company text;
BEGIN
 PERFORM 1 FROM public.users WHERE id=NEW.user_id FOR UPDATE;
 SELECT company_id INTO company FROM public.events WHERE id=NEW.event_id;
 IF NOT app_private.sb_app_notification_allowed(NEW.user_id,company) THEN RETURN NULL;END IF;
 RETURN NEW;
END $$;
GRANT EXECUTE ON FUNCTION app_content_private.workspace(text,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sb_customer_workspace(text,jsonb) TO authenticated;
ALTER TABLE public.us_analyses ENABLE TRIGGER us_content_notification;
ALTER TABLE public.dart_analyses ENABLE TRIGGER dart_content_notification;
NOTIFY pgrst,'reload schema';
COMMIT;
