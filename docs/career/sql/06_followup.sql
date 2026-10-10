WITH views AS (
  SELECT e.user_id, e.properties->>'event_id' AS event_id, min(e.created_at) AS viewed_at
  FROM user_events e JOIN users u ON u.id=e.user_id AND u.analytics_consent
  WHERE e.event_name='brief_opened' AND e.created_at >= :start AND e.created_at < :end
    AND nullif(e.properties->>'event_id', '') IS NOT NULL
  GROUP BY e.user_id, e.properties->>'event_id'
), eligible AS (
  SELECT * FROM views WHERE viewed_at + interval '24 hours' <= :as_of
), counts AS (
  SELECT count(*) FILTER (WHERE EXISTS (
    SELECT 1 FROM user_events e WHERE e.user_id=v.user_id
      AND e.properties->>'event_id'=v.event_id AND e.event_name='followup_asked'
      AND e.created_at >= v.viewed_at AND e.created_at < v.viewed_at + interval '24 hours'
  )) AS numerator, count(*) AS denominator FROM eligible v
)
SELECT *, round(numerator::numeric / nullif(denominator, 0), 4) AS rate FROM counts;
