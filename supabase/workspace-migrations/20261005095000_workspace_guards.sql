-- Protect direct/Realtime reads and limit raw uploads, including unlinked
-- objects. The browser attachment validator is not an authorization boundary.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['workspace_preferences','workspace_saved','workspace_history','workspace_searches','workspace_tickets','workspace_attachments'] LOOP
  EXECUTE format('CREATE POLICY sb_mfa_assurance ON public.%I AS RESTRICTIVE TO authenticated USING ((SELECT app_private.sb_mfa_satisfied())) WITH CHECK ((SELECT app_private.sb_mfa_satisfied()))',t);
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION app_private.sb_workspace_upload_gate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
 DECLARE u text:=(SELECT auth.uid())::text; ticket uuid; existing integer;
 BEGIN
  IF NEW.bucket_id<>'signalbrief-support' THEN RETURN NEW; END IF;
  PERFORM public.sb_require_mfa();
  IF u IS NULL OR split_part(NEW.name,'/',1)<>u
     OR NEW.name!~'^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(png|jpg|webp|pdf)$' THEN
   RAISE EXCEPTION 'invalid_attachment_owner' USING ERRCODE='PT403';
  END IF;
  ticket:=split_part(NEW.name,'/',2)::uuid;
  -- A row lock makes concurrent raw uploads share the same limit.
  PERFORM 1 FROM public.workspace_tickets WHERE id=ticket AND user_id=u FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ticket_not_found' USING ERRCODE='PT404'; END IF;
  SELECT count(*) INTO existing FROM storage.objects
   WHERE bucket_id=NEW.bucket_id AND split_part(name,'/',1)=u AND split_part(name,'/',2)=ticket::text;
  IF existing>=3 THEN RAISE EXCEPTION 'attachment_limit' USING ERRCODE='PT429'; END IF;
  RETURN NEW;
 END
$$;
REVOKE ALL ON FUNCTION app_private.sb_workspace_upload_gate() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER sb_workspace_upload_quota BEFORE INSERT ON storage.objects
 FOR EACH ROW EXECUTE FUNCTION app_private.sb_workspace_upload_gate();
NOTIFY pgrst,'reload schema';
