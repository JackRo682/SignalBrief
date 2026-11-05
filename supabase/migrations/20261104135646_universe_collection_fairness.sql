-- Work remains bounded by the existing collector and atomic quota reservation.
-- Quota exhaustion is deferred work, never a permanent source/evidence failure.
CREATE TABLE app_private.company_collection_state(
 company_id text PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
 last_attempt_at timestamptz,last_success_at timestamptz,next_attempt_at timestamptz NOT NULL DEFAULT now(),
 lease_id uuid,lease_until timestamptz,error_code text,failure_count integer NOT NULL DEFAULT 0 CHECK(failure_count BETWEEN 0 AND 10)
);
CREATE TABLE app_private.company_collection_turns(provider text PRIMARY KEY CHECK(provider IN ('sec','dart')),turn bigint NOT NULL DEFAULT 0);
INSERT INTO app_private.company_collection_turns(provider) VALUES('sec'),('dart');
ALTER TABLE app_private.company_collection_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.company_collection_turns ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.company_collection_state,app_private.company_collection_turns FROM PUBLIC,anon,authenticated;
CREATE INDEX company_collection_due ON app_private.company_collection_state(next_attempt_at,company_id);

CREATE FUNCTION app_private.provider_has_capacity(provider_name text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT CASE WHEN provider_name='openai' THEN
  coalesce((SELECT calls<20 AND reserved_usd<coalesce((SELECT (value::text)::numeric FROM app_private.us_config WHERE key='ai_daily_budget_usd'),0)
   FROM app_private.us_usage WHERE day=current_date AND provider=provider_name),true)
  AND coalesce((SELECT (value::text)::numeric>0 FROM app_private.us_config WHERE key='ai_daily_budget_usd'),false)
 ELSE provider_name IN ('sec','dart') AND coalesce((SELECT calls<500 FROM app_private.us_usage WHERE day=current_date AND provider=provider_name),true) END
$$;
REVOKE ALL ON FUNCTION app_private.provider_has_capacity(text) FROM PUBLIC,anon,authenticated;

-- Calendar is an allocation within (not in addition to) each provider's 500-call
-- daily ceiling. Actual SEC/DART requests reserve here before transport; at least
-- 250 global reservations remain available to metadata/financial/document paths.
CREATE TABLE app_private.calendar_provider_usage(
 day date NOT NULL,provider text NOT NULL CHECK(provider IN ('sec','dart')),
 calls integer NOT NULL CHECK(calls BETWEEN 0 AND 250),PRIMARY KEY(day,provider)
);
ALTER TABLE app_private.calendar_provider_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.calendar_provider_usage FROM PUBLIC,anon,authenticated;
CREATE FUNCTION app_private.calendar_provider_has_capacity(provider_name text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT app_private.provider_has_capacity(provider_name)
  AND coalesce((SELECT calls<250 FROM app_private.calendar_provider_usage WHERE day=current_date AND provider=provider_name),true)
$$;
CREATE FUNCTION public.sb_calendar_provider_reserve(p text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p IS NULL OR p NOT IN ('sec','dart') THEN RAISE EXCEPTION 'invalid_calendar_provider' USING ERRCODE='PT422';END IF;
 INSERT INTO app_private.calendar_provider_usage(day,provider,calls) VALUES(current_date,p,1)
 ON CONFLICT(day,provider) DO UPDATE SET calls=calendar_provider_usage.calls+1 WHERE calendar_provider_usage.calls<250;
 IF NOT FOUND THEN RAISE EXCEPTION 'daily_request_limit' USING ERRCODE='PT429';END IF;
 PERFORM public.sb_us_reserve(p,0,false);
END $$;
REVOKE ALL ON FUNCTION app_private.calendar_provider_has_capacity(text),public.sb_calendar_provider_reserve(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sb_calendar_provider_reserve(text) TO service_role;
DO $migration$
DECLARE definition text;old text:=$old$WHERE q.state='pending' AND q.next_attempt_at<=now() AND q.attempts<3$old$;BEGIN
 definition:=pg_get_functiondef('app_private.dispatch_calendar_refresh()'::regprocedure);
 IF length(definition)-length(replace(definition,old,''))<>length(old) THEN RAISE EXCEPTION 'universe_calendar_dispatch_precondition';END IF;
 EXECUTE replace(definition,old,old||$new$ AND (s.adapter NOT IN ('sec-ir','dart-ir') OR app_private.calendar_provider_has_capacity(s.provider))$new$);
END $migration$;

CREATE OR REPLACE FUNCTION app_content_private.collection_candidates() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE picked public.companies%rowtype;provider_name text;sequence bigint;lease uuid;result jsonb:='[]'::jsonb;BEGIN
 PERFORM pg_advisory_xact_lock(20261104,52);
 -- A pre-upgrade worker does not call finish. Its persisted successful ingestion
 -- timestamp safely reconciles its expired lease; failed leases rotate/back off.
 UPDATE app_private.company_collection_state s SET lease_id=NULL,lease_until=NULL,
  last_success_at=CASE WHEN c.last_ingested_at>=s.last_attempt_at THEN c.last_ingested_at ELSE s.last_success_at END,
  failure_count=CASE WHEN c.last_ingested_at>=s.last_attempt_at THEN 0 ELSE least(10,s.failure_count+1) END,
  error_code=CASE WHEN c.last_ingested_at>=s.last_attempt_at THEN NULL ELSE 'collection_lease_expired' END,
  next_attempt_at=CASE WHEN c.last_ingested_at>=s.last_attempt_at THEN c.last_ingested_at+interval '2 hours' ELSE now()+interval '5 minutes' END
 FROM public.companies c WHERE c.id=s.company_id AND s.lease_until<=now();
 FOREACH provider_name IN ARRAY ARRAY['sec','dart'] LOOP
  IF NOT app_private.provider_has_capacity(provider_name) THEN CONTINUE;END IF;
  SELECT turn INTO sequence FROM app_private.company_collection_turns WHERE provider=provider_name FOR UPDATE;
  SELECT c.* INTO picked FROM public.companies c LEFT JOIN app_private.company_collection_state s ON s.company_id=c.id
  WHERE c.provider=provider_name AND NOT c.is_demo AND coalesce(s.lease_until,'epoch')<=now()
   AND coalesce(s.next_attempt_at,'epoch')<=now()
   AND (c.last_ingested_at IS NULL OR c.last_ingested_at<now()-interval '2 hours'
    OR EXISTS(SELECT 1 FROM app_private.company_analysis_requests r WHERE r.company_id=c.id AND r.completed_at IS NULL AND r.requested_at>c.last_ingested_at))
  ORDER BY CASE WHEN mod(sequence,4)=3 AND c.last_ingested_at IS NOT NULL THEN 0 WHEN c.last_ingested_at IS NULL THEN 1 ELSE 2 END,
   CASE WHEN mod(sequence,4)=3 AND (EXISTS(SELECT 1 FROM public.watchlist_items w WHERE w.company_id=c.id)
    OR EXISTS(SELECT 1 FROM public.positions p WHERE p.company_id=c.id)) THEN 0 ELSE 1 END,
   coalesce(s.last_attempt_at,'epoch'),c.last_ingested_at NULLS FIRST,c.created_at,c.id LIMIT 1;
  IF picked.id IS NULL THEN CONTINUE;END IF;
  lease:=gen_random_uuid();
  INSERT INTO app_private.company_collection_state(company_id,last_attempt_at,lease_id,lease_until)
   VALUES(picked.id,now(),lease,now()+interval '5 minutes')
  ON CONFLICT(company_id) DO UPDATE SET last_attempt_at=EXCLUDED.last_attempt_at,lease_id=EXCLUDED.lease_id,lease_until=EXCLUDED.lease_until;
  UPDATE app_private.company_collection_turns SET turn=turn+1 WHERE provider=provider_name;
  result:=result||jsonb_build_array(jsonb_build_object('id',picked.id,'name',picked.name,'ticker',picked.ticker,
   'provider',picked.provider,'provider_company_id',picked.provider_company_id,'last_ingested_at',picked.last_ingested_at,'collection_lease_id',lease));
 END LOOP;
 RETURN result;
END $$;
CREATE FUNCTION public.sb_collection_finish(company_id text,result_status text,result_code text DEFAULT NULL,lease_id uuid DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s app_private.company_collection_state%rowtype;quota boolean;BEGIN
 IF result_status NOT IN ('verified','blocked') OR result_code IS NOT NULL AND result_code!~'^[a-z0-9_]{1,80}$'
  OR lease_id IS NULL THEN RAISE EXCEPTION 'invalid_collection_result' USING ERRCODE='PT422';END IF;
 SELECT * INTO s FROM app_private.company_collection_state cs WHERE cs.company_id=sb_collection_finish.company_id
  AND cs.lease_id=sb_collection_finish.lease_id AND cs.lease_until>now() FOR UPDATE;
 IF s.company_id IS NULL THEN RAISE EXCEPTION 'collection_lease_expired' USING ERRCODE='PT409';END IF;
 quota:=result_code IN ('daily_request_limit','quota_exceeded','dart_quota_exceeded','ai_budget_not_approved');
 UPDATE app_private.company_collection_state SET lease_id=NULL,lease_until=NULL,
  last_success_at=CASE WHEN result_status='verified' THEN now() ELSE last_success_at END,
  failure_count=CASE WHEN result_status='verified' THEN 0 WHEN quota THEN failure_count ELSE least(10,failure_count+1) END,
  error_code=CASE WHEN result_status='verified' THEN NULL ELSE result_code END,
  next_attempt_at=CASE WHEN result_status='verified' THEN now()+interval '2 hours'
   WHEN quota THEN (date_trunc('day',now() AT TIME ZONE 'UTC')+interval '1 day') AT TIME ZONE 'UTC'
   ELSE now()+make_interval(secs=>least(21600,300*power(2,least(s.failure_count,7))::integer)) END
 WHERE app_private.company_collection_state.company_id=s.company_id;
END $$;
REVOKE ALL ON FUNCTION public.sb_collection_finish(text,text,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sb_collection_finish(text,text,text,uuid) TO service_role;

-- Preserve the existing financial source validator byte-for-byte apart from the
-- queue's claim/failure branches. No finance/evidence/approval predicates change.
ALTER TABLE app_private.company_financial_sources ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now();
DO $migration$
DECLARE definition text;old text;replacement text;BEGIN
 definition:=pg_get_functiondef('app_content_private.company_financial_admin(text,jsonb)'::regprocedure);
 old:=$old$IF s.lease_until>stamp THEN RETURN jsonb_build_object('claimed',false,'status','pending');END IF;$old$;
 replacement:=$new$IF s.lease_until>stamp OR s.next_attempt_at>stamp THEN RETURN jsonb_build_object('claimed',false,'status','pending');END IF;$new$;
 IF length(definition)-length(replace(definition,old,''))<>length(old) THEN RAISE EXCEPTION 'universe_financial_claim_precondition';END IF;
 definition:=replace(definition,old,replacement);
 old:=$old$IF op='fail' THEN
   UPDATE app_private.company_financial_sources SET status='unavailable',lease_id=NULL,lease_until=NULL,$old$;
 replacement:=$new$IF op='fail' THEN
   IF p->>'code' IN ('daily_request_limit','quota_exceeded','dart_quota_exceeded','ai_budget_not_approved') THEN
    UPDATE app_private.company_financial_sources SET status='pending',lease_id=NULL,lease_until=NULL,
     error_code=p->>'code',attempt_count=greatest(0,attempt_count-1),
     next_attempt_at=(date_trunc('day',stamp AT TIME ZONE 'UTC')+interval '1 day') AT TIME ZONE 'UTC' WHERE company_id=c.id;
    RETURN jsonb_build_object('status','pending');
   END IF;
   UPDATE app_private.company_financial_sources SET status='unavailable',lease_id=NULL,lease_until=NULL,$new$;
 IF length(definition)-length(replace(definition,old,''))<>length(old) THEN RAISE EXCEPTION 'universe_financial_fail_precondition';END IF;
 EXECUTE replace(definition,old,replacement);
END $migration$;
CREATE OR REPLACE FUNCTION public.sb_financial_collection_pick() RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT to_jsonb(c) FROM public.companies c JOIN app_private.company_financial_sources s ON s.company_id=c.id
 WHERE NOT c.is_demo AND c.provider IN ('sec','dart') AND coalesce(s.lease_until,'epoch')<now()
  AND s.next_attempt_at<=now() AND app_private.provider_has_capacity(c.provider)
  AND coalesce(s.last_attempt_at,'epoch')<now()-interval '5 minutes'
  AND (s.status IN ('pending','collecting','unavailable') AND s.attempt_count<3 OR s.last_success_at<now()-interval '24 hours' AND s.attempt_count<3)
 ORDER BY (s.last_success_at IS NOT NULL),s.last_attempt_at NULLS FIRST,s.requested_at,c.id LIMIT 1
$$;

ALTER TABLE app_private.collector_analysis_attempts ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now();
CREATE OR REPLACE FUNCTION public.sb_collector_analysis_finish(fid uuid,result_status text,result_code text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF result_status NOT IN ('needs_review','blocked') OR result_code IS NOT NULL AND result_code!~'^[a-z0-9_]{1,80}$' THEN RAISE EXCEPTION 'invalid_analysis_result' USING ERRCODE='PT422';END IF;
 UPDATE app_private.collector_analysis_attempts SET status=result_status,code=result_code,
  attempt_count=CASE WHEN result_code IN ('daily_request_limit','quota_exceeded','dart_quota_exceeded','ai_budget_not_approved') THEN greatest(0,attempt_count-1) ELSE attempt_count END,
  next_attempt_at=CASE WHEN result_code IN ('daily_request_limit','quota_exceeded','dart_quota_exceeded','ai_budget_not_approved')
   THEN (date_trunc('day',now() AT TIME ZONE 'UTC')+interval '1 day') AT TIME ZONE 'UTC' ELSE now()+interval '15 minutes' END WHERE filing_id=fid;
 IF result_status='needs_review' THEN
  UPDATE app_private.company_analysis_requests SET completed_at=now(),error_code=NULL WHERE company_id=(SELECT company_id FROM public.us_filings WHERE id=fid);
 END IF;
END $$;
DO $migration$
DECLARE definition text;old text;replacement text;BEGIN
 definition:=pg_get_functiondef('public.sb_collector_analysis_pick()'::regprocedure);
 old:=$old$t.attempt_count<3 AND t.attempted_at<now()-interval '15 minutes'$old$;
 replacement:=$new$t.attempt_count<3 AND t.next_attempt_at<=now() AND t.attempted_at<now()-interval '15 minutes'$new$;
 IF length(definition)-length(replace(definition,old,''))<>length(old) THEN RAISE EXCEPTION 'universe_analysis_retry_precondition';END IF;
 definition:=replace(definition,old,replacement);
 old:=$old$'http_504','analysis_running_or_complete'$old$;
 replacement:=$new$'http_504','analysis_running_or_complete','daily_request_limit','quota_exceeded','dart_quota_exceeded','ai_budget_not_approved'$new$;
 IF length(definition)-length(replace(definition,old,''))<>length(old) THEN RAISE EXCEPTION 'universe_analysis_codes_precondition';END IF;
 EXECUTE replace(definition,old,replacement);
END $migration$;

ALTER TABLE app_private.dart_document_attempts ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now();
CREATE OR REPLACE FUNCTION public.sb_dart_document_claim() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE filing public.dart_filings%rowtype;BEGIN
 PERFORM pg_advisory_xact_lock(20261014,3);
 WITH documents AS(SELECT f.company_id,count(*) total FROM public.dart_documents d JOIN public.dart_filings f ON f.id=d.filing_id GROUP BY f.company_id)
 SELECT f.* INTO filing FROM public.dart_filings f JOIN public.companies c ON c.id=f.company_id AND c.provider='dart' AND NOT c.is_demo
 LEFT JOIN app_private.dart_document_attempts a ON a.filing_id=f.id LEFT JOIN documents d ON d.company_id=f.company_id
 WHERE (a.filing_id IS NULL OR a.state='retry_requested' OR a.state='quota_deferred' AND a.next_attempt_at<=now()
  OR a.state='analysis_pending' AND a.attempted_at<(date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'))
  AND (EXISTS(SELECT 1 FROM public.dart_documents doc WHERE doc.filing_id=f.id) AND app_private.provider_has_capacity('openai')
   OR NOT EXISTS(SELECT 1 FROM public.dart_documents doc WHERE doc.filing_id=f.id) AND app_private.provider_has_capacity('dart'))
 ORDER BY (a.state='retry_requested') DESC NULLS LAST,coalesce(d.total,0),f.filing_date DESC,f.id LIMIT 1;
 IF NOT FOUND THEN RETURN NULL;END IF;
 INSERT INTO app_private.dart_document_attempts(filing_id) VALUES(filing.id)
 ON CONFLICT(filing_id) DO UPDATE SET state='running',attempted_at=now(),error_code=NULL;
 RETURN to_jsonb(filing);
END $$;
CREATE OR REPLACE FUNCTION public.sb_dart_document_finish(fid uuid,status text,error_code text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF status NOT IN ('blocked','parsed','analysis_pending') OR error_code IS NOT NULL AND error_code!~'^[a-z0-9_]{1,80}$' THEN
  RAISE EXCEPTION 'invalid_document_result' USING ERRCODE='PT422';END IF;
 UPDATE app_private.dart_document_attempts SET
  state=CASE WHEN sb_dart_document_finish.error_code IN ('daily_request_limit','quota_exceeded','dart_quota_exceeded','ai_budget_not_approved') THEN 'quota_deferred' ELSE status END,
  error_code=sb_dart_document_finish.error_code,
  next_attempt_at=CASE WHEN sb_dart_document_finish.error_code IN ('daily_request_limit','quota_exceeded','dart_quota_exceeded','ai_budget_not_approved')
   THEN (date_trunc('day',now() AT TIME ZONE 'UTC')+interval '1 day') AT TIME ZONE 'UTC' ELSE now() END WHERE filing_id=fid;
END $$;

-- Calendar dispatch is already bounded to two concurrent sources. A provider
-- quota reported by the worker must defer its source without burning three tries.
CREATE OR REPLACE FUNCTION public.sb_calendar_finish(h text,summary jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE task app_private.calendar_runs;ok boolean;quota boolean;BEGIN
 UPDATE app_private.calendar_runs SET summary=$2,finished_at=now()
 WHERE token_hash=h AND claimed_at IS NOT NULL AND finished_at IS NULL RETURNING * INTO task;
 IF task.id IS NULL THEN RETURN;END IF;
 IF task.source_key IS NOT NULL THEN
  ok:=EXISTS(SELECT 1 FROM jsonb_array_elements(summary) x WHERE x->>'source'=task.source_key AND x->>'status'='verified');
  quota:=EXISTS(SELECT 1 FROM jsonb_array_elements(summary) x WHERE x->>'source'=task.source_key
   AND x->>'code' IN ('daily_request_limit','quota_exceeded','dart_quota_exceeded','ai_budget_not_approved'));
  UPDATE app_private.calendar_refresh_queue SET state=CASE WHEN quota THEN 'pending' WHEN rerun_requested THEN 'pending' WHEN ok THEN 'idle' WHEN attempts>=3 THEN 'failed' ELSE 'pending' END,
   next_attempt_at=CASE WHEN quota THEN (date_trunc('day',now() AT TIME ZONE 'UTC')+interval '1 day') AT TIME ZONE 'UTC'
    WHEN rerun_requested THEN now() ELSE now()+make_interval(secs=>15*power(2,attempts)::integer) END,
   attempts=CASE WHEN quota THEN greatest(0,attempts-1) WHEN rerun_requested THEN 0 ELSE attempts END,rerun_requested=false,
   lease_until=NULL,finished_at=now(),run_id=NULL WHERE run_id=task.id;
 END IF;
 PERFORM app_private.dispatch_calendar_refresh();
END $$;
NOTIFY pgrst,'reload schema';
