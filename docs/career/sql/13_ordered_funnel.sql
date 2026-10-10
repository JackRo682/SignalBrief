WITH cohort AS (
  SELECT id, created_at FROM users WHERE analytics_consent
    AND created_at >= :start AND created_at < :end
    AND created_at + interval '7 days' <= :as_of
), watch AS (
  SELECT u.*, (SELECT min(e.created_at) FROM user_events e WHERE e.user_id=u.id
    AND e.event_name='watchlist_added' AND e.created_at >= u.created_at
    AND e.created_at < u.created_at + interval '7 days') AS watched_at FROM cohort u
), opened AS (
  SELECT w.*, (SELECT min(e.created_at) FROM user_events e WHERE e.user_id=w.id
    AND e.event_name='brief_opened' AND e.created_at >= w.watched_at
    AND e.created_at < w.created_at + interval '7 days') AS opened_at FROM watch w
)
SELECT count(*) AS cohort, count(watched_at) AS watchlist, count(opened_at) AS detail FROM opened;
