-- Project already archived, identity-verified official facts into customer company
-- resources. This is a factual introduction, not an approved business analysis.
-- No new provider request, approval, cache mutation or public table grant occurs.
CREATE FUNCTION app_private.sb_company_official_overview(cid text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.companies%ROWTYPE; cached jsonb; fields jsonb; stamp timestamptz;
 expected_url text; source_path text; k text; valid boolean:=true; directory record;
BEGIN
 IF (SELECT auth.uid()) IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO c FROM public.companies WHERE id=cid AND provider IN ('sec','dart') AND NOT is_demo;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT value INTO cached FROM app_private.us_cache
 WHERE key='profile:'||c.provider||':v1:'||c.id||':'||c.provider_company_id||':'||c.ticker;
 fields:=cached->'profile';
 expected_url:=CASE WHEN c.provider='dart' THEN 'https://opendart.fss.or.kr/guide/detail.do?apiGrpCd=DS001&apiId=2019002'
  ELSE 'https://www.sec.gov/edgar/browse/?CIK='||lpad(c.provider_company_id,10,'0') END;
 source_path:=CASE WHEN c.provider='dart' THEN 'dart/profiles/' ELSE 'us/sec/submissions/' END||(cached->>'source_sha256')||'.json';
 IF jsonb_typeof(cached)='object' AND cached->>'status'='verified' AND cached->>'company_id'=c.id
  AND cached->>'provider'=(CASE WHEN c.provider='dart' THEN 'OpenDART' ELSE 'SEC EDGAR' END)
  AND cached->>'source_url'=expected_url AND jsonb_typeof(cached->'source_sha256')='string'
  AND cached->>'source_sha256'~'^[a-f0-9]{64}$'
  AND jsonb_typeof(fields)='object' AND jsonb_typeof(fields->'ticker')='string' AND fields->>'ticker'=c.ticker
  AND jsonb_typeof(fields->'corp_code')='string'
  AND fields->>'corp_code'=(CASE WHEN c.provider='dart' THEN c.provider_company_id ELSE lpad(c.provider_company_id,10,'0') END)
  AND jsonb_typeof(fields->'name')='string' AND length(trim(fields->>'name')) BETWEEN 1 AND 500
  AND jsonb_typeof(cached->'fetched_at')='string'
  AND cached->>'fetched_at'~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$'
  AND EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='signalbrief-raw' AND name=source_path) THEN
  BEGIN
   stamp:=(cached->>'fetched_at')::timestamptz;
   IF NOT isfinite(stamp) OR stamp>now()+interval '5 minutes' THEN valid:=false; END IF;
   IF fields->>'established_on' IS NOT NULL AND (
    fields->>'established_on'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    OR to_char((fields->>'established_on')::date,'YYYY-MM-DD')<>fields->>'established_on') THEN valid:=false; END IF;
  EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN valid:=false;
  END;
  FOREACH k IN ARRAY ARRAY['english_name','industry_description','industry_code','ceo','established_on','website'] LOOP
   IF fields->k IS NOT NULL AND fields->k<>'null'::jsonb AND (
    jsonb_typeof(fields->k)<>'string' OR length(trim(fields->>k)) NOT BETWEEN 1 AND 1000) THEN valid:=false; END IF;
  END LOOP;
  IF fields->>'website' IS NOT NULL AND (fields->>'website'!~'^https://[A-Za-z0-9.-]+(:[0-9]+)?([/?#].*)?$'
   OR fields->>'website'~'[[:space:]]') THEN valid:=false; END IF;
  IF valid THEN
   -- Expiry controls re-fetching, not whether these archived, dated facts existed.
   -- Always retain and display the actual verification timestamp.
   RETURN jsonb_build_object('kind','profile','provider',cached->>'provider','company_id',c.id,
    'provider_company_id',c.provider_company_id,'ticker',c.ticker,'name',fields->>'name',
    'english_name',fields->>'english_name','industry_description',fields->>'industry_description',
    'industry_code',fields->>'industry_code','established_on',fields->>'established_on',
    'ceo',fields->>'ceo','website',fields->>'website','source_url',expected_url,
    'source_sha256',cached->>'source_sha256','fetched_at',cached->>'fetched_at');
  END IF;
 END IF;
 -- An activated directory identity still has sourced basic facts while its
 -- separate profile/filing collection is pending or unavailable.
 SELECT d.* INTO directory FROM app_private.company_directory d
 JOIN app_private.company_directory_sources s ON s.provider=d.provider
 WHERE d.provider=c.provider AND d.provider_company_id=c.provider_company_id AND d.ticker=c.ticker AND d.active
  AND s.source_sha256=d.source_sha256
  AND s.raw_object_key='directory/'||d.provider||'/'||d.source_sha256||CASE WHEN d.provider='dart' THEN '.zip' ELSE '.json' END
  AND EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='signalbrief-raw' AND name=s.raw_object_key);
 IF NOT FOUND THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('kind','directory','provider',CASE WHEN c.provider='dart' THEN 'OpenDART' ELSE 'SEC EDGAR' END,
  'company_id',c.id,'provider_company_id',c.provider_company_id,'ticker',directory.ticker,'name',directory.name,
  'english_name',directory.official_english_name,'industry_description',NULL,'industry_code',NULL,
  'established_on',NULL,'ceo',NULL,'website',NULL,
  'source_url',CASE WHEN c.provider='dart' THEN 'https://opendart.fss.or.kr/guide/detail.do?apiGrpCd=DS001&apiId=2019018'
   ELSE 'https://www.sec.gov/files/company_tickers_exchange.json' END,
  'source_sha256',directory.source_sha256,'fetched_at',directory.fetched_at);
END $$;
REVOKE ALL ON FUNCTION app_private.sb_company_official_overview(text) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION app_private.sb_company_resource_overview(resource jsonb) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT CASE WHEN resource->>'kind'='company' THEN resource||jsonb_build_object(
  'official_overview',app_private.sb_company_official_overview(resource->>'id')) ELSE resource END
$$;
REVOKE ALL ON FUNCTION app_private.sb_company_resource_overview(jsonb) FROM PUBLIC,anon,authenticated;

-- Extend only the company JSON projections; preserve the existing RPC auth,
-- MFA, rate limits, filters, numeric-evidence and approval visibility rules.
DO $migration$
DECLARE target regprocedure; definition text; old_text text; new_text text;
BEGIN
 FOR target,old_text,new_text IN SELECT * FROM (VALUES
  ('app_content_private.redesign(text,jsonb)'::regprocedure,
   $old$jsonb_agg(to_jsonb(x)-'market_group')$old$,
   $new$jsonb_agg(app_private.sb_company_resource_overview(to_jsonb(x)-'market_group'))$new$),
  ('app_content_private.workspace(text,jsonb)'::regprocedure,
   $old$jsonb_agg(to_jsonb(x)-'priority') FROM paged x$old$,
   $new$jsonb_agg(app_private.sb_company_resource_overview(to_jsonb(x)-'priority')) FROM paged x$new$),
  ('app_content_private.workspace(text,jsonb)'::regprocedure,
   $old$r:=public.sb_workspace('company',p);$old$,
   $new$r:=public.sb_workspace('company',p);
  r:=jsonb_set(r,'{company}',app_private.sb_company_resource_overview(r->'company'));$new$)
 ) AS changes(target,old_text,new_text) LOOP
  definition:=pg_get_functiondef(target);
  IF length(definition)-length(replace(definition,old_text,''))<>length(old_text) THEN
   RAISE EXCEPTION 'company_overview_migration_precondition_failed: %',target;
  END IF;
  EXECUTE replace(definition,old_text,new_text);
 END LOOP;
END $migration$;
NOTIFY pgrst,'reload schema';
