-- Apply with Supabase migration name signalbrief_collector. No plaintext credentials.
CREATE TABLE IF NOT EXISTS app_private.collector_runs(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),token_hash text UNIQUE NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','running','done','error')),
 created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL DEFAULT now()+interval '5 minutes',
 finished_at timestamptz,request_id bigint,summary jsonb
);
REVOKE ALL ON app_private.collector_runs FROM PUBLIC,anon,authenticated;
GRANT ALL ON app_private.collector_runs TO service_role;
CREATE TABLE IF NOT EXISTS public.dart_filings(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id varchar(36) NOT NULL REFERENCES public.companies(id),
 receipt text NOT NULL CHECK(receipt ~ '^[0-9]{14}$'),title text NOT NULL,filing_date date NOT NULL,
 source_url text NOT NULL CHECK(source_url ~ '^https://dart[.]fss[.]or[.]kr/dsaf001/main[.]do[?]rcpNo=[0-9]{14}$'),
 source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[a-f0-9]{64}$'),source_object_key text NOT NULL,
 publication_precision text NOT NULL CHECK(publication_precision='date'),
 publication_timezone text NOT NULL CHECK(publication_timezone='Asia/Seoul'),
 fetched_at timestamptz NOT NULL DEFAULT now(),UNIQUE(company_id,receipt)
);
CREATE INDEX IF NOT EXISTS dart_filings_recent ON public.dart_filings(filing_date DESC);
ALTER TABLE public.dart_filings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dart_filings FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.dart_filings TO authenticated;
GRANT ALL ON public.dart_filings TO service_role;
CREATE POLICY dart_filings_read ON public.dart_filings FOR SELECT TO authenticated USING(
 EXISTS(SELECT 1 FROM public.companies c WHERE c.id=company_id AND c.provider='dart' AND NOT c.is_demo)
);
CREATE OR REPLACE FUNCTION public.sb_us_secrets() RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(jsonb_object_agg(substring(name from 14),decrypted_secret),'{}'::jsonb)
 FROM vault.decrypted_secrets WHERE name IN
 ('signalbrief::OPENAI_API_KEY','signalbrief::FMP_API_KEY','signalbrief::RESEND_API_KEY','signalbrief::GNEWS_API_KEY','signalbrief::SEC_CONTACT_EMAIL','signalbrief::DART_API_KEY')
$$;
CREATE OR REPLACE FUNCTION public.sb_us_reserve(p text,amount numeric DEFAULT 0,smoke boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n int;spent numeric;budget numeric;BEGIN
 IF p NOT IN ('sec','dart','fmp','openai','resend','gnews','fx') OR amount<0 OR amount>0.05 THEN RAISE EXCEPTION 'invalid_reservation';END IF;
 INSERT INTO app_private.us_usage(day,provider,calls,reserved_usd) VALUES(current_date,p,1,amount)
 ON CONFLICT(day,provider) DO UPDATE SET calls=us_usage.calls+1,reserved_usd=us_usage.reserved_usd+amount
 RETURNING calls,reserved_usd INTO n,spent;
 IF n>(CASE p WHEN 'openai' THEN 20 WHEN 'fmp' THEN 100 WHEN 'resend' THEN 50 ELSE 500 END)
 THEN RAISE EXCEPTION 'daily_request_limit' USING ERRCODE='PT429';END IF;
 IF p='openai' THEN
  SELECT (value::text)::numeric INTO budget FROM app_private.us_config WHERE key='ai_daily_budget_usd';
  -- Legacy smoke flag cannot authorize spending beyond the explicitly approved cap.
  IF spent>coalesce(budget,0) OR coalesce(budget,0)<=0 THEN RAISE EXCEPTION 'ai_budget_not_approved' USING ERRCODE='PT429';END IF;
 END IF;
END $$;
CREATE OR REPLACE FUNCTION public.sb_collector_claim(h text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;BEGIN
 UPDATE app_private.collector_runs SET state='running'
 WHERE token_hash=h AND state='pending' AND expires_at>now()
 RETURNING jsonb_build_object('id',id) INTO result;
 RETURN result;
END $$;
CREATE OR REPLACE FUNCTION public.sb_collector_finish(h text,summary jsonb,failed boolean DEFAULT false) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 UPDATE app_private.collector_runs SET state=CASE WHEN failed THEN 'error' ELSE 'done' END,
 finished_at=now(),summary=sb_collector_finish.summary WHERE token_hash=h AND state='running';
END $$;
CREATE OR REPLACE FUNCTION app_private.enqueue_collector() RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE token text;run_id uuid;http_id bigint;BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(20261014,1);
 IF NOT EXISTS(SELECT 1 FROM app_private.us_config WHERE key='scheduled_ingestion_enabled' AND value='true'::jsonb) THEN RETURN NULL;END IF;
 UPDATE app_private.collector_runs SET state='error',finished_at=now(),summary='{"code":"lease_expired"}'
 WHERE state IN ('pending','running') AND expires_at<=now();
 IF EXISTS(SELECT 1 FROM app_private.collector_runs WHERE state IN ('pending','running')) THEN RETURN NULL;END IF;
 token:=encode(extensions.gen_random_bytes(32),'hex');
 INSERT INTO app_private.collector_runs(token_hash)
 VALUES(encode(extensions.digest(token,'sha256'),'hex')) RETURNING id INTO run_id;
 SELECT net.http_post(
  url:='https://xabzzhtdmqsaqdauthbu.supabase.co/functions/v1/signalbrief-collector',
  headers:=jsonb_build_object('Content-Type','application/json','x-signalbrief-task',token),
  body:='{}'::jsonb,timeout_milliseconds:=120000
 ) INTO http_id;
 UPDATE app_private.collector_runs SET request_id=http_id WHERE id=run_id;
 RETURN http_id;
END $$;
REVOKE ALL ON FUNCTION public.sb_us_secrets(),public.sb_us_reserve(text,numeric,boolean),
 public.sb_collector_claim(text),public.sb_collector_finish(text,jsonb,boolean),
 app_private.enqueue_collector() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sb_us_secrets(),public.sb_us_reserve(text,numeric,boolean),
 public.sb_collector_claim(text),public.sb_collector_finish(text,jsonb,boolean) TO service_role;
NOTIFY pgrst,'reload schema';

-- pg_net's queue is internal and must not be exposed through Data API schemas.

CREATE TABLE IF NOT EXISTS app_private.collector_analysis_attempts(
 filing_id uuid PRIMARY KEY REFERENCES public.us_filings(id),
 attempted_at timestamptz NOT NULL DEFAULT now(),status text NOT NULL DEFAULT 'running',code text
);
REVOKE ALL ON app_private.collector_analysis_attempts FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.sb_collector_analysis_pick() RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE selected uuid;BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(20261014,2);
 SELECT f.id INTO selected FROM public.us_filings f
 WHERE f.filing_date>=current_date-90
 AND NOT EXISTS(SELECT 1 FROM public.us_analyses a WHERE a.filing_id=f.id)
 AND NOT EXISTS(SELECT 1 FROM app_private.collector_analysis_attempts t WHERE t.filing_id=f.id)
 ORDER BY f.filing_date DESC,f.id LIMIT 1;
 IF selected IS NOT NULL THEN INSERT INTO app_private.collector_analysis_attempts(filing_id) VALUES(selected);END IF;
 RETURN selected;
END $$;
CREATE OR REPLACE FUNCTION public.sb_collector_analysis_finish(fid uuid,result_status text,result_code text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 UPDATE app_private.collector_analysis_attempts SET status=result_status,code=result_code WHERE filing_id=fid;
END $$;
REVOKE ALL ON FUNCTION public.sb_collector_analysis_pick(),public.sb_collector_analysis_finish(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sb_collector_analysis_pick(),public.sb_collector_analysis_finish(uuid,text,text) TO service_role;
NOTIFY pgrst,'reload schema';
