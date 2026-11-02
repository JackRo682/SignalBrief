-- A recognized Nasdaq/Drupal HTML list is explicit evidence for its published rows,
-- not proof of an exhaustive future schedule. Reuse canonical SEC issuer validation.
CREATE FUNCTION app_private.calendar_drupal_evidence(source text,manifest jsonb) RETURNS void
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE d jsonb:=manifest->'drupal'; e jsonb; text_value text; rows text[]; bounds text[]; parts text[];
 row_index integer; row_start integer; quote_start integer; quote_end integer; day date; origin text; path text;
BEGIN
 IF manifest->'complete' IS DISTINCT FROM 'false'::jsonb OR manifest->>'coverage' IS DISTINCT FROM 'published-event-list'
 OR jsonb_typeof(d) IS DISTINCT FROM 'object' OR d->>'normalization' IS DISTINCT FROM 'drupal-event-articles-text-v1'
 OR d->>'source_url' IS DISTINCT FROM manifest->>'event_source_url'
 OR coalesce(d->>'raw_sha256','')!~'^[a-f0-9]{64}$'
 OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(manifest->'documents') doc WHERE doc->>'role' IN ('ir','events')
  AND doc->>'url'=d->>'source_url' AND doc->>'raw_sha256'=d->>'raw_sha256')
 OR jsonb_typeof(d->'normalized_text') IS DISTINCT FROM 'string'
 OR coalesce(d->>'normalized_sha256','')!~'^[a-f0-9]{64}$'
 OR d->>'normalized_sha256' IS DISTINCT FROM encode(extensions.digest(convert_to(d->>'normalized_text','UTF8'),'sha256'),'hex')
 OR d->>'normalized_object_key' IS DISTINCT FROM 'calendar/'||source||'/normalized/'||(d->>'normalized_sha256')||'.txt'
 OR jsonb_typeof(d->'row_count') IS DISTINCT FROM 'number' OR coalesce(d->>'row_count','')!~'^[0-9]{1,3}$'
 OR (d->>'row_count')::integer NOT BETWEEN 1 AND 200
 OR jsonb_typeof(d->'pagination_detected') IS DISTINCT FROM 'boolean'
 OR manifest ? 'q4' OR manifest ? 'q4_manifest' OR manifest ? 'filing'
 THEN RAISE EXCEPTION 'invalid_drupal_calendar_evidence'; END IF;
 IF NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='signalbrief-raw' AND o.name=d->>'normalized_object_key') THEN
  RAISE EXCEPTION 'calendar_archive_missing'; END IF;
 text_value:=d->>'normalized_text';rows:=string_to_array(text_value,E'\n');origin:=app_private.calendar_ir_origin(d->>'source_url');
 IF octet_length(text_value) NOT BETWEEN 1 AND 750000 OR cardinality(rows)<>(d->>'row_count')::integer
 OR EXISTS(SELECT 1 FROM unnest(rows) line WHERE length(trim(line))=0 OR line<>trim(regexp_replace(line,'[[:space:]]+',' ','g')))
 OR jsonb_array_length(manifest->'entries')>(d->>'row_count')::integer
 THEN RAISE EXCEPTION 'invalid_drupal_calendar_evidence'; END IF;
 -- Different identity systems must be reviewed rather than duplicating a filing-based event.
 IF EXISTS(SELECT 1 FROM app_private.calendar_snapshots s WHERE s.source_key=source AND s.provenance->>'schema'='signalbrief.calendar.sec-filing.v1') THEN
  RAISE EXCEPTION 'calendar_source_change_requires_review'; END IF;
 FOR e IN SELECT value FROM jsonb_array_elements(manifest->'entries') LOOP
  IF jsonb_typeof(e->'source_date') IS DISTINCT FROM 'string' OR length(e->>'source_date') NOT BETWEEN 1 AND 100
  OR jsonb_typeof(e->'date_text') IS DISTINCT FROM 'string'
  OR jsonb_typeof(e->'event_url') IS DISTINCT FROM 'string'
  OR jsonb_typeof(e->'quote_start') IS DISTINCT FROM 'number' OR coalesce(e->>'quote_start','')!~'^[0-9]{1,7}$'
  OR jsonb_typeof(e->'quote_end') IS DISTINCT FROM 'number' OR coalesce(e->>'quote_end','')!~'^[0-9]{1,7}$'
  OR e->>'source_url' IS DISTINCT FROM d->>'source_url' OR e->>'raw_sha256' IS DISTINCT FROM d->>'raw_sha256'
  OR app_private.calendar_ir_origin(e->>'event_url') IS DISTINCT FROM origin
  OR e->'timezone' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'invalid_drupal_calendar_entry'; END IF;
  path:=substring(e->>'event_url' FROM length(origin)+1);
  bounds:=regexp_match(e->>'location','^drupal-list\.articles\[([0-9]{1,3})\]\.normalized-text\[([0-9]{1,7}):([0-9]{1,7})\]$');
  parts:=regexp_match(lower(e->>'date_text'),'^(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|october|oct|november|nov|december|dec)[[:space:]]+([0-9]{1,2}),[[:space:]]+([0-9]{4})$');
  IF bounds IS NULL OR parts IS NULL OR path!~'^/events/event-details/[A-Za-z0-9][A-Za-z0-9._~-]*/?$'
  OR e->>'key' IS DISTINCT FROM 'event:'||path
  OR e->>'source_date'!~*'^[A-Za-z]+[[:space:]]+[0-9]{1,2},[[:space:]]+[0-9]{4}([[:space:]]+([1-9]|1[0-2]):[0-5][0-9][[:space:]]+(AM|PM)[[:space:]]+(PST|PDT|MST|MDT|CST|CDT|EST|EDT|UTC|GMT))?$'
  OR left(e->>'source_date',length(e->>'date_text')) IS DISTINCT FROM e->>'date_text'
  OR e->>'quote' IS DISTINCT FROM (e->>'title')||' '||(e->>'source_date') THEN RAISE EXCEPTION 'invalid_drupal_calendar_entry'; END IF;
  day:=make_date(parts[3]::integer,array_position(ARRAY['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'],left(parts[1],3)),parts[2]::integer);
  row_index:=bounds[1]::integer;quote_start:=(e->>'quote_start')::integer;quote_end:=(e->>'quote_end')::integer;
  SELECT coalesce(sum(length(line)+1),0)::integer INTO row_start FROM unnest(rows) WITH ORDINALITY AS previous(line,n) WHERE n<=row_index;
  IF row_index>=(d->>'row_count')::integer OR quote_start<>bounds[2]::integer OR quote_end<>bounds[3]::integer
  OR quote_start<row_start OR quote_end>row_start+length(rows[row_index+1]) OR quote_end<=quote_start
  OR e->>'quote' IS DISTINCT FROM substring(text_value FROM quote_start+1 FOR quote_end-quote_start)
  OR rows[row_index+1]~*'\m(cancelled|canceled|postponed|rescheduled)\M'
  OR e->>'occurs_on' IS DISTINCT FROM day::text THEN RAISE EXCEPTION 'invalid_drupal_calendar_entry'; END IF;
  IF EXISTS(SELECT 1 FROM public.calendar_items c WHERE c.source_key=source AND c.company_id=manifest->>'company_id'
   AND c.source_event_key=e->>'key' AND c.occurs_on<>day) THEN RAISE EXCEPTION 'calendar_event_change_requires_review'; END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION app_private.calendar_drupal_evidence(text,jsonb) FROM PUBLIC,anon,authenticated,service_role;

DO $$ DECLARE definition text; marker text; BEGIN
 definition:=pg_get_functiondef('app_private.calendar_ingest_sec_ir_v1(text,text,text,text)'::regprocedure);
 IF position('OR manifest->''complete'' IS DISTINCT FROM ''true''::jsonb' IN definition)=0
 OR position('NOT IN (''q4'',''structured-html'')' IN definition)=0 THEN RAISE EXCEPTION 'calendar_drupal_ingest_precondition_failed'; END IF;
 definition:=replace(definition,'OR manifest->''complete'' IS DISTINCT FROM ''true''::jsonb',
  'OR (manifest->>''format''=''drupal-list'' AND manifest->''complete'' IS DISTINCT FROM ''false''::jsonb OR manifest->>''format''<>''drupal-list'' AND manifest->''complete'' IS DISTINCT FROM ''true''::jsonb)');
 definition:=replace(definition,'NOT IN (''q4'',''structured-html'')','NOT IN (''q4'',''structured-html'',''drupal-list'')');
 marker:=' IF EXISTS(SELECT 1 FROM app_private.calendar_snapshots s WHERE s.source_key=source';
 IF position(marker IN definition)=0 THEN RAISE EXCEPTION 'calendar_drupal_ingest_precondition_failed'; END IF;
 definition:=replace(definition,marker,E' IF manifest->>''format''=''drupal-list'' THEN PERFORM app_private.calendar_drupal_evidence(source,manifest); END IF;\n'||marker);
 marker:='OR coalesce(item->>''location'','''')!~''^(tables\[[0-9]+\]\.rows\[[0-9]+\]\.earnings-date|jsonld\[[0-9]+\]\.events\[[0-9]+\])$''';
 IF position(marker IN definition)=0 THEN RAISE EXCEPTION 'calendar_drupal_location_precondition_failed'; END IF;
 definition:=replace(definition,marker,
  'OR (manifest->>''format''=''drupal-list'' AND coalesce(item->>''location'','''')!~''^drupal-list\.articles\[[0-9]+\]\.normalized-text\[[0-9]+:[0-9]+\]$'' OR manifest->>''format''<>''drupal-list'' AND coalesce(item->>''location'','''')!~''^(tables\[[0-9]+\]\.rows\[[0-9]+\]\.earnings-date|jsonld\[[0-9]+\]\.events\[[0-9]+\])$'')');
 EXECUTE definition;
 definition:=pg_get_functiondef('app_private.calendar_sec_ir_confirmed_v1(text)'::regprocedure);
 marker:='s.provenance->>''format''=''structured-html''';
 IF position(marker IN definition)=0 THEN RAISE EXCEPTION 'calendar_drupal_visibility_precondition_failed'; END IF;
 EXECUTE replace(definition,marker,'s.provenance->>''format'' IN (''structured-html'',''drupal-list'')');
 -- Keep the inverse Drupal-to-filing transition reviewed, with the wrapper lock intact.
 definition:=pg_get_functiondef('public.sb_calendar_ingest_sec_ir(text,text,text,text)'::regprocedure);
 marker:='s.provenance->>''format''=''q4''';
 IF position(marker IN definition)=0 OR position('pg_advisory_xact_lock' IN definition)=0 THEN
  RAISE EXCEPTION 'calendar_drupal_wrapper_precondition_failed'; END IF;
 EXECUTE replace(definition,marker,'s.provenance->>''format'' IN (''q4'',''drupal-list'')');
END $$;
