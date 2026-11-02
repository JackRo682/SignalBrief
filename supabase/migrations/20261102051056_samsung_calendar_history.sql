-- Samsung's current-month upcoming list and explicitly dated annual history are
-- bounded evidence, not a complete future catalogue. Keep historical/saved IDs.
ALTER TABLE app_private.calendar_snapshots DROP CONSTRAINT calendar_snapshot_format;
ALTER TABLE app_private.calendar_snapshots ADD CONSTRAINT calendar_snapshot_format CHECK(
 (raw_format='html' AND (provenance IS NULL OR (source_key='samsung-ir' AND provenance=
  '{"schema":"signalbrief.calendar.samsung.v1","complete":false,"coverage":"current-month-upcoming-and-recent-history","range_representation":"published-start-with-full-range-label"}'::jsonb)))
 OR (raw_format='json' AND provenance IS NOT NULL AND jsonb_typeof(provenance)='object')
);

CREATE FUNCTION app_private.calendar_samsung_dates(value text) RETURNS date[]
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE parts text[]; first_day date; last_day date; m integer; n integer;
 months text[]:=ARRAY['January','February','March','April','May','June','July','August','September','October','November','December'];
 short_months text[]:=ARRAY['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
BEGIN
 parts:=regexp_match(value,'^([A-Z][a-z]+) ([0-9]{1,2}), ([0-9]{4})(, ([1-9]|1[0-2]):[0-5][0-9] [ap]\.m\. KST)?$');
 IF parts IS NOT NULL THEN
  m:=coalesce(array_position(months,parts[1]),array_position(short_months,parts[1]));
  IF m IS NULL THEN RAISE EXCEPTION 'invalid_samsung_calendar_date'; END IF;
  RETURN ARRAY[make_date(parts[3]::integer,m,parts[2]::integer),NULL::date];
 END IF;
 parts:=regexp_match(value,'^([A-Z][a-z]+) ([0-9]{1,2}), ([0-9]{4})\s*[~–-]\s*([A-Z][a-z]+) ([0-9]{1,2}), ([0-9]{4})$');
 IF parts IS NOT NULL THEN
  m:=coalesce(array_position(months,parts[1]),array_position(short_months,parts[1]));
  n:=coalesce(array_position(months,parts[4]),array_position(short_months,parts[4]));
  IF m IS NULL OR n IS NULL THEN RAISE EXCEPTION 'invalid_samsung_calendar_date'; END IF;
  first_day:=make_date(parts[3]::integer,m,parts[2]::integer);last_day:=make_date(parts[6]::integer,n,parts[5]::integer);
 ELSE
  parts:=regexp_match(value,'^([A-Z][a-z]+) ([0-9]{1,2})\s*[~–-]\s*(([A-Z][a-z]+) )?([0-9]{1,2}), ([0-9]{4})$');
  IF parts IS NULL THEN RAISE EXCEPTION 'invalid_samsung_calendar_date'; END IF;
  m:=coalesce(array_position(months,parts[1]),array_position(short_months,parts[1]));
  n:=coalesce(array_position(months,coalesce(parts[4],parts[1])),array_position(short_months,coalesce(parts[4],parts[1])));
  IF m IS NULL OR n IS NULL THEN RAISE EXCEPTION 'invalid_samsung_calendar_date'; END IF;
  first_day:=make_date(parts[6]::integer,m,parts[2]::integer);last_day:=make_date(parts[6]::integer,n,parts[5]::integer);
 END IF;
 IF last_day<=first_day THEN RAISE EXCEPTION 'invalid_samsung_calendar_date'; END IF;
 RETURN ARRAY[first_day,last_day];
END $$;
REVOKE ALL ON FUNCTION app_private.calendar_samsung_dates(text) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.sb_calendar_ingest(source text,raw_sha text,object_key text,normalized_text text,entries jsonb) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cfg app_private.calendar_sources; co text; snap uuid; item jsonb; n integer:=0; day date; bounds date[]; legacy_key text; legacy_id text; canonical_id text;
BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(hashtextextended('calendar:'||source,0));
 SELECT * INTO cfg FROM app_private.calendar_sources WHERE key=source AND enabled;
 IF cfg.key IS NULL OR cfg.adapter NOT IN ('microsoft','samsung') OR NOT EXISTS(SELECT 1 FROM app_private.calendar_source_catalog c WHERE c.key=source AND c.provider=cfg.provider AND c.provider_company_id=cfg.provider_company_id AND c.ticker=cfg.ticker AND c.url=cfg.url AND c.adapter=cfg.adapter) OR raw_sha IS NULL OR object_key IS NULL OR normalized_text IS NULL OR entries IS NULL
 OR raw_sha !~ '^[a-f0-9]{64}$' OR object_key<>('calendar/'||source||'/'||raw_sha||'.html')
 OR length(normalized_text) NOT BETWEEN 1 AND 2000000 OR jsonb_typeof(entries)<>'array' OR jsonb_array_length(entries)>200 THEN
  RAISE EXCEPTION 'invalid_calendar_payload'; END IF;
 IF (SELECT count(*)<>count(DISTINCT x->>'key') FROM jsonb_array_elements(entries) x) THEN RAISE EXCEPTION 'duplicate_calendar_identity'; END IF;
 SELECT id INTO STRICT co FROM public.companies WHERE id=cfg.company_id AND provider=cfg.provider AND provider_company_id=cfg.provider_company_id AND ticker=cfg.ticker AND market=cfg.market AND NOT is_demo;
 IF cfg.adapter='samsung' AND NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='signalbrief-raw' AND o.name=object_key) THEN
  RAISE EXCEPTION 'calendar_original_missing'; END IF;
 INSERT INTO app_private.calendar_snapshots(source_key,raw_sha256,object_key,normalized_text,provenance)
 VALUES(source,raw_sha,object_key,normalized_text,CASE WHEN cfg.adapter='samsung' THEN jsonb_build_object(
  'schema','signalbrief.calendar.samsung.v1','complete',false,'coverage','current-month-upcoming-and-recent-history',
  'range_representation','published-start-with-full-range-label') ELSE NULL END)
 ON CONFLICT(source_key,raw_sha256) DO NOTHING;
 SELECT id INTO snap FROM app_private.calendar_snapshots WHERE source_key=source AND raw_sha256=raw_sha AND calendar_snapshots.normalized_text=sb_calendar_ingest.normalized_text;
 IF snap IS NULL THEN RAISE EXCEPTION 'snapshot_conflict'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(entries) LOOP
  IF item->>'occurs_on' IS NULL OR item->>'occurs_on' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    OR coalesce(length(trim(item->>'title')),0) NOT BETWEEN 1 AND 200
    OR coalesce(length(item->>'key'),0) NOT BETWEEN 1 AND 200
    OR coalesce(length(trim(item->>'quote')),0)=0 OR position(item->>'quote' IN normalized_text)=0
    OR coalesce(length(item->>'location'),0) NOT BETWEEN 1 AND 500
    OR coalesce(item->>'timezone','') NOT IN ('Asia/Seoul','America/Los_Angeles','America/New_York','America/Denver','America/Chicago') THEN RAISE EXCEPTION 'invalid_calendar_entry'; END IF;
  day:=(item->>'occurs_on')::date;
  IF day<current_date-91 OR day>current_date+550 THEN RAISE EXCEPTION 'calendar_date_out_of_range'; END IF;
  IF cfg.adapter='samsung' AND (item ? 'source_title' OR item ? 'source_date' OR item ? 'ends_on' OR item->>'key' LIKE 'date:%') THEN
   IF jsonb_typeof(item->'source_title') IS DISTINCT FROM 'string' OR jsonb_typeof(item->'source_date') IS DISTINCT FROM 'string'
    OR length(trim(item->>'source_title')) NOT BETWEEN 1 AND 160 OR length(item->>'source_date') NOT BETWEEN 1 AND 100
    OR item->>'timezone' IS DISTINCT FROM 'Asia/Seoul'
    OR item->>'quote' IS DISTINCT FROM (item->>'source_title')||' '||(item->>'source_date')
    OR item->>'location' !~ '^(Upcoming Events|Past Events/[0-9]{4})/dl\.ir-event-list__detail\[[0-9]+\]$' THEN
    RAISE EXCEPTION 'invalid_samsung_calendar_entry'; END IF;
   bounds:=app_private.calendar_samsung_dates(item->>'source_date');
   IF day IS DISTINCT FROM bounds[1] OR (item->>'ends_on') IS DISTINCT FROM bounds[2]::text
    OR (item->>'location' LIKE 'Past Events/%' AND substring(item->>'location' FROM '^Past Events/([0-9]{4})/')<>to_char(day,'YYYY')) THEN
    RAISE EXCEPTION 'invalid_samsung_calendar_entry'; END IF;
   legacy_key:=regexp_replace(lower(item->>'source_title'),'\s+',' ','g');
   IF item->>'key' IS DISTINCT FROM 'date:'||day::text||':'||legacy_key
    OR item->>'title' IS DISTINCT FROM ('Samsung Electronics · '||(item->>'source_title')||
     CASE WHEN bounds[2] IS NULL THEN '' ELSE ' · 기간 시작 ('||(item->>'source_date')||')' END) THEN
    RAISE EXCEPTION 'invalid_samsung_calendar_identity'; END IF;
   -- Match the former title identity only at its already verified date. The row ID,
   -- reminder references and owner bindings survive the source-date key upgrade.
   SELECT c.id INTO legacy_id FROM public.calendar_items c WHERE c.source_key=source AND c.company_id=co
    AND c.source_event_key=legacy_key AND c.occurs_on=day;
   SELECT c.id INTO canonical_id FROM public.calendar_items c WHERE c.source_key=source AND c.company_id=co
    AND c.source_event_key=item->>'key';
   IF legacy_id IS NOT NULL AND canonical_id IS NOT NULL AND legacy_id<>canonical_id THEN
    RAISE EXCEPTION 'samsung_calendar_identity_conflict'; END IF;
   IF legacy_id IS NOT NULL THEN UPDATE public.calendar_items SET source_event_key=item->>'key' WHERE id=legacy_id; END IF;
  ELSIF cfg.adapter='samsung' THEN
   -- An already in-flight old worker may still send a title key during deployment.
   -- Reuse an upgraded date identity rather than inserting a duplicate legacy row.
   SELECT c.id INTO canonical_id FROM public.calendar_items c WHERE c.source_key=source AND c.company_id=co
    AND c.source_event_key='date:'||day::text||':'||(item->>'key') AND c.occurs_on=day;
   IF canonical_id IS NOT NULL THEN
    IF EXISTS(SELECT 1 FROM public.calendar_items c WHERE c.source_key=source AND c.company_id=co AND c.source_event_key=item->>'key') THEN
     RAISE EXCEPTION 'samsung_calendar_identity_conflict'; END IF;
    item:=jsonb_set(item,'{key}',to_jsonb('date:'||day::text||':'||(item->>'key')));
   END IF;
  END IF;
  INSERT INTO public.calendar_items(id,company_id,title,occurs_on,origin,quote,created_at,source_snapshot_id,source_key,source_event_key,source_url,source_timezone,source_location,verified_at,calendar_status)
  VALUES(gen_random_uuid()::text,co,item->>'title',day,'official',item->>'quote',now(),snap,source,item->>'key',cfg.url,item->>'timezone',item->>'location',now(),'confirmed')
  ON CONFLICT(source_key,company_id,source_event_key) WHERE source_key IS NOT NULL DO UPDATE SET title=EXCLUDED.title,occurs_on=EXCLUDED.occurs_on,quote=EXCLUDED.quote,
   source_snapshot_id=EXCLUDED.source_snapshot_id,source_url=EXCLUDED.source_url,source_timezone=EXCLUDED.source_timezone,source_location=EXCLUDED.source_location,verified_at=now(),calendar_status='confirmed';
  n:=n+1;
 END LOOP;
 -- Microsoft publishes the complete parsed schedule. Samsung upcoming is month-scoped;
 -- absence there cannot withdraw an independently verified future event.
 UPDATE public.calendar_items c SET calendar_status='withdrawn' WHERE cfg.adapter<>'samsung' AND c.source_key=source AND c.occurs_on>=current_date
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(entries) x WHERE x->>'key'=c.source_event_key);
 UPDATE app_private.calendar_sources SET last_attempt_at=now(),last_success_at=now(),error_code=NULL WHERE key=source;
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.sb_calendar_ingest(text,text,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sb_calendar_ingest(text,text,text,text,jsonb) TO service_role;
