-- Immutable, field-level company-profile evidence. This cache is independent of
-- approved financial analyses and never promotes a model-generated claim.
CREATE TABLE app_private.company_profile_enrichments (
 company_id varchar(36) PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
 provider text NOT NULL CHECK(provider IN ('sec','dart')),
 provider_company_id text NOT NULL,
 ticker text NOT NULL,
 result jsonb,
 archives jsonb NOT NULL DEFAULT '[]'::jsonb,
 next_refresh_at timestamptz NOT NULL DEFAULT '-infinity',
 lease uuid,
 lease_until timestamptz,
 last_error text,
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE app_private.company_profile_enrichments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.company_profile_enrichments FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE app_private.company_profile_official_sources (
 provider text NOT NULL CHECK(provider IN ('sec','dart')),
 provider_company_id text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('leadership_q4')),
 source_url text NOT NULL CHECK(source_url ~ '^https://[A-Za-z0-9.-]+/' AND source_url !~ '[[:space:]@]'),
 issuer_label text NOT NULL CHECK(length(issuer_label) BETWEEN 1 AND 100),
 PRIMARY KEY(provider,provider_company_id,kind)
);
ALTER TABLE app_private.company_profile_official_sources ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.company_profile_official_sources FROM PUBLIC,anon,authenticated,service_role;
-- Reviewed official identity/URL binding, not hardcoded executive or business text.
INSERT INTO app_private.company_profile_official_sources(provider,provider_company_id,kind,source_url,issuer_label)
VALUES('sec','0001403161','leadership_q4',
 'https://investor.visa.com/investor-relations/corporate-governance/board-of-directors/Person-Details/','Visa');

CREATE FUNCTION app_content_private.profile_enrichment_admin(op text,p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
<<enrichment>>
DECLARE c public.companies%ROWTYPE; stored app_private.company_profile_enrichments%ROWTYPE;
 value jsonb; archives jsonb; src jsonb; pub jsonb; item jsonb; proof jsonb; found_source jsonb;
 source_ids text[]:=ARRAY[]::text[]; k text; source_path text; source_url text; start_at integer; end_at integer;
 checked timestamptz; refresh_at timestamptz; owned uuid; text_value text; expected_provider text;
BEGIN
 IF jsonb_typeof(p)<>'object' OR p->>'company_id' IS NULL THEN RAISE EXCEPTION USING ERRCODE='PT422',MESSAGE='invalid_profile_request'; END IF;
 SELECT * INTO c FROM public.companies WHERE id=p->>'company_id' AND provider IN ('sec','dart') AND NOT is_demo;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='PT404',MESSAGE='company_not_found'; END IF;
 IF op='read' THEN
  SELECT * INTO stored FROM app_private.company_profile_enrichments WHERE company_id=c.id AND provider=c.provider AND provider_company_id=c.provider_company_id AND ticker=c.ticker;
  RETURN jsonb_build_object('result',stored.result,'refresh_in_progress',coalesce(stored.lease_until>now(),false),
   'official_sources',coalesce((SELECT jsonb_agg(jsonb_build_object('kind',s.kind,'source_url',s.source_url,'issuer_label',s.issuer_label))
    FROM app_private.company_profile_official_sources s WHERE s.provider=c.provider AND s.provider_company_id=lpad(c.provider_company_id,CASE WHEN c.provider='sec' THEN 10 ELSE 8 END,'0')),'[]'::jsonb));
 END IF;
 IF op NOT IN ('claim','save','fail') OR coalesce(p->>'lease','')!~'^[a-f0-9-]{36}$' THEN RAISE EXCEPTION USING ERRCODE='PT422',MESSAGE='invalid_profile_request'; END IF;
 BEGIN owned:=(p->>'lease')::uuid; EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION USING ERRCODE='PT422',MESSAGE='invalid_profile_request'; END;
 IF op='claim' THEN
  INSERT INTO app_private.company_profile_enrichments(company_id,provider,provider_company_id,ticker)
   VALUES(c.id,c.provider,c.provider_company_id,c.ticker) ON CONFLICT(company_id) DO NOTHING;
  UPDATE app_private.company_profile_enrichments AS cache SET provider=c.provider,provider_company_id=c.provider_company_id,ticker=c.ticker,
   result=CASE WHEN provider=c.provider AND provider_company_id=c.provider_company_id AND ticker=c.ticker THEN result ELSE NULL END,
   archives=CASE WHEN provider=c.provider AND provider_company_id=c.provider_company_id AND ticker=c.ticker THEN cache.archives ELSE '[]'::jsonb END,
   lease=owned,lease_until=now()+interval '38 seconds',updated_at=now()
  WHERE company_id=c.id AND (lease_until IS NULL OR lease_until<=now()) AND
   (next_refresh_at<=now() OR provider<>c.provider OR provider_company_id<>c.provider_company_id OR ticker<>c.ticker);
  RETURN to_jsonb(FOUND);
 END IF;
 SELECT * INTO stored FROM app_private.company_profile_enrichments WHERE company_id=c.id FOR UPDATE;
 IF NOT FOUND OR stored.lease IS DISTINCT FROM owned OR stored.lease_until<=now() OR stored.provider<>c.provider OR stored.provider_company_id<>c.provider_company_id OR stored.ticker<>c.ticker THEN
  RAISE EXCEPTION USING ERRCODE='PT409',MESSAGE='profile_lease_lost';
 END IF;
 IF op='fail' THEN
  IF coalesce(p->>'code','')!~'^[a-z_]{3,80}$' THEN RAISE EXCEPTION USING ERRCODE='PT422',MESSAGE='invalid_profile_failure'; END IF;
  value:=CASE WHEN stored.result IS NOT NULL THEN stored.result||jsonb_build_object('status','partial','last_error',p->>'code',
   'next_refresh_at',to_jsonb(now()+interval '5 minutes'),'limitations',(stored.result->'limitations')||jsonb_build_array('refresh_unavailable'))
   ELSE jsonb_build_object('schema','signalbrief.company-profile.v1','company_id',c.id,'status','unavailable',
    'checked_at',now(),'next_refresh_at',now()+interval '5 minutes','sources','[]'::jsonb,'leadership','[]'::jsonb,
    'formation','[]'::jsonb,'business','[]'::jsonb,'products','[]'::jsonb,'segments','[]'::jsonb,
    'limitations',jsonb_build_array('refresh_unavailable'),'last_error',p->>'code') END;
  UPDATE app_private.company_profile_enrichments SET result=value,next_refresh_at=now()+interval '5 minutes',lease=NULL,lease_until=NULL,last_error=p->>'code',updated_at=now() WHERE company_id=c.id;
  RETURN value;
 END IF;
 value:=p->'result'; archives:=p->'archives';
 IF jsonb_typeof(value)<>'object' OR NOT(value ?& ARRAY['schema','company_id','status','checked_at','next_refresh_at','sources','leadership','formation','business','products','segments','limitations','last_error']) OR value->>'schema' IS DISTINCT FROM 'signalbrief.company-profile.v1' OR value->>'company_id' IS DISTINCT FROM c.id
  OR jsonb_typeof(value->'status') IS DISTINCT FROM 'string' OR value->>'status' NOT IN ('ready','partial','not_available') OR value->'last_error' IS DISTINCT FROM 'null'::jsonb
  OR jsonb_typeof(value->'checked_at') IS DISTINCT FROM 'string' OR jsonb_typeof(value->'next_refresh_at') IS DISTINCT FROM 'string'
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(value) x WHERE x NOT IN ('schema','company_id','status','checked_at','next_refresh_at','sources','leadership','formation','business','products','segments','limitations','last_error'))
  OR jsonb_typeof(archives)<>'array' OR jsonb_array_length(archives)>8 OR octet_length(archives::text)>8000000
 THEN RAISE EXCEPTION USING ERRCODE='PT422',MESSAGE='invalid_profile_snapshot'; END IF;
 BEGIN
  checked:=(value->>'checked_at')::timestamptz; refresh_at:=(value->>'next_refresh_at')::timestamptz;
  IF NOT isfinite(checked) OR NOT isfinite(refresh_at) OR checked>now()+interval '5 minutes' OR checked<now()-interval '1 hour'
   OR refresh_at<=checked OR refresh_at>checked+interval '1 day' THEN RAISE EXCEPTION 'bad'; END IF;
 EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION USING ERRCODE='PT422',MESSAGE='invalid_profile_timestamp'; END;
 FOREACH k IN ARRAY ARRAY['sources','leadership','formation','business','products','segments','limitations'] LOOP
  IF jsonb_typeof(value->k)<>'array' OR jsonb_array_length(value->k)>(CASE k WHEN 'products' THEN 10 WHEN 'segments' THEN 12 WHEN 'limitations' THEN 20 WHEN 'sources' THEN 8 WHEN 'formation' THEN 4 ELSE 2 END) THEN
   RAISE EXCEPTION USING ERRCODE='PT422',MESSAGE='invalid_profile_snapshot';
  END IF;
 END LOOP;
 IF value->>'status'='ready' AND (jsonb_array_length(value->'business')=0 OR jsonb_array_length(value->'products')=0 OR jsonb_array_length(value->'segments')=0 OR jsonb_array_length(value->'leadership')=0 OR jsonb_array_length(value->'formation')=0)
  OR value->>'status'='not_available' AND (jsonb_array_length(value->'business')+jsonb_array_length(value->'products')+jsonb_array_length(value->'segments')+jsonb_array_length(value->'leadership')+jsonb_array_length(value->'formation')<>0)
  THEN RAISE EXCEPTION USING ERRCODE='PT422',MESSAGE='invalid_profile_completeness'; END IF;
 IF jsonb_array_length(value->'sources')<>jsonb_array_length(archives) THEN RAISE EXCEPTION USING ERRCODE='PT422',MESSAGE='invalid_profile_sources'; END IF;
 FOR src IN SELECT * FROM jsonb_array_elements(archives) LOOP
  IF jsonb_typeof(src)<>'object' OR NOT(src ?& ARRAY['id','provider','source_url','source_sha256','fetched_at','published_on','publication_precision','report_period','form_type','title','normalization','object_key','provider_company_id','ticker','normalized_text']) OR src->>'id' IS DISTINCT FROM src->>'source_sha256'
   OR coalesce(src->>'source_sha256','')!~'^[a-f0-9]{64}$' OR src->>'id'=ANY(source_ids)
   OR src->>'provider_company_id' IS DISTINCT FROM c.provider_company_id OR src->>'ticker' IS DISTINCT FROM c.ticker
   OR src->>'normalization'<>'profile-visible-text-v1' OR jsonb_typeof(src->'normalized_text')<>'string'
   OR length(src->>'normalized_text') NOT BETWEEN 1 AND 2000000
   OR EXISTS(SELECT 1 FROM jsonb_object_keys(src) x WHERE x NOT IN ('id','provider','source_url','source_sha256','fetched_at','published_on','publication_precision','report_period','form_type','title','normalization','object_key','provider_company_id','ticker','normalized_text'))
   THEN RAISE EXCEPTION USING ERRCODE='PT422',MESSAGE='invalid_profile_sources'; END IF;
  FOREACH k IN ARRAY ARRAY['id','provider','source_url','source_sha256','fetched_at','publication_precision','title','normalization','object_key','provider_company_id','ticker'] LOOP
   IF jsonb_typeof(src->k) IS DISTINCT FROM 'string' OR length(src->>k) NOT BETWEEN 1 AND 2048 THEN RAISE EXCEPTION USING ERRCODE='PT422',MESSAGE='invalid_profile_sources'; END IF;
  END LOOP;
  source_ids:=array_append(source_ids,src->>'id');source_url:=src->>'source_url';source_path:=src->>'object_key';
  expected_provider:=CASE c.provider WHEN 'sec' THEN 'SEC EDGAR' ELSE 'OpenDART' END;
  IF src->>'provider'='Official company' THEN
   IF NOT EXISTS(SELECT 1 FROM app_private.company_profile_official_sources s WHERE s.provider=c.provider AND s.provider_company_id=lpad(c.provider_company_id,CASE WHEN c.provider='sec' THEN 10 ELSE 8 END,'0') AND s.source_url=source_url) THEN
    RAISE EXCEPTION USING ERRCODE='PT422',MESSAGE='unreviewed_profile_source';
   END IF;
   IF source_path<>'profiles/official/'||(src->>'source_sha256')||'.html' THEN RAISE EXCEPTION USING ERRCODE='PT422',MESSAGE='invalid_profile_source_archive'; END IF;
  ELSE
   IF src->>'provider'<>expected_provider OR source_path<>'profiles/'||c.provider||'/'||(src->>'source_sha256')||'.html'
    OR c.provider='sec' AND source_url!~('^https://www[.]sec[.]gov/Archives/edgar/data/'||ltrim(c.provider_company_id,'0')||'/[0-9]{18}/[A-Za-z0-9_.-]+[.]html?$')
    OR c.provider='dart' AND source_url!~'^https://dart[.]fss[.]or[.]kr/report/viewer[.]do[?]rcpNo=[0-9]{14}&dcmNo=[0-9]{1,12}&eleId=[0-9]{1,12}&offset=[0-9]{1,12}&length=[0-9]{1,12}&dtd=dart[0-9]+[.]xsd$'
    THEN RAISE EXCEPTION USING ERRCODE='PT422',MESSAGE='invalid_profile_source_identity'; END IF;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='signalbrief-raw' AND name=source_path) THEN RAISE EXCEPTION USING ERRCODE='PT422',MESSAGE='profile_source_not_archived'; END IF;
  BEGIN
   IF jsonb_typeof(src->'fetched_at')<>'string' OR (src->>'fetched_at')::timestamptz>checked+interval '5 minutes'
    OR (src->>'fetched_at')::timestamptz<checked-interval '1 hour' THEN RAISE EXCEPTION 'bad'; END IF;
   IF src->>'published_on' IS NOT NULL AND (src->>'published_on'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR (src->>'published_on')::date>checked::date) THEN RAISE EXCEPTION 'bad'; END IF;
   IF src->>'publication_precision' IS DISTINCT FROM (CASE WHEN src->>'published_on' IS NULL THEN 'unknown' ELSE 'date' END) THEN RAISE EXCEPTION 'bad'; END IF;
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION USING ERRCODE='PT422',MESSAGE='invalid_profile_source_date'; END;
  pub:=src-ARRAY['object_key','provider_company_id','ticker','normalized_text'];
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(value->'sources') x WHERE x=pub) THEN RAISE EXCEPTION USING ERRCODE='PT422',MESSAGE='invalid_profile_source_projection'; END IF;
 END LOOP;
 FOREACH k IN ARRAY ARRAY['leadership','formation','business','products','segments'] LOOP
  FOR item IN SELECT * FROM jsonb_array_elements(value->k) LOOP
   proof:=item->'evidence';
   IF jsonb_typeof(item)<>'object' OR jsonb_typeof(proof)<>'object' OR NOT(proof ?& ARRAY['source_id','quote','location']) OR jsonb_typeof(proof->'quote')<>'string' OR length(proof->>'quote') NOT BETWEEN 1 AND 1600
    OR proof->'location'->>'kind'<>'normalized_text' OR jsonb_typeof(proof->'location'->'section')<>'string' OR length(proof->'location'->>'section') NOT BETWEEN 1 AND 200
    OR coalesce(proof->'location'->>'start','')!~'^[0-9]{1,7}$' OR coalesce(proof->'location'->>'end','')!~'^[0-9]{1,7}$'
    THEN RAISE EXCEPTION USING ERRCODE='PT422',MESSAGE='invalid_profile_evidence'; END IF;
   SELECT x INTO found_source FROM jsonb_array_elements(archives) x WHERE x->>'id'=proof->>'source_id';
   IF found_source IS NULL THEN RAISE EXCEPTION USING ERRCODE='PT422',MESSAGE='invalid_profile_evidence'; END IF;
   start_at:=(proof->'location'->>'start')::integer;end_at:=(proof->'location'->>'end')::integer;
   IF end_at<=start_at OR substring(found_source->>'normalized_text' FROM start_at+1 FOR end_at-start_at) IS DISTINCT FROM proof->>'quote' THEN RAISE EXCEPTION USING ERRCODE='PT422',MESSAGE='profile_quote_mismatch'; END IF;
   IF k='business' THEN
    IF item->>'text' IS DISTINCT FROM proof->>'quote' THEN RAISE EXCEPTION USING ERRCODE='PT422',MESSAGE='profile_quote_mismatch'; END IF;
   ELSIF k IN ('products','segments','leadership') THEN
    IF jsonb_typeof(item->'name') IS DISTINCT FROM 'string' OR length(item->>'name') NOT BETWEEN 1 AND 120 OR strpos(proof->>'quote',item->>'name')=0 THEN RAISE EXCEPTION USING ERRCODE='PT422',MESSAGE='profile_quote_mismatch'; END IF;
    IF k='leadership' AND (NOT(item ?& ARRAY['basis','role','as_of']) OR item->>'basis' IS NULL OR item->>'basis' NOT IN ('filing','official_page','official_registry') OR jsonb_typeof(item->'role') IS DISTINCT FROM 'string' OR strpos(lower(proof->>'quote'),lower(item->>'role'))=0 OR
     item->>'as_of' IS DISTINCT FROM (CASE WHEN item->>'basis'='filing' THEN found_source->>'published_on' ELSE left(found_source->>'fetched_at',10) END)) THEN RAISE EXCEPTION USING ERRCODE='PT422',MESSAGE='invalid_profile_leadership'; END IF;
    IF k IN ('products','segments') AND item->>'description' IS NOT NULL AND strpos(proof->>'quote',item->>'description')=0 THEN RAISE EXCEPTION USING ERRCODE='PT422',MESSAGE='profile_quote_mismatch'; END IF;
   ELSIF k='formation' THEN
    IF NOT(item ?& ARRAY['kind','precision','date']) OR item->>'kind' NOT IN ('founded','incorporated','reorganized','established') OR item->>'precision' NOT IN ('day','month','year')
     OR item->>'date'!~(CASE item->>'precision' WHEN 'day' THEN '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' WHEN 'month' THEN '^[0-9]{4}-(0[1-9]|1[0-2])$' ELSE '^[0-9]{4}$' END) THEN RAISE EXCEPTION USING ERRCODE='PT422',MESSAGE='invalid_profile_formation'; END IF;
    BEGIN
     IF (item->>'date'||CASE item->>'precision' WHEN 'year' THEN '-01-01' WHEN 'month' THEN '-01' ELSE '' END)::date>checked::date THEN RAISE EXCEPTION 'bad'; END IF;
    EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION USING ERRCODE='PT422',MESSAGE='invalid_profile_formation'; END;
   END IF;
  END LOOP;
 END LOOP;
 FOR item IN SELECT * FROM jsonb_array_elements(value->'limitations') LOOP
  IF jsonb_typeof(item)<>'string' OR (item#>>'{}')!~'^[a-z_]{3,80}$' THEN RAISE EXCEPTION USING ERRCODE='PT422',MESSAGE='invalid_profile_snapshot'; END IF;
 END LOOP;
 UPDATE app_private.company_profile_enrichments SET result=value,archives=enrichment.archives,next_refresh_at=refresh_at,lease=NULL,lease_until=NULL,last_error=NULL,updated_at=now() WHERE company_id=c.id;
 RETURN value;
END $$;
REVOKE ALL ON FUNCTION app_content_private.profile_enrichment_admin(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app_content_private.profile_enrichment_admin(text,jsonb) TO service_role;
GRANT USAGE ON SCHEMA app_content_private TO service_role;
CREATE FUNCTION public.sb_profile_enrichment_admin(op text,p jsonb) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$SELECT app_content_private.profile_enrichment_admin(op,p)$$;
REVOKE ALL ON FUNCTION public.sb_profile_enrichment_admin(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sb_profile_enrichment_admin(text,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
