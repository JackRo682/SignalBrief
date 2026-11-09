-- A bounded cold-Home read for both layouts. Reuse the authoritative customer
-- projection once instead of serializing several full reads on the quota row.
-- Existing actions, calendars, polling and mutation RPCs remain unchanged.
CREATE FUNCTION app_content_private.home_snapshot(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  u text := (SELECT auth.uid())::text;
  requested_day date;
  first_day date;
  current_day date;
  history_enabled boolean;
  result jsonb;
BEGIN
  IF u IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = u::uuid) THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = 'PT401';
  END IF;
  PERFORM public.sb_require_mfa();
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = u AND onboarding_completed) THEN
    RAISE EXCEPTION 'onboarding_required' USING ERRCODE = 'PT403';
  END IF;
  IF p IS NULL OR jsonb_typeof(p) <> 'object' OR octet_length(p::text) > 1024
    OR p - 'today' <> '{}' OR jsonb_typeof(p->'today') IS DISTINCT FROM 'string'
    OR coalesce(p->>'today', '') !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RAISE EXCEPTION 'invalid_home_request' USING ERRCODE = 'PT422';
  END IF;
  BEGIN
    requested_day := (p->>'today')::date;
  EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN
    RAISE EXCEPTION 'invalid_home_date' USING ERRCODE = 'PT422';
  END;
  first_day := requested_day - 29;
  current_day := (now() AT TIME ZONE coalesce(
    (SELECT value->>'timezone' FROM public.workspace_preferences WHERE user_id = u),
    'Asia/Seoul'
  ))::date;
  history_enabled := coalesce((SELECT (value->>'history_enabled')::boolean
    FROM public.workspace_preferences WHERE user_id = u), false);
  -- One bounded request, one quota acquisition. Do not call the legacy workspace
  -- RPCs inside this function: each would rescan resources and acquire quota.
  PERFORM public.sb_rate_limit();

  WITH resources AS MATERIALIZED (
    SELECT * FROM app_private.sb_customer_resources()
  ), followed AS MATERIALIZED (
    SELECT DISTINCT c.id, c.name, c.last_ingested_at
    FROM public.watchlists w
    JOIN public.watchlist_items i ON i.watchlist_id = w.id
    JOIN public.companies c ON c.id = i.company_id
    WHERE w.user_id = u AND w.name = '관심종목'
      AND c.provider IN ('sec', 'dart') AND NOT c.is_demo
  ), dates AS MATERIALIZED (
    -- The dashboard/monitoring contract deliberately uses the same verified
    -- source predicate as the existing dashboard and source-overview actions.
    SELECT c.id, c.company_id, c.title, c.occurs_on, c.source_url,
      c.source_timezone, c.verified_at, co.name AS company_name
    FROM public.calendar_items c JOIN public.companies co ON co.id = c.company_id
    WHERE NOT co.is_demo AND co.provider IN ('sec', 'dart')
      AND (c.user_id IS NULL OR c.user_id = u)
      AND c.origin = 'official' AND c.calendar_status = 'confirmed'
      AND c.verified_at IS NOT NULL AND c.source_url IS NOT NULL
      AND app_private.sb_calendar_confirmed(c.id)
  ), resource_counts AS (
    SELECT company_id,
      count(*) FILTER (WHERE kind = 'filing') AS filing_count,
      count(*) FILTER (WHERE kind IN ('event', 'us_analysis', 'dart_analysis')) AS analysis_count
    FROM resources GROUP BY company_id
  ), latest_filings AS (
    SELECT DISTINCT ON (company_id) * FROM resources WHERE kind = 'filing'
    ORDER BY company_id, published_at DESC NULLS LAST, id
  ), latest_analyses AS (
    SELECT DISTINCT ON (company_id) * FROM resources
    WHERE kind IN ('event', 'us_analysis', 'dart_analysis')
    ORDER BY company_id, reviewed_at DESC NULLS LAST, published_at DESC, id, kind
  ), next_dates AS (
    SELECT DISTINCT ON (company_id) * FROM dates WHERE occurs_on >= current_day
    ORDER BY company_id, occurs_on, id
  ), recent_resources AS MATERIALIZED (
    -- Catalog's rolling 30-day filter differs from A's inclusive calendar dates.
    SELECT * FROM resources WHERE kind = 'company' OR published_at >= now() - make_interval(days => 30)
  ), catalog_metadata AS (
    SELECT
      coalesce((SELECT jsonb_agg(DISTINCT market) FROM public.companies
        WHERE provider IN ('sec', 'dart') AND NOT is_demo), '[]'::jsonb) AS markets,
      coalesce((SELECT jsonb_agg(DISTINCT category) FROM resources
        WHERE kind IN ('filing', 'document')), '[]'::jsonb) AS categories,
      coalesce((SELECT jsonb_object_agg(kind, n) FROM
        (SELECT kind, count(*) AS n FROM resources GROUP BY kind) x), '{}'::jsonb) AS all_counts,
      coalesce((SELECT jsonb_object_agg(kind, n) FROM
        (SELECT kind, count(*) AS n FROM recent_resources GROUP BY kind) x), '{}'::jsonb) AS recent_counts
  ), saved_resources AS MATERIALIZED (
    SELECT r.*, s.created_at AS saved_at
    FROM public.workspace_saved s JOIN resources r ON r.id = s.resource_id AND r.kind = s.kind
    WHERE s.user_id = u
  ), notifications AS MATERIALIZED (
    SELECT n.id::text, n.created_at, n.read_at, to_jsonb(r) AS resource
    FROM public.notifications n JOIN resources r ON r.kind = 'event' AND r.id = n.event_id
    WHERE n.user_id = u
    UNION ALL
    SELECT n.id::text, n.created_at, n.read_at, to_jsonb(r)
    FROM public.content_notifications n JOIN resources r ON r.kind = n.kind AND r.id = n.resource_id::text
    WHERE n.user_id = u
  ), dashboard_filings AS MATERIALIZED (
    SELECT * FROM resources WHERE kind = 'filing'
      AND CASE WHEN publication_precision = 'date' THEN (published_at AT TIME ZONE 'UTC')::date
        ELSE (published_at AT TIME ZONE 'Asia/Seoul')::date END BETWEEN first_day AND requested_day
  ), dashboard_analyses AS MATERIALIZED (
    SELECT * FROM resources WHERE kind IN ('us_analysis', 'dart_analysis', 'event')
      AND (reviewed_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN first_day AND requested_day
  ), dashboard_dates AS MATERIALIZED (
    SELECT * FROM dates WHERE occurs_on BETWEEN first_day AND requested_day
  )
  SELECT jsonb_build_object(
    'as_of', now(), 'today', requested_day,
    'watchlist', public.sb_watchlist(),
    'monitoring', coalesce((SELECT jsonb_agg(jsonb_build_object(
      'company_id', f.id, 'last_collected_at', f.last_ingested_at,
      'filing_count', coalesce(rc.filing_count, 0), 'analysis_count', coalesce(rc.analysis_count, 0),
      'latest_filing', to_jsonb(lf), 'latest_analysis', to_jsonb(la),
      'next_event', to_jsonb(nd) - 'company_name'
    ) ORDER BY f.name, f.id)
      FROM followed f LEFT JOIN resource_counts rc ON rc.company_id = f.id
      LEFT JOIN latest_filings lf ON lf.company_id = f.id
      LEFT JOIN latest_analyses la ON la.company_id = f.id
      LEFT JOIN next_dates nd ON nd.company_id = f.id), '[]'::jsonb),
    'directory', jsonb_build_object(
      'items', coalesce((SELECT jsonb_agg(app_private.sb_company_resource_overview(to_jsonb(x)))
        FROM (SELECT * FROM resources WHERE kind = 'company'
          ORDER BY published_at DESC NULLS LAST, id, kind LIMIT 50) x), '[]'::jsonb),
      'total', (SELECT count(*) FROM resources WHERE kind = 'company'),
      'counts', m.all_counts, 'markets', m.markets, 'categories', m.categories,
      'next_offset', CASE WHEN (SELECT count(*) FROM resources WHERE kind = 'company') > 50 THEN 50 ELSE NULL END
    ),
    'documents', jsonb_build_object(
      'items', coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM
        (SELECT * FROM recent_resources WHERE kind IN ('document', 'filing')
          ORDER BY published_at DESC NULLS LAST, id, kind LIMIT 50) x), '[]'::jsonb),
      'total', (SELECT count(*) FROM recent_resources WHERE kind IN ('document', 'filing')),
      'counts', m.recent_counts, 'markets', m.markets, 'categories', m.categories,
      'next_offset', CASE WHEN (SELECT count(*) FROM recent_resources WHERE kind IN ('document', 'filing')) > 50 THEN 50 ELSE NULL END
    ),
    'analyses', jsonb_build_object(
      'items', coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM
        (SELECT * FROM resources WHERE kind IN ('event', 'us_analysis', 'dart_analysis')
          ORDER BY published_at DESC NULLS LAST, id, kind LIMIT 2) x), '[]'::jsonb),
      'total', (SELECT count(*) FROM resources WHERE kind IN ('event', 'us_analysis', 'dart_analysis')),
      'counts', m.all_counts, 'markets', m.markets, 'categories', m.categories,
      'next_offset', CASE WHEN (SELECT count(*) FROM resources WHERE kind IN ('event', 'us_analysis', 'dart_analysis')) > 2 THEN 2 ELSE NULL END
    ),
    'saved', jsonb_build_object(
      'items', coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM
        (SELECT * FROM saved_resources WHERE kind IN ('us_analysis', 'dart_analysis')
          ORDER BY saved_at DESC, id, kind LIMIT 500) x), '[]'::jsonb),
      'counts', jsonb_build_object(
        'event', (SELECT count(*) FROM saved_resources WHERE kind = 'event'),
        'document', (SELECT count(*) FROM saved_resources WHERE kind IN ('document', 'filing')),
        'analysis', (SELECT count(*) FROM saved_resources WHERE kind IN ('us_analysis', 'dart_analysis')),
        -- CASE short-circuits the history subquery when consent is disabled.
        -- No browsing-history rows are returned or preloaded by this endpoint.
        'history', CASE WHEN history_enabled THEN
          (SELECT count(*) FROM public.workspace_history h
            JOIN resources r ON r.id = h.resource_id AND r.kind = h.kind WHERE h.user_id = u)
          ELSE 0 END
      )
    ),
    'notifications', jsonb_build_object(
      'items', coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM
        (SELECT * FROM notifications ORDER BY created_at DESC, id LIMIT 100) x), '[]'::jsonb),
      'unread_count', (SELECT count(*) FROM notifications WHERE read_at IS NULL)
    ),
    'dashboard', jsonb_build_object(
      'as_of', now(), 'timezone', 'Asia/Seoul', 'start_date', first_day, 'end_date', requested_day,
      'filing_count', (SELECT count(*) FROM dashboard_filings),
      'analysis_count', (SELECT count(*) FROM dashboard_analyses),
      'event_count', (SELECT count(*) FROM dashboard_dates),
      'filings', coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM
        (SELECT * FROM dashboard_filings ORDER BY published_at DESC, id LIMIT 5) x), '[]'::jsonb),
      'analyses', coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM
        (SELECT * FROM dashboard_analyses ORDER BY reviewed_at DESC, id, kind LIMIT 5) x), '[]'::jsonb),
      'events', coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM
        (SELECT * FROM dashboard_dates ORDER BY occurs_on, id LIMIT 5) x), '[]'::jsonb)
    )
  ) INTO result FROM catalog_metadata m;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION app_content_private.home_snapshot(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_content_private.home_snapshot(jsonb) TO authenticated;

CREATE FUNCTION public.sb_home_snapshot(p jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT app_content_private.home_snapshot(p)
$$;
REVOKE ALL ON FUNCTION public.sb_home_snapshot(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sb_home_snapshot(jsonb) TO authenticated;
NOTIFY pgrst, 'reload schema';
