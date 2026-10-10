WITH counts AS (
  SELECT count(*) FILTER (WHERE status IN ('failed','validation_failed')) AS numerator,
    count(*) AS denominator
  FROM ai_runs WHERE stage='extract_validate_compare'
    AND status IN ('validated','failed','validation_failed')
    AND finished_at >= :start AND finished_at < :end AND finished_at <= :as_of
)
SELECT *, round(numerator::numeric / nullif(denominator, 0), 4) AS rate FROM counts;
