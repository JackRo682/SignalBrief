-- Keep a personal event's selected company through the existing owner-scoped mutation.
-- Preserve the audited function's authentication, validation, limits and other actions.
DO $migration$
DECLARE definition text;
old_insert text:=$old$i:=gen_random_uuid()::text; INSERT INTO public.calendar_items(id,user_id,title,occurs_on,origin,created_at) VALUES(i,u,trim(p->>'title'),(p->>'occurs_on')::date,'user',now());$old$;
new_insert text:=$new$c:=nullif(trim(p->>'company_id'),'');
  IF c IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.companies WHERE id=c AND NOT is_demo) THEN
   RAISE EXCEPTION 'company_not_found' USING ERRCODE='PT404';
  END IF;
  i:=gen_random_uuid()::text; INSERT INTO public.calendar_items(id,user_id,company_id,title,occurs_on,origin,created_at)
  VALUES(i,u,c,trim(p->>'title'),(p->>'occurs_on')::date,'user',now());$new$;
BEGIN
 definition:=pg_get_functiondef('public.sb_user_action(text,jsonb)'::regprocedure);
 IF position(old_insert IN definition)=0 THEN RAISE EXCEPTION 'calendar_mutation_precondition_failed';END IF;
 EXECUTE replace(definition,old_insert,new_insert);
END $migration$;

-- Report actual configured source coverage independently of whether a month has events.
-- No raw snapshots, task tokens or other private operational fields are exposed.
CREATE FUNCTION app_content_private.calendar_coverage(selected_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid:=(SELECT auth.uid());result jsonb;BEGIN
 IF u IS NULL OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=u) THEN
  RAISE EXCEPTION 'authentication_required' USING ERRCODE='PT401';
 END IF;
 PERFORM public.sb_require_mfa();PERFORM public.sb_rate_limit();
 IF selected_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.companies WHERE id=selected_id AND NOT is_demo) THEN
  RAISE EXCEPTION 'company_not_found' USING ERRCODE='PT404';
 END IF;
 WITH coverage AS (
  SELECT c.id,count(s.key) source_count,max(s.last_success_at) last_success_at,
   coalesce(bool_or(s.error_code IS NOT NULL),false) has_error
  FROM public.companies c LEFT JOIN app_private.calendar_sources s
   ON s.enabled AND s.ticker=c.ticker AND s.market=c.market
  WHERE NOT c.is_demo GROUP BY c.id
 ) SELECT jsonb_build_object(
  'registered_companies',(SELECT count(*) FROM coverage),
  'covered_companies',(SELECT count(*) FROM coverage WHERE source_count>0),
  'selected',(SELECT jsonb_build_object('company_id',id,'source_count',source_count,
   'last_success_at',last_success_at,'has_error',has_error) FROM coverage WHERE id=selected_id)
 ) INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION app_content_private.calendar_coverage(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION app_content_private.calendar_coverage(text) TO authenticated;
CREATE FUNCTION public.sb_calendar_coverage(p_company_id text DEFAULT NULL) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT app_content_private.calendar_coverage(p_company_id) $$;
REVOKE ALL ON FUNCTION public.sb_calendar_coverage(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.sb_calendar_coverage(text) TO authenticated;
NOTIFY pgrst,'reload schema';
