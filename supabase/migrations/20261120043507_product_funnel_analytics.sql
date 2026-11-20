-- Add consented product events without changing public acquisition denominators.
-- Only coarse action/screen types are accepted. No query, URL, company or event ID.
CREATE TABLE app_private.traffic_product_events (
 id uuid PRIMARY KEY,
 visitor_id uuid NOT NULL REFERENCES app_private.traffic_visitors(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK (kind IN ('search_used','filter_used','event_detail_click','event_detail_view')),
 page text NOT NULL CHECK (page IN ('search','calendar','app_home','today','event_detail')),
 filter_type text CHECK (filter_type IN ('kind','source','period','sort','market','company','category','scope','view','personal','reset')),
 event_kind text CHECK (event_kind IN ('published','calendar')),
 product_consent_version text NOT NULL CHECK (product_consent_version='2026-11-20'),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((kind='filter_used') = (filter_type IS NOT NULL)),
 CHECK ((kind IN ('event_detail_click','event_detail_view')) = (event_kind IS NOT NULL)),
 CHECK ((kind='event_detail_view') = (page='event_detail'))
);
CREATE INDEX traffic_product_visitor_time ON app_private.traffic_product_events(visitor_id,created_at,kind);
CREATE INDEX traffic_product_user ON app_private.traffic_product_events(user_id);
CREATE INDEX traffic_product_time ON app_private.traffic_product_events(created_at);
ALTER TABLE app_private.traffic_product_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.traffic_product_events FROM PUBLIC,anon,authenticated;

-- Locking the profile while writing makes withdrawal/delete serialize with writes.
-- The existing 90-day visitor retention job cascades into this table as well.
CREATE FUNCTION app_private.sb_erase_product_analytics() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 -- Hosted profile IDs are UUID text; guard the cast for disposable demo fixtures.
 IF OLD.id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
  DELETE FROM app_private.traffic_product_events WHERE user_id=OLD.id::uuid;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_private.sb_erase_product_analytics() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER sb_product_analytics_consent_withdrawal
 AFTER UPDATE OF analytics_consent ON public.users
 FOR EACH ROW WHEN (OLD.analytics_consent IS TRUE AND NEW.analytics_consent IS DISTINCT FROM TRUE)
 EXECUTE FUNCTION app_private.sb_erase_product_analytics();
CREATE TRIGGER sb_product_analytics_profile_deletion
 AFTER DELETE ON public.users FOR EACH ROW EXECUTE FUNCTION app_private.sb_erase_product_analytics();

-- Keep the original acquisition validator, limits, erasure and summary unchanged.
ALTER FUNCTION app_private.sb_traffic(jsonb) RENAME TO sb_traffic_acquisition_v20261110;
REVOKE ALL ON FUNCTION app_private.sb_traffic_acquisition_v20261110(jsonb) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION app_private.sb_traffic(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 action text:=p->>'action'; event text:=p->>'kind'; actor uuid:=(SELECT auth.uid()); stamp timestamptz:=now();
 vid uuid; eid uuid; secret_digest text; existing_hash text; withdrawn timestamptz; consent_created timestamptz;
 page_name text; origin_name text; filter_name text; event_type text; key text; session_claim text;
 account_consent boolean; lower_bound timestamptz; upper_bound timestamptz; result jsonb; product jsonb;
BEGIN
 IF action='record' AND event IN ('search_used','filter_used','event_detail_click','event_detail_view') THEN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR octet_length(p::text)>4096 THEN
   RAISE EXCEPTION 'invalid_input' USING ERRCODE='PT422';
  END IF;
  FOR key IN SELECT jsonb_object_keys(p) LOOP
   IF key NOT IN ('action','visitor_id','secret','id','kind','page','source','product_consent_version','filter_type','event_kind')
    OR jsonb_typeof(p->key) IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE='PT422';
   END IF;
  END LOOP;
  page_name:=p->>'page'; origin_name:=p->>'source'; filter_name:=p->>'filter_type'; event_type:=p->>'event_kind';
  IF coalesce(p->>'visitor_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   OR coalesce(p->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   OR coalesce(p->>'secret','') !~ '^[a-f0-9]{64}$'
   OR (p->>'product_consent_version') IS DISTINCT FROM '2026-11-20'
   OR page_name IS NULL OR page_name NOT IN ('search','calendar','app_home','today','event_detail')
   OR origin_name IS NULL OR origin_name NOT IN ('direct','google','naver','disquiet','geeknews','youtube','x','other')
   OR (event='event_detail_view') IS DISTINCT FROM (page_name='event_detail')
   OR (event='filter_used') IS DISTINCT FROM (filter_name IS NOT NULL)
   OR (filter_name IS NOT NULL AND filter_name NOT IN ('kind','source','period','sort','market','company','category','scope','view','personal','reset'))
   OR (event IN ('event_detail_click','event_detail_view')) IS DISTINCT FROM (event_type IS NOT NULL)
   OR (event_type IS NOT NULL AND event_type NOT IN ('published','calendar')) THEN
   RAISE EXCEPTION 'invalid_event' USING ERRCODE='PT422';
  END IF;
  IF actor IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='PT401'; END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id=actor AND deleted_at IS NULL
   AND (banned_until IS NULL OR banned_until<=stamp) AND email_confirmed_at IS NOT NULL) THEN
   RAISE EXCEPTION 'verified_account_required' USING ERRCODE='PT401';
  END IF;
  session_claim:=(SELECT auth.jwt())->>'session_id';
  IF session_claim IS NULL OR session_claim !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
   RAISE EXCEPTION 'session_revoked' USING ERRCODE='PT401';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.sessions WHERE id=session_claim::uuid AND user_id=actor AND (not_after IS NULL OR not_after>stamp)) THEN
   RAISE EXCEPTION 'session_revoked' USING ERRCODE='PT401';
  END IF;
  IF app_private.sb_is_admin() THEN RETURN jsonb_build_object('ok',true,'recorded',false); END IF;
  SELECT u.analytics_consent INTO account_consent FROM public.users u WHERE u.id=actor::text FOR SHARE;
  IF account_consent IS DISTINCT FROM TRUE THEN RETURN jsonb_build_object('ok',true,'recorded',false); END IF;
  PERFORM public.sb_require_mfa();
  vid:=(p->>'visitor_id')::uuid; eid:=(p->>'id')::uuid;
  secret_digest:=encode(sha256(convert_to(p->>'secret','UTF8')),'hex');
  IF NOT EXISTS (SELECT 1 FROM app_private.traffic_visitors WHERE id=vid) THEN
   PERFORM pg_advisory_xact_lock(1872601110);
   IF (SELECT count(*) FROM app_private.traffic_visitors WHERE created_at>=stamp-interval '1 day')>=20000 THEN
    RAISE EXCEPTION 'rate_limit' USING ERRCODE='PT429';
   END IF;
   INSERT INTO app_private.traffic_visitors(id,secret_hash,source) VALUES(vid,secret_digest,origin_name) ON CONFLICT DO NOTHING;
  END IF;
  SELECT v.secret_hash,v.withdrawn_at,v.created_at INTO existing_hash,withdrawn,consent_created
   FROM app_private.traffic_visitors v WHERE v.id=vid FOR UPDATE;
  IF existing_hash IS DISTINCT FROM secret_digest THEN RAISE EXCEPTION 'invalid_identity' USING ERRCODE='PT403'; END IF;
  IF withdrawn IS NOT NULL OR consent_created<=stamp-interval '90 days' THEN
   RETURN jsonb_build_object('ok',true,'recorded',false);
  END IF;
  IF EXISTS (SELECT 1 FROM app_private.traffic_product_events WHERE id=eid) THEN
   RETURN jsonb_build_object('ok',true,'recorded',false);
  END IF;
  IF (SELECT count(*) FROM app_private.traffic_product_events WHERE visitor_id=vid AND created_at>=stamp-interval '1 hour')>=120 THEN
   RAISE EXCEPTION 'rate_limit' USING ERRCODE='PT429';
  END IF;
  INSERT INTO app_private.traffic_product_events(id,visitor_id,user_id,kind,page,filter_type,event_kind,product_consent_version)
   VALUES(eid,vid,actor,event,page_name,filter_name,event_type,p->>'product_consent_version') ON CONFLICT DO NOTHING;
  RETURN jsonb_build_object('ok',true,'recorded',FOUND);
 END IF;

 -- This call guards summaries with live session/admin/MFA/date checks and preserves
 -- public-only visitor counts. Unknown product fields on legacy events are rejected.
 result:=app_private.sb_traffic_acquisition_v20261110(p);
 IF action='erase' THEN
  DELETE FROM app_private.traffic_product_events e WHERE e.visitor_id=(p->>'visitor_id')::uuid
   AND EXISTS (SELECT 1 FROM app_private.traffic_visitors v WHERE v.id=e.visitor_id
    AND v.withdrawn_at IS NOT NULL AND v.secret_hash=encode(sha256(convert_to(p->>'secret','UTF8')),'hex'));
 ELSIF action='summary' THEN
  lower_bound:=greatest((p->>'from')::date::timestamp AT TIME ZONE 'Asia/Seoul',stamp-interval '90 days');
  upper_bound:=((p->>'to')::date+1)::timestamp AT TIME ZONE 'Asia/Seoul';
  WITH actions AS MATERIALIZED (
   SELECT e.* FROM app_private.traffic_product_events e
   JOIN app_private.traffic_visitors v ON v.id=e.visitor_id AND v.withdrawn_at IS NULL
   JOIN public.users u ON u.id=e.user_id::text AND u.analytics_consent IS TRUE
   WHERE e.created_at>=lower_bound AND e.created_at<upper_bound AND e.created_at<=stamp
  ), landings AS (
   SELECT e.visitor_id,min(e.created_at) AS landed_at FROM app_private.traffic_events e
   JOIN app_private.traffic_visitors v ON v.id=e.visitor_id AND v.withdrawn_at IS NULL
   WHERE e.kind='page_view' AND e.page='home' AND e.created_at>=lower_bound AND e.created_at<upper_bound AND e.created_at<=stamp
   GROUP BY e.visitor_id
  ), engaged AS (
   SELECT l.visitor_id,min(a.created_at) AS engaged_at FROM landings l JOIN actions a ON a.visitor_id=l.visitor_id
    AND a.kind IN ('search_used','filter_used') AND a.created_at>=l.landed_at GROUP BY l.visitor_id
  ), clicked AS (
   SELECT e.visitor_id,min(a.created_at) AS clicked_at FROM engaged e JOIN actions a ON a.visitor_id=e.visitor_id
    AND a.kind='event_detail_click' AND a.created_at>=e.engaged_at GROUP BY e.visitor_id
  ), viewed AS (
   SELECT c.visitor_id FROM clicked c JOIN actions a ON a.visitor_id=c.visitor_id
    AND a.kind='event_detail_view' AND a.created_at>=c.clicked_at GROUP BY c.visitor_id
  ) SELECT jsonb_build_object(
   'landing_visitors',(SELECT count(*)::int FROM landings),
   'engaged_visitors',(SELECT count(*)::int FROM engaged),
   'detail_click_visitors',(SELECT count(*)::int FROM clicked),
   'detail_view_visitors',(SELECT count(*)::int FROM viewed),
   'search_events',(SELECT count(*)::int FROM actions WHERE kind='search_used'),
   'filter_events',(SELECT count(*)::int FROM actions WHERE kind='filter_used'),
   'detail_click_events',(SELECT count(*)::int FROM actions WHERE kind='event_detail_click'),
   'detail_view_events',(SELECT count(*)::int FROM actions WHERE kind='event_detail_view')
  ) INTO product;
  result:=result||jsonb_build_object('product',product);
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION app_private.sb_traffic(jsonb) FROM PUBLIC,anon,authenticated;
-- Refresh the narrow public entry point after the private-function rename.
CREATE OR REPLACE FUNCTION public.sb_traffic(p jsonb) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$ SELECT app_private.sb_traffic(p) $$;
REVOKE ALL ON FUNCTION public.sb_traffic(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sb_traffic(jsonb) TO anon,authenticated;

-- Rollback without deleting data: repoint public.sb_traffic to the retained
-- app_private.sb_traffic_acquisition_v20261110 implementation. The existing
-- 90-day visitor cleanup still removes product records by FK cascade.
NOTIFY pgrst,'reload schema';
