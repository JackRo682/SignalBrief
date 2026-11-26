-- Preserve the first migration as deployed. Classify subsequent public views according to
-- the authenticated RPC context at insertion, leaving prior measurements unknown.
ALTER TABLE app_private.traffic_surface_views ADD COLUMN audience text
 CHECK(audience IN ('signed_in','signed_out'));
CREATE FUNCTION app_private.sb_set_surface_audience() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN NEW.audience:=CASE WHEN (SELECT auth.uid()) IS NULL THEN 'signed_out' ELSE 'signed_in' END; RETURN NEW; END $$;
REVOKE ALL ON FUNCTION app_private.sb_set_surface_audience() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER sb_set_surface_audience BEFORE INSERT ON app_private.traffic_surface_views
 FOR EACH ROW EXECUTE FUNCTION app_private.sb_set_surface_audience();
DO $migration$
DECLARE old_def text:=pg_get_functiondef('app_private.sb_traffic(jsonb)'::regprocedure); next_def text;
BEGIN
 IF strpos(old_def,'SELECT v.surface,v.release,first_touch.source,count(*) AS views')=0 OR strpos(old_def,'GROUP BY v.surface,v.release,first_touch.source')=0
 THEN RAISE EXCEPTION 'Unexpected surface report'; END IF;
 next_def:=replace(old_def,'SELECT v.surface,v.release,first_touch.source,count(*) AS views',
  'SELECT v.surface,v.release,first_touch.source,coalesce(v.audience,''unknown'') AS audience,count(*) AS views');
 EXECUTE replace(next_def,'GROUP BY v.surface,v.release,first_touch.source','GROUP BY v.surface,v.release,first_touch.source,v.audience');
END $migration$;

CREATE TABLE app_private.prelogin_events(
 id uuid PRIMARY KEY, visitor_id uuid NOT NULL REFERENCES app_private.traffic_visitors(id) ON DELETE CASCADE,
 session_id uuid NOT NULL, seq integer NOT NULL CHECK(seq BETWEEN 1 AND 100000),
 page text NOT NULL CHECK(page IN ('home','about','features','sources','pricing','customers','privacy','terms','disclaimer','signup','login')),
 step text NOT NULL CHECK(step IN ('view','features_cta','pricing_cta','signup_cta','login_cta','signup_submit','login_submit','google_start')),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(visitor_id,session_id,seq)
);
CREATE INDEX prelogin_time_idx ON app_private.prelogin_events(created_at);
CREATE INDEX prelogin_visitor_time_idx ON app_private.prelogin_events(visitor_id,created_at);
ALTER TABLE app_private.prelogin_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.prelogin_events FROM PUBLIC,anon,authenticated;
CREATE FUNCTION app_private.sb_prelogin_withdraw() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN DELETE FROM app_private.prelogin_events WHERE visitor_id=NEW.id; RETURN NEW; END $$;
REVOKE ALL ON FUNCTION app_private.sb_prelogin_withdraw() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER sb_prelogin_withdraw AFTER UPDATE OF withdrawn_at ON app_private.traffic_visitors
 FOR EACH ROW WHEN (OLD.withdrawn_at IS NULL AND NEW.withdrawn_at IS NOT NULL) EXECUTE FUNCTION app_private.sb_prelogin_withdraw();

CREATE FUNCTION app_private.sb_record_prelogin(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE vid uuid; sid uuid; eid uuid; seq_n integer; stamp timestamptz:=now(); row_v app_private.traffic_visitors%ROWTYPE;
 digest text; src text:=p->>'source'; step_n text:=p->>'step'; screen text:=p->>'page';
 uuid_pattern text:='^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$';
BEGIN
 IF (SELECT auth.uid()) IS NOT NULL THEN RAISE EXCEPTION 'signed_out_only' USING ERRCODE='PT403'; END IF;
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR octet_length(p::text)>4096 OR
  (p - ARRAY['action','visitor_id','secret','id','session','seq','page','step','source','consent_version'])<>'{}'::jsonb
  OR (p->>'consent_version') IS DISTINCT FROM '2026-11-26.prelogin'
  OR coalesce(p->>'id','') !~* uuid_pattern OR coalesce(p->>'session','') !~* uuid_pattern OR coalesce(p->>'visitor_id','') !~* uuid_pattern
  OR coalesce(p->>'secret','') !~ '^[0-9a-f]{64}$' OR jsonb_typeof(p->'seq') IS DISTINCT FROM 'number' OR coalesce(p->>'seq','') !~ '^[1-9][0-9]{0,5}$'
  OR src IS NULL OR src NOT IN ('direct','google','naver','kakao','disquiet','geeknews','youtube','x','other')
  OR screen IS NULL OR screen NOT IN ('home','about','features','sources','pricing','customers','privacy','terms','disclaimer','signup','login')
  OR step_n IS NULL OR step_n NOT IN ('view','features_cta','pricing_cta','signup_cta','login_cta','signup_submit','login_submit','google_start')
  OR (step_n='signup_submit' AND screen<>'signup') OR (step_n='login_submit' AND screen<>'login')
  OR (step_n='google_start' AND screen NOT IN ('signup','login'))
 THEN RAISE EXCEPTION 'invalid_prelogin_event' USING ERRCODE='PT422'; END IF;
 seq_n:=(p->>'seq')::integer;
 IF seq_n>100000 OR (seq_n=1 AND step_n<>'view') THEN RAISE EXCEPTION 'invalid_sequence' USING ERRCODE='PT422'; END IF;
 vid:=(p->>'visitor_id')::uuid; sid:=(p->>'session')::uuid; eid:=(p->>'id')::uuid;
 digest:=encode(sha256(convert_to(p->>'secret','UTF8')),'hex');
 IF NOT EXISTS(SELECT 1 FROM app_private.traffic_visitors WHERE id=vid) THEN
  PERFORM pg_advisory_xact_lock(1872601110);
  IF (SELECT count(*) FROM app_private.traffic_visitors WHERE created_at>=stamp-interval '1 day')>=20000 THEN RAISE EXCEPTION 'rate_limit' USING ERRCODE='PT429'; END IF;
  INSERT INTO app_private.traffic_visitors(id,secret_hash,source) VALUES(vid,digest,src) ON CONFLICT DO NOTHING;
 END IF;
 SELECT * INTO STRICT row_v FROM app_private.traffic_visitors WHERE id=vid FOR UPDATE;
 IF row_v.secret_hash<>digest THEN RAISE EXCEPTION 'invalid_identity' USING ERRCODE='PT403'; END IF;
 IF row_v.withdrawn_at IS NOT NULL OR row_v.created_at<=stamp-interval '90 days' THEN RETURN jsonb_build_object('ok',true,'recorded',false); END IF;
 IF EXISTS(SELECT 1 FROM app_private.prelogin_events WHERE id=eid) THEN RETURN jsonb_build_object('ok',true,'recorded',false); END IF;
 IF (SELECT count(*) FROM app_private.prelogin_events WHERE visitor_id=vid AND created_at>=stamp-interval '1 hour')>=360 THEN RAISE EXCEPTION 'rate_limit' USING ERRCODE='PT429'; END IF;
 INSERT INTO app_private.prelogin_events(id,visitor_id,session_id,seq,page,step) VALUES(eid,vid,sid,seq_n,screen,step_n) ON CONFLICT DO NOTHING;
 RETURN jsonb_build_object('ok',true,'recorded',FOUND);
END $$;
REVOKE ALL ON FUNCTION app_private.sb_record_prelogin(jsonb) FROM PUBLIC,anon,authenticated;

ALTER FUNCTION app_private.sb_traffic(jsonb) RENAME TO sb_traffic_surface_v20261126;
CREATE FUNCTION app_private.sb_traffic(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE report jsonb; stages jsonb; exits jsonb; actions jsonb; first_day timestamptz; until_at timestamptz;
BEGIN
 IF p->>'action'='prelogin' THEN RETURN app_private.sb_record_prelogin(p); END IF;
 report:=app_private.sb_traffic_surface_v20261126(p);
 IF p->>'action'<>'summary' THEN RETURN report; END IF;
 first_day:=greatest((p->>'from')::date::timestamp AT TIME ZONE 'Asia/Seoul',now()-interval '90 days');
 until_at:=least(((p->>'to')::date+1)::timestamp AT TIME ZONE 'Asia/Seoul',now());
 -- Include only sessions with a successfully measured entry inside the cohort. For
 -- historic ranges, follow them across midnight until now. Client sequence orders
 -- events even when a later navigation request reaches the collector first.
 WITH entries AS MATERIALIZED (
  SELECT e.visitor_id,e.session_id,e.page AS entry_page,v.source FROM app_private.prelogin_events e
  JOIN app_private.traffic_visitors v ON v.id=e.visitor_id AND v.withdrawn_at IS NULL
  WHERE e.seq=1 AND e.step='view' AND e.created_at>=first_day AND e.created_at<until_at
 ), events AS MATERIALIZED (
  SELECT e.*,a.source FROM entries a JOIN app_private.prelogin_events e USING(visitor_id,session_id)
 ), prior_clicks AS (
  SELECT e.*,bool_or(step='signup_cta') OVER preceding AS signup_clicked,
   bool_or(step='login_cta') OVER preceding AS login_clicked
  FROM events e WINDOW preceding AS (PARTITION BY visitor_id,session_id ORDER BY seq ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING)
 ), marked_views AS (
  SELECT c.*,step='view' AND ((page='signup' AND signup_clicked) OR (page='login' AND login_clicked)) AS reached_auth
  FROM prior_clicks c
 ), progress AS (
  SELECT m.*,bool_or(reached_auth AND page='signup') OVER preceding AS signup_arrived,
   bool_or(reached_auth AND page='login') OVER preceding AS login_arrived
  FROM marked_views m WINDOW preceding AS (PARTITION BY visitor_id,session_id ORDER BY seq ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING)
 ), sessions AS (
  SELECT source,visitor_id,session_id,(array_agg(page ORDER BY seq))[1] AS entry_page,
   (array_agg(page ORDER BY seq DESC))[1] AS last_page,(array_agg(step ORDER BY seq DESC))[1] AS last_step,
   max(created_at)<=now()-interval '30 minutes' AS closed,
   bool_or(step IN ('signup_cta','login_cta')) AS clicked,coalesce(bool_or(reached_auth),false) AS arrived,
   coalesce(bool_or(step IN ('signup_submit','login_submit','google_start') AND
    ((page='signup' AND signup_arrived) OR (page='login' AND login_arrived))),false) AS attempted,
   bool_or(step IN ('signup_submit','login_submit','google_start')) AS any_attempt
  FROM progress GROUP BY source,visitor_id,session_id
 ), counts AS (
  SELECT source,count(*) sessions,count(*) FILTER(WHERE clicked) auth_cta,count(*) FILTER(WHERE arrived) auth_arrived,
   count(*) FILTER(WHERE attempted) auth_attempt,count(*) FILTER(WHERE closed) closed,
   count(*) FILTER(WHERE closed AND NOT any_attempt) closed_without_attempt,
   count(*) FILTER(WHERE entry_page IN ('signup','login')) direct_auth_entries FROM sessions GROUP BY source
 ), last_steps AS (
  SELECT source,last_page page,last_step step,count(*) sessions FROM sessions WHERE closed AND NOT any_attempt GROUP BY source,last_page,last_step
 ), action_counts AS (
  SELECT source,page,step,count(*) events,count(DISTINCT (visitor_id,session_id)) sessions FROM events GROUP BY source,page,step
 )
 SELECT coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY source) FROM counts c),'[]'::jsonb),
 coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY source,sessions DESC,page,step) FROM last_steps x),'[]'::jsonb),
 coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY source,sessions DESC,page,step) FROM action_counts a),'[]'::jsonb)
 INTO stages,exits,actions;
 RETURN report||jsonb_build_object('journeys',stages,'journey_exits',exits,'journey_actions',actions);
END $$;
REVOKE ALL ON FUNCTION app_private.sb_traffic(jsonb) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.sb_traffic(p jsonb) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$ SELECT app_private.sb_traffic(p) $$;
REVOKE ALL ON FUNCTION public.sb_traffic(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sb_traffic(jsonb) TO anon,authenticated;
