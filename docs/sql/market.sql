CREATE OR REPLACE FUNCTION public.sb_us_reserve(p text,amount numeric DEFAULT 0,smoke boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n int;spent numeric;budget numeric;BEGIN
 IF p NOT IN ('sec','dart','kis','fmp','openai','resend','gnews','fx') OR amount<0 OR amount>0.05 THEN RAISE EXCEPTION 'invalid_reservation';END IF;
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

CREATE TABLE IF NOT EXISTS app_private.market_auth_lease(provider text PRIMARY KEY,owner uuid NOT NULL,expires_at timestamptz NOT NULL);
REVOKE ALL ON app_private.market_auth_lease FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.sb_market_auth_lease(lease uuid,release boolean DEFAULT false) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE claimed uuid;BEGIN
 IF release THEN UPDATE app_private.market_auth_lease SET expires_at=now() WHERE provider='kis' AND owner=lease;RETURN true;END IF;
 INSERT INTO app_private.market_auth_lease VALUES('kis',lease,now()+interval '90 seconds')
 ON CONFLICT(provider) DO UPDATE SET owner=EXCLUDED.owner,expires_at=EXCLUDED.expires_at WHERE market_auth_lease.expires_at<=now() RETURNING owner INTO claimed;
 RETURN coalesce(claimed=lease,false);
END $$;
REVOKE ALL ON FUNCTION public.sb_market_auth_lease(uuid,boolean),public.sb_us_reserve(text,numeric,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sb_market_auth_lease(uuid,boolean),public.sb_us_reserve(text,numeric,boolean) TO service_role;
INSERT INTO app_private.us_config(key,value) VALUES('kis_display_enabled','false'),('fmp_indices_display_enabled','false') ON CONFLICT DO NOTHING;
NOTIFY pgrst,'reload schema';
