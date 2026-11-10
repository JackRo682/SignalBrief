-- First-party, explicitly consented acquisition telemetry. No email, IP, UA or URL query storage.
CREATE TABLE app_private.traffic_visitors (
 id uuid PRIMARY KEY, secret_hash text NOT NULL,
 source text CHECK(source IN ('direct','google','naver','disquiet','geeknews','youtube','x','other')),
 withdrawn_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), consent_version text NOT NULL DEFAULT '2026-11-10',
 CHECK ((withdrawn_at IS NULL) = (source IS NOT NULL))
);
CREATE INDEX traffic_visitors_created ON app_private.traffic_visitors(created_at);
CREATE TABLE app_private.traffic_events (
 id uuid PRIMARY KEY, visitor_id uuid NOT NULL REFERENCES app_private.traffic_visitors(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('page_view','signup_start','signup_requested','signup_complete','onboarding_complete')),
 page text NOT NULL CHECK(page IN ('home','about','features','sources','pricing','customers','privacy','terms','disclaimer','signup','login','onboarding')),
 created_at timestamptz NOT NULL DEFAULT now(), user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
 CHECK ((kind IN ('signup_complete','onboarding_complete')) = (user_id IS NOT NULL))
);
CREATE INDEX traffic_events_time ON app_private.traffic_events(created_at,visitor_id);
CREATE INDEX traffic_events_visitor ON app_private.traffic_events(visitor_id,created_at,kind);
CREATE UNIQUE INDEX traffic_events_verified_once ON app_private.traffic_events(user_id,kind) WHERE user_id IS NOT NULL;
ALTER TABLE app_private.traffic_visitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.traffic_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.traffic_visitors,app_private.traffic_events FROM PUBLIC,anon,authenticated;

CREATE FUNCTION app_private.sb_traffic(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 action text:=p->>'action'; actor uuid:=(SELECT auth.uid()); stamp timestamptz:=now();
 vid uuid; eid uuid; secret_digest text; existing_hash text; withdrawn timestamptz; event text; page_name text; origin_name text;
 session_claim text; day_from date; day_to date; lower_bound timestamptz; upper_bound timestamptz;
 joined_at timestamptz; started_at timestamptz; result jsonb; key text;
BEGIN
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR octet_length(p::text)>4096 OR action IS NULL OR action NOT IN ('record','erase','summary') THEN
  RAISE EXCEPTION 'invalid_input' USING ERRCODE='PT422';
 END IF;
 FOR key IN SELECT jsonb_object_keys(p) LOOP
  IF action='summary' AND key NOT IN ('action','from','to') OR action='erase' AND key NOT IN ('action','visitor_id','secret')
   OR action='record' AND key NOT IN ('action','visitor_id','secret','id','kind','page','source') THEN
   RAISE EXCEPTION 'invalid_input' USING ERRCODE='PT422';
  END IF;
 END LOOP;
 IF actor IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=actor AND deleted_at IS NULL AND (banned_until IS NULL OR banned_until<=stamp) AND email_confirmed_at IS NOT NULL) THEN
   RAISE EXCEPTION 'verified_account_required' USING ERRCODE='PT401';
  END IF;
  session_claim:=(SELECT auth.jwt())->>'session_id';
  IF session_claim IS NULL OR session_claim !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
   RAISE EXCEPTION 'session_revoked' USING ERRCODE='PT401';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM auth.sessions WHERE id=session_claim::uuid AND user_id=actor AND (not_after IS NULL OR not_after>stamp)) THEN
   RAISE EXCEPTION 'session_revoked' USING ERRCODE='PT401';
  END IF;
 END IF;
 IF action='summary' THEN
  IF actor IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='PT401';END IF;
  IF NOT app_private.sb_is_admin() THEN RAISE EXCEPTION 'admin_required' USING ERRCODE='PT403';END IF;
  PERFORM public.sb_require_mfa(); PERFORM public.sb_rate_limit();
  IF coalesce(p->>'from','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR coalesce(p->>'to','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'invalid_dates' USING ERRCODE='PT422';END IF;
  BEGIN day_from:=(p->>'from')::date;day_to:=(p->>'to')::date;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RAISE EXCEPTION 'invalid_dates' USING ERRCODE='PT422';END;
  IF day_to<day_from OR day_to-day_from>89 THEN RAISE EXCEPTION 'invalid_dates' USING ERRCODE='PT422';END IF;
  lower_bound:=greatest(day_from::timestamp AT TIME ZONE 'Asia/Seoul',stamp-interval '90 days');
  upper_bound:=(day_to+1)::timestamp AT TIME ZONE 'Asia/Seoul';
  WITH events AS MATERIALIZED (
   SELECT e.*,v.source,(e.created_at AT TIME ZONE 'Asia/Seoul')::date AS day
   FROM app_private.traffic_events e JOIN app_private.traffic_visitors v ON v.id=e.visitor_id
   WHERE e.created_at>=lower_bound AND e.created_at<upper_bound AND e.created_at<=stamp
  ), totals AS (
   SELECT count(DISTINCT visitor_id)::int visitors,count(*) FILTER(WHERE kind='page_view')::int pageviews,
    count(DISTINCT visitor_id) FILTER(WHERE kind='signup_start')::int starts,
    count(DISTINCT visitor_id) FILTER(WHERE kind='signup_requested')::int requests,
    count(DISTINCT visitor_id) FILTER(WHERE kind='signup_complete')::int signups,
    count(DISTINCT visitor_id) FILTER(WHERE kind='onboarding_complete')::int onboarded FROM events
  ), daily AS (
   SELECT day,count(DISTINCT visitor_id)::int visitors,count(*) FILTER(WHERE kind='page_view')::int pageviews,
    count(DISTINCT visitor_id) FILTER(WHERE kind='signup_start')::int starts,
    count(DISTINCT visitor_id) FILTER(WHERE kind='signup_requested')::int requests,
    count(DISTINCT visitor_id) FILTER(WHERE kind='signup_complete')::int signups,
    count(DISTINCT visitor_id) FILTER(WHERE kind='onboarding_complete')::int onboarded FROM events GROUP BY day
  ), sources AS (
   SELECT source,count(DISTINCT visitor_id)::int visitors,count(*) FILTER(WHERE kind='page_view')::int pageviews,
    count(DISTINCT visitor_id) FILTER(WHERE kind='signup_start')::int starts,
    count(DISTINCT visitor_id) FILTER(WHERE kind='signup_requested')::int requests,
    count(DISTINCT visitor_id) FILTER(WHERE kind='signup_complete')::int signups,
    count(DISTINCT visitor_id) FILTER(WHERE kind='onboarding_complete')::int onboarded FROM events GROUP BY source
  ) SELECT jsonb_build_object('generated_at',stamp,'totals',(SELECT to_jsonb(t) FROM totals t),
   'daily',coalesce((SELECT jsonb_agg(d ORDER BY day DESC) FROM daily d),'[]'::jsonb),
   'sources',coalesce((SELECT jsonb_agg(s ORDER BY visitors DESC,source) FROM sources s),'[]'::jsonb)) INTO result;
  RETURN result;
 END IF;
 IF coalesce(p->>'visitor_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  OR coalesce(p->>'secret','') !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'invalid_identity' USING ERRCODE='PT422';END IF;
 vid:=(p->>'visitor_id')::uuid;secret_digest:=encode(sha256(convert_to(p->>'secret','UTF8')),'hex');
 IF action='erase' THEN
  PERFORM pg_advisory_xact_lock(1872601110);
  IF NOT EXISTS(SELECT 1 FROM app_private.traffic_visitors WHERE id=vid) AND (SELECT count(*) FROM app_private.traffic_visitors WHERE created_at>=stamp-interval '1 day')>=20000 THEN RAISE EXCEPTION 'rate_limit' USING ERRCODE='PT429';END IF;
  INSERT INTO app_private.traffic_visitors(id,secret_hash,source,withdrawn_at) VALUES(vid,secret_digest,NULL,stamp)
   ON CONFLICT(id) DO UPDATE SET source=NULL,withdrawn_at=stamp WHERE traffic_visitors.secret_hash=secret_digest;
  DELETE FROM app_private.traffic_events WHERE visitor_id=vid AND EXISTS(SELECT 1 FROM app_private.traffic_visitors WHERE id=vid AND secret_hash=secret_digest AND withdrawn_at IS NOT NULL);
  RETURN jsonb_build_object('ok',true);
 END IF;
 event:=p->>'kind';page_name:=p->>'page';origin_name:=p->>'source';
 IF coalesce(p->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  OR event IS NULL OR event NOT IN ('page_view','signup_start','signup_requested','signup_complete','onboarding_complete')
  OR page_name IS NULL OR page_name NOT IN ('home','about','features','sources','pricing','customers','privacy','terms','disclaimer','signup','login','onboarding')
  OR origin_name IS NULL OR origin_name NOT IN ('direct','google','naver','disquiet','geeknews','youtube','x','other') THEN RAISE EXCEPTION 'invalid_event' USING ERRCODE='PT422';END IF;
 IF event IN ('signup_complete','onboarding_complete') AND actor IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='PT401';END IF;
 IF actor IS NOT NULL AND app_private.sb_is_admin() THEN RETURN jsonb_build_object('ok',true,'recorded',false);END IF;
 eid:=(p->>'id')::uuid;
 -- Bound anonymous ingestion; serialize new visitors to prevent cap races.
 IF NOT EXISTS(SELECT 1 FROM app_private.traffic_visitors WHERE id=vid) THEN
  PERFORM pg_advisory_xact_lock(1872601110);
  IF (SELECT count(*) FROM app_private.traffic_visitors WHERE created_at>=stamp-interval '1 day')>=20000 THEN RAISE EXCEPTION 'rate_limit' USING ERRCODE='PT429';END IF;
  INSERT INTO app_private.traffic_visitors(id,secret_hash,source) VALUES(vid,secret_digest,origin_name) ON CONFLICT DO NOTHING;
 END IF;
 SELECT v.secret_hash,v.withdrawn_at INTO existing_hash,withdrawn FROM app_private.traffic_visitors v WHERE v.id=vid FOR UPDATE;
 IF existing_hash IS DISTINCT FROM secret_digest THEN RAISE EXCEPTION 'invalid_identity' USING ERRCODE='PT403';END IF;
 IF withdrawn IS NOT NULL THEN RETURN jsonb_build_object('ok',true,'recorded',false);END IF;
 IF EXISTS(SELECT 1 FROM app_private.traffic_events WHERE id=eid AND visitor_id=vid) THEN RETURN jsonb_build_object('ok',true,'recorded',false);END IF;
 IF (SELECT count(*) FROM app_private.traffic_events WHERE visitor_id=vid AND created_at>=stamp-interval '1 hour')>=120 THEN RAISE EXCEPTION 'rate_limit' USING ERRCODE='PT429';END IF;
 IF event IN ('signup_complete','onboarding_complete') THEN
  SELECT created_at INTO joined_at FROM auth.users WHERE id=actor;
  SELECT min(created_at) INTO started_at FROM app_private.traffic_events WHERE visitor_id=vid AND kind='signup_start';
  IF started_at IS NULL OR joined_at<started_at-interval '5 minutes' OR joined_at>started_at+interval '7 days' THEN RETURN jsonb_build_object('ok',true,'recorded',false);END IF;
  IF event='onboarding_complete' AND NOT EXISTS(SELECT 1 FROM public.users WHERE id=actor::text AND onboarding_completed) THEN RETURN jsonb_build_object('ok',true,'recorded',false);END IF;
  PERFORM public.sb_require_mfa();
 END IF;
 INSERT INTO app_private.traffic_events(id,visitor_id,kind,page,user_id)
 VALUES(eid,vid,event,page_name,CASE WHEN event IN ('signup_complete','onboarding_complete') THEN actor ELSE NULL END) ON CONFLICT DO NOTHING;
 RETURN jsonb_build_object('ok',true,'recorded',FOUND);
END $$;
REVOKE ALL ON FUNCTION app_private.sb_traffic(jsonb) FROM PUBLIC,anon,authenticated;
-- Deliberately narrow anonymous write API. Private-schema usage/table access is NOT granted.
-- Reads and verified conversions are independently guarded in the private implementation.
CREATE FUNCTION public.sb_traffic(p jsonb) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$ SELECT app_private.sb_traffic(p) $$;
REVOKE ALL ON FUNCTION public.sb_traffic(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sb_traffic(jsonb) TO anon,authenticated;
DO $$ BEGIN
 IF to_regprocedure('cron.schedule(text,text,text)') IS NOT NULL THEN
  PERFORM cron.schedule('signalbrief-traffic-retention','40 18 * * *',$job$DELETE FROM app_private.traffic_visitors WHERE created_at < now() - interval '90 days'$job$);
 END IF;
END $$;
NOTIFY pgrst,'reload schema';
