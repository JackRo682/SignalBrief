-- Every canonical SEC issuer can discover an official IR calendar from filed evidence.
-- Existing reviewed source configurations and operator-disabled flags retain priority.
ALTER TABLE app_private.calendar_worker_control ADD COLUMN sec_ir_ready boolean NOT NULL DEFAULT false;

CREATE FUNCTION app_private.calendar_ir_origin(value text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE WHEN value~'^https://[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,63}/[^[:space:]]*$'
  AND value!~'^https://[^/]*(supabase|metadata\.google|\.localhost|\.local|\.internal|\.invalid|\.example|\.test|\.onion)/'
  AND length(value)<=1000 THEN substring(value FROM '^https://[^/]+') END
$$;
REVOKE ALL ON FUNCTION app_private.calendar_ir_origin(text) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION app_private.calendar_issuer_name(value text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT regexp_replace(trim(regexp_replace(replace(replace(lower(normalize(value,NFKC)),'.',''),',',''),'[[:space:]]+',' ','g')),
  ' (incorporated|inc|corporation|corp|limited|ltd|plc)$','')
$$;
CREATE FUNCTION app_private.calendar_ir_issuer_label(value text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT trim(regexp_replace(regexp_replace(trim(regexp_replace(normalize(value,NFKC),'[[:space:]]+',' ','g')),
  '^(investor relations|investor overview|events calendar|events (&|and) presentations|events)([[:space:]]*[|–—-][[:space:]]*|[[:space:]]+)','','i'),
  '([[:space:]]*[|–—-][[:space:]]*|[[:space:]]+)(investor relations|investor overview|events calendar|events (&|and) presentations|events)$','','i'))
$$;
REVOKE ALL ON FUNCTION app_private.calendar_issuer_name(text),app_private.calendar_ir_issuer_label(text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION app_private.calendar_onboard_company(cid text,dispatch boolean DEFAULT true) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE company public.companies; cfg record; count_sources integer:=0; market_changed boolean; BEGIN
 SELECT * INTO company FROM public.companies WHERE id=cid AND NOT is_demo AND provider IN ('sec','dart');
 IF company.id IS NULL THEN RAISE EXCEPTION 'company_not_found'; END IF;
 FOR cfg IN
  SELECT c.key,c.url,c.adapter,c.feed_url FROM app_private.calendar_source_catalog c
   WHERE c.provider=company.provider AND c.provider_company_id=company.provider_company_id AND c.ticker=company.ticker
  UNION ALL
  SELECT 'dart-ir-'||company.provider_company_id,'https://dart.fss.or.kr/','dart-ir',NULL
   WHERE company.provider='dart' AND company.provider_company_id~'^[0-9]{8}$' AND company.ticker~'^[A-Z0-9]{6}$'
   AND NOT EXISTS(SELECT 1 FROM app_private.calendar_source_catalog c WHERE c.provider=company.provider AND c.provider_company_id=company.provider_company_id AND c.ticker=company.ticker)
 UNION ALL
  SELECT 'sec-ir-'||company.provider_company_id,'https://www.sec.gov/edgar/browse/?CIK='||company.provider_company_id,'sec-ir',NULL
   WHERE company.provider='sec' AND company.provider_company_id~'^[0-9]{10}$'
   AND NOT EXISTS(SELECT 1 FROM app_private.calendar_source_catalog c WHERE c.provider=company.provider AND c.provider_company_id=company.provider_company_id AND c.ticker=company.ticker)
 LOOP
  IF EXISTS(SELECT 1 FROM app_private.calendar_sources s WHERE s.key=cfg.key AND (
   s.ticker<>company.ticker OR s.url<>cfg.url OR s.adapter<>cfg.adapter
   OR (s.provider IS NOT NULL AND s.provider<>company.provider)
   OR (s.provider_company_id IS NOT NULL AND s.provider_company_id<>company.provider_company_id)
   OR (s.company_id IS NOT NULL AND s.company_id<>company.id)
   OR (s.feed_url IS NOT NULL AND s.feed_url IS DISTINCT FROM cfg.feed_url))) THEN RAISE EXCEPTION 'calendar_source_conflict'; END IF;
  SELECT EXISTS(SELECT 1 FROM app_private.calendar_sources s WHERE s.key=cfg.key AND s.market IS DISTINCT FROM company.market) INTO market_changed;
  INSERT INTO app_private.calendar_sources(key,ticker,market,url,adapter,company_id,provider,provider_company_id,feed_url)
  VALUES(cfg.key,company.ticker,company.market,cfg.url,cfg.adapter,company.id,company.provider,company.provider_company_id,cfg.feed_url)
  ON CONFLICT(key) DO UPDATE SET market=EXCLUDED.market,company_id=EXCLUDED.company_id,provider=EXCLUDED.provider,
   provider_company_id=EXCLUDED.provider_company_id,feed_url=EXCLUDED.feed_url;
  count_sources:=count_sources+1;
  INSERT INTO app_private.calendar_refresh_queue(source_key,state)
  SELECT s.key,'pending' FROM app_private.calendar_sources s WHERE s.key=cfg.key AND s.enabled
   AND (market_changed OR (coalesce(s.last_success_at,'epoch')<now()-interval '6 hours'
    AND coalesce(s.last_attempt_at,'epoch')<now()-interval '1 minute'))
  ON CONFLICT(source_key) DO UPDATE SET
   state=CASE WHEN calendar_refresh_queue.state='running' THEN 'running' ELSE 'pending' END,
   requested_at=now(),next_attempt_at=now(),
   attempts=CASE WHEN calendar_refresh_queue.state='running' THEN calendar_refresh_queue.attempts ELSE 0 END,
   run_id=CASE WHEN calendar_refresh_queue.state='running' THEN calendar_refresh_queue.run_id END,
   lease_until=CASE WHEN calendar_refresh_queue.state='running' THEN calendar_refresh_queue.lease_until END,
   rerun_requested=(calendar_refresh_queue.state='running')
   WHERE market_changed OR (calendar_refresh_queue.state IN ('idle','failed') AND calendar_refresh_queue.requested_at<now()-interval '1 minute');
 END LOOP;
 IF dispatch THEN PERFORM app_private.dispatch_calendar_refresh(); END IF;
 RETURN jsonb_build_object('supported',count_sources>0,'pending',EXISTS(
  SELECT 1 FROM app_private.calendar_sources s JOIN app_private.calendar_refresh_queue q ON q.source_key=s.key
  WHERE s.company_id=cid AND s.enabled AND q.state IN ('pending','running')));
END $$;

CREATE OR REPLACE FUNCTION app_private.dispatch_calendar_refresh() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE candidate record; token text; runid uuid; rid bigint; available integer; sent integer:=0; BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(20261101,74);
 IF NOT coalesce((SELECT ready FROM app_private.calendar_worker_control WHERE singleton),false) THEN RETURN 0; END IF;
 UPDATE app_private.calendar_sources s SET last_attempt_at=now(),error_code='refresh_lease_expired'
 FROM app_private.calendar_refresh_queue q WHERE q.source_key=s.key AND q.state='running' AND q.lease_until<=now();
 UPDATE app_private.calendar_refresh_queue SET state=CASE WHEN NOT rerun_requested AND attempts>=3 THEN 'failed' ELSE 'pending' END,
  attempts=CASE WHEN rerun_requested THEN 0 ELSE attempts END,rerun_requested=false,
  next_attempt_at=now(),lease_until=NULL,run_id=NULL WHERE state='running' AND lease_until<=now();
 IF EXISTS(SELECT 1 FROM app_private.calendar_runs WHERE source_key IS NULL AND finished_at IS NULL AND expires_at>now()) THEN RETURN 0; END IF;
 available:=greatest(0,2-(SELECT count(*) FROM app_private.calendar_runs WHERE source_key IS NOT NULL AND finished_at IS NULL AND expires_at>now()));
 FOR candidate IN SELECT q.source_key FROM app_private.calendar_refresh_queue q
 JOIN app_private.calendar_sources s ON s.key=q.source_key AND s.enabled
 AND (s.adapter<>'sec-ir' OR (SELECT sec_ir_ready FROM app_private.calendar_worker_control WHERE singleton))
 JOIN public.companies c ON c.id=s.company_id AND c.provider=s.provider AND c.provider_company_id=s.provider_company_id AND c.ticker=s.ticker AND c.market=s.market AND NOT c.is_demo
 WHERE q.state='pending' AND q.next_attempt_at<=now() AND q.attempts<3 ORDER BY q.next_attempt_at,q.requested_at,q.source_key LIMIT available
 LOOP
  token:=encode(extensions.gen_random_bytes(32),'hex');
  INSERT INTO app_private.calendar_runs(token_hash,source_key) VALUES(encode(extensions.digest(token,'sha256'),'hex'),candidate.source_key) RETURNING id INTO runid;
  BEGIN
   SELECT net.http_post(url:='https://xabzzhtdmqsaqdauthbu.supabase.co/functions/v1/signalbrief-calendar',
    headers:=jsonb_build_object('Content-Type','application/json','x-signalbrief-task',token),body:='{}'::jsonb,timeout_milliseconds:=60000) INTO rid;
  EXCEPTION WHEN OTHERS THEN
   DELETE FROM app_private.calendar_runs WHERE id=runid;
   UPDATE app_private.calendar_refresh_queue SET state=CASE WHEN attempts>=2 THEN 'failed' ELSE 'pending' END,
    attempts=attempts+1,next_attempt_at=now()+interval '1 minute' WHERE source_key=candidate.source_key;
   UPDATE app_private.calendar_sources SET last_attempt_at=now(),error_code='dispatch_failed' WHERE key=candidate.source_key;
   CONTINUE;
  END;
  UPDATE app_private.calendar_runs SET request_id=rid WHERE id=runid;
  UPDATE app_private.calendar_refresh_queue SET state='running',attempts=attempts+1,run_id=runid,lease_until=now()+interval '5 minutes' WHERE source_key=candidate.source_key;
  sent:=sent+1;
 END LOOP;
 RETURN sent;
END $$;

CREATE OR REPLACE FUNCTION app_content_private.calendar_coverage(selected_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid:=(SELECT auth.uid()); result jsonb; BEGIN
 IF u IS NULL OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=u) THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='PT401'; END IF;
 PERFORM public.sb_require_mfa();PERFORM public.sb_rate_limit();
 IF selected_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.companies WHERE id=selected_id AND NOT is_demo) THEN
  RAISE EXCEPTION 'company_not_found' USING ERRCODE='PT404'; END IF;
 WITH coverage AS (
  SELECT c.id,count(s.key) FILTER(WHERE s.adapter<>'sec-ir' OR s.last_success_at IS NOT NULL) source_count,max(s.last_success_at) last_success_at,max(s.last_attempt_at) last_attempt_at,
   coalesce(bool_or(s.error_code IS NOT NULL),false) has_error,
   coalesce(bool_or(q.state IN ('pending','running')),false) pending
  FROM public.companies c LEFT JOIN app_private.calendar_sources s ON s.enabled AND s.company_id=c.id
   AND s.provider=c.provider AND s.provider_company_id=c.provider_company_id AND s.ticker=c.ticker AND s.market=c.market
  LEFT JOIN app_private.calendar_refresh_queue q ON q.source_key=s.key
  WHERE NOT c.is_demo GROUP BY c.id
 ) SELECT jsonb_build_object('registered_companies',(SELECT count(*) FROM coverage),
  'covered_companies',(SELECT count(*) FROM coverage WHERE source_count>0),
  'pending_companies',(SELECT count(*) FROM coverage WHERE pending),
  'pending_company_ids',(SELECT coalesce(jsonb_agg(id ORDER BY id),'[]'::jsonb) FROM coverage WHERE pending),
  'selected',(SELECT jsonb_build_object('company_id',id,'source_count',source_count,'last_success_at',last_success_at,
   'last_attempt_at',last_attempt_at,'has_error',has_error,'pending',pending) FROM coverage WHERE id=selected_id)) INTO result;
 RETURN result;
END $$;

CREATE FUNCTION public.sb_calendar_ingest_sec_ir(source text,raw_sha text,object_key text,manifest_text text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cfg app_private.calendar_sources; manifest jsonb; documents jsonb; entries jsonb; document jsonb; item jsonb;
 binding jsonb; q4 jsonb; page jsonb; identity_proof jsonb; page_index integer:=0; page_count integer; rows_seen integer:=0; short_page boolean:=false;
 origin text; selected_url text; submission_url text; expected_url text; co text; snap uuid; evidence text; day date; n integer:=0;
BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(hashtextextended('calendar:'||source,0));
 SELECT * INTO cfg FROM app_private.calendar_sources WHERE key=source AND enabled;
 IF cfg.key IS NULL OR cfg.adapter<>'sec-ir' OR cfg.provider<>'sec' OR cfg.provider_company_id!~'^[0-9]{10}$'
 OR cfg.key IS DISTINCT FROM 'sec-ir-'||cfg.provider_company_id
 OR cfg.url IS DISTINCT FROM 'https://www.sec.gov/edgar/browse/?CIK='||cfg.provider_company_id OR cfg.feed_url IS NOT NULL
 OR raw_sha IS NULL OR raw_sha!~'^[a-f0-9]{64}$' OR object_key IS DISTINCT FROM 'calendar/'||source||'/'||raw_sha||'.json'
 OR manifest_text IS NULL OR length(manifest_text) NOT BETWEEN 1 AND 1000000
 OR encode(extensions.digest(convert_to(manifest_text,'UTF8'),'sha256'),'hex') IS DISTINCT FROM raw_sha THEN RAISE EXCEPTION 'invalid_calendar_payload'; END IF;
 SELECT id INTO STRICT co FROM public.companies WHERE id=cfg.company_id AND provider=cfg.provider
  AND provider_company_id=cfg.provider_company_id AND ticker=cfg.ticker AND market=cfg.market AND NOT is_demo;
 manifest:=manifest_text::jsonb;documents:=manifest->'documents';entries:=manifest->'entries';binding:=manifest->'binding';
 submission_url:='https://data.sec.gov/submissions/CIK'||cfg.provider_company_id||'.json';
 origin:=app_private.calendar_ir_origin(binding->>'url');selected_url:=manifest->>'event_source_url';
 IF jsonb_typeof(manifest) IS DISTINCT FROM 'object' OR manifest->>'schema' IS DISTINCT FROM 'signalbrief.calendar.sec-ir.v1'
 OR manifest->>'adapter' IS DISTINCT FROM cfg.adapter OR manifest->>'source_key' IS DISTINCT FROM source
 OR manifest->>'source_url' IS DISTINCT FROM cfg.url OR manifest->>'company_id' IS DISTINCT FROM co
 OR manifest->>'provider' IS DISTINCT FROM cfg.provider OR manifest->>'provider_company_id' IS DISTINCT FROM cfg.provider_company_id
 OR manifest->>'ticker' IS DISTINCT FROM cfg.ticker OR manifest->'complete' IS DISTINCT FROM 'true'::jsonb
 OR jsonb_typeof(manifest->'issuer_name') IS DISTINCT FROM 'string' OR length(manifest->>'issuer_name') NOT BETWEEN 1 AND 300
 OR jsonb_typeof(manifest->'issuer_evidence') IS DISTINCT FROM 'array'
 OR manifest#>>'{window,start}' IS DISTINCT FROM (current_date-90)::text
 OR manifest#>>'{window,end}' IS DISTINCT FROM (current_date+interval '18 months')::date::text
 OR coalesce(manifest->>'format','') NOT IN ('q4','structured-html') OR jsonb_typeof(documents) IS DISTINCT FROM 'array'
 OR jsonb_typeof(entries) IS DISTINCT FROM 'array' OR jsonb_typeof(binding) IS DISTINCT FROM 'object'
 OR origin IS NULL OR app_private.calendar_ir_origin(selected_url) IS DISTINCT FROM origin
 OR jsonb_typeof(binding->'quote') IS DISTINCT FROM 'string' OR length(binding->>'quote') NOT BETWEEN 1 AND 1000
 OR position(replace(origin,'https://','') IN lower(binding->>'quote'))<=0 THEN RAISE EXCEPTION 'invalid_ir_source_binding'; END IF;
 IF jsonb_array_length(documents) NOT BETWEEN 2 AND 12 OR jsonb_array_length(entries)>200
 OR (SELECT count(*)<>count(DISTINCT d->>'url') FROM jsonb_array_elements(documents) d)
 OR (SELECT count(*)<>count(DISTINCT e->>'key') FROM jsonb_array_elements(entries) e) THEN RAISE EXCEPTION 'duplicate_calendar_identity'; END IF;
 IF NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='signalbrief-raw' AND o.name=object_key) THEN RAISE EXCEPTION 'calendar_archive_missing'; END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(documents) d WHERE d->>'role'='submissions' AND d->>'url'=submission_url)<>1 THEN RAISE EXCEPTION 'invalid_ir_source_binding'; END IF;
 FOR document IN SELECT value FROM jsonb_array_elements(documents) LOOP
  IF jsonb_typeof(document) IS DISTINCT FROM 'object' OR coalesce(document->>'raw_sha256','')!~'^[a-f0-9]{64}$'
  OR coalesce(document->>'role','') NOT IN ('submissions','primary','exhibit','ir','events')
  OR document->>'object_key' IS DISTINCT FROM 'calendar/'||source||'/discovery/'||(document->>'raw_sha256')||
   (CASE WHEN document->>'role'='submissions' THEN '.json' ELSE '.html' END)
  OR NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='signalbrief-raw' AND o.name=document->>'object_key') THEN RAISE EXCEPTION 'calendar_archive_missing'; END IF;
  IF document->>'role'='submissions' THEN
   IF document->>'url' IS DISTINCT FROM submission_url THEN RAISE EXCEPTION 'invalid_ir_source_binding'; END IF;
  ELSIF document->>'role' IN ('primary','exhibit') THEN
   IF coalesce(document->>'accession','')!~'^[0-9]{10}-[0-9]{2}-[0-9]{6}$'
   OR coalesce(document->>'filing_date','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
   OR (document->>'filing_date')::date>current_date
   OR coalesce(document->>'url','')!~('^https://www\.sec\.gov/Archives/edgar/data/'||cfg.provider_company_id::bigint::text||'/'||replace(document->>'accession','-','')||'/[A-Za-z0-9_.-]+\.html?$') THEN RAISE EXCEPTION 'invalid_ir_source_binding'; END IF;
   IF document->>'role'='primary' AND document->>'parent_url' IS DISTINCT FROM submission_url THEN RAISE EXCEPTION 'invalid_ir_source_binding'; END IF;
   IF document->>'role'='exhibit' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(documents) d WHERE d->>'role'='primary'
    AND d->>'url'=document->>'parent_url' AND d->>'accession'=document->>'accession') THEN RAISE EXCEPTION 'invalid_ir_source_binding'; END IF;
  ELSE
   IF app_private.calendar_ir_origin(document->>'url') IS DISTINCT FROM origin THEN RAISE EXCEPTION 'invalid_ir_source_binding'; END IF;
   IF document->>'role'='ir' AND (document->>'url' IS DISTINCT FROM binding->>'url' OR document->>'parent_url' IS DISTINCT FROM binding->>'document_url') THEN RAISE EXCEPTION 'invalid_ir_source_binding'; END IF;
   IF document->>'role'='events' AND document->>'parent_url' IS DISTINCT FROM binding->>'url' THEN RAISE EXCEPTION 'invalid_ir_source_binding'; END IF;
  END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(documents) d WHERE d->>'url'=binding->>'document_url' AND (
  d->>'role'='submissions' AND binding->>'location'='submissions.investorWebsite'
  OR d->>'role' IN ('primary','exhibit') AND binding->>'location' IN ('normalized-text/explicit-investor-relations-url','anchor/explicit-investor-relations-url')))
 OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(documents) d WHERE d->>'role'='ir' AND d->>'url'=binding->>'url')
 OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(documents) d WHERE d->>'role' IN ('ir','events') AND d->>'url'=selected_url) THEN RAISE EXCEPTION 'invalid_ir_source_binding'; END IF;
 -- A filed link alone may identify an M&A counterparty. The parser must also
 -- retain an exact title/organization label from every selected IR page that
 -- matches the canonical SEC-submissions name under narrow legal-form rules.
 IF jsonb_array_length(manifest->'issuer_evidence') NOT BETWEEN 1 AND 2
 OR (SELECT count(*)<>count(DISTINCT e->>'source_url') FROM jsonb_array_elements(manifest->'issuer_evidence') e)
 OR (SELECT count(*) FROM jsonb_array_elements(documents) d WHERE d->>'role' IN ('ir','events'))<>jsonb_array_length(manifest->'issuer_evidence')
 THEN RAISE EXCEPTION 'invalid_ir_issuer_identity'; END IF;
 FOR identity_proof IN SELECT value FROM jsonb_array_elements(manifest->'issuer_evidence') LOOP
  IF jsonb_typeof(identity_proof->'label') IS DISTINCT FROM 'string' OR length(identity_proof->>'label') NOT BETWEEN 1 AND 500
  OR app_private.calendar_issuer_name(app_private.calendar_ir_issuer_label(identity_proof->>'label')) IS DISTINCT FROM app_private.calendar_issuer_name(manifest->>'issuer_name')
  OR coalesce(identity_proof->>'location','')!~'^(title\[[0-9]+\]|meta\[[0-9]+\]\.og:(site_name|title)|h1\[[0-9]+\]|jsonld\[[0-9]+\]\.organization\[[0-9]+\])$'
  OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(documents) d WHERE d->>'role' IN ('ir','events')
   AND d->>'url'=identity_proof->>'source_url' AND d->>'raw_sha256'=identity_proof->>'raw_sha256')
  THEN RAISE EXCEPTION 'invalid_ir_issuer_identity'; END IF;
 END LOOP;
 IF manifest->>'format'='q4' THEN
  q4:=manifest->'q4';
  IF q4->>'schema' IS DISTINCT FROM 'signalbrief.calendar.q4.v1' OR q4->>'source_key' IS DISTINCT FROM source
  OR q4->>'source_url' IS DISTINCT FROM selected_url OR q4->>'adapter' IS DISTINCT FROM 'q4-events'
  OR q4->>'company_id' IS DISTINCT FROM co OR q4->>'provider_company_id' IS DISTINCT FROM cfg.provider_company_id
  OR q4->>'provider' IS DISTINCT FROM 'sec' OR q4->>'ticker' IS DISTINCT FROM cfg.ticker OR q4->'complete' IS DISTINCT FROM 'true'::jsonb
  OR q4->>'tag_policy' IS DISTINCT FROM 'official-events' OR q4->'window' IS DISTINCT FROM manifest->'window'
  OR q4->'page_size' IS DISTINCT FROM '100'::jsonb OR jsonb_typeof(q4->'pages') IS DISTINCT FROM 'array'
  OR jsonb_typeof(q4->'entries') IS DISTINCT FROM 'array' OR jsonb_array_length(q4->'pages') NOT BETWEEN 2 AND 10
  OR coalesce(manifest#>>'{q4_manifest,raw_sha256}','')!~'^[a-f0-9]{64}$'
  OR manifest#>>'{q4_manifest,object_key}' IS DISTINCT FROM 'calendar/'||source||'/'||(manifest#>>'{q4_manifest,raw_sha256}')||'.json'
  OR NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='signalbrief-raw' AND o.name=manifest#>>'{q4_manifest,object_key}') THEN RAISE EXCEPTION 'incomplete_calendar_manifest'; END IF;
  FOR page IN SELECT value FROM jsonb_array_elements(q4->'pages') LOOP
   expected_url:=origin||'/feed/Event.svc/GetEventList?LanguageId=1&eventSelection=3&eventDateFilter=3&includeFinancialReports=false&includePresentations=false&includePressReleases=false&sortOperator=1&pageSize=100&pageNumber='||page_index||'&tagList=&includeTags=true&year=-1&excludeSelection=1';
   IF page->'page_number' IS DISTINCT FROM to_jsonb(page_index) OR page->>'url' IS DISTINCT FROM expected_url
   OR coalesce(page->>'raw_sha256','')!~'^[a-f0-9]{64}$' OR page->>'object_key' IS DISTINCT FROM 'calendar/'||source||'/pages/'||(page->>'raw_sha256')||'.json'
   OR jsonb_typeof(page->'count') IS DISTINCT FROM 'number' OR coalesce(page->>'count','')!~'^[0-9]{1,3}$'
   OR NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='signalbrief-raw' AND o.name=page->>'object_key') THEN RAISE EXCEPTION 'invalid_calendar_page'; END IF;
   page_count:=(page->>'count')::integer;
   IF page_count>100 OR (page_index=jsonb_array_length(q4->'pages')-1 AND page_count<>0)
   OR (page_index<jsonb_array_length(q4->'pages')-1 AND page_count=0) OR (short_page AND page_count<>0) THEN RAISE EXCEPTION 'incomplete_calendar_manifest'; END IF;
   rows_seen:=rows_seen+page_count;short_page:=page_count<100;page_index:=page_index+1;
  END LOOP;
  IF rows_seen=0 OR jsonb_array_length(entries)>rows_seen OR jsonb_array_length(entries)<>jsonb_array_length(q4->'entries') THEN RAISE EXCEPTION 'incomplete_calendar_manifest'; END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM app_private.calendar_snapshots s WHERE s.source_key=source
  AND s.provenance->>'schema'='signalbrief.calendar.sec-ir.v1' AND (s.provenance->>'format' IS DISTINCT FROM manifest->>'format'
   OR app_private.calendar_ir_origin(s.provenance->>'event_source_url') IS DISTINCT FROM origin)) THEN RAISE EXCEPTION 'calendar_source_change_requires_review'; END IF;
 SELECT coalesce(string_agg(e->>'quote',E'\n' ORDER BY ord),'Verified official calendar within the display window') INTO evidence
 FROM jsonb_array_elements(entries) WITH ORDINALITY AS items(e,ord);
 INSERT INTO app_private.calendar_snapshots(source_key,raw_sha256,object_key,normalized_text,raw_format,provenance)
 VALUES(source,raw_sha,object_key,evidence,'json',manifest) ON CONFLICT(source_key,raw_sha256) DO NOTHING;
 SELECT id INTO snap FROM app_private.calendar_snapshots s WHERE s.source_key=source AND s.raw_sha256=raw_sha
  AND s.object_key=sb_calendar_ingest_sec_ir.object_key AND s.normalized_text=evidence AND s.raw_format='json' AND s.provenance=manifest;
 IF snap IS NULL THEN RAISE EXCEPTION 'snapshot_conflict'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(entries) LOOP
  IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR jsonb_typeof(item->'key') IS DISTINCT FROM 'string' OR length(item->>'key') NOT BETWEEN 1 AND 200
  OR coalesce(item->>'occurs_on','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  OR jsonb_typeof(item->'title') IS DISTINCT FROM 'string' OR coalesce(length(trim(item->>'title')),0) NOT BETWEEN 1 AND 200
  OR jsonb_typeof(item->'quote') IS DISTINCT FROM 'string' OR coalesce(length(trim(item->>'quote')),0) NOT BETWEEN 1 AND 500
  OR item->>'source_url' IS DISTINCT FROM selected_url OR coalesce(item->>'raw_sha256','')!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'invalid_calendar_entry'; END IF;
  day:=(item->>'occurs_on')::date;IF day NOT BETWEEN current_date-90 AND (current_date+interval '18 months')::date THEN RAISE EXCEPTION 'calendar_date_out_of_range'; END IF;
  IF manifest->>'format'='q4' THEN
   IF coalesce(item->>'location','')!~'^pages\[[0-9]+\]\.GetEventListResult\[[0-9]+\]$'
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(q4->'entries') e WHERE 'q4:'||(e->>'key')=item->>'key'
    AND e->>'occurs_on'=item->>'occurs_on' AND e->>'title'=item->>'title' AND e->>'quote'=item->>'quote'
    AND e->'timezone'=item->'timezone' AND e->>'location'=item->>'location') THEN RAISE EXCEPTION 'invalid_calendar_entry'; END IF;
   page_index:=(regexp_match(item->>'location','^pages\[([0-9]+)\]'))[1]::integer;
   page_count:=(regexp_match(item->>'location','GetEventListResult\[([0-9]+)\]$'))[1]::integer;
   IF page_index>=jsonb_array_length(q4->'pages')-1 OR page_count>=coalesce((q4->'pages'->page_index->>'count')::integer,0)
   OR item->>'raw_sha256' IS DISTINCT FROM q4->'pages'->page_index->>'raw_sha256'
   OR coalesce(item->>'timezone','') NOT IN ('America/New_York','America/Los_Angeles','America/Denver','America/Chicago') THEN RAISE EXCEPTION 'invalid_calendar_entry'; END IF;
  ELSE
   IF item->'timezone' IS DISTINCT FROM 'null'::jsonb OR coalesce(item->>'key','')!~'^(quarter:[0-9]{4}:Q[1-4]|event:/[^[:space:]]+)$'
   OR coalesce(item->>'location','')!~'^(tables\[[0-9]+\]\.rows\[[0-9]+\]\.earnings-date|jsonld\[[0-9]+\]\.events\[[0-9]+\])$'
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(documents) d WHERE d->>'url'=selected_url AND d->>'raw_sha256'=item->>'raw_sha256' AND d->>'role' IN ('ir','events')) THEN RAISE EXCEPTION 'invalid_calendar_entry'; END IF;
  END IF;
  INSERT INTO public.calendar_items(id,company_id,title,occurs_on,origin,quote,created_at,source_snapshot_id,source_key,source_event_key,source_url,source_timezone,source_location,verified_at,calendar_status)
  VALUES(gen_random_uuid()::text,co,item->>'title',day,'official',item->>'quote',now(),snap,source,item->>'key',selected_url,item->>'timezone',item->>'location',now(),'confirmed')
  ON CONFLICT(source_key,company_id,source_event_key) WHERE source_key IS NOT NULL DO UPDATE SET title=EXCLUDED.title,occurs_on=EXCLUDED.occurs_on,quote=EXCLUDED.quote,
   source_snapshot_id=EXCLUDED.source_snapshot_id,source_url=EXCLUDED.source_url,source_timezone=EXCLUDED.source_timezone,source_location=EXCLUDED.source_location,verified_at=now(),calendar_status='confirmed';
  n:=n+1;
 END LOOP;
 -- Missing items on a changed/public HTML page do not prove a cancellation.
 UPDATE app_private.calendar_sources SET last_attempt_at=now(),last_success_at=now(),error_code=NULL WHERE key=source;
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.sb_calendar_ingest_sec_ir(text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sb_calendar_ingest_sec_ir(text,text,text,text) TO service_role;

CREATE FUNCTION app_private.calendar_sec_ir_confirmed(cid text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.calendar_items c
 JOIN app_private.calendar_sources p ON p.key=c.source_key AND p.adapter='sec-ir' AND p.enabled
 JOIN public.companies co ON co.id=c.company_id AND co.id=p.company_id AND co.provider=p.provider
  AND co.provider_company_id=p.provider_company_id AND co.ticker=p.ticker AND co.market=p.market AND NOT co.is_demo
 JOIN app_private.calendar_snapshots s ON s.id=c.source_snapshot_id AND s.source_key=p.key
 WHERE c.id=cid AND c.origin='official' AND c.calendar_status='confirmed' AND c.verified_at IS NOT NULL
 AND s.provenance->>'schema'='signalbrief.calendar.sec-ir.v1' AND s.provenance->>'company_id'=co.id
 AND s.provenance->>'provider'='sec' AND s.provenance->>'provider_company_id'=p.provider_company_id
 AND s.provenance->>'source_key'=p.key AND s.provenance->>'source_url'=p.url
 AND c.source_url=s.provenance->>'event_source_url' AND position(c.quote IN s.normalized_text)>0
 AND app_private.calendar_ir_origin(c.source_url)=app_private.calendar_ir_origin(s.provenance#>>'{binding,url}')
 AND EXISTS(SELECT 1 FROM jsonb_array_elements(s.provenance->'entries') e
  WHERE e->>'key'=c.source_event_key AND e->>'source_url'=c.source_url AND e->>'title'=c.title
   AND e->>'occurs_on'=c.occurs_on::text AND e->>'quote'=c.quote AND e->>'location'=c.source_location
   AND (e->>'timezone') IS NOT DISTINCT FROM c.source_timezone
   AND (s.provenance->>'format'='structured-html' AND EXISTS(SELECT 1 FROM jsonb_array_elements(s.provenance->'documents') d
     WHERE d->>'role' IN ('ir','events') AND d->>'url'=c.source_url AND d->>'raw_sha256'=e->>'raw_sha256')
    OR s.provenance->>'format'='q4' AND EXISTS(SELECT 1 FROM jsonb_array_elements(s.provenance#>'{q4,pages}') page
     WHERE page->>'raw_sha256'=e->>'raw_sha256'))))
$$;
REVOKE ALL ON FUNCTION app_private.calendar_sec_ir_confirmed(text) FROM PUBLIC,anon,authenticated;
DO $$ DECLARE definition text; BEGIN
 definition:=pg_get_functiondef('app_private.sb_calendar_confirmed(text)'::regprocedure);
 IF position('p.adapter<>''dart-ir''' IN definition)=0 OR position('SELECT EXISTS(SELECT 1 FROM public.calendar_items c' IN definition)=0 THEN
  RAISE EXCEPTION 'calendar_visibility_precondition_failed'; END IF;
 definition:=replace(definition,'p.adapter<>''dart-ir''','p.adapter NOT IN (''dart-ir'',''sec-ir'')');
 EXECUTE replace(definition,'SELECT EXISTS(SELECT 1 FROM public.calendar_items c',
  'SELECT app_private.calendar_sec_ir_confirmed(cid) OR EXISTS(SELECT 1 FROM public.calendar_items c');
END $$;

CREATE FUNCTION public.sb_calendar_sec_ir_ready(version text) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF version IS DISTINCT FROM 'sec-ir-v1' THEN RAISE EXCEPTION 'unsupported_calendar_worker'; END IF;
 UPDATE app_private.calendar_worker_control SET sec_ir_ready=true WHERE singleton;
 RETURN app_private.dispatch_calendar_refresh();
END $$;
REVOKE ALL ON FUNCTION public.sb_calendar_sec_ir_ready(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sb_calendar_sec_ir_ready(text) TO service_role;

-- Stage new-company work without dispatching unsupported tasks to the old Edge worker.
DO $$ DECLARE company record; BEGIN
 FOR company IN SELECT id FROM public.companies WHERE NOT is_demo AND provider='sec' LOOP
  PERFORM app_private.calendar_onboard_company(company.id,false);
 END LOOP;
END $$;
