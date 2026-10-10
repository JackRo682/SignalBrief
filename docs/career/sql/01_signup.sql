-- SYNTHETIC CONTRACT ONLY: signup_attempts is not a production table.
WITH eligible AS (
  SELECT * FROM signup_attempts
  WHERE started_at >= :start AND started_at < :end
    AND started_at + interval '24 hours' <= :as_of
), counts AS (
  SELECT count(*) FILTER (WHERE completed_at >= started_at
      AND completed_at < started_at + interval '24 hours') AS numerator,
    count(*) AS denominator
  FROM eligible
)
SELECT *, round(numerator::numeric / nullif(denominator, 0), 4) AS rate FROM counts;
