-- Reuse the bounded collector and existing durable company analysis requests.
-- A fresh request gets a short refresh priority window; a failed issuer cannot
-- permanently displace previously runnable watched/held issuers.
CREATE OR REPLACE FUNCTION app_content_private.collection_candidates() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH candidates AS (
 SELECT c.id,c.name,c.ticker,c.provider,c.provider_company_id,c.last_ingested_at,
 r.requested_at AS analysis_requested_at,
 CASE WHEN c.provider='sec' AND r.company_id IS NOT NULL
  AND coalesce(c.last_ingested_at,'epoch')<r.requested_at
  AND r.requested_at>now()-interval '15 minutes' THEN -1
 WHEN (c.last_ingested_at IS NULL OR c.last_ingested_at<now()-interval '2 hours') AND (
 EXISTS(SELECT 1 FROM public.watchlist_items w WHERE w.company_id=c.id) OR EXISTS(SELECT 1 FROM public.positions p WHERE p.company_id=c.id)) THEN 0
 WHEN c.last_ingested_at IS NULL THEN 1 ELSE 2 END priority
 FROM public.companies c
 LEFT JOIN app_private.company_analysis_requests r ON r.company_id=c.id AND r.completed_at IS NULL
 WHERE NOT c.is_demo AND c.provider IN ('sec','dart')
 ),picked AS (SELECT DISTINCT ON (provider) * FROM candidates
 ORDER BY provider,priority,CASE WHEN priority=-1 THEN analysis_requested_at END NULLS LAST,last_ingested_at NULLS FIRST,id)
 SELECT coalesce(jsonb_agg(to_jsonb(picked)-'priority'-'analysis_requested_at'),'[]'::jsonb) FROM picked
$$;
REVOKE ALL ON FUNCTION app_content_private.collection_candidates() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app_content_private.collection_candidates() TO service_role;

-- One document per execution, unchanged age/retry bounds and review/cost gates.
-- Do not let a new request consume a stale filing before its metadata refresh.
CREATE OR REPLACE FUNCTION public.sb_collector_analysis_pick() RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE selected uuid;budget numeric;used_calls integer;reserved numeric;BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(20261014,2);
 -- Read-only preflight mirrors sb_us_reserve's existing current-date limits.
 -- Do not claim a document that is certain to fail today's quota reservation.
 -- The later reservation still atomically checks races and the exact excerpt cost.
 SELECT (value::text)::numeric INTO budget FROM app_private.us_config WHERE key='ai_daily_budget_usd';
 SELECT calls,reserved_usd INTO used_calls,reserved FROM app_private.us_usage WHERE day=current_date AND provider='openai';
 IF coalesce(used_calls,0)>=20 OR coalesce(budget,0)<=0 OR coalesce(reserved,0)>=budget THEN RETURN NULL;END IF;
 SELECT f.id INTO selected FROM public.us_filings f JOIN public.companies c ON c.id=f.company_id
 LEFT JOIN app_private.company_analysis_requests r ON r.company_id=c.id AND r.completed_at IS NULL
 LEFT JOIN app_private.collector_analysis_attempts t ON t.filing_id=f.id
 WHERE c.provider='sec' AND NOT c.is_demo AND f.filing_date>=current_date-550 AND f.filing_date<=current_date
  AND (r.company_id IS NULL OR c.last_ingested_at>=r.requested_at)
  AND NOT EXISTS(SELECT 1 FROM public.us_analyses a WHERE a.filing_id=f.id)
  AND (t.filing_id IS NULL OR t.attempt_count<3 AND t.attempted_at<now()-interval '15 minutes'
   AND (t.status='running' OR t.status='blocked' AND t.code IN ('request_timeout','network_or_timeout','connection_failed','http_500','http_502','http_503','http_504','analysis_running_or_complete')))
 ORDER BY (r.company_id IS NULL),
  (SELECT count(*) FROM public.us_analyses a JOIN public.us_filings prior ON prior.id=a.filing_id WHERE prior.company_id=c.id),
  r.requested_at NULLS LAST,
  CASE WHEN f.form IN ('10-K','10-K/A','10-Q','10-Q/A','20-F','20-F/A','40-F','40-F/A','N-CSR','N-CSR/A','N-CSRS','N-CSRS/A') THEN 0 ELSE 1 END,
  f.filing_date DESC,f.id LIMIT 1;
 IF selected IS NOT NULL THEN
  INSERT INTO app_private.collector_analysis_attempts(filing_id) VALUES(selected)
  ON CONFLICT(filing_id) DO UPDATE SET attempted_at=now(),status='running',code=NULL,attempt_count=collector_analysis_attempts.attempt_count+1;
 END IF;
 RETURN selected;
END $$;
REVOKE ALL ON FUNCTION public.sb_collector_analysis_pick() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sb_collector_analysis_pick() TO service_role;
NOTIFY pgrst,'reload schema';
