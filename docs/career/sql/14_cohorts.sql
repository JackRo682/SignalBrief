WITH eligible AS (
  SELECT id, created_at FROM users WHERE analytics_consent
    AND created_at >= :start AND created_at < :end
    AND created_at + interval '8 days' <= :as_of
), retained AS (
  SELECT u.*, EXISTS (SELECT 1 FROM user_events e WHERE e.user_id=u.id
    AND e.event_name IN ('brief_opened','evidence_opened','watchlist_added','followup_asked','feedback_submitted')
    AND e.created_at >= u.created_at + interval '7 days'
    AND e.created_at < u.created_at + interval '8 days') AS returned FROM eligible u
)
SELECT date_trunc('week', created_at AT TIME ZONE 'UTC')::date AS cohort_week,
  count(*) AS users, count(*) FILTER (WHERE returned) AS retained,
  round(count(*) FILTER (WHERE returned)::numeric / nullif(count(*),0),4) AS rate
FROM retained GROUP BY 1 ORDER BY 1;
