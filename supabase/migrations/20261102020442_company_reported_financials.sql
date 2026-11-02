-- Source-reported numbers are separate from model claims and their human review.
CREATE TABLE app_private.company_financial_sources(
 company_id text PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','collecting','ready','unavailable')),
 requested_at timestamptz NOT NULL DEFAULT now(),last_attempt_at timestamptz,last_success_at timestamptz,
 lease_id uuid,lease_until timestamptz,error_code text,latest_sha256 text,attempt_count integer NOT NULL DEFAULT 0
);
CREATE TABLE app_private.company_financial_snapshots(
 company_id text NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
 raw_sha256 text NOT NULL CHECK(raw_sha256~'^[a-f0-9]{64}$'),
 raw_object_key text NOT NULL,parser_version text NOT NULL,source jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(company_id,raw_sha256)
);
CREATE TABLE app_private.company_analysis_requests(
 company_id text PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
 requested_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,error_code text
);
ALTER TABLE app_private.company_financial_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.company_financial_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.company_analysis_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.company_financial_sources,app_private.company_financial_snapshots,app_private.company_analysis_requests FROM PUBLIC,anon,authenticated;

CREATE FUNCTION app_content_private.company_financial_admin(op text,p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.companies%rowtype;s app_private.company_financial_sources%rowtype;stamp timestamptz:=clock_timestamp();
 item jsonb;quote jsonb;body jsonb;expected text;object_key text;old jsonb;term text;previous jsonb;cache_usable boolean:=false;
BEGIN
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR octet_length(p::text)>2100000 THEN RAISE EXCEPTION 'invalid_financial_input' USING ERRCODE='PT422';END IF;
 SELECT * INTO c FROM public.companies WHERE id=p->>'company_id' AND NOT is_demo AND provider IN ('sec','dart');
 IF c.id IS NULL THEN RAISE EXCEPTION 'company_not_found' USING ERRCODE='PT404';END IF;
 IF op='request' THEN
  INSERT INTO app_private.company_financial_sources(company_id) VALUES(c.id) ON CONFLICT(company_id) DO UPDATE
  SET status='pending',requested_at=stamp,error_code=NULL
  WHERE company_financial_sources.last_success_at IS NOT NULL AND company_financial_sources.last_success_at<stamp-interval '6 hours'
   AND coalesce(company_financial_sources.lease_until,'epoch')<stamp
   AND coalesce(company_financial_sources.last_attempt_at,'epoch')<stamp-interval '1 minute';
  IF c.provider='sec' AND NOT EXISTS(SELECT 1 FROM public.us_analyses a JOIN public.us_filings f ON f.id=a.filing_id WHERE f.company_id=c.id) THEN
   INSERT INTO app_private.company_analysis_requests(company_id) VALUES(c.id) ON CONFLICT DO NOTHING;
  END IF;
  -- The durable rows survive transport failure; the existing bounded cron retries dispatch.
  IF to_regprocedure('app_private.enqueue_collector()') IS NOT NULL THEN
   BEGIN PERFORM app_private.enqueue_collector();EXCEPTION WHEN OTHERS THEN NULL;END;
  END IF;
  RETURN jsonb_build_object('requested',true);
 ELSIF op='claim' THEN
  INSERT INTO app_private.company_financial_sources(company_id) VALUES(c.id) ON CONFLICT DO NOTHING;
  SELECT * INTO s FROM app_private.company_financial_sources WHERE company_id=c.id FOR UPDATE;
  SELECT EXISTS(SELECT 1 FROM app_private.company_financial_snapshots snap WHERE snap.company_id=c.id AND snap.raw_sha256=s.latest_sha256
   AND snap.source->>'provider'=c.provider AND snap.source->>'provider_company_id'=c.provider_company_id
   AND EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='signalbrief-raw' AND o.name=snap.raw_object_key)) INTO cache_usable;
  IF cache_usable AND s.last_success_at>stamp-interval '6 hours' THEN RETURN jsonb_build_object('claimed',false,'status','ready');END IF;
  IF s.lease_until>stamp THEN RETURN jsonb_build_object('claimed',false,'status','pending');END IF;
  IF s.last_attempt_at>stamp-interval '1 minute' AND (s.latest_sha256 IS NULL OR cache_usable) THEN RETURN jsonb_build_object('claimed',false,'status','unavailable');END IF;
  UPDATE app_private.company_financial_sources SET status='collecting',last_attempt_at=stamp,attempt_count=attempt_count+1,
   lease_id=(p->>'lease')::uuid,lease_until=stamp+interval '3 minutes',error_code=NULL WHERE company_id=c.id;
  RETURN jsonb_build_object('claimed',true,'status','pending');
 ELSIF op IN ('save','fail') THEN
  SELECT * INTO s FROM app_private.company_financial_sources WHERE company_id=c.id AND lease_id=(p->>'lease')::uuid AND lease_until>stamp FOR UPDATE;
  IF s.company_id IS NULL THEN RAISE EXCEPTION 'financial_lease_expired' USING ERRCODE='PT409';END IF;
  IF op='fail' THEN
   UPDATE app_private.company_financial_sources SET status='unavailable',lease_id=NULL,lease_until=NULL,
    error_code=CASE WHEN p->>'code'~'^[a-z0-9_]{1,80}$' THEN p->>'code' ELSE 'provider_unavailable' END WHERE company_id=c.id;
   RETURN jsonb_build_object('status','unavailable');
  END IF;
  body:=p->'snapshot';
  expected:=CASE WHEN c.provider='sec' THEN 'https://data.sec.gov/api/xbrl/companyfacts/CIK'||c.provider_company_id||'.json' END;
  object_key:='financials/'||c.provider||'/'||c.provider_company_id||'/'||(body->>'raw_sha256')||'.json';
  IF body->>'provider' IS DISTINCT FROM c.provider OR body->>'provider_company_id' IS DISTINCT FROM c.provider_company_id
   OR coalesce(body->>'raw_sha256','')!~'^[a-f0-9]{64}$' OR p->>'object_key' IS DISTINCT FROM object_key
   OR p->>'parser_version' IS DISTINCT FROM 'reported-financials-v1'
   OR jsonb_typeof(body->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(body->'items')>240
   OR coalesce(body->>'fetched_at','')!~'^20[0-9]{2}-[0-9]{2}-[0-9]{2}T' OR (body->>'fetched_at')::timestamptz>stamp+interval '5 minutes'
   OR c.provider='sec' AND body->>'source_url' IS DISTINCT FROM expected
   OR c.provider='dart' AND coalesce(body->>'source_url','')!~('^https://opendart[.]fss[.]or[.]kr/api/fnlttSinglAcnt[.]json[?]corp_code='||c.provider_company_id||'&bsns_year=20[0-9]{2}&reprt_code=(11011|11012|11013|11014)$')
   OR NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='signalbrief-raw' AND name=object_key)
  THEN RAISE EXCEPTION 'invalid_financial_source' USING ERRCODE='PT422';END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(body->'items') LOOP
   IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR NOT item ?& ARRAY['metric','taxonomy','concept','label','value_raw','unit','period_start','period_end','period_label','period_kind','fiscal_year','fiscal_period','form','accession','filed_on','accounting_standard','basis','scope','source_url','source_quote','location','raw_sha256']
    OR item->>'raw_sha256' IS DISTINCT FROM body->>'raw_sha256'
    OR coalesce(item->>'value_raw','')!~'^-?[0-9]{1,110}([.][0-9]{1,110})?$'
    OR length(coalesce(item->>'label','')) NOT BETWEEN 1 AND 300 OR length(coalesce(item->>'concept','')) NOT BETWEEN 1 AND 200
    OR coalesce(item->>'metric','')!~'^[a-z_]{1,60}$' OR coalesce(item->>'unit','')!~'^[A-Z]{3}(/shares)?$'
    OR item->>'basis' IS DISTINCT FROM 'reported' OR coalesce(item->>'period_kind','') NOT IN ('instant','duration')
    OR length(coalesce(item->>'period_label','')) NOT BETWEEN 1 AND 200 OR length(coalesce(item->>'source_quote','')) NOT BETWEEN 2 AND 8000
    THEN RAISE EXCEPTION 'invalid_financial_fact' USING ERRCODE='PT422';END IF;
   BEGIN quote:=(item->>'source_quote')::jsonb;EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'invalid_financial_quote' USING ERRCODE='PT422';END;
   IF c.provider='sec' THEN
    IF coalesce(item->>'taxonomy','') NOT IN ('us-gaap','ifrs-full') OR item->>'scope' IS DISTINCT FROM 'entity'
     OR item->>'accounting_standard' IS DISTINCT FROM (CASE WHEN item->>'taxonomy'='us-gaap' THEN 'US-GAAP' ELSE 'IFRS' END)
     OR item->>'source_url' IS DISTINCT FROM expected OR coalesce(item->>'location','')!~'^/facts/(us-gaap|ifrs-full)/[A-Za-z0-9]+/units/[A-Z]{3}(~1shares)?/[0-9]+$'
     OR split_part(item->>'location','/',3) IS DISTINCT FROM item->>'taxonomy' OR split_part(item->>'location','/',4) IS DISTINCT FROM item->>'concept'
     OR replace(split_part(item->>'location','/',6),'~1','/') IS DISTINCT FROM item->>'unit'
     OR jsonb_typeof(quote->'val') IS DISTINCT FROM 'number' OR (quote->>'val')::numeric<>(item->>'value_raw')::numeric
     OR item->>'accession' IS DISTINCT FROM quote->>'accn' OR coalesce(item->>'accession','')!~'^[0-9]{10}-[0-9]{2}-[0-9]{6}$'
     OR item->>'form' IS DISTINCT FROM quote->>'form' OR item->>'filed_on' IS DISTINCT FROM quote->>'filed'
     OR item->>'period_start' IS DISTINCT FROM quote->>'start' OR item->>'period_end' IS DISTINCT FROM quote->>'end'
     OR item->>'period_label' IS DISTINCT FROM (CASE WHEN quote->>'start' IS NULL THEN quote->>'end' ELSE (quote->>'start')||' — '||(quote->>'end') END)
     OR coalesce(item->>'period_end','')!~'^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'
     OR (item->>'period_end')::date>(body->>'fetched_at')::date OR (item->>'filed_on')::date>(body->>'fetched_at')::date
     OR item->>'period_kind'='duration' AND (item->>'period_start' IS NULL OR (item->>'period_start')::date>(item->>'period_end')::date)
     OR item->>'period_kind'='instant' AND item->>'period_start' IS NOT NULL
    THEN RAISE EXCEPTION 'financial_quote_mismatch' USING ERRCODE='PT422';END IF;
   ELSE
    term:=CASE WHEN item->>'location'~'/thstrm_amount$' THEN 'thstrm' WHEN item->>'location'~'/frmtrm_amount$' THEN 'frmtrm' END;
    IF term IS NULL OR coalesce(item->>'location','')!~'^/list/[0-9]+/(thstrm|frmtrm)_amount$'
     OR item->>'taxonomy' IS DISTINCT FROM 'dart' OR quote->>'stock_code' IS DISTINCT FROM c.ticker
     OR quote ? 'corp_code' AND quote->>'corp_code' IS DISTINCT FROM c.provider_company_id
     OR item->>'concept' IS DISTINCT FROM quote->>'account_nm' OR item->>'label' IS DISTINCT FROM quote->>'account_nm'
     OR item->>'scope' IS DISTINCT FROM (CASE WHEN quote->>'fs_div'='CFS' THEN 'consolidated' WHEN quote->>'fs_div'='OFS' THEN 'separate' END)
     OR item->>'unit' IS DISTINCT FROM quote->>'currency' OR (replace(quote->>(term||'_amount'),',',''))::numeric<>(item->>'value_raw')::numeric
     OR item->>'period_label' IS DISTINCT FROM trim(quote->>(term||'_dt')) OR item->>'accession' IS DISTINCT FROM quote->>'rcept_no'
     OR coalesce(item->>'accession','')!~'^[0-9]{14}$' OR item->>'form' IS DISTINCT FROM quote->>'reprt_code'
     OR item->>'source_url' IS DISTINCT FROM ('https://dart.fss.or.kr/dsaf001/main.do?rcpNo='||(quote->>'rcept_no'))
     OR body->>'source_url' IS DISTINCT FROM ('https://opendart.fss.or.kr/api/fnlttSinglAcnt.json?corp_code='||c.provider_company_id||'&bsns_year='||(quote->>'bsns_year')||'&reprt_code='||(quote->>'reprt_code'))
    THEN RAISE EXCEPTION 'financial_quote_mismatch' USING ERRCODE='PT422';END IF;
   END IF;
  END LOOP;
  SELECT source INTO old FROM app_private.company_financial_snapshots WHERE company_id=c.id AND raw_sha256=body->>'raw_sha256';
  IF old IS NOT NULL AND (old-'fetched_at') IS DISTINCT FROM (body-'fetched_at') THEN RAISE EXCEPTION 'financial_snapshot_conflict' USING ERRCODE='PT409';END IF;
  SELECT source INTO previous FROM app_private.company_financial_snapshots WHERE company_id=c.id AND raw_sha256=s.latest_sha256
   AND source->>'provider'=c.provider AND source->>'provider_company_id'=c.provider_company_id;
  IF previous IS NOT NULL AND jsonb_array_length(previous->'items')>0 THEN
   IF jsonb_array_length(body->'items')=0 OR
    (SELECT max(x->>'period_end') FROM jsonb_array_elements(previous->'items') x)>
    coalesce((SELECT max(x->>'period_end') FROM jsonb_array_elements(body->'items') x),'')
   THEN RAISE EXCEPTION 'financial_snapshot_regression' USING ERRCODE='PT409';END IF;
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(previous->'items') a CROSS JOIN jsonb_array_elements(body->'items') b
    WHERE a->>'taxonomy'=b->>'taxonomy' AND a->>'concept'=b->>'concept' AND a->>'unit'=b->>'unit'
     AND a->>'scope'=b->>'scope' AND a->>'period_start' IS NOT DISTINCT FROM b->>'period_start'
     AND a->>'period_end' IS NOT DISTINCT FROM b->>'period_end' AND a->>'period_label'=b->>'period_label'
     AND a->>'accession'=b->>'accession' AND (a->>'value_raw')::numeric<>(b->>'value_raw')::numeric)
   THEN RAISE EXCEPTION 'financial_revision_conflict' USING ERRCODE='PT409';END IF;
  END IF;
  INSERT INTO app_private.company_financial_snapshots(company_id,raw_sha256,raw_object_key,parser_version,source)
  VALUES(c.id,body->>'raw_sha256',object_key,p->>'parser_version',body) ON CONFLICT DO NOTHING;
  UPDATE app_private.company_financial_sources SET status='ready',last_success_at=stamp,latest_sha256=body->>'raw_sha256',error_code=NULL,lease_id=NULL,lease_until=NULL,attempt_count=0 WHERE company_id=c.id;
  RETURN jsonb_build_object('status','ready','count',jsonb_array_length(body->'items'));
 END IF;
 RAISE EXCEPTION 'unsupported_financial_action' USING ERRCODE='PT422';
END $$;
REVOKE ALL ON FUNCTION app_content_private.company_financial_admin(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app_content_private.company_financial_admin(text,jsonb) TO service_role;
CREATE FUNCTION public.sb_company_financial_admin(op text,p jsonb) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT app_content_private.company_financial_admin(op,p)
$$;
REVOKE ALL ON FUNCTION public.sb_company_financial_admin(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sb_company_financial_admin(text,jsonb) TO service_role;

CREATE FUNCTION app_content_private.company_financials(company_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.companies%rowtype;s app_private.company_financial_sources%rowtype;source jsonb;approved bigint;pending bigint;analysis_state text;failure text;collecting boolean:=false;request app_private.company_analysis_requests%rowtype;
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=auth.uid()) THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='PT401';END IF;
 PERFORM public.sb_require_mfa();PERFORM public.sb_rate_limit();
 SELECT * INTO c FROM public.companies WHERE id=company_financials.company_id AND NOT is_demo;
 IF c.id IS NULL THEN RAISE EXCEPTION 'company_not_found' USING ERRCODE='PT404';END IF;
 SELECT * INTO s FROM app_private.company_financial_sources f WHERE f.company_id=c.id;
 SELECT f.source INTO source FROM app_private.company_financial_snapshots f WHERE f.company_id=c.id AND f.raw_sha256=s.latest_sha256
  AND f.source->>'provider'=c.provider AND f.source->>'provider_company_id'=c.provider_company_id
  AND EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='signalbrief-raw' AND o.name=f.raw_object_key);
 SELECT count(*) INTO approved FROM app_private.sb_approved_filing_analyses() a WHERE a.company_id=c.id;
 IF c.provider='sec' THEN
  SELECT count(*) INTO pending FROM public.us_analyses a JOIN public.us_filings f ON f.id=a.filing_id WHERE f.company_id=c.id AND a.status='needs_review';
  SELECT * INTO request FROM app_private.company_analysis_requests a WHERE a.company_id=c.id;
  SELECT EXISTS(SELECT 1 FROM app_private.collector_analysis_attempts t JOIN public.us_filings f ON f.id=t.filing_id WHERE f.company_id=c.id AND t.status='running' AND t.attempted_at>now()-interval '5 minutes') INTO collecting;
  SELECT t.code INTO failure FROM app_private.collector_analysis_attempts t JOIN public.us_filings f ON f.id=t.filing_id WHERE f.company_id=c.id AND t.status='blocked' ORDER BY t.attempted_at DESC LIMIT 1;
 ELSE
  SELECT count(*) INTO pending FROM public.dart_analyses a JOIN public.dart_filings f ON f.id=a.filing_id WHERE f.company_id=c.id AND a.status='needs_review';
 END IF;
 analysis_state:=CASE WHEN approved>0 THEN 'approved' WHEN pending>0 THEN 'pending_review' WHEN collecting THEN 'collecting'
  WHEN failure IS NOT NULL THEN 'blocked' WHEN request.company_id IS NOT NULL AND request.completed_at IS NULL THEN 'queued' ELSE 'not_collected' END;
 IF analysis_state='queued' AND NOT EXISTS(SELECT 1 FROM app_private.us_config WHERE key='scheduled_ingestion_enabled' AND value='true'::jsonb) THEN analysis_state:='blocked';failure:='schedule_disabled';END IF;
 IF analysis_state='queued' AND NOT EXISTS(SELECT 1 FROM app_private.us_config WHERE key='ai_daily_budget_usd' AND (value::text)::numeric>0) THEN analysis_state:='blocked';failure:='ai_budget_not_approved';END IF;
 IF analysis_state IN ('approved','pending_review','collecting') THEN failure:=NULL;END IF;
 RETURN jsonb_build_object('company_id',c.id,'provider',c.provider,'status',CASE WHEN c.provider NOT IN ('sec','dart') THEN 'unsupported' WHEN s.company_id IS NULL THEN 'not_collected'
  WHEN s.status IN ('pending','collecting') THEN 'pending' WHEN s.status='ready' AND source IS NULL THEN 'unavailable' ELSE s.status END,
  'last_success_at',CASE WHEN source IS NOT NULL THEN s.last_success_at END,'error_code',CASE WHEN s.status='ready' AND source IS NULL THEN 'financial_source_unavailable' ELSE s.error_code END,
  'source',CASE WHEN source IS NULL THEN NULL ELSE jsonb_build_object('url',source->'source_url','raw_sha256',source->'raw_sha256','fetched_at',source->'fetched_at') END,
  'items',coalesce(source->'items','[]'::jsonb),'analysis',jsonb_build_object('status',analysis_state,'approved',approved,'pending_review',pending,'error_code',failure));
END $$;
REVOKE ALL ON FUNCTION app_content_private.company_financials(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION app_content_private.company_financials(text) TO authenticated;
CREATE FUNCTION public.sb_company_financials(company_id text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT app_content_private.company_financials(company_id)
$$;
REVOKE ALL ON FUNCTION public.sb_company_financials(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.sb_company_financials(text) TO authenticated;

CREATE FUNCTION public.sb_financial_collection_pick() RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT to_jsonb(c) FROM public.companies c JOIN app_private.company_financial_sources s ON s.company_id=c.id
 WHERE NOT c.is_demo AND c.provider IN ('sec','dart') AND coalesce(s.lease_until,'epoch')<now()
  AND coalesce(s.last_attempt_at,'epoch')<now()-interval '5 minutes'
  AND (s.status IN ('pending','collecting','unavailable') AND s.attempt_count<3 OR s.last_success_at<now()-interval '24 hours' AND s.attempt_count<3)
 ORDER BY s.requested_at,c.id LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.sb_financial_collection_pick() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sb_financial_collection_pick() TO service_role;

CREATE FUNCTION app_private.request_registered_company_data() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT NEW.is_demo AND NEW.provider IN ('sec','dart') THEN PERFORM app_content_private.company_financial_admin('request',jsonb_build_object('company_id',NEW.id));END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_private.request_registered_company_data() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER company_reported_data_on_registration AFTER INSERT ON public.companies FOR EACH ROW EXECUTE FUNCTION app_private.request_registered_company_data();

-- One analysis per existing collector execution, keeping the approved daily model cap.
-- New issuers get a fair first document rather than waiting behind one prolific issuer.
ALTER TABLE app_private.collector_analysis_attempts ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 1;
CREATE OR REPLACE FUNCTION public.sb_collector_analysis_pick() RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE selected uuid;BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(20261014,2);
 SELECT f.id INTO selected FROM public.us_filings f JOIN public.companies c ON c.id=f.company_id
 LEFT JOIN app_private.company_analysis_requests r ON r.company_id=c.id AND r.completed_at IS NULL
 LEFT JOIN app_private.collector_analysis_attempts t ON t.filing_id=f.id
 WHERE c.provider='sec' AND NOT c.is_demo AND f.filing_date>=current_date-550 AND f.filing_date<=current_date
  AND NOT EXISTS(SELECT 1 FROM public.us_analyses a WHERE a.filing_id=f.id)
  AND (t.filing_id IS NULL OR t.attempt_count<3 AND t.attempted_at<now()-interval '15 minutes'
   AND (t.status='running' OR t.status='blocked' AND t.code IN ('request_timeout','network_or_timeout','connection_failed','http_500','http_502','http_503','http_504','analysis_running_or_complete')))
 ORDER BY (r.company_id IS NULL),
  (SELECT count(*) FROM public.us_analyses a JOIN public.us_filings prior ON prior.id=a.filing_id WHERE prior.company_id=c.id),
  r.requested_at NULLS LAST,
  CASE WHEN f.form IN ('10-K','10-K/A','10-Q','10-Q/A','20-F','20-F/A','40-F','40-F/A') THEN 0 ELSE 1 END,
  f.filing_date DESC,f.id LIMIT 1;
 IF selected IS NOT NULL THEN
  INSERT INTO app_private.collector_analysis_attempts(filing_id) VALUES(selected)
  ON CONFLICT(filing_id) DO UPDATE SET attempted_at=now(),status='running',code=NULL,attempt_count=collector_analysis_attempts.attempt_count+1;
 END IF;
 RETURN selected;
END $$;
CREATE OR REPLACE FUNCTION public.sb_collector_analysis_finish(fid uuid,result_status text,result_code text DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF result_status NOT IN ('needs_review','blocked') OR result_code IS NOT NULL AND result_code!~'^[a-z0-9_]{1,80}$' THEN RAISE EXCEPTION 'invalid_analysis_result' USING ERRCODE='PT422';END IF;
 UPDATE app_private.collector_analysis_attempts SET status=result_status,code=result_code WHERE filing_id=fid;
 IF result_status='needs_review' THEN
  UPDATE app_private.company_analysis_requests SET completed_at=now(),error_code=NULL WHERE company_id=(SELECT company_id FROM public.us_filings WHERE id=fid);
 END IF;
END $$;
NOTIFY pgrst,'reload schema';
