-- Additive reporting over the existing consented, anonymous session cohort.
-- Old clients and historical events remain valid; unknown device data is never inferred.
ALTER TABLE app_private.prelogin_events ADD COLUMN device text
 CHECK(device IN ('mobile','tablet','desktop'));
CREATE INDEX prelogin_entry_time_idx ON app_private.prelogin_events(created_at DESC,session_id,visitor_id)
 WHERE seq=1 AND step='view';

CREATE OR REPLACE FUNCTION app_private.sb_record_prelogin(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE vid uuid; sid uuid; eid uuid; seq_n integer; stamp timestamptz:=now(); row_v app_private.traffic_visitors%ROWTYPE;
 digest text; src text:=p->>'source'; step_n text:=p->>'step'; screen text:=p->>'page';
 uuid_pattern text:='^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$';
BEGIN
 IF (SELECT auth.uid()) IS NOT NULL THEN RAISE EXCEPTION 'signed_out_only' USING ERRCODE='PT403'; END IF;
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR octet_length(p::text)>4096 OR
  (p - ARRAY['action','visitor_id','secret','id','session','seq','page','step','source','consent_version','device'])<>'{}'::jsonb
  OR coalesce(p->>'consent_version','') NOT IN ('2026-11-26.prelogin','2026-11-27.prelogin')
  OR (p ? 'device' AND ((p->>'consent_version')<>'2026-11-27.prelogin'
   OR jsonb_typeof(p->'device') IS DISTINCT FROM 'string' OR p->>'device' NOT IN ('mobile','tablet','desktop')))
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
 INSERT INTO app_private.prelogin_events(id,visitor_id,session_id,seq,page,step,device)
  VALUES(eid,vid,sid,seq_n,screen,step_n,p->>'device') ON CONFLICT DO NOTHING;
 RETURN jsonb_build_object('ok',true,'recorded',FOUND);
END $$;
REVOKE ALL ON FUNCTION app_private.sb_record_prelogin(jsonb) FROM PUBLIC,anon,authenticated;

-- Private invoker helper: the guarded reporting wrapper supplies privileged access.
-- The cohort and ordered stages intentionally match the existing journey summary.
CREATE FUNCTION app_private.sb_prelogin_session_rows(from_at timestamptz,to_at timestamptz)
RETURNS TABLE(visitor_id uuid,session_id uuid,source text,device text,started_at timestamptz,last_at timestamptz,
 entry_page text,last_page text,last_step text,events bigint,closed boolean,clicked boolean,arrived boolean,
 attempted boolean,any_attempt boolean)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 WITH entries AS MATERIALIZED (
  SELECT e.visitor_id,e.session_id,e.created_at AS started_at,v.source,coalesce(e.device,'unknown') AS device
  FROM app_private.prelogin_events e JOIN app_private.traffic_visitors v ON v.id=e.visitor_id AND v.withdrawn_at IS NULL
  WHERE e.seq=1 AND e.step='view' AND e.created_at>=from_at AND e.created_at<to_at
 ), ordered_events AS MATERIALIZED (
  SELECT e.*,a.source,a.device AS entry_device,a.started_at FROM entries a
  JOIN app_private.prelogin_events e USING(visitor_id,session_id)
 ), prior_clicks AS (
  SELECT e.*,bool_or(step='signup_cta') OVER preceding AS signup_clicked,
   bool_or(step='login_cta') OVER preceding AS login_clicked
  FROM ordered_events e WINDOW preceding AS (PARTITION BY visitor_id,session_id ORDER BY seq ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING)
 ), marked_views AS (
  SELECT c.*,step='view' AND ((page='signup' AND signup_clicked) OR (page='login' AND login_clicked)) AS reached_auth
  FROM prior_clicks c
 ), progress AS (
  SELECT m.*,bool_or(reached_auth AND page='signup') OVER preceding AS signup_arrived,
   bool_or(reached_auth AND page='login') OVER preceding AS login_arrived
  FROM marked_views m WINDOW preceding AS (PARTITION BY visitor_id,session_id ORDER BY seq ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING)
 )
 SELECT p.visitor_id,p.session_id,p.source,p.entry_device,p.started_at,max(p.created_at),
  (array_agg(p.page ORDER BY p.seq))[1],(array_agg(p.page ORDER BY p.seq DESC))[1],
  (array_agg(p.step ORDER BY p.seq DESC))[1],count(*),max(p.created_at)<=now()-interval '30 minutes',
  bool_or(p.step IN ('signup_cta','login_cta')),coalesce(bool_or(p.reached_auth),false),
  coalesce(bool_or(p.step IN ('signup_submit','login_submit','google_start') AND
   ((p.page='signup' AND p.signup_arrived) OR (p.page='login' AND p.login_arrived))),false),
  bool_or(p.step IN ('signup_submit','login_submit','google_start'))
 FROM progress p GROUP BY p.visitor_id,p.session_id,p.source,p.entry_device,p.started_at;
$$;
REVOKE ALL ON FUNCTION app_private.sb_prelogin_session_rows(timestamptz,timestamptz) FROM PUBLIC,anon,authenticated;

ALTER FUNCTION app_private.sb_traffic(jsonb) RENAME TO sb_traffic_journeys_v20261126;
REVOKE ALL ON FUNCTION app_private.sb_traffic_journeys_v20261126(jsonb) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION app_private.sb_traffic(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE report jsonb; daily_rows jsonb; device_rows jsonb; measurement jsonb; session_report jsonb;
 from_at timestamptz; to_at timestamptz; stamp timestamptz:=now(); retained_from timestamptz:=now()-interval '90 days';
 selected_source text; page_offset integer:=0; page_limit integer:=20;
BEGIN
 IF p->>'action'='sessions' THEN
  -- Reuse the original live account/session/admin/MFA/rate/date checks. Validate
  -- only sanitized summary arguments there, then independently bound this payload.
  PERFORM app_private.sb_traffic_acquisition_v20261110(
   jsonb_build_object('action','summary','from',p->'from','to',p->'to'));
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR octet_length(p::text)>4096
   OR (p - ARRAY['action','from','to','source','offset','limit'])<>'{}'::jsonb
   OR (p ? 'source' AND (jsonb_typeof(p->'source') IS DISTINCT FROM 'string'
    OR p->>'source' NOT IN ('direct','google','naver','kakao','disquiet','geeknews','youtube','x','other')))
   OR (p ? 'offset' AND (jsonb_typeof(p->'offset') IS DISTINCT FROM 'number' OR coalesce(p->>'offset','') !~ '^[0-9]{1,5}$'))
   OR (p ? 'limit' AND (jsonb_typeof(p->'limit') IS DISTINCT FROM 'number' OR coalesce(p->>'limit','') !~ '^[0-9]{1,2}$'))
  THEN RAISE EXCEPTION 'invalid_session_filter' USING ERRCODE='PT422'; END IF;
  page_offset:=coalesce((p->>'offset')::integer,0); page_limit:=coalesce((p->>'limit')::integer,20);
  IF page_offset>10000 OR page_limit NOT BETWEEN 1 AND 50 THEN
   RAISE EXCEPTION 'invalid_session_filter' USING ERRCODE='PT422';
  END IF;
  selected_source:=p->>'source';
  from_at:=greatest((p->>'from')::date::timestamp AT TIME ZONE 'Asia/Seoul',retained_from);
  to_at:=least(((p->>'to')::date+1)::timestamp AT TIME ZONE 'Asia/Seoul',stamp);
  WITH sessions AS MATERIALIZED (
   SELECT s.* FROM app_private.sb_prelogin_session_rows(from_at,to_at) s
   WHERE selected_source IS NULL OR s.source=selected_source
  ), page AS MATERIALIZED (
   SELECT s.* FROM sessions s ORDER BY s.started_at DESC,s.session_id DESC,s.visitor_id DESC LIMIT page_limit OFFSET page_offset
  ), presented AS (
   SELECT s.started_at,s.session_id,s.visitor_id,jsonb_build_object(
    'session_id',s.session_id,'source',s.source,'device',s.device,'started_at',s.started_at,'last_at',s.last_at,
    'entry_page',s.entry_page,'last_page',s.last_page,'last_step',s.last_step,'events',s.events,
    'closed',s.closed,'any_auth_attempt',s.any_attempt,'steps_truncated',s.events>100,
    'steps',coalesce((SELECT jsonb_agg(jsonb_build_object('seq',e.seq,'page',e.page,'step',e.step,'at',e.created_at) ORDER BY e.seq)
     FROM (SELECT e.seq,e.page,e.step,e.created_at FROM app_private.prelogin_events e
      WHERE e.visitor_id=s.visitor_id AND e.session_id=s.session_id ORDER BY e.seq LIMIT 100) e),'[]'::jsonb)
   ) AS item FROM page s
  )
  SELECT jsonb_build_object('generated_at',stamp,'total',(SELECT count(*) FROM sessions),
   'rows',coalesce((SELECT jsonb_agg(s.item ORDER BY s.started_at DESC,s.session_id DESC,s.visitor_id DESC) FROM presented s),'[]'::jsonb))
  INTO session_report;
  RETURN session_report;
 END IF;

 -- The previous summary validates the complete request before these additions.
 -- All collectors/erasure actions retain their prior behavior and return values.
 report:=app_private.sb_traffic_journeys_v20261126(p);
 IF p->>'action'<>'summary' THEN RETURN report; END IF;
 from_at:=greatest((p->>'from')::date::timestamp AT TIME ZONE 'Asia/Seoul',retained_from);
 to_at:=least(((p->>'to')::date+1)::timestamp AT TIME ZONE 'Asia/Seoul',stamp);
 WITH sessions AS MATERIALIZED (
  SELECT * FROM app_private.sb_prelogin_session_rows(from_at,to_at)
 ), daily AS (
  SELECT (started_at AT TIME ZONE 'Asia/Seoul')::date AS day,source,count(*) AS sessions,
   count(*) FILTER(WHERE clicked) AS auth_cta,count(*) FILTER(WHERE arrived) AS auth_arrived,
   count(*) FILTER(WHERE attempted) AS auth_attempt,count(*) FILTER(WHERE closed) AS closed,
   count(*) FILTER(WHERE closed AND NOT any_attempt) AS closed_without_attempt,
   count(*) FILTER(WHERE entry_page IN ('signup','login')) AS direct_auth_entries
  FROM sessions GROUP BY (started_at AT TIME ZONE 'Asia/Seoul')::date,source
 ), devices AS (SELECT device,count(*) AS sessions FROM sessions GROUP BY device)
 SELECT coalesce((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.day,d.source) FROM daily d),'[]'::jsonb),
  coalesce((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.sessions DESC,d.device) FROM devices d),'[]'::jsonb)
 INTO daily_rows,device_rows;
 SELECT jsonb_build_object('retained_from',retained_from,
  'first_acquisition_at',(SELECT min(e.created_at) FROM app_private.traffic_events e
   JOIN app_private.traffic_visitors v ON v.id=e.visitor_id AND v.withdrawn_at IS NULL
   WHERE e.created_at>=retained_from AND e.created_at<stamp),
  'first_journey_at',(SELECT min(e.created_at) FROM app_private.prelogin_events e
   JOIN app_private.traffic_visitors v ON v.id=e.visitor_id AND v.withdrawn_at IS NULL
   WHERE e.seq=1 AND e.step='view' AND e.created_at>=retained_from AND e.created_at<stamp),
  'first_surface_at',(SELECT min(e.started_at) FROM app_private.traffic_surface_views e
   JOIN app_private.traffic_visitors v ON v.id=e.visitor_id AND v.withdrawn_at IS NULL
   WHERE e.started_at>=retained_from AND e.started_at<stamp)) INTO measurement;
 RETURN report||jsonb_build_object('measurement',measurement,'journey_daily',daily_rows,'journey_devices',device_rows);
END $$;
REVOKE ALL ON FUNCTION app_private.sb_traffic(jsonb) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.sb_traffic(p jsonb) RETURNS jsonb
 LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$ SELECT app_private.sb_traffic(p) $$;
REVOKE ALL ON FUNCTION public.sb_traffic(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sb_traffic(jsonb) TO anon,authenticated;
