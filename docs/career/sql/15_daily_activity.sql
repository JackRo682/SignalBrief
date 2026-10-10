WITH daily AS (
  SELECT (e.created_at AT TIME ZONE 'UTC')::date AS day, count(DISTINCT e.user_id) AS active_users
  FROM user_events e JOIN users u ON u.id=e.user_id AND u.analytics_consent
  WHERE e.event_name='brief_opened' AND e.created_at >= :start AND e.created_at < :end
    AND e.created_at <= :as_of GROUP BY 1
), calendar AS (
  SELECT d::date AS day FROM generate_series(
    CAST(:start AS timestamptz) AT TIME ZONE 'UTC',
    (least(CAST(:end AS timestamptz),CAST(:as_of AS timestamptz)) - interval '1 microsecond') AT TIME ZONE 'UTC',
    interval '1 day') d
), filled AS (
  SELECT c.day, coalesce(d.active_users,0) AS active_users FROM calendar c LEFT JOIN daily d USING(day)
)
SELECT *, round(avg(active_users) OVER (ORDER BY day ROWS BETWEEN 6 PRECEDING AND CURRENT ROW),4) AS trailing_observed_day_average
FROM filled ORDER BY day;
