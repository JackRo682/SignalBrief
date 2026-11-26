-- Keep the original ingestion, account checks and first-touch identities.
ALTER TABLE app_private.traffic_visitors DROP CONSTRAINT traffic_visitors_source_check;
ALTER TABLE app_private.traffic_visitors ADD CONSTRAINT traffic_visitors_source_check
 CHECK(source IN ('direct','google','naver','kakao','disquiet','geeknews','youtube','x','other'));
DO $migration$
DECLARE target regprocedure; original text;
 old_guard text:='origin_name NOT IN (''direct'',''google'',''naver'',''disquiet'',''geeknews'',''youtube'',''x'',''other'')';
 new_guard text:='origin_name NOT IN (''direct'',''google'',''naver'',''kakao'',''disquiet'',''geeknews'',''youtube'',''x'',''other'')';
BEGIN
 FOREACH target IN ARRAY ARRAY['app_private.sb_traffic_acquisition_v20261110(jsonb)'::regprocedure,'app_private.sb_traffic(jsonb)'::regprocedure] LOOP
  original:=pg_get_functiondef(target);
  IF strpos(original,old_guard)=0 THEN RAISE EXCEPTION 'Unexpected source validator in %',target; END IF;
  EXECUTE replace(original,old_guard,new_guard);
 END LOOP;
END $migration$;

CREATE TABLE app_private.traffic_surface_views(
 id uuid PRIMARY KEY,
 visitor_id uuid NOT NULL REFERENCES app_private.traffic_visitors(id) ON DELETE CASCADE,
 user_id varchar(36) REFERENCES public.users(id) ON DELETE CASCADE,
 surface text NOT NULL CHECK(surface IN ('home','about','features','sources','pricing','customers','privacy','terms','disclaimer','signup','login','search','calendar','app_home','today','event_detail')),
 release text NOT NULL CHECK(release ~ '^([0-9a-f]{7,40}|unversioned)$'),
 active_ms integer NOT NULL CHECK(active_ms BETWEEN 0 AND 86400000),
 started_at timestamptz NOT NULL DEFAULT now(),
 CHECK((surface IN ('search','calendar','app_home','today','event_detail'))=(user_id IS NOT NULL))
);
CREATE INDEX traffic_surface_started_idx ON app_private.traffic_surface_views(started_at);
CREATE INDEX traffic_surface_visitor_idx ON app_private.traffic_surface_views(visitor_id,started_at);
CREATE INDEX traffic_surface_user_idx ON app_private.traffic_surface_views(user_id) WHERE user_id IS NOT NULL;
ALTER TABLE app_private.traffic_surface_views ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.traffic_surface_views FROM PUBLIC,anon,authenticated;

CREATE FUNCTION app_private.sb_surface_withdraw() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_TABLE_NAME='traffic_visitors' THEN DELETE FROM app_private.traffic_surface_views WHERE visitor_id=NEW.id;
 ELSE DELETE FROM app_private.traffic_surface_views WHERE user_id=NEW.id; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_private.sb_surface_withdraw() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER sb_surface_browser_withdraw AFTER UPDATE OF withdrawn_at ON app_private.traffic_visitors
 FOR EACH ROW WHEN (OLD.withdrawn_at IS NULL AND NEW.withdrawn_at IS NOT NULL) EXECUTE FUNCTION app_private.sb_surface_withdraw();
CREATE TRIGGER sb_surface_account_withdraw AFTER UPDATE OF analytics_consent ON public.users
 FOR EACH ROW WHEN (OLD.analytics_consent IS TRUE AND NEW.analytics_consent IS DISTINCT FROM TRUE) EXECUTE FUNCTION app_private.sb_surface_withdraw();

CREATE FUNCTION app_private.sb_record_surface(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 actor uuid:=(SELECT auth.uid()); stamp timestamptz:=now(); vid uuid; eid uuid; grant_row app_private.traffic_visitors%ROWTYPE;
 screen text:=p->>'surface'; version_name text:=p->>'release'; src text:=p->>'source'; digest text; duration integer;
 private_screen boolean:=screen IN ('search','calendar','app_home','today','event_detail'); profile varchar(36); prior app_private.traffic_surface_views%ROWTYPE;
BEGIN
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR octet_length(p::text)>4096 OR
  (p - ARRAY['action','visitor_id','secret','id','source','surface','release','active_ms','consent_version']) <> '{}'::jsonb
  OR (p->>'consent_version') IS DISTINCT FROM '2026-11-26'
  OR coalesce(p->>'id','') !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
  OR coalesce(p->>'visitor_id','') !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
  OR coalesce(p->>'secret','') !~ '^[0-9a-f]{64}$'
  OR coalesce(version_name,'') !~ '^([0-9a-f]{7,40}|unversioned)$'
  OR jsonb_typeof(p->'active_ms') IS DISTINCT FROM 'number' OR coalesce(p->>'active_ms','') !~ '^[0-9]{1,8}$'
  OR src IS NULL OR src NOT IN ('direct','google','naver','kakao','disquiet','geeknews','youtube','x','other')
  OR screen IS NULL OR screen NOT IN ('home','about','features','sources','pricing','customers','privacy','terms','disclaimer','signup','login','search','calendar','app_home','today','event_detail')
 THEN RAISE EXCEPTION 'invalid_surface' USING ERRCODE='PT422'; END IF;
 duration:=(p->>'active_ms')::integer;
 IF duration>86400000 THEN RAISE EXCEPTION 'invalid_duration' USING ERRCODE='PT422'; END IF;
 IF private_screen AND actor IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='PT401'; END IF;
 IF actor IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM auth.users u JOIN auth.sessions s ON s.user_id=u.id
   WHERE u.id=actor AND u.deleted_at IS NULL AND u.email_confirmed_at IS NOT NULL AND (u.banned_until IS NULL OR u.banned_until<=stamp)
    AND s.id::text=(SELECT auth.jwt())->>'session_id' AND (s.not_after IS NULL OR s.not_after>stamp))
  THEN RAISE EXCEPTION 'invalid_session' USING ERRCODE='PT401'; END IF;
  IF app_private.sb_is_admin() THEN RETURN jsonb_build_object('ok',true,'recorded',false); END IF;
 END IF;
 IF private_screen THEN
  SELECT u.id INTO profile FROM public.users u WHERE u.id=actor::text AND u.analytics_consent IS TRUE FOR SHARE;
  IF profile IS NULL THEN RETURN jsonb_build_object('ok',true,'recorded',false); END IF;
  PERFORM public.sb_require_mfa();
 END IF;
 vid:=(p->>'visitor_id')::uuid; eid:=(p->>'id')::uuid; digest:=encode(sha256(convert_to(p->>'secret','UTF8')),'hex');
 IF NOT EXISTS(SELECT 1 FROM app_private.traffic_visitors WHERE id=vid) THEN
  PERFORM pg_advisory_xact_lock(1872601110);
  IF (SELECT count(*) FROM app_private.traffic_visitors WHERE created_at>=stamp-interval '1 day')>=20000 THEN RAISE EXCEPTION 'rate_limit' USING ERRCODE='PT429'; END IF;
  INSERT INTO app_private.traffic_visitors(id,secret_hash,source) VALUES(vid,digest,src) ON CONFLICT DO NOTHING;
 END IF;
 SELECT * INTO STRICT grant_row FROM app_private.traffic_visitors WHERE id=vid FOR UPDATE;
 IF grant_row.secret_hash<>digest THEN RAISE EXCEPTION 'invalid_identity' USING ERRCODE='PT403'; END IF;
 IF grant_row.withdrawn_at IS NOT NULL OR grant_row.created_at<=stamp-interval '90 days' THEN RETURN jsonb_build_object('ok',true,'recorded',false); END IF;
 SELECT * INTO prior FROM app_private.traffic_surface_views WHERE id=eid;
 IF FOUND THEN
  IF prior.visitor_id<>vid OR prior.surface<>screen OR prior.release<>version_name OR prior.user_id IS DISTINCT FROM profile THEN
   RAISE EXCEPTION 'invalid_view' USING ERRCODE='PT403';
  END IF;
  IF duration>(extract(epoch from stamp-prior.started_at)*1000+60000) THEN RAISE EXCEPTION 'invalid_duration' USING ERRCODE='PT422'; END IF;
  IF duration>prior.active_ms THEN UPDATE app_private.traffic_surface_views SET active_ms=duration WHERE id=eid; END IF;
 ELSE
  IF duration>60000 THEN RAISE EXCEPTION 'missing_start' USING ERRCODE='PT422'; END IF;
  IF (SELECT count(*) FROM app_private.traffic_surface_views WHERE visitor_id=vid AND started_at>=stamp-interval '1 hour')>=180 THEN RAISE EXCEPTION 'rate_limit' USING ERRCODE='PT429'; END IF;
  INSERT INTO app_private.traffic_surface_views(id,visitor_id,user_id,surface,release,active_ms)
   VALUES(eid,vid,profile,screen,version_name,duration);
 END IF;
 RETURN jsonb_build_object('ok',true,'recorded',true);
END $$;
REVOKE ALL ON FUNCTION app_private.sb_record_surface(jsonb) FROM PUBLIC,anon,authenticated;

ALTER FUNCTION app_private.sb_traffic(jsonb) RENAME TO sb_traffic_behavior_v20261120;
CREATE FUNCTION app_private.sb_traffic(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; from_at timestamptz; to_at timestamptz; times jsonb; features jsonb;
BEGIN
 IF p->>'action'='surface' THEN RETURN app_private.sb_record_surface(p); END IF;
 result:=app_private.sb_traffic_behavior_v20261120(p);
 IF p->>'action'='summary' THEN
  -- Existing function above verifies the admin, MFA, rate limit, and date range.
  from_at:=greatest((p->>'from')::date::timestamp AT TIME ZONE 'Asia/Seoul',now()-interval '90 days');
  to_at:=least(((p->>'to')::date+1)::timestamp AT TIME ZONE 'Asia/Seoul',now());
  SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.surface,s.source,s.release),'[]'::jsonb) INTO times FROM (
   SELECT v.surface,v.release,first_touch.source,count(*) AS views,count(DISTINCT v.visitor_id) AS browsers,
    round(avg(v.active_ms))::int AS mean_ms,round(percentile_cont(0.5) WITHIN GROUP(ORDER BY v.active_ms))::int AS median_ms
   FROM app_private.traffic_surface_views v JOIN app_private.traffic_visitors first_touch ON first_touch.id=v.visitor_id AND first_touch.withdrawn_at IS NULL
   WHERE v.started_at>=from_at AND v.started_at<to_at GROUP BY v.surface,v.release,first_touch.source
  ) s;
  SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.page,s.kind),'[]'::jsonb) INTO features FROM (
   SELECT e.page,e.kind,count(*) AS events,count(DISTINCT e.visitor_id) AS browsers
   FROM app_private.traffic_product_events e JOIN public.users u ON u.id=e.user_id::text AND u.analytics_consent IS TRUE
   JOIN app_private.traffic_visitors v ON v.id=e.visitor_id AND v.withdrawn_at IS NULL
   WHERE e.created_at>=from_at AND e.created_at<to_at GROUP BY e.page,e.kind
  ) s;
  result:=result||jsonb_build_object('surface_times',times,'feature_actions',features);
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION app_private.sb_traffic(jsonb) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.sb_traffic(p jsonb) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$ SELECT app_private.sb_traffic(p) $$;
REVOKE ALL ON FUNCTION public.sb_traffic(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sb_traffic(jsonb) TO anon,authenticated;
