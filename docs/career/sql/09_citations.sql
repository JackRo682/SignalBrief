-- SYNTHETIC REVIEW CONTRACT: claim_reviews does not exist in production.
-- One adjudicated label per sampled claim and review kind; not model self-assessment.
WITH counts AS (
  SELECT count(*) FILTER (WHERE verdict='pass' AND reviewed_at <= :as_of) AS numerator,
    count(*) FILTER (WHERE verdict IN ('pass','fail') AND reviewed_at <= :as_of) AS denominator,
    count(*) FILTER (WHERE verdict <> 'not_applicable') AS sampled
  FROM claim_reviews WHERE kind='citation' AND sampled_at >= :start AND sampled_at < :end
    AND sampled_at <= :as_of
)
SELECT *, round(numerator::numeric / nullif(denominator, 0), 4) AS rate,
  round(denominator::numeric / nullif(sampled, 0), 4) AS coverage FROM counts;
