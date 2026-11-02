-- DART periodic profiles retain the official ZIP, its issuer-bound receipt list,
-- and the deterministic normalized evidence separately. No analysis is approved.
ALTER FUNCTION app_content_private.profile_enrichment_admin(text,jsonb) RENAME TO profile_enrichment_admin_v1;
REVOKE ALL ON FUNCTION app_content_private.profile_enrichment_admin_v1(text,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION app_content_private.profile_enrichment_admin(op text,p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
<<dart_profile>>
DECLARE c public.companies%ROWTYPE; stored app_private.company_profile_enrichments%ROWTYPE; f public.dart_filings%ROWTYPE;
 value jsonb; archives jsonb; src jsonb; pub jsonb; proof jsonb; item jsonb; previous jsonb;
 k text; checked timestamptz; refresh_at timestamptz; owned uuid; parts text[]; start_at integer; end_at integer; count_fields integer;
BEGIN
 IF op<>'save' THEN RETURN app_content_private.profile_enrichment_admin_v1(op,p);END IF;
 SELECT * INTO c FROM public.companies WHERE id=p->>'company_id' AND NOT is_demo;
 IF c.provider IS DISTINCT FROM 'dart' THEN RETURN app_content_private.profile_enrichment_admin_v1(op,p);END IF;
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR coalesce(p->>'lease','')!~'^[a-f0-9-]{36}$' THEN RAISE EXCEPTION 'invalid_profile_request' USING ERRCODE='PT422';END IF;
 BEGIN owned:=(p->>'lease')::uuid;EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'invalid_profile_request' USING ERRCODE='PT422';END;
 SELECT * INTO stored FROM app_private.company_profile_enrichments WHERE company_id=c.id FOR UPDATE;
 IF NOT FOUND OR stored.lease IS DISTINCT FROM owned OR stored.lease_until<=now() OR stored.provider<>c.provider OR stored.provider_company_id<>c.provider_company_id OR stored.ticker<>c.ticker THEN RAISE EXCEPTION 'profile_lease_lost' USING ERRCODE='PT409';END IF;
 value:=p->'result';archives:=p->'archives';
 IF jsonb_typeof(value) IS DISTINCT FROM 'object' OR NOT(value ?& ARRAY['schema','company_id','status','checked_at','next_refresh_at','sources','leadership','formation','business','products','segments','limitations','last_error'])
  OR value->>'schema' IS DISTINCT FROM 'signalbrief.company-profile.v1' OR value->>'company_id' IS DISTINCT FROM c.id OR coalesce(value->>'status','') NOT IN ('partial','not_available') OR value->'last_error' IS DISTINCT FROM 'null'::jsonb
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(value) x WHERE x NOT IN ('schema','company_id','status','checked_at','next_refresh_at','sources','leadership','formation','business','products','segments','limitations','last_error'))
  OR jsonb_typeof(archives) IS DISTINCT FROM 'array' OR jsonb_array_length(archives)>1 OR octet_length(archives::text)>8000000 THEN RAISE EXCEPTION 'invalid_profile_snapshot' USING ERRCODE='PT422';END IF;
 FOREACH k IN ARRAY ARRAY['sources','leadership','formation','business','products','segments','limitations'] LOOP
  IF jsonb_typeof(value->k) IS DISTINCT FROM 'array' OR jsonb_array_length(value->k)>(CASE k WHEN 'sources' THEN 1 WHEN 'leadership' THEN 0 WHEN 'formation' THEN 0 WHEN 'business' THEN 2 WHEN 'products' THEN 10 WHEN 'segments' THEN 12 ELSE 20 END) THEN RAISE EXCEPTION 'invalid_profile_snapshot' USING ERRCODE='PT422';END IF;
 END LOOP;
 BEGIN
  checked:=(value->>'checked_at')::timestamptz;refresh_at:=(value->>'next_refresh_at')::timestamptz;
  IF checked IS NULL OR refresh_at IS NULL OR NOT isfinite(checked) OR NOT isfinite(refresh_at) OR checked>now()+interval '5 minutes' OR checked<now()-interval '1 hour' OR refresh_at<=checked OR refresh_at>checked+interval '1 day' THEN RAISE EXCEPTION 'bad';END IF;
 EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'invalid_profile_timestamp' USING ERRCODE='PT422';END;
 count_fields:=jsonb_array_length(value->'business')+jsonb_array_length(value->'products')+jsonb_array_length(value->'segments');
 IF value->>'status'='not_available' AND (count_fields<>0 OR jsonb_array_length(archives)<>0 OR jsonb_array_length(value->'sources')<>0)
  OR value->>'status'='partial' AND (count_fields=0 OR jsonb_array_length(archives)<>1 OR jsonb_array_length(value->'sources')<>1) THEN RAISE EXCEPTION 'invalid_profile_completeness' USING ERRCODE='PT422';END IF;
 FOREACH k IN ARRAY ARRAY['business','products','segments'] LOOP
  IF coalesce(jsonb_array_length(stored.result->k),0)>0 AND jsonb_array_length(value->k)=0 THEN RAISE EXCEPTION 'profile_snapshot_regression' USING ERRCODE='PT409';END IF;
 END LOOP;
 FOR src IN SELECT * FROM jsonb_array_elements(archives) LOOP
  IF jsonb_typeof(src) IS DISTINCT FROM 'object' OR NOT(src ?& ARRAY['id','provider','source_url','source_sha256','fetched_at','published_on','publication_precision','publication_timezone','report_period','form_type','title','normalization','normalized_sha256','object_key','normalized_object_key','filing_id','provider_company_id','ticker','normalized_text'])
   OR EXISTS(SELECT 1 FROM jsonb_object_keys(src) x WHERE x NOT IN ('id','provider','source_url','source_sha256','fetched_at','published_on','publication_precision','publication_timezone','report_period','form_type','title','normalization','normalized_sha256','object_key','normalized_object_key','filing_id','provider_company_id','ticker','normalized_text'))
   OR src->>'id' IS DISTINCT FROM src->>'source_sha256' OR coalesce(src->>'source_sha256','')!~'^[a-f0-9]{64}$' OR coalesce(src->>'normalized_sha256','')!~'^[a-f0-9]{64}$'
   OR src->>'provider' IS DISTINCT FROM 'OpenDART' OR src->>'provider_company_id' IS DISTINCT FROM c.provider_company_id OR src->>'ticker' IS DISTINCT FROM c.ticker
   OR coalesce(src->>'normalization','') NOT IN ('dart-periodic-xml-text-v1','dart-periodic-recovered-text-v1') OR jsonb_typeof(src->'normalized_text') IS DISTINCT FROM 'string' OR length(src->>'normalized_text') NOT BETWEEN 1 AND 2000000
   OR src->>'normalized_sha256' IS DISTINCT FROM encode(extensions.digest(convert_to(src->>'normalized_text','UTF8'),'sha256'),'hex')
   OR src->>'object_key' IS DISTINCT FROM ('profiles/dart/'||(src->>'source_sha256')||'.zip') OR src->>'normalized_object_key' IS DISTINCT FROM ('profiles/dart/normalized/'||(src->>'normalized_sha256')||'.txt')
   OR src->>'publication_precision' IS DISTINCT FROM 'date' OR src->>'publication_timezone' IS DISTINCT FROM 'Asia/Seoul'
   THEN RAISE EXCEPTION 'invalid_profile_sources' USING ERRCODE='PT422';END IF;
  FOREACH k IN ARRAY ARRAY['id','provider','source_url','source_sha256','fetched_at','published_on','publication_precision','publication_timezone','report_period','form_type','title','normalization','normalized_sha256','object_key','normalized_object_key','filing_id','provider_company_id','ticker'] LOOP
   IF jsonb_typeof(src->k) IS DISTINCT FROM 'string' OR length(src->>k) NOT BETWEEN 1 AND 2048 THEN RAISE EXCEPTION 'invalid_profile_sources' USING ERRCODE='PT422';END IF;
  END LOOP;
  SELECT * INTO f FROM public.dart_filings WHERE id::text=src->>'filing_id' AND company_id=c.id;
  parts:=regexp_match(f.title,'(사업|반기|분기)보고서[[:space:]]*[(](20[0-9]{2})[.]([01][0-9])[)]$');
  IF f.id IS NULL OR f.receipt!~'^[0-9]{14}$' OR parts IS NULL OR src->>'source_url' IS DISTINCT FROM ('https://dart.fss.or.kr/dsaf001/main.do?rcpNo='||f.receipt)
   OR f.source_url IS DISTINCT FROM src->>'source_url' OR src->>'title' IS DISTINCT FROM f.title OR src->>'published_on' IS DISTINCT FROM f.filing_date::text
   OR src->>'report_period' IS DISTINCT FROM (parts[2]||'-'||parts[3]) OR src->>'form_type' IS DISTINCT FROM (parts[1]||'보고서')
   OR coalesce(f.source_sha256,'')!~'^[a-f0-9]{64}$' OR f.source_object_key IS DISTINCT FROM ('dart/lists/'||f.source_sha256||'.json')
   OR NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='signalbrief-raw' AND name=f.source_object_key)
   OR NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='signalbrief-raw' AND name=src->>'object_key')
   OR NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='signalbrief-raw' AND name=src->>'normalized_object_key') THEN RAISE EXCEPTION 'invalid_profile_source_identity' USING ERRCODE='PT422';END IF;
  BEGIN
   IF (src->>'fetched_at')::timestamptz>checked+interval '5 minutes' OR (src->>'fetched_at')::timestamptz<checked-interval '1 hour'
    OR (src->>'published_on')::date>(checked AT TIME ZONE 'Asia/Seoul')::date OR (src->>'report_period'||'-01')::date>(checked AT TIME ZONE 'Asia/Seoul')::date THEN RAISE EXCEPTION 'bad';END IF;
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'invalid_profile_source_date' USING ERRCODE='PT422';END;
  IF src->>'normalization'='dart-periodic-recovered-text-v1' AND NOT(value->'limitations' @> '["source_markup_recovery_requires_review"]'::jsonb) THEN RAISE EXCEPTION 'profile_recovery_status_required' USING ERRCODE='PT422';END IF;
  previous:=stored.result->'sources'->0;
  IF previous IS NOT NULL AND (previous->>'report_period'>src->>'report_period' OR previous->>'report_period'=src->>'report_period' AND
   (previous->>'published_on'>src->>'published_on' OR previous->>'published_on'=src->>'published_on' AND right(previous->>'source_url',14)>f.receipt)) THEN RAISE EXCEPTION 'profile_snapshot_regression' USING ERRCODE='PT409';END IF;
  IF previous->>'source_sha256'=src->>'source_sha256' AND previous->>'normalized_sha256' IS DISTINCT FROM src->>'normalized_sha256' THEN RAISE EXCEPTION 'profile_source_conflict' USING ERRCODE='PT409';END IF;
  pub:=src-ARRAY['object_key','normalized_object_key','filing_id','provider_company_id','ticker','normalized_text'];
  IF value->'sources'->0 IS DISTINCT FROM pub THEN RAISE EXCEPTION 'invalid_profile_source_projection' USING ERRCODE='PT422';END IF;
 END LOOP;
 FOREACH k IN ARRAY ARRAY['business','products','segments'] LOOP
  FOR item IN SELECT * FROM jsonb_array_elements(value->k) LOOP
   proof:=item->'evidence';
   IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR jsonb_typeof(proof) IS DISTINCT FROM 'object' OR proof->>'source_id' IS DISTINCT FROM src->>'id'
    OR jsonb_typeof(proof->'quote') IS DISTINCT FROM 'string' OR length(proof->>'quote') NOT BETWEEN 1 AND 1600 OR proof->'location'->>'kind' IS DISTINCT FROM 'normalized_text'
    OR jsonb_typeof(proof->'location'->'section') IS DISTINCT FROM 'string' OR length(proof->'location'->>'section') NOT BETWEEN 1 AND 200
    OR coalesce(proof->'location'->>'start','')!~'^[0-9]{1,7}$' OR coalesce(proof->'location'->>'end','')!~'^[0-9]{1,7}$' THEN RAISE EXCEPTION 'invalid_profile_evidence' USING ERRCODE='PT422';END IF;
   start_at:=(proof->'location'->>'start')::integer;end_at:=(proof->'location'->>'end')::integer;
   IF end_at<=start_at OR substring(src->>'normalized_text' FROM start_at+1 FOR end_at-start_at) IS DISTINCT FROM proof->>'quote' THEN RAISE EXCEPTION 'profile_quote_mismatch' USING ERRCODE='PT422';END IF;
   IF k='business' THEN
    IF item->>'text' IS DISTINCT FROM proof->>'quote' THEN RAISE EXCEPTION 'profile_quote_mismatch' USING ERRCODE='PT422';END IF;
   ELSE
    IF jsonb_typeof(item->'name') IS DISTINCT FROM 'string' OR length(item->>'name') NOT BETWEEN 1 AND 120 OR strpos(proof->>'quote',item->>'name')=0 OR item->'description' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'profile_quote_mismatch' USING ERRCODE='PT422';END IF;
   END IF;
  END LOOP;
 END LOOP;
 FOR item IN SELECT * FROM jsonb_array_elements(value->'limitations') LOOP
  IF jsonb_typeof(item) IS DISTINCT FROM 'string' OR (item#>>'{}')!~'^[a-z_]{3,80}$' THEN RAISE EXCEPTION 'invalid_profile_snapshot' USING ERRCODE='PT422';END IF;
 END LOOP;
 UPDATE app_private.company_profile_enrichments SET result=value,archives=dart_profile.archives,next_refresh_at=refresh_at,lease=NULL,lease_until=NULL,last_error=NULL,updated_at=now() WHERE company_id=c.id;
 RETURN value;
END $$;
REVOKE ALL ON FUNCTION app_content_private.profile_enrichment_admin(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app_content_private.profile_enrichment_admin(text,jsonb) TO service_role;
CREATE OR REPLACE FUNCTION public.sb_profile_enrichment_admin(op text,p jsonb) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$SELECT app_content_private.profile_enrichment_admin(op,p)$$;
REVOKE ALL ON FUNCTION public.sb_profile_enrichment_admin(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sb_profile_enrichment_admin(text,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
