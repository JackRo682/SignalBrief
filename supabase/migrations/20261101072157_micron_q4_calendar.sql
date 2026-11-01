-- Q4's public JSON event feed is archived page-by-page, including its empty tail.
-- HTML adapters keep their existing ingestion function and provenance contract.
ALTER TABLE app_private.calendar_snapshots
 ADD COLUMN raw_format text NOT NULL DEFAULT 'html' CHECK(raw_format IN ('html','json')),
 ADD COLUMN provenance jsonb,
 ADD CONSTRAINT calendar_snapshot_format CHECK(
  (raw_format='html' AND provenance IS NULL)
  OR (raw_format='json' AND provenance IS NOT NULL AND jsonb_typeof(provenance)='object')
 );

-- A fresh installation need not have activated MU yet. Bind only the exact official
-- identity, when present; scheduled discovery of sources also handles later activation.
CREATE OR REPLACE FUNCTION public.sb_calendar_sources() RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; BEGIN
 IF EXISTS(SELECT 1 FROM app_private.calendar_sources s WHERE s.key='micron-ir' AND (
  s.adapter<>'micron-q4' OR s.ticker<>'MU' OR s.url<>'https://investors.micron.com/events-and-presentations/')) THEN
  RAISE EXCEPTION 'calendar_source_conflict'; END IF;
 INSERT INTO app_private.calendar_sources(key,ticker,market,url,adapter)
 SELECT 'micron-ir',c.ticker,c.market,'https://investors.micron.com/events-and-presentations/','micron-q4'
 FROM public.companies c WHERE c.provider='sec' AND c.provider_company_id='0000723125' AND c.ticker='MU' AND NOT c.is_demo
 AND (SELECT count(*) FROM public.companies x WHERE x.provider='sec' AND x.provider_company_id='0000723125' AND x.ticker='MU' AND NOT x.is_demo)=1
 ON CONFLICT(key) DO UPDATE SET market=EXCLUDED.market
 WHERE calendar_sources.adapter='micron-q4' AND calendar_sources.ticker='MU'
 AND calendar_sources.url='https://investors.micron.com/events-and-presentations/';
 SELECT coalesce(jsonb_agg(jsonb_build_object('key',s.key,'ticker',s.ticker,'market',s.market,'url',s.url,'adapter',s.adapter) ORDER BY s.key),'[]'::jsonb)
 INTO result FROM app_private.calendar_sources s WHERE s.enabled AND (s.adapter<>'micron-q4' OR EXISTS(
  SELECT 1 FROM public.companies c WHERE c.provider='sec' AND c.provider_company_id='0000723125' AND c.ticker='MU'
  AND c.market=s.market AND NOT c.is_demo) AND (SELECT count(*) FROM public.companies c
   WHERE c.provider='sec' AND c.provider_company_id='0000723125' AND c.ticker='MU' AND NOT c.is_demo)=1);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.sb_calendar_sources() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sb_calendar_sources() TO service_role;
SELECT public.sb_calendar_sources();

CREATE FUNCTION public.sb_calendar_ingest_q4(source text,raw_sha text,object_key text,manifest_text text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cfg app_private.calendar_sources; co text; snap uuid; manifest jsonb; pages jsonb; entries jsonb;
 page jsonb; item jsonb; page_index integer:=0; page_count integer; total_rows integer:=0; n integer:=0;
 day date; evidence text; expected_url text; short_page boolean:=false;
BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(hashtextextended('calendar:'||source,0));
 SELECT * INTO cfg FROM app_private.calendar_sources WHERE key=source AND enabled;
 IF source IS DISTINCT FROM 'micron-ir' OR cfg.adapter IS DISTINCT FROM 'micron-q4'
 OR cfg.ticker IS DISTINCT FROM 'MU' OR cfg.url IS DISTINCT FROM 'https://investors.micron.com/events-and-presentations/'
 OR raw_sha IS NULL OR raw_sha !~ '^[a-f0-9]{64}$'
 OR object_key IS DISTINCT FROM ('calendar/'||source||'/'||raw_sha||'.json')
 OR manifest_text IS NULL OR length(manifest_text) NOT BETWEEN 1 AND 1000000
 OR encode(extensions.digest(convert_to(manifest_text,'UTF8'),'sha256'),'hex') IS DISTINCT FROM raw_sha THEN
  RAISE EXCEPTION 'invalid_calendar_payload'; END IF;
 manifest:=manifest_text::jsonb; pages:=manifest->'pages'; entries:=manifest->'entries';
 IF jsonb_typeof(manifest) IS DISTINCT FROM 'object'
 OR manifest->>'schema' IS DISTINCT FROM 'signalbrief.calendar.q4.v1'
 OR manifest->>'source_key' IS DISTINCT FROM source OR manifest->>'source_url' IS DISTINCT FROM cfg.url
 OR manifest->>'adapter' IS DISTINCT FROM cfg.adapter OR manifest->'complete' IS DISTINCT FROM 'true'::jsonb
 OR manifest->'page_size' IS DISTINCT FROM '100'::jsonb
 OR manifest#>>'{window,start}' IS DISTINCT FROM (current_date-90)::text
 OR manifest#>>'{window,end}' IS DISTINCT FROM (current_date+interval '18 months')::date::text
 OR jsonb_typeof(pages) IS DISTINCT FROM 'array' OR jsonb_typeof(entries) IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'incomplete_calendar_manifest'; END IF;
 IF jsonb_array_length(pages) NOT BETWEEN 1 AND 10 OR jsonb_array_length(entries)>200 THEN
  RAISE EXCEPTION 'invalid_calendar_manifest'; END IF;
 IF NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='signalbrief-raw' AND o.name=object_key) THEN
  RAISE EXCEPTION 'calendar_archive_missing'; END IF;
 FOR page IN SELECT value FROM jsonb_array_elements(pages) LOOP
  expected_url:='https://investors.micron.com/feed/Event.svc/GetEventList?LanguageId=1&eventSelection=3&eventDateFilter=3&includeFinancialReports=false&includePresentations=false&includePressReleases=false&sortOperator=1&pageSize=100&pageNumber='||page_index||'&tagList=&includeTags=true&year=-1&excludeSelection=1';
  IF jsonb_typeof(page) IS DISTINCT FROM 'object' OR page->'page_number' IS DISTINCT FROM to_jsonb(page_index)
  OR page->>'url' IS DISTINCT FROM expected_url OR coalesce(page->>'raw_sha256','') !~ '^[a-f0-9]{64}$'
  OR page->>'object_key' IS DISTINCT FROM ('calendar/'||source||'/pages/'||(page->>'raw_sha256')||'.json')
  OR jsonb_typeof(page->'count') IS DISTINCT FROM 'number' OR coalesce(page->>'count','') !~ '^[0-9]{1,3}$' THEN
   RAISE EXCEPTION 'invalid_calendar_page'; END IF;
  page_count:=(page->>'count')::integer;
  IF page_count>100 OR (page_index=jsonb_array_length(pages)-1 AND page_count<>0)
   OR (page_index<jsonb_array_length(pages)-1 AND page_count=0)
   OR (short_page AND page_count<>0) THEN RAISE EXCEPTION 'incomplete_calendar_manifest'; END IF;
  short_page:=page_count<100;
  IF NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='signalbrief-raw' AND o.name=page->>'object_key') THEN
   RAISE EXCEPTION 'calendar_archive_missing'; END IF;
  total_rows:=total_rows+page_count;page_index:=page_index+1;
 END LOOP;
 IF total_rows=0 THEN RAISE EXCEPTION 'unexpected_empty_catalog'; END IF;
 IF jsonb_array_length(entries)>total_rows THEN RAISE EXCEPTION 'invalid_calendar_entry'; END IF;
 IF (SELECT count(*)<>count(DISTINCT x->>'key') FROM jsonb_array_elements(entries) x) THEN
  RAISE EXCEPTION 'duplicate_calendar_identity'; END IF;
 SELECT id INTO STRICT co FROM public.companies WHERE provider='sec' AND provider_company_id='0000723125'
 AND ticker=cfg.ticker AND market=cfg.market AND NOT is_demo;
 SELECT coalesce(string_agg(x->>'quote',E'\n' ORDER BY ord),'Complete official webcast schedule') INTO evidence
 FROM jsonb_array_elements(entries) WITH ORDINALITY AS elements(x,ord);
 INSERT INTO app_private.calendar_snapshots(source_key,raw_sha256,object_key,normalized_text,raw_format,provenance)
 VALUES(source,raw_sha,object_key,evidence,'json',manifest) ON CONFLICT(source_key,raw_sha256) DO NOTHING;
 SELECT id INTO snap FROM app_private.calendar_snapshots s WHERE s.source_key=source AND s.raw_sha256=raw_sha
 AND s.object_key=sb_calendar_ingest_q4.object_key AND s.normalized_text=evidence AND s.raw_format='json' AND s.provenance=manifest;
 IF snap IS NULL THEN RAISE EXCEPTION 'snapshot_conflict'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(entries) LOOP
  IF jsonb_typeof(item) IS DISTINCT FROM 'object'
  OR coalesce(item->>'occurs_on','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  OR jsonb_typeof(item->'title') IS DISTINCT FROM 'string' OR coalesce(length(trim(item->>'title')),0) NOT BETWEEN 1 AND 200
  OR jsonb_typeof(item->'key') IS DISTINCT FROM 'string' OR coalesce(item->>'key','') !~ '^[1-9][0-9]{0,15}$'
  OR jsonb_typeof(item->'quote') IS DISTINCT FROM 'string' OR coalesce(length(trim(item->>'quote')),0) NOT BETWEEN 1 AND 500
  OR item->>'timezone' IS DISTINCT FROM 'America/New_York'
  OR coalesce(item->>'location','') !~ '^pages\[[0-9]+\]\.GetEventListResult\[[0-9]+\]$' THEN
   RAISE EXCEPTION 'invalid_calendar_entry'; END IF;
  page_index:=(regexp_match(item->>'location','^pages\[([0-9]+)\]'))[1]::integer;
  page_count:=(regexp_match(item->>'location','GetEventListResult\[([0-9]+)\]$'))[1]::integer;
  IF page_index>=jsonb_array_length(pages)-1 OR page_count>=coalesce((pages->page_index->>'count')::integer,0) THEN
   RAISE EXCEPTION 'invalid_calendar_entry'; END IF;
  day:=(item->>'occurs_on')::date;
  IF day<current_date-90 OR day>(current_date+interval '18 months')::date THEN RAISE EXCEPTION 'calendar_date_out_of_range'; END IF;
  INSERT INTO public.calendar_items(id,company_id,title,occurs_on,origin,quote,created_at,source_snapshot_id,source_key,source_event_key,source_url,source_timezone,source_location,verified_at,calendar_status)
  VALUES(gen_random_uuid()::text,co,item->>'title',day,'official',item->>'quote',now(),snap,source,item->>'key',cfg.url,item->>'timezone',item->>'location',now(),'confirmed')
  ON CONFLICT(source_key,company_id,source_event_key) WHERE source_key IS NOT NULL DO UPDATE SET title=EXCLUDED.title,occurs_on=EXCLUDED.occurs_on,quote=EXCLUDED.quote,
   source_snapshot_id=EXCLUDED.source_snapshot_id,source_url=EXCLUDED.source_url,source_timezone=EXCLUDED.source_timezone,source_location=EXCLUDED.source_location,verified_at=now(),calendar_status='confirmed';
  n:=n+1;
 END LOOP;
 -- Withdrawal is reachable only after the complete, archived, hash-bound manifest validates.
 UPDATE public.calendar_items c SET calendar_status='withdrawn' WHERE c.source_key=source AND c.occurs_on>=current_date
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(entries) x WHERE x->>'key'=c.source_event_key);
 UPDATE app_private.calendar_sources SET last_attempt_at=now(),last_success_at=now(),error_code=NULL WHERE key=source;
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.sb_calendar_ingest_q4(text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sb_calendar_ingest_q4(text,text,text,text) TO service_role;
