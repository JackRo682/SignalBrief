-- OpenDART corpCode.xml supplies corp_eng_name. Keep the primary display name
-- unchanged and retain the additional official name with its snapshot provenance.
ALTER TABLE app_private.company_directory ADD COLUMN official_english_name text
 CHECK(official_english_name IS NULL OR (length(official_english_name) BETWEEN 1 AND 500 AND btrim(official_english_name)<>''));

-- Existing protected search functions call this as their owner. No new public
-- endpoint, definer boundary, table grant or caller-selected identity is added.
CREATE FUNCTION app_private.sb_company_official_search_names(cid text) RETURNS text
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT coalesce(string_agg(d.official_english_name,' '),'')
 FROM public.companies c JOIN app_private.company_directory d
 ON d.provider=c.provider AND d.provider_company_id=c.provider_company_id
 WHERE c.id=cid AND NOT c.is_demo AND d.active
$$;
REVOKE ALL ON FUNCTION app_private.sb_company_official_search_names(text) FROM PUBLIC,anon,authenticated;

-- Preserve every audited authorization, approval, lease and quota check. Abort
-- rather than apply a partial replacement if the expected definitions drift.
DO $migration$
DECLARE target regprocedure;definition text;old_expression text;new_expression text;BEGIN
 FOR target,old_expression,new_expression IN SELECT * FROM (VALUES
 ('app_content_private.discovery_admin(text,jsonb)'::regprocedure,
  $old$jsonb_typeof(x)<>'object' OR length(coalesce(x->>'name',''))$old$,
  $new$jsonb_typeof(x)<>'object' OR (x ? 'official_english_name' AND x->'official_english_name'<>'null'::jsonb AND
   (jsonb_typeof(x->'official_english_name')<>'string' OR length(btrim(x->>'official_english_name')) NOT BETWEEN 1 AND 500)) OR length(coalesce(x->>'name',''))$new$),
 ('app_content_private.discovery_admin(text,jsonb)'::regprocedure,
  $old$ticker,name,market,source_sha256,fetched_at,active)$old$,
  $new$ticker,name,official_english_name,market,source_sha256,fetched_at,active)$new$),
 ('app_content_private.discovery_admin(text,jsonb)'::regprocedure,
  $old$x->>'ticker',x->>'name',x->>'market',p->>'sha'$old$,
  $new$x->>'ticker',x->>'name',nullif(btrim(x->>'official_english_name'),''),x->>'market',p->>'sha'$new$),
 ('app_content_private.discovery_admin(text,jsonb)'::regprocedure,
  $old$SET name=EXCLUDED.name,market=EXCLUDED.market$old$,
  $new$SET name=EXCLUDED.name,official_english_name=EXCLUDED.official_english_name,market=EXCLUDED.market$new$),
 ('app_content_private.discovery_search(text)'::regprocedure,
  $old$app_private.sb_search_normalize(d.name)=app_private.sb_search_normalize(q) THEN 1$old$,
  $new$app_private.sb_search_normalize(d.name)=app_private.sb_search_normalize(q) OR app_private.sb_search_normalize(d.official_english_name)=app_private.sb_search_normalize(q) THEN 1$new$),
 ('app_content_private.discovery_search(text)'::regprocedure,
  $old$app_private.sb_search_normalize(d.name||' '||d.ticker)$old$,
  $new$app_private.sb_search_normalize(concat_ws(' ',d.name,d.ticker,d.official_english_name))$new$),
 ('public.sb_workspace(text,jsonb)'::regprocedure,
  $old$app_private.sb_search_normalize(c.name||' '||c.ticker)$old$,
  $new$app_private.sb_search_normalize(c.name||' '||c.ticker||' '||app_private.sb_company_official_search_names(c.id))$new$),
 ('app_content_private.workspace(text,jsonb)'::regprocedure,
  $old$app_private.sb_search_normalize(x.title||' '||x.summary||' '||x.ticker||' '||x.company_name||' '||x.category)$old$,
  $new$app_private.sb_search_normalize(x.title||' '||x.summary||' '||x.ticker||' '||x.company_name||' '||x.category||' '||app_private.sb_company_official_search_names(x.company_id))$new$),
 ('app_content_private.redesign(text,jsonb)'::regprocedure,
  $old$app_private.sb_search_normalize(c.company_name||' '||c.ticker||' '||c.title)$old$,
  $new$app_private.sb_search_normalize(c.company_name||' '||c.ticker||' '||c.title||' '||app_private.sb_company_official_search_names(c.company_id))$new$)
 )x(target,old_expression,new_expression) LOOP
  definition:=pg_get_functiondef(target);
  IF position(old_expression IN definition)=0 THEN RAISE EXCEPTION 'official_name_migration_precondition_failed: %',target;END IF;
  EXECUTE replace(definition,old_expression,new_expression);
 END LOOP;
END $migration$;
NOTIFY pgrst,'reload schema';
