-- US-first provider integration. No credentials are embedded in migration text.
CREATE TABLE IF NOT EXISTS app_private.us_config (key text PRIMARY KEY, value jsonb NOT NULL);
INSERT INTO app_private.us_config VALUES
 ('fmp_display_enabled','false'),('gnews_display_enabled','false'),('ai_daily_budget_usd','0'),('scheduled_ingestion_enabled','false') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS app_private.us_tasks (
 token_hash text PRIMARY KEY CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 operation text NOT NULL CHECK(operation IN ('keygen','import','smoke','ingest','analyze')),
 payload jsonb NOT NULL DEFAULT '{}', state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','running','done','error')),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '15 minutes', result jsonb, public_key jsonb,
 created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS app_private.us_cache (key text PRIMARY KEY, value jsonb NOT NULL, expires_at timestamptz NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.us_provider_checks(provider text PRIMARY KEY,status text NOT NULL,detail jsonb NOT NULL DEFAULT '{}',checked_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.us_filings(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id varchar(36) NOT NULL REFERENCES public.companies(id),
 accession text NOT NULL CHECK(accession ~ '^\d{10}-\d{2}-\d{6}$'),form text NOT NULL,filing_date date NOT NULL,report_date date,
 document_url text NOT NULL CHECK(document_url ~ '^https://www[.]sec[.]gov/Archives/edgar/data/'),
 source_url text NOT NULL CHECK(source_url ~ '^https://data[.]sec[.]gov/submissions/CIK[0-9]{10}[.]json$'),
 source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[a-f0-9]{64}$'), fetched_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,accession));
CREATE TABLE IF NOT EXISTS public.us_analyses(
 filing_id uuid PRIMARY KEY REFERENCES public.us_filings(id),status text NOT NULL CHECK(status IN ('needs_review','approved','rejected')),
 model text NOT NULL, source_sha256 text NOT NULL, result jsonb NOT NULL, input_tokens int, output_tokens int,
 created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS app_private.us_usage(day date NOT NULL,provider text NOT NULL,calls int NOT NULL DEFAULT 0,reserved_usd numeric NOT NULL DEFAULT 0,PRIMARY KEY(day,provider));
ALTER TABLE public.us_provider_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.us_filings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.us_analyses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.us_provider_checks,public.us_filings,public.us_analyses FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.us_provider_checks,public.us_filings,public.us_analyses TO authenticated;
GRANT ALL ON public.us_provider_checks,public.us_filings,public.us_analyses TO service_role;
CREATE POLICY us_checks_read ON public.us_provider_checks FOR SELECT TO authenticated USING(true);
CREATE POLICY us_filings_read ON public.us_filings FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.companies c WHERE c.id=company_id AND c.provider='sec' AND NOT c.is_demo));
CREATE POLICY us_analysis_read ON public.us_analyses FOR SELECT TO authenticated USING(status='approved' OR app_private.sb_is_admin());
REVOKE ALL ON ALL TABLES IN SCHEMA app_private FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.sb_us_secrets() RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(jsonb_object_agg(substring(name from 14),decrypted_secret),'{}'::jsonb) FROM vault.decrypted_secrets
 WHERE name IN ('signalbrief::OPENAI_API_KEY','signalbrief::FMP_API_KEY','signalbrief::RESEND_API_KEY','signalbrief::GNEWS_API_KEY','signalbrief::SEC_CONTACT_EMAIL')
$$;
CREATE OR REPLACE FUNCTION public.sb_us_vault_put(k text,v text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i uuid;BEGIN
 IF k NOT IN ('OPENAI_API_KEY','FMP_API_KEY','RESEND_API_KEY','GNEWS_API_KEY','SEC_CONTACT_EMAIL') AND k !~ '^bootstrap:[a-f0-9]{64}$' THEN RAISE EXCEPTION 'invalid_secret_name';END IF;
 IF v IS NULL OR octet_length(v)>10000 THEN RAISE EXCEPTION 'invalid_secret';END IF;
 SELECT id INTO i FROM vault.secrets WHERE name='signalbrief::'||k;
 IF i IS NULL THEN PERFORM vault.create_secret(v,'signalbrief::'||k);ELSE PERFORM vault.update_secret(i,v);END IF;
END $$;
CREATE OR REPLACE FUNCTION public.sb_us_config() RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$ SELECT coalesce(jsonb_object_agg(key,value),'{}'::jsonb) FROM app_private.us_config $$;
CREATE OR REPLACE FUNCTION public.sb_us_cache(k text,v jsonb DEFAULT NULL,ttl int DEFAULT 900) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF v IS NOT NULL THEN INSERT INTO app_private.us_cache VALUES(k,v,now()+make_interval(secs=>least(greatest(ttl,1),86400)),now()) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,expires_at=EXCLUDED.expires_at,updated_at=now(); END IF;
 RETURN (SELECT value FROM app_private.us_cache WHERE key=k AND expires_at>now());
END $$;
CREATE OR REPLACE FUNCTION public.sb_us_task_take(h text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE t app_private.us_tasks%rowtype;r jsonb;BEGIN
 UPDATE app_private.us_tasks SET state='running' WHERE token_hash=h AND state='pending' AND expires_at>now() RETURNING * INTO t;
 IF NOT FOUND THEN RETURN NULL;END IF;r:=to_jsonb(t);
 IF t.operation='import' THEN r:=r||jsonb_build_object('private_key',(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='signalbrief::bootstrap:'||(t.payload->>'key_id')));END IF;RETURN r;
END $$;
CREATE OR REPLACE FUNCTION public.sb_us_task_finish(h text,r jsonb,pub jsonb DEFAULT NULL,failed boolean DEFAULT false) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 UPDATE app_private.us_tasks SET state=CASE WHEN failed THEN 'error' ELSE 'done' END,result=r,public_key=pub WHERE token_hash=h AND state='running';
 DELETE FROM vault.secrets WHERE name='signalbrief::bootstrap:'||(SELECT payload->>'key_id' FROM app_private.us_tasks WHERE token_hash=h AND operation='import');
 DELETE FROM vault.secrets WHERE name LIKE 'signalbrief::bootstrap:%' AND created_at<now()-interval '20 minutes';
END $$;
CREATE OR REPLACE FUNCTION public.sb_us_reserve(p text,amount numeric DEFAULT 0,smoke boolean DEFAULT false) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE n int;spent numeric;budget numeric;BEGIN
 IF p NOT IN ('sec','fmp','openai','resend','gnews','fx') OR amount<0 OR amount>0.05 THEN RAISE EXCEPTION 'invalid_reservation';END IF;
 INSERT INTO app_private.us_usage(day,provider,calls,reserved_usd) VALUES(current_date,p,1,amount) ON CONFLICT(day,provider) DO UPDATE SET calls=us_usage.calls+1,reserved_usd=us_usage.reserved_usd+amount RETURNING calls,reserved_usd INTO n,spent;
 IF n>(CASE p WHEN 'openai' THEN 20 WHEN 'fmp' THEN 100 WHEN 'resend' THEN 50 ELSE 500 END) THEN RAISE EXCEPTION 'daily_request_limit' USING ERRCODE='PT429';END IF;
 IF p='openai' THEN SELECT (value::text)::numeric INTO budget FROM app_private.us_config WHERE key='ai_daily_budget_usd';
 IF smoke THEN budget:=greatest(coalesce(budget,0),0.005);END IF;
 IF spent>coalesce(budget,0) THEN RAISE EXCEPTION 'ai_budget_not_approved' USING ERRCODE='PT429';END IF;END IF;
END $$;
-- Explicitly non-client RPCs: only the trusted Edge runtime may read secrets/maintain caches.
REVOKE ALL ON FUNCTION public.sb_us_secrets(),public.sb_us_vault_put(text,text),public.sb_us_config(),public.sb_us_cache(text,jsonb,int),public.sb_us_task_take(text),public.sb_us_task_finish(text,jsonb,jsonb,boolean),public.sb_us_reserve(text,numeric,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sb_us_secrets(),public.sb_us_vault_put(text,text),public.sb_us_config(),public.sb_us_cache(text,jsonb,int),public.sb_us_task_take(text),public.sb_us_task_finish(text,jsonb,jsonb,boolean),public.sb_us_reserve(text,numeric,boolean) TO service_role;
NOTIFY pgrst,'reload schema';
