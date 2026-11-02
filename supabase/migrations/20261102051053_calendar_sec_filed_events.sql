-- Independently archived SEC earnings announcements complement unavailable IR pages.
-- The prior IR/Q4 validator remains intact; no issuer, network or approval gate is relaxed.
DO $$ DECLARE definition text; BEGIN
 definition:=pg_get_functiondef('public.sb_calendar_ingest_sec_ir(text,text,text,text)'::regprocedure);
 definition:=replace(definition,'FUNCTION public.sb_calendar_ingest_sec_ir(', 'FUNCTION app_private.calendar_ingest_sec_ir_v1(');
 definition:=replace(definition,'sb_calendar_ingest_sec_ir.object_key','calendar_ingest_sec_ir_v1.object_key');
 EXECUTE definition;
 definition:=pg_get_functiondef('app_private.calendar_sec_ir_confirmed(text)'::regprocedure);
 EXECUTE replace(definition,'FUNCTION app_private.calendar_sec_ir_confirmed(', 'FUNCTION app_private.calendar_sec_ir_confirmed_v1(');
END $$;
REVOKE ALL ON FUNCTION app_private.calendar_ingest_sec_ir_v1(text,text,text,text),app_private.calendar_sec_ir_confirmed_v1(text) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.sb_calendar_ingest_sec_ir(source text,raw_sha text,object_key text,manifest_text text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cfg app_private.calendar_sources; m jsonb; f jsonb; docs jsonb; d jsonb; e jsonb; co text; snap uuid;
 selected_url text; text_value text; quote_value text; date_parts text[]; period_parts text[]; day date;
 quote_start integer; quote_end integer; yr integer; quarter integer; doc_base text; previous record;
BEGIN
 m:=manifest_text::jsonb;
 IF m->>'schema' IS DISTINCT FROM 'signalbrief.calendar.sec-filing.v1' THEN
  IF m->>'format'='q4' AND EXISTS(SELECT 1 FROM app_private.calendar_snapshots s WHERE s.source_key=source
   AND s.provenance->>'schema'='signalbrief.calendar.sec-filing.v1') THEN RAISE EXCEPTION 'calendar_source_change_requires_review'; END IF;
  RETURN app_private.calendar_ingest_sec_ir_v1(source,raw_sha,object_key,manifest_text);
 END IF;
 SELECT * INTO cfg FROM app_private.calendar_sources WHERE key=source AND enabled;
 SELECT id INTO co FROM public.companies WHERE id=cfg.company_id AND provider='sec' AND provider=cfg.provider
  AND provider_company_id=cfg.provider_company_id AND ticker=cfg.ticker AND market=cfg.market AND NOT is_demo;
 IF co IS NULL OR cfg.adapter<>'sec-ir' OR source IS DISTINCT FROM 'sec-ir-'||cfg.provider_company_id
 OR cfg.url IS DISTINCT FROM 'https://www.sec.gov/edgar/browse/?CIK='||cfg.provider_company_id
 OR length(manifest_text)>1000000 OR coalesce(raw_sha,'')!~'^[a-f0-9]{64}$'
 OR raw_sha IS DISTINCT FROM encode(extensions.digest(convert_to(manifest_text,'UTF8'),'sha256'),'hex')
 OR object_key IS DISTINCT FROM 'calendar/'||source||'/'||raw_sha||'.json'
 OR m->>'adapter' IS DISTINCT FROM 'sec-ir' OR m->>'format' IS DISTINCT FROM 'sec-filing'
 OR m->'complete' IS DISTINCT FROM 'false'::jsonb OR m->>'coverage' IS DISTINCT FROM 'explicit-sec-announcement'
 OR m->>'source_key' IS DISTINCT FROM source OR m->>'source_url' IS DISTINCT FROM cfg.url
 OR m->>'company_id' IS DISTINCT FROM co OR m->>'provider' IS DISTINCT FROM 'sec'
 OR m->>'provider_company_id' IS DISTINCT FROM cfg.provider_company_id OR m->>'ticker' IS DISTINCT FROM cfg.ticker
 OR jsonb_typeof(m->'issuer_name') IS DISTINCT FROM 'string' OR length(trim(m->>'issuer_name')) NOT BETWEEN 1 AND 300
 OR m->'issuer_evidence' IS DISTINCT FROM '[]'::jsonb
 OR coalesce(m->>'fallback_reason','') NOT IN ('calendar_relay_upstream_failed','calendar_relay_network_failed','official_calendar_format_unsupported','source_http_403','source_http_404','source_http_429','source_http_500','source_http_502','source_http_503','source_http_504')
 OR m->'window' IS DISTINCT FROM jsonb_build_object('start',(current_date-90)::text,'end',(current_date+interval '18 months')::date::text)
 OR jsonb_typeof(m->'documents') IS DISTINCT FROM 'array' OR jsonb_typeof(m->'entries') IS DISTINCT FROM 'array'
 OR jsonb_typeof(m->'filing') IS DISTINCT FROM 'object' OR m ? 'q4' OR m ? 'q4_manifest'
 THEN RAISE EXCEPTION 'invalid_sec_filing_manifest'; END IF;
 docs:=m->'documents';f:=m->'filing';selected_url:=m->>'event_source_url';
 IF jsonb_array_length(docs) NOT BETWEEN 2 AND 10 OR jsonb_array_length(m->'entries')<>1
 OR (SELECT count(*) FROM jsonb_array_elements(docs) x WHERE x->>'role'='submissions')<>1
 OR (SELECT count(*) FROM jsonb_array_elements(docs) x WHERE x->>'role'='primary') NOT BETWEEN 1 AND 3
 OR (SELECT count(DISTINCT x->>'url') FROM jsonb_array_elements(docs) x)<>jsonb_array_length(docs)
 THEN RAISE EXCEPTION 'invalid_sec_filing_manifest'; END IF;
 IF NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='signalbrief-raw' AND o.name=sb_calendar_ingest_sec_ir.object_key)
 THEN RAISE EXCEPTION 'invalid_sec_filing_archive'; END IF;
 FOR d IN SELECT value FROM jsonb_array_elements(docs) LOOP
  IF coalesce(d->>'raw_sha256','')!~'^[a-f0-9]{64}$'
  OR d->>'object_key' IS DISTINCT FROM 'calendar/'||source||'/discovery/'||(d->>'raw_sha256')||(CASE WHEN d->>'role'='submissions' THEN '.json' ELSE '.html' END)
  OR coalesce(d->>'role','') NOT IN ('submissions','primary','exhibit') THEN RAISE EXCEPTION 'invalid_sec_filing_manifest'; END IF;
  IF NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='signalbrief-raw' AND o.name=d->>'object_key') THEN RAISE EXCEPTION 'invalid_sec_filing_archive'; END IF;
  IF d->>'role'='submissions' THEN
   IF d->>'url' IS DISTINCT FROM 'https://data.sec.gov/submissions/CIK'||cfg.provider_company_id||'.json' THEN RAISE EXCEPTION 'invalid_sec_filing_manifest'; END IF;
  ELSE
   IF coalesce(d->>'accession','')!~'^[0-9]{10}-[0-9]{2}-[0-9]{6}$' OR coalesce(d->>'filing_date','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
   OR (d->>'filing_date')::date>current_date THEN RAISE EXCEPTION 'invalid_sec_filing_manifest'; END IF;
   doc_base:='https://www.sec.gov/Archives/edgar/data/'||(cfg.provider_company_id::bigint)::text||'/'||replace(d->>'accession','-','')||'/';
   IF left(d->>'url',length(doc_base)) IS DISTINCT FROM doc_base OR substring(d->>'url' FROM length(doc_base)+1)!~'^[A-Za-z0-9_.-]+\.html?$'
   THEN RAISE EXCEPTION 'invalid_sec_filing_manifest'; END IF;
   IF d->>'role'='primary' AND d->>'parent_url' IS DISTINCT FROM 'https://data.sec.gov/submissions/CIK'||cfg.provider_company_id||'.json'
   OR d->>'role'='exhibit' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(docs) p WHERE p->>'role'='primary' AND p->>'url'=d->>'parent_url'
    AND p->>'accession'=d->>'accession' AND p->>'filing_date'=d->>'filing_date')
   OR d->>'role'='primary' AND (SELECT count(*) FROM jsonb_array_elements(docs) x WHERE x->>'role'='exhibit' AND x->>'parent_url'=d->>'url')>2
   THEN RAISE EXCEPTION 'invalid_sec_filing_manifest'; END IF;
  END IF;
 END LOOP;
 e:=m->'entries'->0;text_value:=f->>'normalized_text';quote_value:=e->>'quote';
 IF coalesce(f->>'form_type','') NOT IN ('8-K','6-K') OR f->>'source_url' IS DISTINCT FROM selected_url
 OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(docs) selected_doc WHERE selected_doc->>'role' IN ('primary','exhibit') AND selected_doc->>'url'=selected_url
  AND selected_doc->>'raw_sha256'=f->>'raw_sha256' AND selected_doc->>'accession'=f->>'accession' AND selected_doc->>'filing_date'=f->>'filing_date')
 OR jsonb_typeof(f->'normalized_text') IS DISTINCT FROM 'string' OR length(text_value) NOT BETWEEN 1 AND 750000
 OR coalesce(f->>'normalized_sha256','')!~'^[a-f0-9]{64}$'
 OR f->>'normalized_sha256' IS DISTINCT FROM encode(extensions.digest(convert_to(text_value,'UTF8'),'sha256'),'hex')
 OR f->>'normalized_object_key' IS DISTINCT FROM 'calendar/'||source||'/normalized/'||(f->>'normalized_sha256')||'.txt'
 THEN RAISE EXCEPTION 'invalid_sec_filing_evidence'; END IF;
 IF NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='signalbrief-raw' AND o.name=f->>'normalized_object_key') THEN RAISE EXCEPTION 'invalid_sec_filing_archive'; END IF;
 IF jsonb_typeof(f->'quote_start') IS DISTINCT FROM 'number' OR coalesce(f->>'quote_start','')!~'^[0-9]{1,7}$'
 OR jsonb_typeof(f->'quote_end') IS DISTINCT FROM 'number' OR coalesce(f->>'quote_end','')!~'^[0-9]{1,7}$'
 OR jsonb_typeof(f->'fiscal_year') IS DISTINCT FROM 'number' OR coalesce(f->>'fiscal_year','')!~'^[0-9]{4}$'
 OR jsonb_typeof(f->'quarter') IS DISTINCT FROM 'number' OR coalesce(f->>'quarter','')!~'^[1-4]$'
 OR jsonb_typeof(e->'quote') IS DISTINCT FROM 'string' OR length(quote_value) NOT BETWEEN 1 AND 500
 OR jsonb_typeof(f->'issuer_label') IS DISTINCT FROM 'string' OR length(f->>'issuer_label') NOT BETWEEN 1 AND 300
 OR app_private.calendar_issuer_name(f->>'issuer_label') IS DISTINCT FROM app_private.calendar_issuer_name(m->>'issuer_name')
 THEN RAISE EXCEPTION 'invalid_sec_filing_evidence'; END IF;
 quote_start:=(f->>'quote_start')::integer;quote_end:=(f->>'quote_end')::integer;yr:=(f->>'fiscal_year')::integer;quarter:=(f->>'quarter')::integer;
 date_parts:=regexp_match(lower(f->>'date_text'),'^(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|october|oct|november|nov|december|dec)[[:space:]]+([0-9]{1,2}),[[:space:]]+([0-9]{4})$');
 period_parts:=regexp_match(lower(f->>'period_text'),'^(first|second|third|fourth)(?: fiscal)? quarter(?: of)? ([0-9]{4})$|^q([1-4]) ([0-9]{4})$');
 IF date_parts IS NULL OR period_parts IS NULL THEN RAISE EXCEPTION 'invalid_sec_filing_evidence'; END IF;
 day:=make_date(date_parts[3]::integer,array_position(ARRAY['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'],left(date_parts[1],3)),date_parts[2]::integer);
 IF yr<>coalesce(period_parts[2],period_parts[4])::integer OR quarter<>coalesce(array_position(ARRAY['first','second','third','fourth'],period_parts[1]),period_parts[3]::integer)
 OR quote_end<=quote_start OR quote_end>length(text_value) OR quote_value IS DISTINCT FROM substring(text_value FROM quote_start+1 FOR quote_end-quote_start)
 OR left(lower(quote_value),length(f->>'issuer_label')+6) IS DISTINCT FROM lower(f->>'issuer_label')||' will '
 OR substring(quote_value FROM length(f->>'issuer_label')+1)!~*'^ will (host|hold|conduct|provide)\y'
 OR quote_value!~*'(financial results|earnings)' OR quote_value!~*'(conference call|webcast)'
 OR position(f->>'period_text' IN quote_value)=0 OR right(quote_value,length(f->>'date_text')) IS DISTINCT FROM f->>'date_text'
 OR quote_value!~*'\mon[[:space:]]+(?:(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?[[:space:]]+)?[A-Za-z]+[[:space:]]+[0-9]{1,2},[[:space:]]+[0-9]{4}$'
 OR substring(text_value FROM greatest(1,quote_start-199) FOR quote_end-quote_start+350)~*'\m(cancelled|canceled|cancellation|reschedule|rescheduled|rescheduling|postpone|postponed|postponement|corrected|correction|revised)\M'
 OR (SELECT count(*) FROM regexp_matches(quote_value,'(?:(?:first|second|third|fourth)[[:space:]]+(?:fiscal[[:space:]]+)?quarter(?:[[:space:]]+of)?[[:space:]]+[0-9]{4}|Q[1-4][[:space:]]+[0-9]{4})','gi'))<>1
 OR (SELECT count(*) FROM regexp_matches(quote_value,'(?:January|Jan|February|Feb|March|Mar|April|Apr|May|June|Jun|July|Jul|August|Aug|September|Sep|October|Oct|November|Nov|December|Dec)[[:space:]]+[0-9]{1,2},[[:space:]]+[0-9]{4}','gi'))<>1
 OR e->>'key' IS DISTINCT FROM 'quarter:'||yr||':Q'||quarter OR e->>'title' IS DISTINCT FROM cfg.ticker||' '||yr||' Q'||quarter||' earnings'
 OR e->>'occurs_on' IS DISTINCT FROM day::text OR day NOT BETWEEN current_date-90 AND (current_date+interval '18 months')::date
 OR e->'timezone' IS DISTINCT FROM 'null'::jsonb OR e->>'location' IS DISTINCT FROM 'normalized-text['||quote_start||':'||quote_end||']'
 OR e->>'source_url' IS DISTINCT FROM selected_url OR e->>'raw_sha256' IS DISTINCT FROM f->>'raw_sha256'
 OR m->'binding' IS DISTINCT FROM jsonb_build_object('url',selected_url,'document_url',selected_url,'quote',quote_value,'location',e->>'location')
 THEN RAISE EXCEPTION 'invalid_sec_filing_evidence'; END IF;
 IF EXISTS(SELECT 1 FROM app_private.calendar_snapshots s WHERE s.source_key=source AND s.provenance->>'format'='q4') THEN RAISE EXCEPTION 'calendar_source_change_requires_review'; END IF;
 SELECT c.occurs_on,s.provenance INTO previous FROM public.calendar_items c JOIN app_private.calendar_snapshots s ON s.id=c.source_snapshot_id
 WHERE c.source_key=source AND c.company_id=co AND c.source_event_key=e->>'key';
 IF FOUND AND (previous.occurs_on<>day OR previous.provenance->>'schema'='signalbrief.calendar.sec-filing.v1' AND
  (previous.provenance#>>'{filing,filing_date}',previous.provenance#>>'{filing,accession}')>(f->>'filing_date',f->>'accession')) THEN RAISE EXCEPTION 'calendar_filing_conflict'; END IF;
 INSERT INTO app_private.calendar_snapshots(source_key,raw_sha256,object_key,normalized_text,raw_format,provenance)
 VALUES(source,raw_sha,object_key,quote_value,'json',m) ON CONFLICT(source_key,raw_sha256) DO NOTHING;
 SELECT id INTO snap FROM app_private.calendar_snapshots s WHERE s.source_key=source AND s.raw_sha256=raw_sha
  AND s.object_key=sb_calendar_ingest_sec_ir.object_key AND s.normalized_text=quote_value AND s.raw_format='json' AND s.provenance=m;
 IF snap IS NULL THEN RAISE EXCEPTION 'snapshot_conflict'; END IF;
 INSERT INTO public.calendar_items(id,company_id,title,occurs_on,origin,quote,created_at,source_snapshot_id,source_key,source_event_key,source_url,source_timezone,source_location,verified_at,calendar_status)
 VALUES(gen_random_uuid()::text,co,e->>'title',day,'official',quote_value,now(),snap,source,e->>'key',selected_url,NULL,e->>'location',now(),'confirmed')
 ON CONFLICT(source_key,company_id,source_event_key) WHERE source_key IS NOT NULL DO UPDATE SET title=EXCLUDED.title,occurs_on=EXCLUDED.occurs_on,quote=EXCLUDED.quote,
  source_snapshot_id=EXCLUDED.source_snapshot_id,source_url=EXCLUDED.source_url,source_timezone=NULL,source_location=EXCLUDED.source_location,verified_at=now(),calendar_status='confirmed';
 UPDATE app_private.calendar_sources SET last_attempt_at=now(),last_success_at=now(),error_code=NULL WHERE key=source;
 RETURN 1;
END $$;
REVOKE ALL ON FUNCTION public.sb_calendar_ingest_sec_ir(text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sb_calendar_ingest_sec_ir(text,text,text,text) TO service_role;

CREATE OR REPLACE FUNCTION app_private.calendar_sec_ir_confirmed(cid text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT app_private.calendar_sec_ir_confirmed_v1(cid) OR EXISTS(
 SELECT 1 FROM public.calendar_items c JOIN app_private.calendar_sources p ON p.key=c.source_key AND p.adapter='sec-ir' AND p.enabled
 JOIN public.companies co ON co.id=c.company_id AND co.id=p.company_id AND co.provider='sec' AND co.provider=p.provider
  AND co.provider_company_id=p.provider_company_id AND co.ticker=p.ticker AND co.market=p.market AND NOT co.is_demo
 JOIN app_private.calendar_snapshots s ON s.id=c.source_snapshot_id AND s.source_key=p.key
 WHERE c.id=cid AND c.origin='official' AND c.calendar_status='confirmed' AND c.verified_at IS NOT NULL
 AND s.provenance->>'schema'='signalbrief.calendar.sec-filing.v1' AND s.provenance->>'format'='sec-filing'
 AND s.provenance->>'company_id'=co.id AND s.provenance->>'provider_company_id'=p.provider_company_id
 AND s.provenance->>'source_key'=p.key AND s.provenance->>'source_url'=p.url
 AND c.source_url=s.provenance->>'event_source_url' AND c.source_url=s.provenance#>>'{filing,source_url}'
 AND c.quote=s.normalized_text AND c.source_timezone IS NULL
 AND EXISTS(SELECT 1 FROM jsonb_array_elements(s.provenance->'entries') e WHERE e->>'key'=c.source_event_key
  AND e->>'title'=c.title AND e->>'occurs_on'=c.occurs_on::text AND e->>'quote'=c.quote AND e->>'source_url'=c.source_url
  AND e->>'location'=c.source_location AND e->>'raw_sha256'=s.provenance#>>'{filing,raw_sha256}'
  AND e->'timezone'='null'::jsonb))
$$;
REVOKE ALL ON FUNCTION app_private.calendar_sec_ir_confirmed(text) FROM PUBLIC,anon,authenticated;
