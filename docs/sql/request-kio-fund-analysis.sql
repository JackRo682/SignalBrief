-- OPERATOR-ONLY, ONE-TIME REQUEST. This file is not a migration.
-- Run only after the fund-report parser/selector is deployed and the queue
-- migration is applied. It uses existing private queue operations, never keys.
-- No raw documents or analysis claims are inserted here. Nothing is approved.
DO $request$
DECLARE cid text:='68c2d48b-e0ba-4429-90a3-3135c1e036fb'; budget numeric;
BEGIN
 -- Match the existing dispatch/picker lock order. This also prevents a picker
 -- from selecting a stale KIO filing between the checks and the new request.
 PERFORM pg_catalog.pg_advisory_xact_lock(20261014,1);
 PERFORM pg_catalog.pg_advisory_xact_lock(20261014,2);
 IF position('coalesce(used_calls,0)>=20' IN pg_get_functiondef('public.sb_collector_analysis_pick()'::regprocedure))=0
 THEN RAISE EXCEPTION 'quota_deferral_migration_required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.companies WHERE id=cid AND provider='sec'
  AND provider_company_id='0001515940' AND ticker='KIO' AND NOT is_demo)
 THEN RAISE EXCEPTION 'kio_identity_mismatch'; END IF;
 SELECT (value::text)::numeric INTO budget FROM app_private.us_config WHERE key='ai_daily_budget_usd';
 IF budget IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'existing_one_dollar_budget_required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM app_private.us_config WHERE key='scheduled_ingestion_enabled' AND value='true'::jsonb)
 THEN RAISE EXCEPTION 'schedule_disabled'; END IF;
 IF EXISTS(SELECT 1 FROM public.us_analyses a JOIN public.us_filings f ON f.id=a.filing_id WHERE f.company_id=cid)
 THEN RAISE EXCEPTION 'kio_already_has_analysis'; END IF;
 IF EXISTS(SELECT 1 FROM app_private.us_analysis_locks l JOIN public.us_filings f ON f.id=l.filing_id
  WHERE f.company_id=cid AND l.expires_at>clock_timestamp())
 OR EXISTS(SELECT 1 FROM app_private.collector_analysis_attempts t JOIN public.us_filings f ON f.id=t.filing_id
  WHERE f.company_id=cid AND t.status='running' AND t.attempted_at>clock_timestamp()-interval '5 minutes')
 THEN RAISE EXCEPTION 'kio_analysis_in_progress'; END IF;
 -- A previously launched worker can retain old code. Wait for existing bounded
 -- runs to finish/expire; do not cancel or overwrite somebody else's run.
 IF EXISTS(SELECT 1 FROM app_private.collector_runs WHERE state IN ('pending','running') AND expires_at>clock_timestamp())
 THEN RAISE EXCEPTION 'collector_run_in_progress'; END IF;
 PERFORM public.sb_company_financial_admin('request',jsonb_build_object('company_id',cid));
 -- The existing request operation deliberately does nothing on conflict.
 -- Re-request this one previously omitted fund after deployment, truthfully
 -- recording a new request time. Never alter last_ingested_at or filing dates.
 UPDATE app_private.company_analysis_requests SET requested_at=clock_timestamp(),completed_at=NULL,error_code=NULL
 WHERE company_id=cid;
 IF NOT FOUND THEN RAISE EXCEPTION 'kio_request_not_created'; END IF;
 PERFORM app_private.enqueue_collector();
END $request$;

-- Safe operational output: no task tokens, provider keys, or raw documents.
SELECT r.company_id,r.requested_at,r.completed_at,c.last_ingested_at,
 (SELECT jsonb_build_object('id',x.id,'state',x.state,'request_id',x.request_id)
  FROM app_private.collector_runs x ORDER BY x.created_at DESC LIMIT 1) AS collector
FROM app_private.company_analysis_requests r JOIN public.companies c ON c.id=r.company_id
WHERE r.company_id='68c2d48b-e0ba-4429-90a3-3135c1e036fb';
