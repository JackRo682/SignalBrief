-- Enforce opt-in MFA at the Data API boundary, not just in the settings UI.
-- Auth endpoints remain accessible at AAL1 so a user can complete a challenge.
CREATE OR REPLACE FUNCTION app_private.sb_mfa_satisfied()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT (SELECT auth.uid()) IS NULL
 OR coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'aal','aal1')='aal2'
 OR NOT EXISTS(SELECT 1 FROM auth.mfa_factors f WHERE f.user_id=(SELECT auth.uid()) AND f.status='verified')
$$;
REVOKE ALL ON FUNCTION app_private.sb_mfa_satisfied() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION app_private.sb_mfa_satisfied() TO authenticated,service_role;
CREATE OR REPLACE FUNCTION public.sb_require_mfa()
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
 BEGIN
  IF NOT app_private.sb_mfa_satisfied() THEN
   RAISE EXCEPTION 'mfa_required' USING ERRCODE='PT403';
  END IF;
 END
$$;
REVOKE ALL ON FUNCTION public.sb_require_mfa() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sb_require_mfa() TO anon,authenticated,service_role;
DO $$ DECLARE previous text; BEGIN
 SELECT split_part(c,'=',2) INTO previous FROM pg_roles r,unnest(r.rolconfig) c
 WHERE r.rolname='authenticator' AND c LIKE 'pgrst.db_pre_request=%';
 IF previous IS NOT NULL AND previous<>'' AND previous<>'public.sb_require_mfa' THEN
  RAISE EXCEPTION 'existing_pre_request_requires_manual_composition';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticator') THEN
  ALTER ROLE authenticator SET pgrst.db_pre_request='public.sb_require_mfa';
 END IF;
END $$;
-- Data API pre-request hooks do not cover Storage or Realtime. Preserve every
-- existing ownership policy and add a restrictive assurance policy alongside it.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['users','user_preferences','watchlists','watchlist_items','portfolios','positions','question_history','alerts','notifications','calendar_items','calendar_reminders','feedback'] LOOP
  EXECUTE format('CREATE POLICY sb_mfa_assurance ON public.%I AS RESTRICTIVE TO authenticated USING ((SELECT app_private.sb_mfa_satisfied())) WITH CHECK ((SELECT app_private.sb_mfa_satisfied()))',t);
 END LOOP;
END $$;
CREATE POLICY sb_mfa_assurance ON storage.objects AS RESTRICTIVE TO authenticated
 USING((SELECT app_private.sb_mfa_satisfied())) WITH CHECK((SELECT app_private.sb_mfa_satisfied()));
NOTIFY pgrst,'reload config';
NOTIFY pgrst,'reload schema';
