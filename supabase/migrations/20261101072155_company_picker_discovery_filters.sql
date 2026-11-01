-- Apply user-visible scope before the bounded directory page. The former client
-- filter could discard all 30 returned rows while matching issuers existed later.
-- Preserve the original unfiltered RPC for compatible callers and rollback.
CREATE FUNCTION app_content_private.discovery_search_filtered(q text,p jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid:=(SELECT auth.uid());result jsonb;selected_provider text;selected_market text;selected_group text;
BEGIN
 IF u IS NULL OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=u) THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='PT401';END IF;
 PERFORM public.sb_require_mfa();PERFORM public.sb_rate_limit();
 IF q IS NULL OR length(trim(q)) NOT BETWEEN 1 AND 100 OR app_private.sb_search_normalize(q)='' THEN RAISE EXCEPTION 'invalid_query' USING ERRCODE='PT422';END IF;
 IF p IS NULL OR jsonb_typeof(p)<>'object' OR p-'provider'-'market'-'market_group'<>'{}'::jsonb
 OR EXISTS(SELECT 1 FROM jsonb_each(p) WHERE jsonb_typeof(value)<>'string') THEN RAISE EXCEPTION 'invalid_filter' USING ERRCODE='PT422';END IF;
 selected_provider:=coalesce(p->>'provider','');selected_market:=upper(btrim(coalesce(p->>'market','')));selected_group:=coalesce(p->>'market_group','all');
 IF selected_provider NOT IN ('','sec','dart') OR selected_group NOT IN ('all','kospi','kosdaq','overseas','unclassified')
 OR length(selected_market)>32 OR (selected_market<>'' AND selected_market!~'^[A-Z0-9가-힣 :._-]+$') THEN RAISE EXCEPTION 'invalid_filter' USING ERRCODE='PT422';END IF;
 WITH registry AS MATERIALIZED (
  SELECT d.provider,d.provider_company_id,d.ticker,d.name,d.official_english_name,
   coalesce(nullif(c.market,''),d.market) AS market,c.id AS company_id,
   CASE WHEN d.provider='sec' THEN 'overseas'
    WHEN upper(coalesce(nullif(c.market,''),d.market)) IN ('KOSPI','코스피','KRX:KOSPI') THEN 'kospi'
    WHEN upper(coalesce(nullif(c.market,''),d.market)) IN ('KOSDAQ','코스닥','KRX:KOSDAQ') THEN 'kosdaq'
    ELSE 'unclassified' END AS market_group
  FROM app_private.company_directory d LEFT JOIN public.companies c
  ON c.provider=d.provider AND c.provider_company_id=d.provider_company_id AND NOT c.is_demo
  WHERE d.active AND (selected_provider='' OR d.provider=selected_provider)
 ),matches AS MATERIALIZED (
  SELECT provider,provider_company_id,ticker,name,market,company_id,
   CASE WHEN app_private.sb_search_normalize(ticker)=app_private.sb_search_normalize(q) THEN 0
    WHEN app_private.sb_search_normalize(name)=app_private.sb_search_normalize(q)
     OR app_private.sb_search_normalize(official_english_name)=app_private.sb_search_normalize(q) THEN 1 ELSE 2 END AS rank
  FROM registry d WHERE (selected_market='' OR upper(d.market)=selected_market)
   AND (selected_group='all' OR d.market_group=selected_group)
   AND EXISTS(SELECT 1 FROM unnest(app_private.sb_search_terms(q)) term
    WHERE position(app_private.sb_search_normalize(term) IN app_private.sb_search_normalize(concat_ws(' ',d.name,d.ticker,d.official_english_name)))>0)
 ) SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(to_jsonb(x)-'rank') FROM
  (SELECT * FROM matches ORDER BY rank,name,ticker LIMIT 30)x),'[]'::jsonb),'total',(SELECT count(*) FROM matches),
  'source_status',CASE WHEN (SELECT count(*) FROM app_private.company_directory_sources WHERE last_success_at>now()-interval '72 hours' AND error_code IS NULL)=2 THEN 'ready'
   WHEN EXISTS(SELECT 1 FROM app_private.company_directory WHERE active) THEN 'partial' ELSE 'unavailable' END,
  'sources',(SELECT jsonb_agg(jsonb_build_object('provider',provider,'source_url',source_url,'last_success_at',last_success_at,'error_code',error_code)) FROM app_private.company_directory_sources)) INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION app_content_private.discovery_search_filtered(text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION app_content_private.discovery_search_filtered(text,jsonb) TO authenticated;

CREATE FUNCTION public.sb_company_discovery_filtered(q text,p jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT app_content_private.discovery_search_filtered(q,p) $$;
REVOKE ALL ON FUNCTION public.sb_company_discovery_filtered(text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.sb_company_discovery_filtered(text,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION app_content_private.discovery_search(q text) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT app_content_private.discovery_search_filtered(q,'{}'::jsonb) $$;

-- SEC is authoritative issuer coverage even when its exchange has an unfamiliar
-- name. Do not guess nationality from ticker syntax or reinterpret DART's KR.
DO $migration$
DECLARE definition text;old_expression text:='WHEN upper(x.market) IN (';
BEGIN
 definition:=pg_get_functiondef('app_content_private.redesign(text,jsonb)'::regprocedure);
 IF position(old_expression IN definition)=0 THEN RAISE EXCEPTION 'directory_market_precondition_failed';END IF;
 -- Only the overseas arm has the original US list; KOSPI/KOSDAQ stay unchanged.
 old_expression:=$old$WHEN upper(x.market) IN ('US','NASDAQ','NYSE','AMEX'$old$;
 IF position(old_expression IN definition)=0 THEN RAISE EXCEPTION 'directory_overseas_precondition_failed';END IF;
 EXECUTE replace(definition,old_expression,$new$WHEN EXISTS(SELECT 1 FROM public.companies issuer WHERE issuer.id=x.company_id AND issuer.provider='sec' AND NOT issuer.is_demo) OR upper(x.market) IN ('US','NASDAQ','NYSE','AMEX'$new$);
END $migration$;
NOTIFY pgrst,'reload schema';
