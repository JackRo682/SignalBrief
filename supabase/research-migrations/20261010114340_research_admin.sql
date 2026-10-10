-- Additive research system. All raw records are private; callable operations enforce identity.
CREATE TABLE app_private.research_experiments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL CHECK(length(name) BETWEEN 3 AND 120),
 hypothesis text NOT NULL CHECK(length(hypothesis) BETWEEN 10 AND 2000), screen text NOT NULL,
 design text NOT NULL CHECK(design IN ('between','crossover')), ratio integer NOT NULL CHECK(ratio BETWEEN 1 AND 99),
 metric text NOT NULL CHECK(metric IN ('accuracy','completion','active_time','evidence')),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','running','paused','completed')),
 version integer NOT NULL DEFAULT 1, consent_version text NOT NULL DEFAULT 'research-v1',
 consent_text text NOT NULL CHECK(length(consent_text) BETWEEN 20 AND 4000),
 config jsonb NOT NULL, created_by uuid NOT NULL REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app_private.research_participants (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), experiment_id uuid NOT NULL REFERENCES app_private.research_experiments(id),
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, sequence text NOT NULL CHECK(sequence IN ('A','B','AB','BA')),
 version integer NOT NULL, consent_version text NOT NULL, consented_at timestamptz NOT NULL DEFAULT now(),
 withdrawn_at timestamptz, expires_at timestamptz NOT NULL DEFAULT now()+interval '90 days', UNIQUE(experiment_id,user_id)
);
CREATE TABLE app_private.research_observations (
 participant_id uuid NOT NULL REFERENCES app_private.research_participants(id) ON DELETE CASCADE,
 phase integer NOT NULL CHECK(phase IN (0,1)), variant text NOT NULL CHECK(variant IN ('A','B')),
 exposed_at timestamptz NOT NULL DEFAULT now(), active_ms integer NOT NULL DEFAULT 0 CHECK(active_ms BETWEEN 0 AND 3600000),
 evidence_opened boolean NOT NULL DEFAULT false, answer text, correct boolean, confidence integer CHECK(confidence BETWEEN 1 AND 5),
 submitted_at timestamptz, PRIMARY KEY(participant_id,phase)
);
CREATE TABLE app_private.research_events (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 session_id uuid NOT NULL, page_id uuid NOT NULL, screen text NOT NULL CHECK(screen IN ('today','explore','search','watchlist','portfolio','timeline','questions','calendar','alerts','saved','settings','onboarding','company','event','document','help')),
 device text NOT NULL CHECK(device IN ('mobile','desktop','unknown')), kind text NOT NULL CHECK(kind IN ('view','heartbeat','click','conversion')),
 active_ms integer NOT NULL DEFAULT 0 CHECK(active_ms BETWEEN 0 AND 15000), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX research_events_time ON app_private.research_events(created_at);
CREATE INDEX research_events_user ON app_private.research_events(user_id,created_at);
CREATE INDEX research_participants_user ON app_private.research_participants(user_id);
CREATE TABLE app_private.research_datasets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL CHECK(length(name) BETWEEN 3 AND 120),
 split text NOT NULL CHECK(split IN ('review','holdout')), version integer NOT NULL DEFAULT 1,
 created_by uuid NOT NULL REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app_private.research_cases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), dataset_id uuid NOT NULL REFERENCES app_private.research_datasets(id),
 filing_id uuid NOT NULL REFERENCES public.us_filings(id), previous_filing_id uuid NOT NULL REFERENCES public.us_filings(id),
 field text NOT NULL, period text NOT NULL, previous_period text NOT NULL, unit text NOT NULL,
 expected numeric, previous_expected numeric, answerable boolean NOT NULL DEFAULT true,
 quote text NOT NULL CHECK(length(quote) BETWEEN 5 AND 8000), previous_quote text NOT NULL CHECK(length(previous_quote) BETWEEN 5 AND 8000),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','held')),
 created_by uuid NOT NULL REFERENCES auth.users(id), reviewed_by uuid REFERENCES auth.users(id),
 reviewed_at timestamptz, reason text, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(NOT answerable OR (expected IS NOT NULL AND previous_expected IS NOT NULL)), CHECK(filing_id<>previous_filing_id),
 UNIQUE(dataset_id,filing_id,previous_filing_id,field,period)
);
CREATE TABLE app_private.research_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), dataset_id uuid NOT NULL REFERENCES app_private.research_datasets(id),
 method text NOT NULL CHECK(method IN ('A','B','C')), model text NOT NULL DEFAULT 'gpt-4.1-mini', prompt_version text NOT NULL DEFAULT 'sec-comparison-v1',
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','completed','failed')),
 created_by uuid NOT NULL REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz, finished_at timestamptz,
 cases jsonb NOT NULL, results jsonb NOT NULL DEFAULT '[]', error text,
 idempotency_key uuid UNIQUE NOT NULL
);
CREATE INDEX research_runs_dataset ON app_private.research_runs(dataset_id,created_at);
CREATE INDEX research_cases_dataset ON app_private.research_cases(dataset_id);
CREATE TABLE app_private.research_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 action text NOT NULL, target uuid, detail jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app_private.research_checks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, status text NOT NULL CHECK(status IN ('passed','failed','blocked')),
 environment text NOT NULL CHECK(environment IN ('local','preview','production')), evidence text NOT NULL,
 created_by uuid REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app_private.research_api_metrics (
 hour timestamptz PRIMARY KEY, requests bigint NOT NULL DEFAULT 0, errors bigint NOT NULL DEFAULT 0,
 latency_ms bigint NOT NULL DEFAULT 0, last_seen timestamptz NOT NULL DEFAULT now()
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['research_experiments','research_participants','research_observations','research_events','research_datasets','research_cases','research_runs','research_audit','research_checks','research_api_metrics'] LOOP
  EXECUTE format('ALTER TABLE app_private.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON app_private.%I FROM PUBLIC,anon,authenticated',t);
 END LOOP;
END $$;

CREATE FUNCTION app_private.research_experiment_result(eid uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('experiment',to_jsonb(e),'groups',(
  SELECT jsonb_agg(to_jsonb(g)) FROM (
   SELECT v.variant,count(DISTINCT p.id) FILTER(WHERE position(v.variant IN p.sequence)>0) AS assigned,
    count(o.participant_id) AS exposed,count(o.submitted_at) AS completed,
    avg(o.correct::int) FILTER(WHERE o.submitted_at IS NOT NULL) AS accuracy,
    count(o.submitted_at)::numeric/nullif(count(o.participant_id),0) AS completion_rate,
    percentile_cont(0.5) WITHIN GROUP(ORDER BY o.active_ms) FILTER(WHERE o.submitted_at IS NOT NULL) AS median_active_ms,
    avg(o.evidence_opened::int) AS evidence_rate
   FROM (VALUES('A'),('B')) v(variant)
   LEFT JOIN app_private.research_participants p ON p.experiment_id=eid AND p.withdrawn_at IS NULL AND p.expires_at>now()
   LEFT JOIN app_private.research_observations o ON o.participant_id=p.id AND o.variant=v.variant
   GROUP BY v.variant ORDER BY v.variant
  ) g),'participants',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (
    SELECT p.id,p.sequence,p.version,p.consented_at,p.consent_version,o.phase,o.variant,o.exposed_at,o.active_ms,o.answer,o.correct,o.confidence,o.evidence_opened,o.submitted_at
    FROM app_private.research_participants p LEFT JOIN app_private.research_observations o ON o.participant_id=p.id
    WHERE p.experiment_id=eid AND p.withdrawn_at IS NULL AND p.expires_at>now() ORDER BY p.consented_at DESC,o.phase LIMIT 500
   ) x),'[]'), 'method_note','Rates use exposed participants, accuracy uses submitted answers. Crossover rows are paired by participant and phase; no independent-sample significance claim. Participant detail capped at 500 rows.')
 FROM app_private.research_experiments e WHERE e.id=eid
$$;
REVOKE ALL ON FUNCTION app_private.research_experiment_result(uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION app_private.sb_research(action text,p jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET timezone='UTC' AS $$
DECLARE u uuid:=(SELECT auth.uid()); r jsonb; e app_private.research_experiments%rowtype;
 part app_private.research_participants%rowtype; reviewed_case app_private.research_cases%rowtype; ds app_private.research_datasets%rowtype;
 rid uuid; phase_index integer; v text; step jsonb; stamp timestamptz; until_stamp timestamptz; screen_filter text; device_filter text;
BEGIN
 IF u IS NULL OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=u) THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='PT401'; END IF;
 PERFORM public.sb_require_mfa();
 IF p IS NULL OR jsonb_typeof(p)<>'object' OR octet_length(p::text)>64000 THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='PT422';END IF;
 PERFORM public.sb_rate_limit();
 IF action='track' THEN
  PERFORM 1 FROM public.users WHERE id=u::text AND analytics_consent FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('recorded',false); END IF;
  IF p-'id'-'session_id'-'page_id'-'screen'-'device'-'kind'-'active_ms'<>'{}' THEN RAISE EXCEPTION 'invalid_event' USING ERRCODE='PT422';END IF;
  INSERT INTO app_private.research_events(id,user_id,session_id,page_id,screen,device,kind,active_ms)
   VALUES((p->>'id')::uuid,u,(p->>'session_id')::uuid,(p->>'page_id')::uuid,p->>'screen',p->>'device',p->>'kind',coalesce((p->>'active_ms')::int,0)) ON CONFLICT(id) DO NOTHING;
  RETURN jsonb_build_object('recorded',true);
 ELSIF action='analytics_delete' THEN
  UPDATE public.users SET analytics_consent=false WHERE id=u::text;
  DELETE FROM app_private.research_events WHERE user_id=u;
  RETURN jsonb_build_object('deleted',true);
 ELSIF action IN ('study','join','expose','study_event','submit','withdraw') THEN
  SELECT * INTO e FROM app_private.research_experiments WHERE id=(p->>'id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'study_not_found' USING ERRCODE='PT404'; END IF;
  SELECT * INTO part FROM app_private.research_participants WHERE experiment_id=e.id AND user_id=u FOR UPDATE;
  IF action='withdraw' THEN
   DELETE FROM app_private.research_observations WHERE participant_id=part.id;
   UPDATE app_private.research_participants SET withdrawn_at=coalesce(withdrawn_at,now()) WHERE id=part.id;
   RETURN jsonb_build_object('withdrawn',true);
  END IF;
  IF part.withdrawn_at IS NOT NULL OR part.expires_at<=now() THEN RAISE EXCEPTION 'consent_withdrawn_or_expired' USING ERRCODE='PT403';END IF;
  IF action='join' THEN
   IF e.status<>'running' OR p->>'consent_version' IS DISTINCT FROM e.consent_version OR p->>'consent' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'study_consent_required' USING ERRCODE='PT409';END IF;
   IF part.id IS NULL THEN
    v:=CASE WHEN (('x'||substr(replace(gen_random_uuid()::text,'-',''),1,8))::bit(32)::bigint%100)<e.ratio THEN 'A' ELSE 'B' END;
    IF e.design='crossover' THEN v:=CASE v WHEN 'A' THEN 'AB' ELSE 'BA' END;END IF;
    INSERT INTO app_private.research_participants(experiment_id,user_id,sequence,version,consent_version) VALUES(e.id,u,v,e.version,e.consent_version) RETURNING * INTO part;
   END IF;
  END IF;
  SELECT count(*) INTO phase_index FROM app_private.research_observations WHERE participant_id=part.id AND submitted_at IS NOT NULL;
  IF action IN ('expose','study_event','submit') THEN
   IF part.id IS NULL OR e.status<>'running' THEN RAISE EXCEPTION 'active_consent_required' USING ERRCODE='PT403';END IF;
   -- Retrying a successful submission is idempotent; a retry cannot submit the next phase.
   IF action='submit' AND EXISTS(SELECT 1 FROM app_private.research_observations WHERE participant_id=part.id AND phase=(p->>'phase')::int AND submitted_at IS NOT NULL) THEN
    RETURN jsonb_build_object('submitted',true);
   END IF;
   IF (p->>'phase')::int IS DISTINCT FROM phase_index OR phase_index>=length(part.sequence) THEN RAISE EXCEPTION 'phase_conflict' USING ERRCODE='PT409';END IF;
   v:=substr(part.sequence,phase_index+1,1);step:=e.config->v;
   IF action='expose' THEN
    INSERT INTO app_private.research_observations(participant_id,phase,variant) VALUES(part.id,phase_index,v) ON CONFLICT DO NOTHING;
   ELSE
    IF NOT EXISTS(SELECT 1 FROM app_private.research_observations WHERE participant_id=part.id AND research_observations.phase=phase_index) THEN RAISE EXCEPTION 'exposure_required' USING ERRCODE='PT409';END IF;
    IF action='study_event' THEN
     UPDATE app_private.research_observations o SET active_ms=greatest(o.active_ms,least(greatest(coalesce((p->>'active_ms')::int,0),0),3600000,greatest(0,(extract(epoch FROM now()-o.exposed_at)*1000)::int))), evidence_opened=o.evidence_opened OR coalesce((p->>'evidence_opened')::boolean,false) WHERE o.participant_id=part.id AND o.phase=phase_index;
    ELSE
     IF length(coalesce(p->>'answer','')) NOT BETWEEN 1 AND 500 OR p->>'confidence' IS NULL OR (p->>'confidence')::int NOT BETWEEN 1 AND 5 THEN RAISE EXCEPTION 'invalid_answer' USING ERRCODE='PT422';END IF;
     UPDATE app_private.research_observations o SET answer=p->>'answer',confidence=(p->>'confidence')::int,correct=lower(trim(p->>'answer'))=lower(trim(step->>'answer')),submitted_at=now() WHERE o.participant_id=part.id AND o.phase=phase_index;
    END IF;
   END IF;
   RETURN jsonb_build_object('saved',true);
  END IF;
  RETURN jsonb_build_object('id',e.id,'name',e.name,'status',e.status,'consent_text',e.consent_text,'consent_version',e.consent_version,
   'joined',part.id IS NOT NULL,'phase',phase_index,'total',CASE e.design WHEN 'crossover' THEN 2 ELSE 1 END,'complete',part.id IS NOT NULL AND phase_index>=length(part.sequence),
   'step',CASE WHEN part.id IS NOT NULL AND phase_index<length(part.sequence) AND e.status='running' THEN (e.config->substr(part.sequence,phase_index+1,1))-'answer' ELSE NULL END);
 END IF;
 IF NOT app_private.sb_is_admin() THEN RAISE EXCEPTION 'admin_required' USING ERRCODE='PT403';END IF;
 CASE action
 WHEN 'experiments' THEN
  RETURN jsonb_build_object('items',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT id,name,hypothesis,screen,design,ratio,metric,status,version,created_at FROM app_private.research_experiments ORDER BY created_at DESC LIMIT 200) x),'[]'));
 WHEN 'experiment' THEN
  r:=app_private.research_experiment_result((p->>'id')::uuid);IF r IS NULL THEN RAISE EXCEPTION 'experiment_not_found' USING ERRCODE='PT404';END IF;RETURN r;
 WHEN 'experiment_create' THEN
  IF p->>'screen' NOT IN ('today','event','document') OR jsonb_typeof(p->'config') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'invalid_experiment' USING ERRCODE='PT422';END IF;
  FOREACH v IN ARRAY ARRAY['A','B'] LOOP
   step:=p->'config'->v;
   IF step IS NULL OR length(coalesce(step->>'content','')) NOT BETWEEN 20 AND 12000 OR length(coalesce(step->>'question','')) NOT BETWEEN 3 AND 1000 OR length(coalesce(step->>'answer','')) NOT BETWEEN 1 AND 500 OR coalesce(step->>'source_url','') !~ '^https://(www\.)?sec\.gov/Archives/' THEN RAISE EXCEPTION 'invalid_variant' USING ERRCODE='PT422';END IF;
  END LOOP;
  INSERT INTO app_private.research_experiments(name,hypothesis,screen,design,ratio,metric,consent_text,config,created_by)
   VALUES(p->>'name',p->>'hypothesis',p->>'screen',p->>'design',(p->>'ratio')::int,p->>'metric',p->>'consent_text',p->'config',u) RETURNING id INTO rid;
 WHEN 'experiment_status' THEN
  SELECT * INTO e FROM app_private.research_experiments WHERE id=(p->>'id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'experiment_not_found' USING ERRCODE='PT404';END IF;
  IF NOT ((e.status='draft' AND p->>'status'='running') OR (e.status='running' AND p->>'status' IN ('paused','completed')) OR (e.status='paused' AND p->>'status' IN ('running','completed'))) THEN RAISE EXCEPTION 'invalid_transition' USING ERRCODE='PT409';END IF;
  UPDATE app_private.research_experiments SET status=p->>'status' WHERE id=e.id;rid:=e.id;
 WHEN 'analytics' THEN
  stamp:=coalesce((p->>'from')::date,current_date-29)::timestamptz;until_stamp:=coalesce((p->>'to')::date,current_date)::timestamptz+interval '1 day';
  IF until_stamp<=stamp OR until_stamp-stamp>interval '90 days' THEN RAISE EXCEPTION 'invalid_date_range' USING ERRCODE='PT422';END IF;
  screen_filter:=nullif(p->>'screen','');device_filter:=nullif(p->>'device','');
  WITH filtered AS (SELECT a.* FROM app_private.research_events a JOIN public.users u ON u.id=a.user_id::text AND u.analytics_consent WHERE a.created_at>=stamp AND a.created_at<until_stamp AND a.created_at>now()-interval '90 days' AND (screen_filter IS NULL OR a.screen=screen_filter) AND (device_filter IS NULL OR a.device=device_filter)),
  sessions AS (SELECT session_id,count(*) FILTER(WHERE kind='view') views,sum(active_ms) active FROM filtered WHERE kind<>'conversion' GROUP BY session_id),
  pages AS (SELECT screen,count(*) FILTER(WHERE kind='view') views,count(DISTINCT user_id) users,sum(active_ms) active_ms,count(*) FILTER(WHERE kind='click') clicks,count(*) FILTER(WHERE kind='conversion') conversions FROM filtered GROUP BY screen),
  days AS (SELECT created_at::date AS day,count(DISTINCT user_id) users FROM filtered GROUP BY created_at::date),
  firsts AS (SELECT user_id,min(created_at::date) first_day FROM app_private.research_events GROUP BY user_id),
  paths AS (SELECT screen,lead(screen) OVER(PARTITION BY session_id ORDER BY created_at,id) next FROM filtered WHERE kind='view'),
  retention AS (SELECT d.day,count(*) denominator,count(*) FILTER(WHERE EXISTS(SELECT 1 FROM filtered f WHERE f.user_id=c.user_id AND f.created_at::date=c.first_day+d.day)) numerator FROM firsts c CROSS JOIN (VALUES(1),(7)) d(day) WHERE c.first_day>=stamp::date AND c.first_day+d.day<until_stamp::date AND c.first_day+d.day<current_date GROUP BY d.day)
  SELECT jsonb_build_object('from',stamp,'to',until_stamp,'timezone','UTC','users',(SELECT count(DISTINCT user_id) FROM filtered),
   'dau',(SELECT count(DISTINCT user_id) FROM filtered WHERE created_at>=until_stamp-interval '1 day'),'wau',(SELECT count(DISTINCT user_id) FROM filtered WHERE created_at>=until_stamp-interval '7 days'),
   'views',(SELECT count(*) FROM filtered WHERE kind='view'),'active_ms',(SELECT coalesce(sum(active_ms),0) FROM filtered),'bounce_rate',(SELECT avg((views=1 AND active<10000)::int) FROM sessions),
   'pages',coalesce((SELECT jsonb_agg(to_jsonb(pages)) FROM pages),'[]'),'days',coalesce((SELECT jsonb_agg(to_jsonb(days) ORDER BY day) FROM days),'[]'),
   'retention',coalesce((SELECT jsonb_agg(to_jsonb(retention)) FROM retention),'[]'),
   'paths',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT screen,next,count(*) count FROM paths WHERE next IS NOT NULL GROUP BY screen,next ORDER BY count(*) DESC LIMIT 20)x),'[]'),
   'note','Consent-only signed-in users. UTC calendar days. Bounce: one view and <10s active. Retention: first observed day, mature cohorts only. Sign-up visitor conversion cannot be inferred. 90-day retention.') INTO r;RETURN r;
 WHEN 'datasets' THEN
  RETURN jsonb_build_object('daily_budget_usd',(SELECT value FROM app_private.us_config WHERE key='ai_daily_budget_usd'),'items',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT d.*,(SELECT count(*) FROM app_private.research_cases c WHERE c.dataset_id=d.id) cases,(SELECT count(*) FROM app_private.research_cases c WHERE c.dataset_id=d.id AND status='approved') approved FROM app_private.research_datasets d ORDER BY created_at DESC LIMIT 200)x),'[]'),
   'filings',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT f.id,c.ticker,f.form,f.filing_date,f.document_url FROM public.us_filings f JOIN public.companies c ON c.id=f.company_id WHERE c.ticker IN ('AAPL','MSFT','NVDA') AND NOT c.is_demo ORDER BY f.filing_date DESC LIMIT 300)x),'[]'));
 WHEN 'dataset_create' THEN
  INSERT INTO app_private.research_datasets(name,split,created_by) VALUES(p->>'name',p->>'split',u) RETURNING id INTO rid;
 WHEN 'evaluation_budget' THEN
  IF p->>'usd' IS NULL OR (p->>'usd')::numeric NOT BETWEEN 0 AND 10 THEN RAISE EXCEPTION 'invalid_budget' USING ERRCODE='PT422';END IF;
  UPDATE app_private.us_config SET value=to_jsonb((p->>'usd')::numeric) WHERE key='ai_daily_budget_usd';
 WHEN 'dataset' THEN
  SELECT to_jsonb(d) INTO r FROM app_private.research_datasets d WHERE id=(p->>'id')::uuid;
  IF r IS NULL THEN RAISE EXCEPTION 'dataset_not_found' USING ERRCODE='PT404';END IF;
  RETURN jsonb_build_object('dataset',r,'cases',coalesce((SELECT jsonb_agg(to_jsonb(c)||jsonb_build_object('source_url',f.document_url,'previous_source_url',pf.document_url,'source_sha256',f.source_sha256,'ticker',co.ticker)) FROM app_private.research_cases c JOIN public.us_filings f ON f.id=c.filing_id JOIN public.us_filings pf ON pf.id=c.previous_filing_id JOIN public.companies co ON co.id=f.company_id WHERE c.dataset_id=(p->>'id')::uuid),'[]'));
 WHEN 'case_create' THEN
  -- Serialize allocation across datasets so concurrent imports cannot leak holdout filings.
  PERFORM pg_advisory_xact_lock(71420261010);
  SELECT * INTO ds FROM app_private.research_datasets WHERE id=(p->>'dataset_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'dataset_not_found' USING ERRCODE='PT404';END IF;
  IF EXISTS(SELECT 1 FROM app_private.research_runs WHERE dataset_id=ds.id) THEN RAISE EXCEPTION 'dataset_frozen_create_new_version' USING ERRCODE='PT409';END IF;
  IF NOT EXISTS(SELECT 1 FROM public.us_filings f JOIN public.us_filings prev ON prev.company_id=f.company_id JOIN public.companies co ON co.id=f.company_id WHERE f.id=(p->>'filing_id')::uuid AND prev.id=(p->>'previous_filing_id')::uuid AND co.ticker IN ('AAPL','MSFT','NVDA') AND NOT co.is_demo AND f.filing_date>prev.filing_date) THEN RAISE EXCEPTION 'invalid_filing_pair' USING ERRCODE='PT422';END IF;
  IF EXISTS(SELECT 1 FROM app_private.research_cases c JOIN app_private.research_datasets d ON d.id=c.dataset_id WHERE d.split<>ds.split AND (c.filing_id IN ((p->>'filing_id')::uuid,(p->>'previous_filing_id')::uuid) OR c.previous_filing_id IN ((p->>'filing_id')::uuid,(p->>'previous_filing_id')::uuid))) THEN RAISE EXCEPTION 'review_holdout_overlap' USING ERRCODE='PT409';END IF;
  INSERT INTO app_private.research_cases(dataset_id,filing_id,previous_filing_id,field,period,previous_period,unit,expected,previous_expected,answerable,quote,previous_quote,created_by)
   VALUES(ds.id,(p->>'filing_id')::uuid,(p->>'previous_filing_id')::uuid,p->>'field',p->>'period',p->>'previous_period',p->>'unit',nullif(p->>'expected','')::numeric,nullif(p->>'previous_expected','')::numeric,coalesce((p->>'answerable')::boolean,true),p->>'quote',p->>'previous_quote',u) RETURNING id INTO rid;
 WHEN 'case_review' THEN
  SELECT * INTO reviewed_case FROM app_private.research_cases WHERE id=(p->>'id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'case_not_found' USING ERRCODE='PT404';END IF;
  IF reviewed_case.created_by=u THEN RAISE EXCEPTION 'independent_reviewer_required' USING ERRCODE='PT403';END IF;
  IF p->>'status' NOT IN ('approved','rejected','held') OR length(coalesce(p->>'reason',''))<5 THEN RAISE EXCEPTION 'review_reason_required' USING ERRCODE='PT422';END IF;
  PERFORM 1 FROM app_private.research_datasets WHERE id=reviewed_case.dataset_id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM app_private.research_runs WHERE dataset_id=reviewed_case.dataset_id) THEN RAISE EXCEPTION 'dataset_frozen_create_new_version' USING ERRCODE='PT409';END IF;
  UPDATE app_private.research_cases SET status=p->>'status',reason=p->>'reason',reviewed_by=u,reviewed_at=now() WHERE id=reviewed_case.id;rid:=reviewed_case.id;
 WHEN 'evaluation_create' THEN
  SELECT * INTO ds FROM app_private.research_datasets WHERE id=(p->>'dataset_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'dataset_not_found' USING ERRCODE='PT404';END IF;
  SELECT jsonb_agg(to_jsonb(c)||jsonb_build_object('expected',c.expected::text,'previous_expected',c.previous_expected::text,'source_url',f.document_url,'previous_source_url',pf.document_url)) INTO r FROM app_private.research_cases c JOIN public.us_filings f ON f.id=c.filing_id JOIN public.us_filings pf ON pf.id=c.previous_filing_id WHERE c.dataset_id=ds.id AND c.status='approved';
  IF r IS NULL OR jsonb_array_length(r)>20 OR EXISTS(SELECT 1 FROM app_private.research_cases WHERE dataset_id=ds.id AND status<>'approved') THEN RAISE EXCEPTION 'approve_all_cases_max_20' USING ERRCODE='PT409';END IF;
  INSERT INTO app_private.research_runs(dataset_id,method,created_by,cases,idempotency_key) VALUES(ds.id,p->>'method',u,r,(p->>'idempotency_key')::uuid) ON CONFLICT(idempotency_key) DO NOTHING RETURNING id INTO rid;
  IF rid IS NULL THEN SELECT id INTO rid FROM app_private.research_runs WHERE idempotency_key=(p->>'idempotency_key')::uuid;END IF;
 WHEN 'evaluations' THEN
  RETURN jsonb_build_object('runs',coalesce((SELECT jsonb_agg(to_jsonb(x)-'cases') FROM (SELECT * FROM app_private.research_runs ORDER BY created_at DESC LIMIT 100)x),'[]'));
 WHEN 'evaluation' THEN
  SELECT to_jsonb(x) INTO r FROM app_private.research_runs x WHERE id=(p->>'id')::uuid;
  IF r IS NULL THEN RAISE EXCEPTION 'run_not_found' USING ERRCODE='PT404';END IF;RETURN r;
 WHEN 'quality' THEN
  RETURN jsonb_build_object('analyses',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT a.filing_id,a.status,a.model,a.result,f.document_url,c.ticker FROM public.us_analyses a JOIN public.us_filings f ON f.id=a.filing_id JOIN public.companies c ON c.id=f.company_id ORDER BY a.created_at DESC LIMIT 100)x),'[]'),
   'reports',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT id,event_id,rating,comment,state FROM public.feedback ORDER BY created_at DESC LIMIT 100)x),'[]'));
 WHEN 'reliability' THEN
  RETURN jsonb_build_object('jobs',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT id,kind,state,attempts,last_error,created_at,lease_until FROM public.jobs ORDER BY created_at DESC LIMIT 100)x),'[]'),
   'runs',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT id,status,error_code,latency_ms,created_at FROM public.ai_runs ORDER BY created_at DESC LIMIT 100)x),'[]'),
   'checks',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM app_private.research_checks ORDER BY created_at DESC LIMIT 50)x),'[]'),
   'provider_checks',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM public.us_provider_checks x),'[]'),
   'api_error_rate',(SELECT sum(errors)::numeric/nullif(sum(requests),0) FROM app_private.research_api_metrics WHERE hour>now()-interval '24 hours'),
   'api_requests',(SELECT coalesce(sum(requests),0) FROM app_private.research_api_metrics WHERE hour>now()-interval '24 hours'),
   'api_latency_ms',(SELECT sum(latency_ms)::numeric/nullif(sum(requests),0) FROM app_private.research_api_metrics WHERE hour>now()-interval '24 hours'),
   'worker_heartbeat',NULL,'evaluation_running',(SELECT count(*) FROM app_private.research_runs WHERE status='running' AND started_at>now()-interval '10 minutes'),
   'evaluation_stale',(SELECT count(*) FROM app_private.research_runs WHERE status='running' AND started_at<=now()-interval '10 minutes'),
   'note','API metrics cover signalbrief-api completed private requests in the last 24 hours, not all Vercel requests. Python worker heartbeat is not connected. Fault injection is restricted to disposable test environments.');
 WHEN 'check_record' THEN
  IF p->>'environment'='production' AND p->>'name' LIKE '%fault%' THEN RAISE EXCEPTION 'production_fault_test_forbidden' USING ERRCODE='PT403';END IF;
  IF length(coalesce(p->>'evidence','')) NOT BETWEEN 10 AND 4000 THEN RAISE EXCEPTION 'evidence_required' USING ERRCODE='PT422';END IF;
  INSERT INTO app_private.research_checks(name,status,environment,evidence,created_by) VALUES(p->>'name',p->>'status',p->>'environment',p->>'evidence',u) RETURNING id INTO rid;
 WHEN 'reports' THEN
  RETURN jsonb_build_object('generated_at',now(),'method_version','research-v1','retention_days',90,
   'experiments',coalesce((SELECT jsonb_agg(app_private.research_experiment_result(id)-'participants') FROM app_private.research_experiments),'[]'),
   'evaluations',app_private.sb_research('evaluations','{}')->'runs','checks',app_private.sb_research('reliability','{}')->'checks',
   'limitations',jsonb_build_array('No fabricated participants or results.','Descriptive metrics only; no significance or causal claim.','Withdrawn and expired participant observations excluded at export time.','Evaluation uses independently approved excerpts; full-document coverage is not implied.','Costs remain unknown unless measured with a stated price basis.'));
 ELSE RAISE EXCEPTION 'unknown_action' USING ERRCODE='PT404';
 END CASE;
  INSERT INTO app_private.research_audit(actor,action,target,detail) VALUES(u,action,rid,jsonb_build_object('status',p->>'status','reason',p->>'reason','budget_usd',p->>'usd'));
 RETURN jsonb_build_object('id',rid,'saved',true);
END $$;
REVOKE ALL ON FUNCTION app_private.sb_research(text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION app_private.sb_research(text,jsonb) TO authenticated;
CREATE FUNCTION public.sb_research(action text,p jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT app_private.sb_research(action,p) $$;
REVOKE ALL ON FUNCTION public.sb_research(text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.sb_research(text,jsonb) TO authenticated;

-- The trusted evaluation worker can claim a run once and persist actual model output.
CREATE FUNCTION public.sb_research_worker(action text,p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r app_private.research_runs%rowtype; BEGIN
 IF action='claim' THEN
  UPDATE app_private.research_runs SET status='running',started_at=now() WHERE id=(p->>'id')::uuid AND status='queued' RETURNING * INTO r;
  IF r.id IS NULL THEN RAISE EXCEPTION 'run_already_claimed' USING ERRCODE='PT409';END IF;RETURN to_jsonb(r);
 ELSIF action='finish' THEN
  UPDATE app_private.research_runs SET status=p->>'status',results=p->'results',error=p->>'error',finished_at=now() WHERE id=(p->>'id')::uuid AND status='running';
  RETURN jsonb_build_object('saved',FOUND);
 END IF;RAISE EXCEPTION 'unknown_action'; END $$;
REVOKE ALL ON FUNCTION public.sb_research_worker(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sb_research_worker(text,jsonb) TO service_role;
CREATE FUNCTION public.sb_research_observe(status integer,latency integer) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF status NOT BETWEEN 100 AND 599 OR latency NOT BETWEEN 0 AND 300000 THEN RETURN;END IF;
 INSERT INTO app_private.research_api_metrics(hour,requests,errors,latency_ms) VALUES(date_trunc('hour',now()),1,(status>=500)::int,latency)
 ON CONFLICT(hour) DO UPDATE SET requests=research_api_metrics.requests+1,errors=research_api_metrics.errors+(status>=500)::int,latency_ms=research_api_metrics.latency_ms+latency,last_seen=now();
END $$;
REVOKE ALL ON FUNCTION public.sb_research_observe(integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sb_research_observe(integer,integer) TO service_role;

-- Consent withdrawal deletes the new analytics history in the same transaction.
CREATE FUNCTION app_private.research_consent_cleanup() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF OLD.analytics_consent AND NOT NEW.analytics_consent THEN DELETE FROM app_private.research_events WHERE user_id=NEW.id::uuid;END IF;RETURN NEW;END $$;
REVOKE ALL ON FUNCTION app_private.research_consent_cleanup() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER research_consent_cleanup AFTER UPDATE OF analytics_consent ON public.users FOR EACH ROW EXECUTE FUNCTION app_private.research_consent_cleanup();
CREATE FUNCTION app_private.research_onboarding_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF NOT OLD.onboarding_completed AND NEW.onboarding_completed AND NEW.analytics_consent THEN
  INSERT INTO app_private.research_events(id,user_id,session_id,page_id,screen,device,kind) VALUES(gen_random_uuid(),NEW.id::uuid,gen_random_uuid(),gen_random_uuid(),'onboarding','unknown','conversion');
 END IF;RETURN NEW;END $$;
REVOKE ALL ON FUNCTION app_private.research_onboarding_event() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER research_onboarding_event AFTER UPDATE OF onboarding_completed ON public.users FOR EACH ROW EXECUTE FUNCTION app_private.research_onboarding_event();
CREATE FUNCTION public.sb_research_retention() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 DELETE FROM app_private.research_events WHERE created_at<now()-interval '90 days';
 DELETE FROM app_private.research_api_metrics WHERE hour<now()-interval '30 days';
 DELETE FROM app_private.research_observations WHERE participant_id IN (SELECT id FROM app_private.research_participants WHERE expires_at<=now() OR withdrawn_at IS NOT NULL);
 DELETE FROM app_private.research_participants WHERE expires_at<now()-interval '30 days';
 UPDATE app_private.research_runs SET status='failed',error='worker_timeout',finished_at=now() WHERE status='running' AND started_at<now()-interval '10 minutes';
END $$;
REVOKE ALL ON FUNCTION public.sb_research_retention() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sb_research_retention() TO service_role;
-- Supabase supports pg_cron. Disposable PostgreSQL installations without the extension
-- still replay the same schema; integration tests call retention directly.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_available_extensions WHERE name='pg_cron') THEN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  PERFORM cron.schedule('signalbrief-research-retention','17 3 * * *','select public.sb_research_retention()');
 END IF;
END $$;
