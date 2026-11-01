-- Reviewed source configuration is private. Company activation supplies an identity,
-- never a provider URL. Existing operator-disabled source rows stay disabled.
CREATE TABLE app_private.calendar_source_catalog (
 key text PRIMARY KEY, provider text NOT NULL CHECK(provider IN ('sec','dart')),
 provider_company_id text NOT NULL, ticker text NOT NULL, url text NOT NULL,
 adapter text NOT NULL, feed_url text, UNIQUE(provider,provider_company_id,key)
);
INSERT INTO app_private.calendar_source_catalog VALUES
 ('microsoft-ir','sec','0000789019','MSFT','https://www.microsoft.com/en-us/investor/default','microsoft',NULL),
 ('samsung-ir','dart','00126380','005930','https://www.samsung.com/global/ir/ir-events-presentations/events/','samsung',NULL),
 ('micron-ir','sec','0000723125','MU','https://investors.micron.com/events-and-presentations/','micron-q4','https://investors.micron.com/feed/Event.svc/GetEventList'),
 ('nvidia-ir','sec','0001045810','NVDA','https://investor.nvidia.com/events-and-presentations/events-and-presentations/default.aspx','q4-events','https://investor.nvidia.com/feed/Event.svc/GetEventList');
ALTER TABLE app_private.calendar_sources
 ADD COLUMN company_id text REFERENCES public.companies(id) ON DELETE RESTRICT,
 ADD COLUMN provider text,
 ADD COLUMN provider_company_id text,
 ADD COLUMN feed_url text;
CREATE INDEX calendar_sources_company ON app_private.calendar_sources(company_id);
ALTER TABLE app_private.calendar_runs ADD COLUMN source_key text REFERENCES app_private.calendar_sources(key) ON DELETE RESTRICT;
CREATE INDEX calendar_runs_source ON app_private.calendar_runs(source_key);
CREATE TABLE app_private.calendar_refresh_queue (
 source_key text PRIMARY KEY REFERENCES app_private.calendar_sources(key) ON DELETE CASCADE,
 state text NOT NULL CHECK(state IN ('pending','running','idle','failed')),
 requested_at timestamptz NOT NULL DEFAULT now(), next_attempt_at timestamptz NOT NULL DEFAULT now(),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
 run_id uuid REFERENCES app_private.calendar_runs(id) ON DELETE SET NULL,
 lease_until timestamptz, finished_at timestamptz, rerun_requested boolean NOT NULL DEFAULT false
);
CREATE INDEX calendar_refresh_due ON app_private.calendar_refresh_queue(next_attempt_at) WHERE state='pending';
CREATE INDEX calendar_refresh_run ON app_private.calendar_refresh_queue(run_id);
CREATE TABLE app_private.calendar_worker_control (singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),ready boolean NOT NULL DEFAULT false);
INSERT INTO app_private.calendar_worker_control(singleton,ready) VALUES(true,false);
ALTER TABLE app_private.calendar_source_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.calendar_refresh_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.calendar_worker_control ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.calendar_source_catalog,app_private.calendar_refresh_queue,app_private.calendar_worker_control FROM PUBLIC,anon,authenticated;

CREATE FUNCTION app_private.calendar_onboard_company(cid text,dispatch boolean DEFAULT true) RETURNS jsonb
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
REVOKE ALL ON FUNCTION app_private.calendar_onboard_company(text,boolean) FROM PUBLIC,anon,authenticated;

-- At most two one-source workers run concurrently. A global legacy task can delay
-- dispatch but cannot erase pending work; the minute rescue also reclaims expired leases.
CREATE FUNCTION app_private.dispatch_calendar_refresh() RETURNS integer
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

CREATE OR REPLACE FUNCTION public.sb_calendar_sources() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('key',s.key,'ticker',s.ticker,'market',s.market,'url',s.url,'adapter',s.adapter,
  'company_id',s.company_id,'provider',s.provider,'provider_company_id',s.provider_company_id,'feed_url',s.feed_url) ORDER BY s.key),'[]'::jsonb)
 FROM app_private.calendar_sources s JOIN public.companies c ON c.id=s.company_id AND c.provider=s.provider
 AND c.provider_company_id=s.provider_company_id AND c.ticker=s.ticker AND c.market=s.market AND NOT c.is_demo WHERE s.enabled
$$;

CREATE OR REPLACE FUNCTION app_content_private.calendar_coverage(selected_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid:=(SELECT auth.uid()); result jsonb; BEGIN
 IF u IS NULL OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=u) THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='PT401'; END IF;
 PERFORM public.sb_require_mfa();PERFORM public.sb_rate_limit();
 IF selected_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.companies WHERE id=selected_id AND NOT is_demo) THEN
  RAISE EXCEPTION 'company_not_found' USING ERRCODE='PT404'; END IF;
 WITH coverage AS (
  SELECT c.id,count(s.key) source_count,max(s.last_success_at) last_success_at,max(s.last_attempt_at) last_attempt_at,
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

CREATE OR REPLACE FUNCTION app_private.sb_calendar_confirmed(cid text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.calendar_items c
 JOIN app_private.calendar_snapshots s ON s.id=c.source_snapshot_id AND s.source_key=c.source_key
 JOIN app_private.calendar_sources p ON p.key=s.source_key
 JOIN public.companies co ON co.id=c.company_id AND co.id=p.company_id AND co.provider=p.provider
  AND co.provider_company_id=p.provider_company_id AND co.ticker=p.ticker AND co.market=p.market AND NOT co.is_demo
 WHERE c.id=cid AND c.origin='official' AND c.calendar_status='confirmed' AND p.enabled
 AND position(c.quote IN s.normalized_text)>0 AND c.verified_at IS NOT NULL
 AND ((p.adapter<>'dart-ir' AND c.source_url=p.url) OR (p.adapter='dart-ir' AND s.provenance->>'schema'='signalbrief.calendar.dart-ir.v1'
  AND s.provenance->>'provider_company_id'=p.provider_company_id AND s.provenance->>'company_id'=co.id
  AND EXISTS(SELECT 1 FROM jsonb_array_elements(s.provenance->'entries') e WHERE e->>'key'=c.source_event_key
   AND e->>'source_url'=c.source_url AND e->>'quote'=c.quote AND e->>'occurs_on'=c.occurs_on::text
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(s.provenance->'documents') d WHERE d->>'receipt_no'=e->>'key'
    AND d->>'main_url'=e->>'source_url' AND d->>'body_sha256'=e->>'body_sha256')))))
$$;

-- HTML ingestion also requires the exact issuer identity once sources have been bound.
DO $$ DECLARE definition text; BEGIN
 definition:=pg_get_functiondef('public.sb_calendar_ingest(text,text,text,text,jsonb)'::regprocedure);
 IF position('WHERE ticker=cfg.ticker AND market=cfg.market AND NOT is_demo' IN definition)=0 THEN RAISE EXCEPTION 'calendar_identity_precondition_failed'; END IF;
 definition:=replace(definition,'WHERE ticker=cfg.ticker AND market=cfg.market AND NOT is_demo',
  'WHERE id=cfg.company_id AND provider=cfg.provider AND provider_company_id=cfg.provider_company_id AND ticker=cfg.ticker AND market=cfg.market AND NOT is_demo');
 IF position('IF cfg.key IS NULL OR' IN definition)=0 THEN RAISE EXCEPTION 'calendar_adapter_precondition_failed'; END IF;
 EXECUTE replace(definition,'IF cfg.key IS NULL OR',
  'IF cfg.key IS NULL OR cfg.adapter NOT IN (''microsoft'',''samsung'') OR NOT EXISTS(SELECT 1 FROM app_private.calendar_source_catalog c WHERE c.key=source AND c.provider=cfg.provider AND c.provider_company_id=cfg.provider_company_id AND c.ticker=cfg.ticker AND c.url=cfg.url AND c.adapter=cfg.adapter) OR');
END $$;
REVOKE ALL ON FUNCTION app_private.dispatch_calendar_refresh() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.sb_calendar_worker_ready(version text) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF version IS DISTINCT FROM 'calendar-onboarding-v1' THEN RAISE EXCEPTION 'unsupported_calendar_worker'; END IF;
 UPDATE app_private.calendar_worker_control SET ready=true WHERE singleton;
 RETURN app_private.dispatch_calendar_refresh();
END $$;
CREATE FUNCTION public.sb_calendar_request_company(company_id text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT app_private.calendar_onboard_company(company_id,true)
$$;
CREATE FUNCTION public.sb_calendar_task_sources(h text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE task app_private.calendar_runs; result jsonb; BEGIN
 SELECT * INTO task FROM app_private.calendar_runs WHERE token_hash=h AND claimed_at IS NOT NULL AND finished_at IS NULL AND expires_at>now();
 IF task.id IS NULL THEN RAISE EXCEPTION 'invalid_calendar_task'; END IF;
 -- An already-running unscoped task only hands off to the durable source queue.
 IF task.source_key IS NULL THEN RETURN '[]'::jsonb; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('key',s.key,'ticker',s.ticker,'market',s.market,'url',s.url,'adapter',s.adapter,
  'company_id',s.company_id,'provider',s.provider,'provider_company_id',s.provider_company_id,'feed_url',s.feed_url)),'[]'::jsonb)
 INTO result FROM app_private.calendar_sources s JOIN public.companies c ON c.id=s.company_id AND c.provider=s.provider AND c.provider_company_id=s.provider_company_id AND c.ticker=s.ticker AND c.market=s.market AND NOT c.is_demo
 WHERE s.key=task.source_key AND s.enabled;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.sb_calendar_worker_ready(text),public.sb_calendar_request_company(text),public.sb_calendar_task_sources(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sb_calendar_worker_ready(text),public.sb_calendar_request_company(text),public.sb_calendar_task_sources(text) TO service_role;

CREATE OR REPLACE FUNCTION public.sb_calendar_finish(h text,summary jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE task app_private.calendar_runs; ok boolean; BEGIN
 UPDATE app_private.calendar_runs SET summary=$2,finished_at=now() WHERE token_hash=h AND claimed_at IS NOT NULL AND finished_at IS NULL RETURNING * INTO task;
 IF task.id IS NULL THEN RETURN; END IF;
 IF task.source_key IS NOT NULL THEN
  ok:=EXISTS(SELECT 1 FROM jsonb_array_elements(summary) x WHERE x->>'source'=task.source_key AND x->>'status'='verified');
  UPDATE app_private.calendar_refresh_queue SET state=CASE WHEN rerun_requested THEN 'pending' WHEN ok THEN 'idle' WHEN attempts>=3 THEN 'failed' ELSE 'pending' END,
   next_attempt_at=CASE WHEN rerun_requested THEN now() ELSE now()+make_interval(secs=>15*power(2,attempts)::integer) END,
   attempts=CASE WHEN rerun_requested THEN 0 ELSE attempts END,rerun_requested=false,
   lease_until=NULL,finished_at=now(),run_id=NULL WHERE run_id=task.id;
 END IF;
 PERFORM app_private.dispatch_calendar_refresh();
END $$;
CREATE OR REPLACE FUNCTION app_private.enqueue_calendar() RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE company record; BEGIN
 FOR company IN SELECT id FROM public.companies WHERE NOT is_demo AND provider IN ('sec','dart') LOOP
  PERFORM app_private.calendar_onboard_company(company.id,false);
 END LOOP;
 RETURN app_private.dispatch_calendar_refresh();
END $$;
CREATE FUNCTION app_private.calendar_company_inserted() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT NEW.is_demo AND NEW.provider IN ('sec','dart') AND (TG_OP='INSERT' OR
  (NEW.market,NEW.ticker,NEW.provider,NEW.provider_company_id,NEW.is_demo) IS DISTINCT FROM
  (OLD.market,OLD.ticker,OLD.provider,OLD.provider_company_id,OLD.is_demo)) THEN
  PERFORM app_private.calendar_onboard_company(NEW.id,true);
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_private.calendar_company_inserted() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER calendar_company_onboarding AFTER INSERT OR UPDATE OF market,ticker,provider,provider_company_id,is_demo ON public.companies
 FOR EACH ROW EXECUTE FUNCTION app_private.calendar_company_inserted();

-- Backfill existing canonical issuers but keep all outbound work disabled until the
-- new Edge worker is deployed and the service-only readiness RPC is explicitly called.
DO $$ DECLARE company record; BEGIN
 FOR company IN SELECT id FROM public.companies WHERE NOT is_demo AND provider IN ('sec','dart') LOOP
  PERFORM app_private.calendar_onboard_company(company.id,false);
 END LOOP;
 IF to_regprocedure('cron.schedule(text,text,text)') IS NOT NULL THEN
  PERFORM cron.schedule('signalbrief-calendar-queue','* * * * *','select app_private.dispatch_calendar_refresh();');
 END IF;
END $$;

-- The same archived Q4 contract now serves reviewed canonical issuers.
CREATE OR REPLACE FUNCTION public.sb_calendar_ingest_q4(source text,raw_sha text,object_key text,manifest_text text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cfg app_private.calendar_sources; co text; snap uuid; manifest jsonb; pages jsonb; entries jsonb;
 page jsonb; item jsonb; page_index integer:=0; page_count integer; total_rows integer:=0; n integer:=0;
 day date; evidence text; expected_url text; short_page boolean:=false;
BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(hashtextextended('calendar:'||source,0));
 SELECT * INTO cfg FROM app_private.calendar_sources WHERE key=source AND enabled;
 IF cfg.key IS NULL OR cfg.adapter NOT IN ('micron-q4','q4-events')
 OR NOT EXISTS(SELECT 1 FROM app_private.calendar_source_catalog c WHERE c.key=source AND c.provider=cfg.provider
  AND c.provider_company_id=cfg.provider_company_id AND c.ticker=cfg.ticker AND c.url=cfg.url AND c.adapter=cfg.adapter AND c.feed_url=cfg.feed_url)
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
 OR manifest->>'company_id' IS DISTINCT FROM cfg.company_id OR manifest->>'provider' IS DISTINCT FROM cfg.provider
 OR manifest->>'provider_company_id' IS DISTINCT FROM cfg.provider_company_id OR manifest->>'ticker' IS DISTINCT FROM cfg.ticker
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
  expected_url:=cfg.feed_url||'?LanguageId=1&eventSelection=3&eventDateFilter=3&includeFinancialReports=false&includePresentations=false&includePressReleases=false&sortOperator=1&pageSize=100&pageNumber='||page_index||'&tagList=&includeTags=true&year=-1&excludeSelection=1';
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
 SELECT id INTO STRICT co FROM public.companies WHERE id=cfg.company_id AND provider=cfg.provider AND provider_company_id=cfg.provider_company_id
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
  OR coalesce(item->>'timezone','') NOT IN ('America/New_York','America/Los_Angeles','America/Denver','America/Chicago')
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

-- A complete DART scan covers receipt dates, not the entire future event catalog.
-- Its absence therefore never withdraws an earlier verified announcement.
CREATE FUNCTION public.sb_calendar_ingest_dart_ir(source text,raw_sha text,object_key text,manifest_text text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cfg app_private.calendar_sources; co text; snap uuid; manifest jsonb; pages jsonb; documents jsonb; entries jsonb;
 page jsonb; item jsonb; document jsonb; page_index integer:=1; page_count integer; total_rows integer; total_pages integer;
 rows_seen integer:=0; n integer:=0; day date; receipt_day date; evidence text; expected_url text;
 today date:=(current_timestamp AT TIME ZONE 'Asia/Seoul')::date;
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
 IF jsonb_typeof(manifest) IS DISTINCT FROM 'object'
 OR manifest->>'schema' IS DISTINCT FROM 'signalbrief.calendar.dart-ir.v1' OR manifest->>'adapter' IS DISTINCT FROM cfg.adapter
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
 IF jsonb_array_length(pages) NOT BETWEEN 1 AND 5 OR jsonb_array_length(documents)>20
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
 IF rows_seen<>total_rows OR jsonb_array_length(documents)>total_rows THEN RAISE EXCEPTION 'incomplete_calendar_manifest'; END IF;
 IF (SELECT count(*)<>count(DISTINCT x->>'receipt_no') FROM jsonb_array_elements(documents) x)
 OR (SELECT count(*)<>count(DISTINCT x->>'key') FROM jsonb_array_elements(entries) x) THEN RAISE EXCEPTION 'duplicate_calendar_identity'; END IF;
 FOR document IN SELECT value FROM jsonb_array_elements(documents) LOOP
  IF jsonb_typeof(document) IS DISTINCT FROM 'object' OR coalesce(document->>'receipt_no','')!~'^[0-9]{14}$'
  OR document->>'main_url' IS DISTINCT FROM ('https://dart.fss.or.kr/dsaf001/main.do?rcpNo='||(document->>'receipt_no'))
  OR coalesce(document->>'main_sha256','')!~'^[a-f0-9]{64}$' OR coalesce(document->>'body_sha256','')!~'^[a-f0-9]{64}$'
  OR document->>'main_object_key' IS DISTINCT FROM ('calendar/'||source||'/documents/'||(document->>'main_sha256')||'.html')
  OR document->>'body_object_key' IS DISTINCT FROM ('calendar/'||source||'/documents/'||(document->>'body_sha256')||'.html')
  OR coalesce(document->>'body_url','')!~('^https://dart\.fss\.or\.kr/report/viewer\.do\?rcpNo='||(document->>'receipt_no')||'&dcmNo=[1-9][0-9]{0,11}&eleId=0&offset=0&length=0&dtd=HTML$') THEN
   RAISE EXCEPTION 'invalid_calendar_document'; END IF;
  receipt_day:=(substr(document->>'receipt_no',1,4)||'-'||substr(document->>'receipt_no',5,2)||'-'||substr(document->>'receipt_no',7,2))::date;
  IF receipt_day NOT BETWEEN today-90 AND today THEN RAISE EXCEPTION 'receipt_date_out_of_range'; END IF;
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
  OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(documents) d WHERE d->>'receipt_no'=item->>'key'
    AND d->>'main_url'=item->>'source_url' AND d->>'body_sha256'=item->>'body_sha256') THEN RAISE EXCEPTION 'invalid_calendar_entry'; END IF;
  day:=(item->>'occurs_on')::date;
  IF day NOT BETWEEN today-90 AND (today+interval '18 months')::date THEN RAISE EXCEPTION 'calendar_date_out_of_range'; END IF;
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
