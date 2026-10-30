-- Official IR dates are independently verifiable; they do not require an AI event.
CREATE TABLE app_private.calendar_sources (
 key text PRIMARY KEY, ticker text NOT NULL, market text NOT NULL, url text NOT NULL,
 adapter text NOT NULL, enabled boolean NOT NULL DEFAULT true,
 last_attempt_at timestamptz, last_success_at timestamptz, error_code text
);
INSERT INTO app_private.calendar_sources(key,ticker,market,url,adapter) VALUES
 ('microsoft-ir','MSFT','NASDAQ','https://www.microsoft.com/en-us/investor/default','microsoft'),
 ('samsung-ir','005930','KOSPI','https://www.samsung.com/global/ir/ir-events-presentations/events/','samsung');
CREATE TABLE app_private.calendar_snapshots (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_key text NOT NULL REFERENCES app_private.calendar_sources(key),
 raw_sha256 text NOT NULL CHECK(raw_sha256 ~ '^[a-f0-9]{64}$'), object_key text NOT NULL,
 normalized_text text NOT NULL, fetched_at timestamptz NOT NULL DEFAULT now(), UNIQUE(source_key,raw_sha256)
);
CREATE TABLE app_private.calendar_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), token_hash text UNIQUE NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL DEFAULT now()+interval '5 minutes',
 claimed_at timestamptz, finished_at timestamptz, summary jsonb, request_id bigint
);
ALTER TABLE app_private.calendar_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.calendar_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.calendar_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.calendar_sources,app_private.calendar_snapshots,app_private.calendar_runs FROM PUBLIC,anon,authenticated;
ALTER TABLE public.calendar_items
 ADD COLUMN source_snapshot_id uuid REFERENCES app_private.calendar_snapshots(id) ON DELETE RESTRICT,
 ADD COLUMN source_key text REFERENCES app_private.calendar_sources(key),
 ADD COLUMN source_event_key text,
 ADD COLUMN source_url text,
 ADD COLUMN source_timezone text,
 ADD COLUMN source_location text,
 ADD COLUMN verified_at timestamptz,
 ADD COLUMN calendar_status text NOT NULL DEFAULT 'confirmed' CHECK(calendar_status IN ('confirmed','withdrawn'));
-- Locate the existing unnamed origin check without assuming its generated name.
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='public.calendar_items'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%chunk_id%event_id%'
 LOOP EXECUTE format('ALTER TABLE public.calendar_items DROP CONSTRAINT %I',c.conname); END LOOP;
END $$;
ALTER TABLE public.calendar_items ADD CONSTRAINT calendar_origin_evidence CHECK (
 (origin='user' AND user_id IS NOT NULL AND source_snapshot_id IS NULL AND source_key IS NULL)
 OR (origin='official' AND user_id IS NULL AND (
  (chunk_id IS NOT NULL AND event_id IS NOT NULL AND source_snapshot_id IS NULL)
  OR (source_snapshot_id IS NOT NULL AND source_key IS NOT NULL AND source_event_key IS NOT NULL
      AND company_id IS NOT NULL AND source_url IS NOT NULL AND verified_at IS NOT NULL AND length(trim(quote))>0)
 ))
);
CREATE UNIQUE INDEX calendar_official_source_identity ON public.calendar_items(source_key,company_id,source_event_key) WHERE source_key IS NOT NULL;
CREATE INDEX calendar_items_date_company ON public.calendar_items(occurs_on,company_id);
CREATE INDEX calendar_items_snapshot ON public.calendar_items(source_snapshot_id) WHERE source_snapshot_id IS NOT NULL;

CREATE FUNCTION app_private.sb_calendar_confirmed(cid text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.calendar_items c
 JOIN app_private.calendar_snapshots s ON s.id=c.source_snapshot_id AND s.source_key=c.source_key
 JOIN app_private.calendar_sources p ON p.key=s.source_key AND p.url=c.source_url
 JOIN public.companies co ON co.id=c.company_id AND co.ticker=p.ticker AND co.market=p.market AND NOT co.is_demo
 WHERE c.id=cid AND c.origin='official' AND c.calendar_status='confirmed' AND p.enabled
 AND position(c.quote IN s.normalized_text)>0 AND c.verified_at IS NOT NULL)
$$;
REVOKE ALL ON FUNCTION app_private.sb_calendar_confirmed(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION app_private.sb_calendar_confirmed(text) TO authenticated;
CREATE POLICY official_ir_read ON public.calendar_items FOR SELECT TO authenticated USING(app_private.sb_calendar_confirmed(id));

CREATE FUNCTION public.sb_calendar_sources() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('key',key,'ticker',ticker,'market',market,'url',url,'adapter',adapter) ORDER BY key),'[]'::jsonb) FROM app_private.calendar_sources WHERE enabled
$$;
CREATE FUNCTION public.sb_calendar_claim(h text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 UPDATE app_private.calendar_runs SET claimed_at=now() WHERE token_hash=h AND claimed_at IS NULL AND expires_at>now(); RETURN FOUND;
END $$;
CREATE FUNCTION public.sb_calendar_finish(h text,summary jsonb) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 UPDATE app_private.calendar_runs SET summary=$2,finished_at=now() WHERE token_hash=h AND claimed_at IS NOT NULL AND finished_at IS NULL
$$;
CREATE FUNCTION public.sb_calendar_source_error(source text,code text) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 UPDATE app_private.calendar_sources SET last_attempt_at=now(),error_code=left(code,100) WHERE key=source
$$;
CREATE FUNCTION public.sb_calendar_ingest(source text,raw_sha text,object_key text,normalized_text text,entries jsonb) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cfg app_private.calendar_sources; co text; snap uuid; item jsonb; n integer:=0; day date;
BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(hashtextextended('calendar:'||source,0));
 SELECT * INTO cfg FROM app_private.calendar_sources WHERE key=source AND enabled;
 IF cfg.key IS NULL OR raw_sha IS NULL OR object_key IS NULL OR normalized_text IS NULL OR entries IS NULL
 OR raw_sha !~ '^[a-f0-9]{64}$' OR object_key<>('calendar/'||source||'/'||raw_sha||'.html')
 OR length(normalized_text) NOT BETWEEN 1 AND 2000000 OR jsonb_typeof(entries)<>'array' OR jsonb_array_length(entries)>200 THEN
  RAISE EXCEPTION 'invalid_calendar_payload'; END IF;
 IF (SELECT count(*)<>count(DISTINCT x->>'key') FROM jsonb_array_elements(entries) x) THEN RAISE EXCEPTION 'duplicate_calendar_identity'; END IF;
 SELECT id INTO STRICT co FROM public.companies WHERE ticker=cfg.ticker AND market=cfg.market AND NOT is_demo;
 INSERT INTO app_private.calendar_snapshots(source_key,raw_sha256,object_key,normalized_text) VALUES(source,raw_sha,object_key,normalized_text)
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
  INSERT INTO public.calendar_items(id,company_id,title,occurs_on,origin,quote,created_at,source_snapshot_id,source_key,source_event_key,source_url,source_timezone,source_location,verified_at,calendar_status)
  VALUES(gen_random_uuid()::text,co,item->>'title',day,'official',item->>'quote',now(),snap,source,item->>'key',cfg.url,item->>'timezone',item->>'location',now(),'confirmed')
  ON CONFLICT(source_key,company_id,source_event_key) WHERE source_key IS NOT NULL DO UPDATE SET title=EXCLUDED.title,occurs_on=EXCLUDED.occurs_on,quote=EXCLUDED.quote,
   source_snapshot_id=EXCLUDED.source_snapshot_id,source_url=EXCLUDED.source_url,source_timezone=EXCLUDED.source_timezone,source_location=EXCLUDED.source_location,verified_at=now(),calendar_status='confirmed';
  n:=n+1;
 END LOOP;
 -- A successfully parsed complete schedule supersedes disappeared future dates.
 UPDATE public.calendar_items c SET calendar_status='withdrawn' WHERE c.source_key=source AND c.occurs_on>=current_date
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(entries) x WHERE x->>'key'=c.source_event_key);
 UPDATE app_private.calendar_sources SET last_attempt_at=now(),last_success_at=now(),error_code=NULL WHERE key=source;
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.sb_calendar_sources(),public.sb_calendar_claim(text),public.sb_calendar_finish(text,jsonb),public.sb_calendar_source_error(text,text),public.sb_calendar_ingest(text,text,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sb_calendar_sources(),public.sb_calendar_claim(text),public.sb_calendar_finish(text,jsonb),public.sb_calendar_source_error(text,text),public.sb_calendar_ingest(text,text,text,text,jsonb) TO service_role;

CREATE FUNCTION app_private.enqueue_calendar() RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE token text; rid bigint; runid uuid; BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(20261019,7);
 IF EXISTS(SELECT 1 FROM app_private.calendar_runs WHERE finished_at IS NULL AND expires_at>now()) THEN RETURN NULL; END IF;
 DELETE FROM app_private.calendar_runs WHERE created_at<now()-interval '30 days';
 token:=encode(extensions.gen_random_bytes(32),'hex');
 INSERT INTO app_private.calendar_runs(token_hash) VALUES(encode(extensions.digest(token,'sha256'),'hex')) RETURNING id INTO runid;
 SELECT net.http_post(url:='https://xabzzhtdmqsaqdauthbu.supabase.co/functions/v1/signalbrief-calendar',headers:=jsonb_build_object('Content-Type','application/json','x-signalbrief-task',token),body:='{}'::jsonb,timeout_milliseconds:=120000) INTO rid;
 UPDATE app_private.calendar_runs SET request_id=rid WHERE id=runid; RETURN rid;
END $$;
REVOKE ALL ON FUNCTION app_private.enqueue_calendar() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.sb_calendar_subscription_feed(token text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE u text; r jsonb; BEGIN
 IF token IS NULL OR token !~ '^[a-f0-9]{64}$' THEN RETURN NULL; END IF;
 SELECT s.user_id INTO u FROM app_private.calendar_subscriptions s WHERE s.token_hash=encode(sha256(convert_to(token,'UTF8')),'hex') AND s.expires_at>now();
 IF u IS NULL THEN RETURN NULL; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.occurs_on,x.id),'[]'::jsonb) INTO r FROM (
  SELECT c.id,c.title,c.occurs_on,c.origin FROM public.calendar_items c WHERE c.calendar_status='confirmed' AND (
   (c.user_id=u AND c.origin='user') OR (c.origin='official' AND
   (app_private.sb_event_visible(c.event_id) OR app_private.sb_calendar_confirmed(c.id)) AND (
    EXISTS(SELECT 1 FROM public.watchlist_items i JOIN public.watchlists w ON w.id=i.watchlist_id WHERE w.user_id=u AND i.company_id=c.company_id)
    OR EXISTS(SELECT 1 FROM public.positions p JOIN public.portfolios f ON f.id=p.portfolio_id WHERE f.user_id=u AND p.company_id=c.company_id))))
  ORDER BY c.occurs_on,c.id LIMIT 500
 ) x; RETURN r;
END $$;
-- Activated only after the Edge Function has been deployed and verified.
