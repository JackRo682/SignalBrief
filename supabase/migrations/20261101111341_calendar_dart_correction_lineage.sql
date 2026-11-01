-- Explicit official correction families preserve stable calendar IDs and prior v1 evidence.
CREATE FUNCTION app_private.calendar_validate_dart_families(manifest jsonb,today date) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE families jsonb:=manifest->'families'; family jsonb; receipts jsonb; receipt jsonb; entry jsonb;
 root text; latest text; latest_day date; member_count integer:=0;
BEGIN
 IF jsonb_typeof(families) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'invalid_correction_lineage'; END IF;
 IF jsonb_array_length(families)>20 OR jsonb_array_length(families)<>jsonb_array_length(manifest->'entries')
 OR (SELECT count(*)<>count(DISTINCT f->>'root_receipt_no') FROM jsonb_array_elements(families) f) THEN
  RAISE EXCEPTION 'invalid_correction_lineage'; END IF;
 FOR family IN SELECT value FROM jsonb_array_elements(families) LOOP
  root:=family->>'root_receipt_no';latest:=family->>'latest_receipt_no';receipts:=family->'receipt_nos';
  IF jsonb_typeof(family) IS DISTINCT FROM 'object' OR jsonb_typeof(family->'root_receipt_no') IS DISTINCT FROM 'string'
  OR jsonb_typeof(family->'latest_receipt_no') IS DISTINCT FROM 'string' OR coalesce(root,'')!~'^[0-9]{14}$'
  OR coalesce(latest,'')!~'^[0-9]{14}$' OR jsonb_typeof(receipts) IS DISTINCT FROM 'array' THEN
   RAISE EXCEPTION 'invalid_correction_lineage'; END IF;
  IF jsonb_array_length(receipts) NOT BETWEEN 1 AND 8 OR receipts->>0 IS DISTINCT FROM root
  OR receipts->>-1 IS DISTINCT FROM latest
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(receipts) r WHERE jsonb_typeof(r) IS DISTINCT FROM 'string' OR r#>>'{}'!~'^[0-9]{14}$')
  OR (SELECT count(*)<>count(DISTINCT r) FROM jsonb_array_elements(receipts) r)
  OR receipts IS DISTINCT FROM (SELECT jsonb_agg(r ORDER BY r) FROM jsonb_array_elements(receipts) r) THEN
   RAISE EXCEPTION 'invalid_correction_lineage'; END IF;
  latest_day:=(substr(latest,1,4)||'-'||substr(latest,5,2)||'-'||substr(latest,7,2))::date;
  IF latest_day NOT BETWEEN today-90 AND today THEN RAISE EXCEPTION 'receipt_date_out_of_range'; END IF;
  FOR receipt IN SELECT value FROM jsonb_array_elements(receipts) LOOP
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(manifest->'documents') d
    WHERE jsonb_typeof(d->'receipt_no')='string' AND jsonb_typeof(d->'root_receipt_no')='string'
    AND d->>'receipt_no'=receipt#>>'{}' AND d->>'root_receipt_no'=root
    AND d->'family_receipts'=receipts AND d->'corrected'=to_jsonb(receipt#>>'{}'<>root)) THEN
    RAISE EXCEPTION 'incomplete_correction_lineage'; END IF;
   member_count:=member_count+1;
  END LOOP;
  SELECT e INTO entry FROM jsonb_array_elements(manifest->'entries') e WHERE e->>'key'=root;
  IF entry IS NULL OR jsonb_typeof(entry->'key') IS DISTINCT FROM 'string'
  OR jsonb_typeof(entry->'receipt_no') IS DISTINCT FROM 'string' OR entry->>'receipt_no' IS DISTINCT FROM latest THEN
   RAISE EXCEPTION 'invalid_correction_lineage'; END IF;
 END LOOP;
 IF member_count<>jsonb_array_length(manifest->'documents') THEN RAISE EXCEPTION 'invalid_correction_lineage'; END IF;
END $$;
REVOKE ALL ON FUNCTION app_private.calendar_validate_dart_families(jsonb,date) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.sb_calendar_ingest_dart_ir(source text,raw_sha text,object_key text,manifest_text text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cfg app_private.calendar_sources; co text; snap uuid; manifest jsonb; pages jsonb; documents jsonb; entries jsonb;
 page jsonb; item jsonb; document jsonb; page_index integer:=1; page_count integer; total_rows integer; total_pages integer;
 rows_seen integer:=0; n integer:=0; day date; receipt_day date; evidence text; expected_url text;
 today date:=(current_timestamp AT TIME ZONE 'Asia/Seoul')::date; correction_manifest boolean;
 previous record; latest text; family_receipts jsonb;
BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(hashtextextended('calendar:'||source,0));
 SELECT * INTO cfg FROM app_private.calendar_sources WHERE key=source AND enabled;
 IF cfg.key IS NULL OR cfg.adapter<>'dart-ir' OR cfg.provider<>'dart' OR cfg.provider_company_id!~'^[0-9]{8}$'
 OR cfg.ticker!~'^[A-Z0-9]{6}$' OR cfg.key IS DISTINCT FROM 'dart-ir-'||cfg.provider_company_id
 OR cfg.url IS DISTINCT FROM 'https://dart.fss.or.kr/' OR cfg.feed_url IS NOT NULL
 OR raw_sha IS NULL OR raw_sha!~'^[a-f0-9]{64}$'
 OR object_key IS DISTINCT FROM ('calendar/'||source||'/'||raw_sha||'.json')
 OR manifest_text IS NULL OR length(manifest_text) NOT BETWEEN 1 AND 1000000
 OR encode(extensions.digest(convert_to(manifest_text,'UTF8'),'sha256'),'hex') IS DISTINCT FROM raw_sha THEN
  RAISE EXCEPTION 'invalid_calendar_payload'; END IF;
 SELECT id INTO STRICT co FROM public.companies WHERE id=cfg.company_id AND provider=cfg.provider
  AND provider_company_id=cfg.provider_company_id AND ticker=cfg.ticker AND market=cfg.market AND NOT is_demo;
 manifest:=manifest_text::jsonb;pages:=manifest->'pages';documents:=manifest->'documents';entries:=manifest->'entries';
 correction_manifest:=manifest->>'schema'='signalbrief.calendar.dart-ir.v2';
 IF jsonb_typeof(manifest) IS DISTINCT FROM 'object'
 OR coalesce(manifest->>'schema','') NOT IN ('signalbrief.calendar.dart-ir.v1','signalbrief.calendar.dart-ir.v2') OR manifest->>'adapter' IS DISTINCT FROM cfg.adapter
 OR manifest->>'source_key' IS DISTINCT FROM source OR manifest->>'source_url' IS DISTINCT FROM cfg.url
 OR manifest->>'company_id' IS DISTINCT FROM co OR manifest->>'provider' IS DISTINCT FROM cfg.provider
 OR manifest->>'provider_company_id' IS DISTINCT FROM cfg.provider_company_id OR manifest->>'ticker' IS DISTINCT FROM cfg.ticker
 OR manifest->'complete' IS DISTINCT FROM 'true'::jsonb OR manifest->'page_size' IS DISTINCT FROM '100'::jsonb
 OR manifest#>>'{receipt_window,start}' IS DISTINCT FROM (today-90)::text
 OR manifest#>>'{receipt_window,end}' IS DISTINCT FROM today::text
 OR manifest#>>'{window,start}' IS DISTINCT FROM (today-90)::text
 OR manifest#>>'{window,end}' IS DISTINCT FROM (today+interval '18 months')::date::text
 OR jsonb_typeof(pages) IS DISTINCT FROM 'array' OR jsonb_typeof(documents) IS DISTINCT FROM 'array'
 OR jsonb_typeof(entries) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'incomplete_calendar_manifest'; END IF;
 IF jsonb_array_length(pages) NOT BETWEEN 1 AND 5 OR jsonb_array_length(documents)>(CASE WHEN correction_manifest THEN 40 ELSE 20 END)
 OR jsonb_array_length(entries)>jsonb_array_length(documents) THEN RAISE EXCEPTION 'invalid_calendar_manifest'; END IF;
 IF NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='signalbrief-raw' AND o.name=object_key) THEN
  RAISE EXCEPTION 'calendar_archive_missing'; END IF;
 FOR page IN SELECT value FROM jsonb_array_elements(pages) LOOP
  expected_url:='https://opendart.fss.or.kr/api/list.json?corp_code='||cfg.provider_company_id||'&page_no='||page_index||
   '&bgn_de='||to_char(today-90,'YYYYMMDD')||'&end_de='||to_char(today,'YYYYMMDD')||'&page_count=100&sort=date&sort_mth=desc';
  IF jsonb_typeof(page) IS DISTINCT FROM 'object' OR page->'page_number' IS DISTINCT FROM to_jsonb(page_index)
  OR page->>'url' IS DISTINCT FROM expected_url OR coalesce(page->>'raw_sha256','')!~'^[a-f0-9]{64}$'
  OR page->>'object_key' IS DISTINCT FROM ('calendar/'||source||'/lists/'||(page->>'raw_sha256')||'.json')
  OR jsonb_typeof(page->'count') IS DISTINCT FROM 'number' OR coalesce(page->>'count','')!~'^[0-9]{1,3}$'
  OR jsonb_typeof(page->'total_count') IS DISTINCT FROM 'number' OR coalesce(page->>'total_count','')!~'^[0-9]{1,3}$'
  OR jsonb_typeof(page->'total_page') IS DISTINCT FROM 'number' OR coalesce(page->>'total_page','')!~'^[0-5]$' THEN
   RAISE EXCEPTION 'invalid_calendar_page'; END IF;
  page_count:=(page->>'count')::integer;
  IF page_index=1 THEN total_rows:=(page->>'total_count')::integer;total_pages:=(page->>'total_page')::integer; END IF;
  IF total_rows>500 OR (page->>'total_count')::integer<>total_rows OR (page->>'total_page')::integer<>total_pages
  OR total_pages<>ceil(total_rows/100.0)::integer OR jsonb_array_length(pages)<>greatest(1,total_pages)
  OR page_count<>least(100,greatest(0,total_rows-(page_index-1)*100)) THEN RAISE EXCEPTION 'incomplete_calendar_manifest'; END IF;
  IF NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='signalbrief-raw' AND o.name=page->>'object_key') THEN
   RAISE EXCEPTION 'calendar_archive_missing'; END IF;
  rows_seen:=rows_seen+page_count;page_index:=page_index+1;
 END LOOP;
 IF rows_seen<>total_rows OR (NOT correction_manifest AND jsonb_array_length(documents)>total_rows) THEN RAISE EXCEPTION 'incomplete_calendar_manifest'; END IF;
 IF (SELECT count(*)<>count(DISTINCT x->>'receipt_no') FROM jsonb_array_elements(documents) x)
 OR (SELECT count(*)<>count(DISTINCT x->>'key') FROM jsonb_array_elements(entries) x) THEN RAISE EXCEPTION 'duplicate_calendar_identity'; END IF;
 IF correction_manifest THEN
  PERFORM app_private.calendar_validate_dart_families(manifest,today);
  IF jsonb_array_length(manifest->'families')>total_rows THEN RAISE EXCEPTION 'incomplete_calendar_manifest'; END IF;
 END IF;
 FOR document IN SELECT value FROM jsonb_array_elements(documents) LOOP
  IF jsonb_typeof(document) IS DISTINCT FROM 'object' OR coalesce(document->>'receipt_no','')!~'^[0-9]{14}$'
  OR document->>'main_url' IS DISTINCT FROM ('https://dart.fss.or.kr/dsaf001/main.do?rcpNo='||(document->>'receipt_no'))
  OR coalesce(document->>'main_sha256','')!~'^[a-f0-9]{64}$' OR coalesce(document->>'body_sha256','')!~'^[a-f0-9]{64}$'
  OR document->>'main_object_key' IS DISTINCT FROM ('calendar/'||source||'/documents/'||(document->>'main_sha256')||'.html')
  OR document->>'body_object_key' IS DISTINCT FROM ('calendar/'||source||'/documents/'||(document->>'body_sha256')||'.html')
  OR coalesce(document->>'body_url','')!~('^https://dart\.fss\.or\.kr/report/viewer\.do\?rcpNo='||(document->>'receipt_no')||'&dcmNo=[1-9][0-9]{0,11}&eleId=0&offset=0&length=0&dtd=HTML$') THEN
   RAISE EXCEPTION 'invalid_calendar_document'; END IF;
  receipt_day:=(substr(document->>'receipt_no',1,4)||'-'||substr(document->>'receipt_no',5,2)||'-'||substr(document->>'receipt_no',7,2))::date;
  IF receipt_day>today OR (NOT correction_manifest AND receipt_day<today-90) THEN RAISE EXCEPTION 'receipt_date_out_of_range'; END IF;
  IF NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='signalbrief-raw' AND o.name=document->>'main_object_key')
  OR NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='signalbrief-raw' AND o.name=document->>'body_object_key') THEN
   RAISE EXCEPTION 'calendar_archive_missing'; END IF;
 END LOOP;
 SELECT coalesce(string_agg(x->>'quote',E'\n' ORDER BY ord),'Complete official IR receipt-window scan') INTO evidence
 FROM jsonb_array_elements(entries) WITH ORDINALITY AS elements(x,ord);
 INSERT INTO app_private.calendar_snapshots(source_key,raw_sha256,object_key,normalized_text,raw_format,provenance)
 VALUES(source,raw_sha,object_key,evidence,'json',manifest) ON CONFLICT(source_key,raw_sha256) DO NOTHING;
 SELECT id INTO snap FROM app_private.calendar_snapshots s WHERE s.source_key=source AND s.raw_sha256=raw_sha
 AND s.object_key=sb_calendar_ingest_dart_ir.object_key AND s.normalized_text=evidence AND s.raw_format='json' AND s.provenance=manifest;
 IF snap IS NULL THEN RAISE EXCEPTION 'snapshot_conflict'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(entries) LOOP
  IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR coalesce(item->>'key','')!~'^[0-9]{14}$'
  OR coalesce(item->>'occurs_on','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  OR jsonb_typeof(item->'title') IS DISTINCT FROM 'string' OR coalesce(length(trim(item->>'title')),0) NOT BETWEEN 1 AND 200
  OR jsonb_typeof(item->'quote') IS DISTINCT FROM 'string' OR coalesce(length(trim(item->>'quote')),0) NOT BETWEEN 1 AND 500
  OR item->'timezone' IS DISTINCT FROM 'null'::jsonb
  OR coalesce(item->>'location','')!~'^99664/table/tr\[[0-9]{1,4}\]/일시$'
  OR position(item->>'occurs_on' IN item->>'quote')<=0
  OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(documents) d WHERE d->>'receipt_no'=CASE WHEN correction_manifest THEN item->>'receipt_no' ELSE item->>'key' END
    AND d->>'main_url'=item->>'source_url' AND d->>'body_sha256'=item->>'body_sha256') THEN RAISE EXCEPTION 'invalid_calendar_entry'; END IF;
  day:=(item->>'occurs_on')::date;
  IF NOT correction_manifest AND day NOT BETWEEN today-90 AND (today+interval '18 months')::date THEN RAISE EXCEPTION 'calendar_date_out_of_range'; END IF;
  -- The root receipt is the stable identity. Latest evidence may advance only along
  -- the explicitly verified family; an old worker/replay cannot restore an obsolete date.
  SELECT s.provenance->>'schema' schema,e.value entry INTO previous FROM public.calendar_items c
   JOIN app_private.calendar_snapshots s ON s.id=c.source_snapshot_id
   CROSS JOIN LATERAL jsonb_array_elements(s.provenance->'entries') e
   WHERE c.source_key=source AND c.company_id=co AND c.source_event_key=item->>'key' AND e.value->>'key'=c.source_event_key;
  IF correction_manifest AND previous.entry IS NOT NULL
  AND coalesce(previous.entry->>'receipt_no',previous.entry->>'key')=item->>'receipt_no'
  AND (item->>'key',item->>'occurs_on',item->>'title',item->>'quote',item->'timezone',item->>'source_url')
   IS DISTINCT FROM (previous.entry->>'key',previous.entry->>'occurs_on',previous.entry->>'title',
    previous.entry->>'quote',previous.entry->'timezone',previous.entry->>'source_url') THEN
   RAISE EXCEPTION 'calendar_revision_conflict'; END IF;
  IF previous.schema='signalbrief.calendar.dart-ir.v2' THEN
   IF NOT correction_manifest THEN RAISE EXCEPTION 'stale_calendar_revision'; END IF;
   latest:=item->>'receipt_no';
   SELECT f->'receipt_nos' INTO family_receipts FROM jsonb_array_elements(manifest->'families') f WHERE f->>'root_receipt_no'=item->>'key';
   IF NOT family_receipts ? (previous.entry->>'receipt_no') OR latest<previous.entry->>'receipt_no' THEN
    RAISE EXCEPTION 'stale_calendar_revision'; END IF;
  END IF;
  INSERT INTO public.calendar_items(id,company_id,title,occurs_on,origin,quote,created_at,source_snapshot_id,source_key,source_event_key,source_url,source_timezone,source_location,verified_at,calendar_status)
  VALUES(gen_random_uuid()::text,co,item->>'title',day,'official',item->>'quote',now(),snap,source,item->>'key',item->>'source_url',NULL,item->>'location',now(),'confirmed')
  ON CONFLICT(source_key,company_id,source_event_key) WHERE source_key IS NOT NULL DO UPDATE SET title=EXCLUDED.title,occurs_on=EXCLUDED.occurs_on,quote=EXCLUDED.quote,
   source_snapshot_id=EXCLUDED.source_snapshot_id,source_url=EXCLUDED.source_url,source_timezone=NULL,source_location=EXCLUDED.source_location,verified_at=now(),calendar_status='confirmed';
  n:=n+1;
 END LOOP;
 UPDATE app_private.calendar_sources SET last_attempt_at=now(),last_success_at=now(),error_code=NULL WHERE key=source;
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.sb_calendar_ingest_dart_ir(text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sb_calendar_ingest_dart_ir(text,text,text,text) TO service_role;

-- Earlier v1 evidence remains visible. A v2 row points to the latest document,
-- while its public calendar identity remains the verified family root.
CREATE OR REPLACE FUNCTION app_private.sb_calendar_confirmed(cid text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.calendar_items c
 JOIN app_private.calendar_snapshots s ON s.id=c.source_snapshot_id AND s.source_key=c.source_key
 JOIN app_private.calendar_sources p ON p.key=s.source_key
 JOIN public.companies co ON co.id=c.company_id AND co.id=p.company_id AND co.provider=p.provider
  AND co.provider_company_id=p.provider_company_id AND co.ticker=p.ticker AND co.market=p.market AND NOT co.is_demo
 WHERE c.id=cid AND c.origin='official' AND c.calendar_status='confirmed' AND p.enabled
 AND position(c.quote IN s.normalized_text)>0 AND c.verified_at IS NOT NULL
 AND ((p.adapter<>'dart-ir' AND c.source_url=p.url) OR (p.adapter='dart-ir'
  AND s.provenance->>'schema' IN ('signalbrief.calendar.dart-ir.v1','signalbrief.calendar.dart-ir.v2')
  AND s.provenance->>'provider_company_id'=p.provider_company_id AND s.provenance->>'company_id'=co.id
  AND EXISTS(SELECT 1 FROM jsonb_array_elements(s.provenance->'entries') e WHERE e->>'key'=c.source_event_key
   AND e->>'source_url'=c.source_url AND e->>'quote'=c.quote AND e->>'occurs_on'=c.occurs_on::text
   AND ((s.provenance->>'schema'='signalbrief.calendar.dart-ir.v1'
    AND EXISTS(SELECT 1 FROM jsonb_array_elements(s.provenance->'documents') d WHERE d->>'receipt_no'=e->>'key'
     AND d->>'main_url'=e->>'source_url' AND d->>'body_sha256'=e->>'body_sha256'))
   OR (s.provenance->>'schema'='signalbrief.calendar.dart-ir.v2' AND c.title=e->>'title'
    AND c.source_timezone IS NULL AND c.source_location=e->>'location'
    AND EXISTS(SELECT 1 FROM jsonb_array_elements(s.provenance->'families') f WHERE f->>'root_receipt_no'=e->>'key'
     AND f->>'latest_receipt_no'=e->>'receipt_no' AND f->'receipt_nos'->>0=e->>'key' AND f->'receipt_nos'->>-1=e->>'receipt_no'
     AND EXISTS(SELECT 1 FROM jsonb_array_elements(s.provenance->'documents') d WHERE d->>'receipt_no'=e->>'receipt_no'
      AND d->>'root_receipt_no'=e->>'key' AND d->'family_receipts'=f->'receipt_nos'
      AND d->'corrected'=to_jsonb(e->>'receipt_no'<>e->>'key')
      AND d->>'main_url'=e->>'source_url' AND d->>'body_sha256'=e->>'body_sha256'))))))))
$$;
