WITH eligible AS (
  SELECT id, created_at FROM users
  WHERE analytics_consent AND created_at >= :start AND created_at < :end
    AND created_at + interval '7 days' <= :as_of
), counts AS (
  SELECT count(*) FILTER (WHERE EXISTS (
    SELECT 1 FROM user_events e WHERE e.user_id = u.id AND e.event_name = 'watchlist_added'
      AND e.created_at >= u.created_at AND e.created_at < u.created_at + interval '7 days'
  )) AS numerator, count(*) AS denominator FROM eligible u
)
SELECT *, round(numerator::numeric / nullif(denominator, 0), 4) AS rate FROM counts;
