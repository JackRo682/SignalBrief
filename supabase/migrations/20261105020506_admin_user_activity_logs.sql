-- One bounded, administrator-only projection over existing consented activity.
-- No new collection, administrator grants, or consent changes are introduced.
CREATE INDEX IF NOT EXISTS research_events_admin_log_order
  ON app_private.research_events (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS user_events_admin_log_order
  ON public.user_events (created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION app_private.sb_admin_user_logs(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor uuid := (SELECT auth.uid());
  claims jsonb := (SELECT auth.jwt());
  session_claim text;
  day_from date;
  day_to date;
  range_from timestamptz;
  range_to timestamptz;
  selected_user uuid;
  selected_event text := '';
  selected_screen text := '';
  selected_device text := '';
  include_administrators boolean := false;
  cursor_at timestamptz;
  cursor_id text;
  key text;
  result jsonb;
  stamp timestamptz := now();
BEGIN
  IF actor IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = 'PT401';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM auth.users u WHERE u.id = actor AND u.deleted_at IS NULL
      AND (u.banned_until IS NULL OR u.banned_until <= stamp)
  ) THEN
    RAISE EXCEPTION 'invalid_or_expired_session' USING ERRCODE = 'PT401';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = actor AND u.email_confirmed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'verified_account_required' USING ERRCODE = 'PT403';
  END IF;
  session_claim := claims ->> 'session_id';
  IF session_claim IS NULL OR session_claim !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'session_revoked' USING ERRCODE = 'PT401';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM auth.sessions s WHERE s.id = session_claim::uuid AND s.user_id = actor
      AND (s.not_after IS NULL OR s.not_after > stamp)
  ) THEN
    RAISE EXCEPTION 'session_revoked' USING ERRCODE = 'PT401';
  END IF;
  IF NOT app_private.sb_is_admin() THEN
    RAISE EXCEPTION 'admin_required' USING ERRCODE = 'PT403';
  END IF;
  PERFORM public.sb_require_mfa();
  BEGIN
    PERFORM public.sb_rate_limit();
  EXCEPTION WHEN SQLSTATE 'PT429' THEN
    RAISE EXCEPTION 'rate_limit_exceeded' USING ERRCODE = 'PT429';
  END;

  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR octet_length(p::text) > 4096 THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = 'PT422';
  END IF;
  FOR key IN SELECT jsonb_object_keys(p) LOOP
    IF key NOT IN ('from', 'to', 'user_id', 'event', 'screen', 'device', 'include_admin', 'cursor') THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = 'PT422';
    END IF;
  END LOOP;
  IF jsonb_typeof(p -> 'from') IS DISTINCT FROM 'string'
     OR jsonb_typeof(p -> 'to') IS DISTINCT FROM 'string'
     OR (p ->> 'from') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     OR (p ->> 'to') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
    RAISE EXCEPTION 'invalid_date_range' USING ERRCODE = 'PT422';
  END IF;
  BEGIN
    day_from := (p ->> 'from')::date;
    day_to := (p ->> 'to')::date;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
    RAISE EXCEPTION 'invalid_date_range' USING ERRCODE = 'PT422';
  END;
  IF day_to < day_from OR day_to - day_from > 89 THEN
    RAISE EXCEPTION 'invalid_date_range' USING ERRCODE = 'PT422';
  END IF;
  range_from := greatest(day_from::timestamp AT TIME ZONE 'Asia/Seoul', stamp - interval '90 days');
  range_to := least((day_to + 1)::timestamp AT TIME ZONE 'Asia/Seoul', stamp);

  FOREACH key IN ARRAY ARRAY['user_id', 'event', 'screen', 'device'] LOOP
    IF p ? key AND jsonb_typeof(p -> key) IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'invalid_filter' USING ERRCODE = 'PT422';
    END IF;
  END LOOP;
  IF coalesce(p ->> 'user_id', '') <> '' THEN
    IF (p ->> 'user_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'invalid_filter' USING ERRCODE = 'PT422';
    END IF;
    selected_user := (p ->> 'user_id')::uuid;
  END IF;
  selected_event := coalesce(p ->> 'event', '');
  selected_screen := coalesce(p ->> 'screen', '');
  selected_device := coalesce(p ->> 'device', '');
  IF selected_event NOT IN ('', 'view', 'click', 'heartbeat', 'conversion', 'sign_up', 'login',
      'onboarding_started', 'watchlist_added', 'onboarding_completed', 'brief_impression',
      'brief_opened', 'evidence_opened', 'followup_asked', 'alert_created', 'feedback_submitted')
     OR selected_screen NOT IN ('', 'today', 'explore', 'search', 'watchlist', 'portfolio', 'timeline',
      'questions', 'calendar', 'alerts', 'saved', 'settings', 'onboarding', 'company', 'event', 'document', 'help')
     OR selected_device NOT IN ('', 'desktop', 'mobile') THEN
    RAISE EXCEPTION 'invalid_filter' USING ERRCODE = 'PT422';
  END IF;
  IF p ? 'include_admin' THEN
    IF jsonb_typeof(p -> 'include_admin') IS DISTINCT FROM 'boolean' THEN
      RAISE EXCEPTION 'invalid_filter' USING ERRCODE = 'PT422';
    END IF;
    include_administrators := (p ->> 'include_admin')::boolean;
  END IF;
  IF p ? 'cursor' AND p -> 'cursor' <> 'null'::jsonb THEN
    IF jsonb_typeof(p -> 'cursor') IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'invalid_cursor' USING ERRCODE = 'PT422';
    END IF;
    IF (p -> 'cursor') - ARRAY['created_at', 'id'] <> '{}'::jsonb
       OR jsonb_typeof(p #> '{cursor,created_at}') IS DISTINCT FROM 'string'
       OR jsonb_typeof(p #> '{cursor,id}') IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'invalid_cursor' USING ERRCODE = 'PT422';
    END IF;
    cursor_id := p #>> '{cursor,id}';
    IF length(cursor_id) > 200 OR cursor_id !~ '^(usage|product):[A-Za-z0-9_-]+$'
       OR length(p #>> '{cursor,created_at}') > 64
       OR (p #>> '{cursor,created_at}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$' THEN
      RAISE EXCEPTION 'invalid_cursor' USING ERRCODE = 'PT422';
    END IF;
    BEGIN
      cursor_at := (p #>> '{cursor,created_at}')::timestamptz;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
      RAISE EXCEPTION 'invalid_cursor' USING ERRCODE = 'PT422';
    END;
  END IF;

  WITH consented AS MATERIALIZED (
    SELECT au.id, EXISTS (SELECT 1 FROM app_private.sb_admin_users a WHERE a.user_id = au.id::text) AS is_admin
    FROM public.users u JOIN auth.users au ON au.id::text = u.id
    WHERE u.analytics_consent IS TRUE AND au.deleted_at IS NULL
  ), eligible AS MATERIALIZED (
    SELECT * FROM consented WHERE (include_administrators OR NOT is_admin)
      AND (selected_user IS NULL OR id = selected_user)
  ), activity AS (
    SELECT ('usage:' || e.id::text) COLLATE "C" AS id, e.created_at, e.user_id,
      e.kind AS event, e.screen, e.device, e.session_id, e.page_id, e.active_ms, 'usage'::text AS source, u.is_admin
    FROM app_private.research_events e JOIN eligible u ON u.id = e.user_id
    WHERE e.created_at >= range_from AND e.created_at < range_to
    UNION ALL
    SELECT ('product:' || e.id) COLLATE "C", e.created_at, u.id, e.event_name,
      CASE WHEN e.properties ->> 'screen' = 'event_detail' THEN 'event'
        WHEN e.properties ->> 'screen' IN ('today', 'explore', 'search', 'watchlist', 'portfolio', 'timeline',
          'questions', 'calendar', 'alerts', 'saved', 'settings', 'onboarding', 'company', 'event', 'document', 'help')
        THEN e.properties ->> 'screen' ELSE NULL END,
      NULL::text, NULL::uuid, NULL::uuid, NULL::integer, 'product'::text, u.is_admin
    FROM public.user_events e JOIN eligible u ON u.id::text = e.user_id
    WHERE e.created_at >= range_from AND e.created_at < range_to
      AND length(e.id) <= 192 AND e.id ~ '^[A-Za-z0-9_-]+$'
      AND e.event_name IN ('sign_up', 'login', 'onboarding_started', 'watchlist_added', 'onboarding_completed',
        'brief_impression', 'brief_opened', 'evidence_opened', 'followup_asked', 'alert_created', 'feedback_submitted')
  ), filtered AS MATERIALIZED (
    SELECT * FROM activity
    WHERE (selected_event = '' OR event = selected_event)
      AND (selected_screen = '' OR screen = selected_screen)
      AND (selected_device = '' OR device = selected_device)
  ), candidates AS MATERIALIZED (
    SELECT * FROM filtered
    WHERE cursor_at IS NULL OR (created_at, id) < (cursor_at, cursor_id COLLATE "C")
    ORDER BY created_at DESC, id DESC LIMIT 51
  ), page AS MATERIALIZED (
    SELECT * FROM candidates ORDER BY created_at DESC, id DESC LIMIT 50
  )
  SELECT jsonb_build_object(
    'items', coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.created_at DESC, r.id DESC) FROM page r), '[]'::jsonb),
    'has_more', (SELECT count(*) > 50 FROM candidates),
    'next_cursor', CASE WHEN (SELECT count(*) > 50 FROM candidates) THEN
      (SELECT jsonb_build_object('created_at', r.created_at, 'id', r.id) FROM page r ORDER BY r.created_at, r.id LIMIT 1)
      ELSE NULL END,
    'summary', (SELECT jsonb_build_object('events', count(*), 'users', count(DISTINCT user_id),
      'sessions', count(DISTINCT session_id), 'active_ms', coalesce(sum(active_ms), 0)) FROM filtered),
    'consented_users', (SELECT count(*) FROM consented),
    'retention_days', 90, 'timezone', 'Asia/Seoul', 'generated_at', stamp
  ) INTO result;

  -- Audit the read itself; never copy event content or selected user IDs into audit details.
  INSERT INTO app_private.research_audit(actor, action, detail)
  VALUES (actor, 'user_logs_read', jsonb_build_object('from', day_from, 'to', day_to,
    'include_admin', include_administrators, 'returned', jsonb_array_length(result -> 'items')));
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION app_private.sb_admin_user_logs(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.sb_admin_user_logs(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.sb_admin_user_logs(p jsonb)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$ SELECT app_private.sb_admin_user_logs(p) $$;

REVOKE ALL ON FUNCTION public.sb_admin_user_logs(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sb_admin_user_logs(jsonb) TO authenticated;

-- Browser sessions must use the guarded projection, including when reading their own events.
REVOKE SELECT ON TABLE public.user_events FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS owner_select ON public.user_events;
COMMENT ON FUNCTION public.sb_admin_user_logs(jsonb) IS
  'Verified live administrator session plus MFA; consented activity only, 90-day KST range, 50-row keyset pages.';
NOTIFY pgrst, 'reload schema';
