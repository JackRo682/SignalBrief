-- Add one guarded, bounded overview of existing records. No new tracking, consent
-- changes, administrator grants, or raw user-content projections are introduced.
CREATE OR REPLACE FUNCTION app_private.sb_admin_overview(p jsonb)
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
  api_from timestamptz;
  history_from timestamptz;
  today_kst date;
  include_administrators boolean;
  key text;
  result jsonb;
  stamp timestamptz := now();
BEGIN
  -- Match the activity-log boundary, including direct PostgREST/RPC calls.
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
    IF key NOT IN ('from', 'to', 'include_admin') THEN
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
  IF jsonb_typeof(p -> 'include_admin') IS DISTINCT FROM 'boolean' THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = 'PT422';
  END IF;
  include_administrators := (p ->> 'include_admin')::boolean;
  history_from := stamp - interval '90 days';
  today_kst := (stamp AT TIME ZONE 'Asia/Seoul')::date;
  range_from := greatest(day_from::timestamp AT TIME ZONE 'Asia/Seoul', history_from);
  range_to := least((day_to + 1)::timestamp AT TIME ZONE 'Asia/Seoul', stamp);
  -- API storage is hourly and retained for 30 days, independently of product data.
  -- Exclude a partial oldest bucket rather than claiming finer time precision.
  api_from := greatest(day_from::timestamp AT TIME ZONE 'Asia/Seoul',
    date_trunc('hour', stamp - interval '30 days', 'UTC') + interval '1 hour');

  WITH consented AS MATERIALIZED (
    SELECT au.id, u.created_at, u.onboarding_completed,
      EXISTS (SELECT 1 FROM app_private.sb_admin_users a WHERE a.user_id = au.id::text) AS is_admin
    FROM public.users u JOIN auth.users au ON au.id::text = u.id
    WHERE u.analytics_consent IS TRUE AND au.deleted_at IS NULL
  ), eligible AS MATERIALIZED (
    SELECT * FROM consented WHERE include_administrators OR NOT is_admin
  ), history_usage AS MATERIALIZED (
    SELECT e.id, e.created_at, e.user_id, e.session_id, e.screen, e.kind, e.active_ms
    FROM app_private.research_events e JOIN eligible u ON u.id = e.user_id
    WHERE e.created_at >= history_from AND e.created_at < stamp
  ), history_product AS MATERIALIZED (
    SELECT e.created_at, u.id AS user_id, e.event_name
    FROM public.user_events e JOIN eligible u ON u.id::text = e.user_id
    WHERE e.created_at >= history_from AND e.created_at < stamp
      AND length(e.id) <= 192 AND e.id ~ '^[A-Za-z0-9_-]+$'
      AND e.event_name IN ('sign_up', 'login', 'onboarding_started', 'watchlist_added', 'onboarding_completed',
        'brief_impression', 'brief_opened', 'evidence_opened', 'followup_asked', 'alert_created', 'feedback_submitted')
  ), selected_usage AS MATERIALIZED (
    SELECT * FROM history_usage WHERE created_at >= range_from AND created_at < range_to
  ), selected_product AS MATERIALIZED (
    SELECT * FROM history_product WHERE created_at >= range_from AND created_at < range_to
  ), active_users AS MATERIALIZED (
    SELECT user_id FROM selected_usage UNION SELECT user_id FROM selected_product
  ), user_totals AS (
    SELECT count(*) AS users FROM active_users
  ), session_order AS (
    SELECT e.*, lag(created_at) OVER (PARTITION BY user_id, session_id ORDER BY created_at, id) AS previous_at
    FROM history_usage e WHERE kind <> 'conversion'
  ), session_numbered AS MATERIALIZED (
    -- sessionStorage IDs live for a tab's lifetime. Reconstruct inactivity breaks
    -- without changing or pretending to improve the original tracking collection.
    SELECT e.*, sum(CASE WHEN previous_at IS NULL OR created_at - previous_at >= interval '30 minutes' THEN 1 ELSE 0 END)
      OVER (PARTITION BY user_id, session_id ORDER BY created_at, id ROWS UNBOUNDED PRECEDING) AS segment
    FROM session_order e
  ), selected_session_events AS MATERIALIZED (
    SELECT * FROM session_numbered WHERE created_at >= range_from AND created_at < range_to
  ), selected_sessions AS MATERIALIZED (
    SELECT user_id, session_id, segment,
      sum(CASE WHEN kind = 'heartbeat' THEN active_ms ELSE 0 END) AS active_ms
    FROM selected_session_events GROUP BY user_id, session_id, segment
  ), session_last AS (
    SELECT DISTINCT ON (user_id, session_id, segment) user_id, session_id, segment, screen, created_at
    FROM session_numbered ORDER BY user_id, session_id, segment, created_at DESC, id DESC
  ), ended AS MATERIALIZED (
    -- Observe beyond the selected period so a continuing session is not mistaken
    -- for an exit at midnight or at the selected end boundary.
    SELECT * FROM session_last
    WHERE created_at >= range_from AND created_at < range_to AND created_at <= stamp - interval '30 minutes'
  ), page_totals AS (
    SELECT screen, count(*) FILTER (WHERE kind = 'view') AS views, count(DISTINCT user_id) AS users,
      count(DISTINCT (user_id, session_id, segment)) AS sessions,
      sum(CASE WHEN kind = 'heartbeat' THEN active_ms ELSE 0 END) AS active_ms
    FROM selected_session_events GROUP BY screen
  ), pages AS (
    SELECT page_row.*, page_row.active_ms::numeric / nullif(page_row.sessions, 0) AS average_active_ms,
      (SELECT count(*) FROM ended e WHERE e.screen = page_row.screen) AS exits,
      (SELECT count(*) FROM ended e WHERE e.screen = page_row.screen)::numeric / nullif(page_row.sessions, 0) AS exit_rate
    FROM page_totals page_row
  ), view_days AS MATERIALIZED (
    SELECT DISTINCT user_id, (created_at AT TIME ZONE 'Asia/Seoul')::date AS day
    FROM history_usage WHERE kind = 'view'
  ), first_views AS (
    SELECT user_id, min(day) AS first_day FROM view_days GROUP BY user_id
  ), cohorts AS MATERIALIZED (
    SELECT * FROM first_views
    WHERE first_day BETWEEN day_from AND day_to
      -- The oldest retained local day is partial; its first observation is not a
      -- complete cohort boundary. All other cohorts remain explicitly observed,
      -- not signup cohorts or a claim about pre-retention history.
      AND first_day > (history_from AT TIME ZONE 'Asia/Seoul')::date
  ), retention_rows AS (
    SELECT d.day,
      count(c.user_id) FILTER (WHERE c.first_day + d.day < today_kst) AS eligible,
      count(c.user_id) FILTER (WHERE c.first_day + d.day < today_kst AND EXISTS (
        SELECT 1 FROM view_days v WHERE v.user_id = c.user_id AND v.day = c.first_day + d.day
      )) AS returned,
      count(c.user_id) FILTER (WHERE c.first_day + d.day >= today_kst) AS pending
    FROM (VALUES (1), (7)) d(day) LEFT JOIN cohorts c ON true GROUP BY d.day
  ), daily_views AS (
    SELECT (created_at AT TIME ZONE 'Asia/Seoul')::date AS day,
      count(DISTINCT user_id) AS visitors, count(*) AS page_views
    FROM selected_usage WHERE kind = 'view' GROUP BY (created_at AT TIME ZONE 'Asia/Seoul')::date
  ), days AS (
    SELECT d.day::date AS day, coalesce(v.visitors, 0) AS visitors, coalesce(v.page_views, 0) AS page_views
    FROM generate_series(greatest(day_from, (history_from AT TIME ZONE 'Asia/Seoul')::date)::timestamp,
      least(day_to, today_kst)::timestamp, interval '1 day') d(day)
    LEFT JOIN daily_views v ON v.day = d.day::date
  ), feature_names(event) AS (
    VALUES ('watchlist_added'), ('brief_opened'), ('evidence_opened'), ('followup_asked'), ('alert_created'), ('feedback_submitted')
  ), feature_users AS (
    SELECT DISTINCT user_id FROM selected_product WHERE event_name IN (SELECT event FROM feature_names)
  ), features AS (
    SELECT f.event, count(DISTINCT product_event.user_id) AS users, count(product_event.user_id) AS events,
      count(DISTINCT product_event.user_id)::numeric / nullif((SELECT users FROM user_totals), 0) AS usage_rate
    FROM feature_names f LEFT JOIN selected_product product_event ON product_event.event_name = f.event GROUP BY f.event
  ), activation AS (
    -- This is a current profile snapshot, not historical completion timing or a
    -- behavioral seven-day activation metric. The response makes the basis explicit.
    SELECT count(*) AS eligible, count(*) FILTER (WHERE onboarding_completed IS TRUE) AS completed
    FROM eligible WHERE created_at >= range_from AND created_at < range_to
  ), api_window AS MATERIALIZED (
    SELECT hour, requests, errors, latency_ms, last_seen FROM app_private.research_api_metrics
    WHERE hour >= api_from AND hour < range_to
  ), api_totals AS (
    SELECT coalesce(sum(requests), 0) AS requests, coalesce(sum(errors), 0) AS errors,
      sum(errors)::numeric / nullif(sum(requests), 0) AS error_rate,
      sum(latency_ms)::numeric / nullif(sum(requests), 0) AS mean_latency_ms,
      max(last_seen) AS last_seen FROM api_window
  ), error_hours AS (
    SELECT hour, requests, errors, errors::numeric / nullif(requests, 0) AS error_rate
    FROM api_window WHERE errors > 0 ORDER BY hour DESC LIMIT 20
  )
  SELECT jsonb_build_object(
    'from', day_from, 'to', day_to, 'include_admin', include_administrators,
    'timezone', 'Asia/Seoul', 'retention_days', 90, 'generated_at', stamp,
    'coverage', jsonb_build_object(
      'product_scope', 'consented_signed_in_users',
      'first_available_event_at', (SELECT min(created_at) FROM (
        SELECT created_at FROM history_usage UNION ALL SELECT created_at FROM history_product
      ) h),
      'consented_users', (SELECT count(*) FROM consented), 'eligible_users', (SELECT count(*) FROM eligible),
      'retention_basis', 'first_observed_view_in_retained_history', 'retention_observed_until', stamp,
      'signup_status', 'not_instrumented', 'session_timeout_minutes', 30
    ),
    'summary', jsonb_build_object(
      'visitors', (SELECT count(DISTINCT user_id) FROM selected_usage WHERE kind = 'view'),
      'page_views', (SELECT count(*) FROM selected_usage WHERE kind = 'view'),
      'active_users', (SELECT users FROM user_totals),
      'sessions', (SELECT count(*) FROM selected_sessions),
      'active_ms', (SELECT coalesce(sum(active_ms), 0) FROM selected_sessions),
      'average_active_ms', (SELECT sum(active_ms)::numeric / nullif(count(*), 0) FROM selected_sessions),
      'signup_conversion', NULL,
      'activation', (SELECT jsonb_build_object('completed', completed, 'eligible', eligible,
        'rate', completed::numeric / nullif(eligible, 0), 'basis', 'new_profiles_current_onboarding', 'as_of', stamp) FROM activation),
      'core_feature_users', (SELECT count(*) FROM feature_users),
      'core_feature_rate', (SELECT count(*)::numeric / nullif((SELECT users FROM user_totals), 0) FROM feature_users),
      'ended_sessions', (SELECT count(*) FROM ended)
    ),
    'retention', (SELECT jsonb_agg(jsonb_build_object('day', day, 'returned', returned,
      'eligible', eligible, 'pending', pending, 'rate', returned::numeric / nullif(eligible, 0)) ORDER BY day) FROM retention_rows),
    'days', coalesce((SELECT jsonb_agg(to_jsonb(d) ORDER BY day) FROM days d), '[]'::jsonb),
    'features', (SELECT jsonb_agg(to_jsonb(f) ORDER BY users DESC, events DESC, event) FROM features f),
    'pages', coalesce((SELECT jsonb_agg(to_jsonb(page_row) ORDER BY views DESC, screen) FROM pages page_row), '[]'::jsonb),
    'api', (SELECT jsonb_build_object(
      'scope', 'signalbrief_api_completed_requests', 'includes_admin', true, 'retention_days', 30,
      'coverage_from', CASE WHEN api_from < range_to THEN api_from ELSE NULL END,
      'coverage_to', CASE WHEN api_from < range_to THEN range_to ELSE NULL END,
      'requests', requests, 'errors', errors, 'error_rate', error_rate,
      'mean_latency_ms', mean_latency_ms, 'last_seen', last_seen,
      'recent_error_hours', coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY hour DESC) FROM error_hours e), '[]'::jsonb)
    ) FROM api_totals)
  ) INTO result;

  INSERT INTO app_private.research_audit(actor, action, detail)
  VALUES (actor, 'admin_overview_read', jsonb_build_object('from', day_from, 'to', day_to, 'include_admin', include_administrators));
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION app_private.sb_admin_overview(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.sb_admin_overview(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.sb_admin_overview(p jsonb)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$ SELECT app_private.sb_admin_overview(p) $$;

REVOKE ALL ON FUNCTION public.sb_admin_overview(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sb_admin_overview(jsonb) TO authenticated;
COMMENT ON FUNCTION public.sb_admin_overview(jsonb) IS
  'Admin live-session/MFA overview. Consented signed-in activity, KST dates, 90-day product and 30-day system API coverage. No raw content.';
NOTIFY pgrst, 'reload schema';
