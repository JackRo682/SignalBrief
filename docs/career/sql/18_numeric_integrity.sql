-- Numeric-text guard prevents malformed persisted strings from breaking the audit.
WITH parsed AS (
  SELECT ch.id, previous_value, current_value, absolute_change, percentage_change,
    cf.unit AS current_unit, pf.unit AS previous_unit,
    CASE WHEN previous_value ~ '^-?[0-9]+(\.[0-9]+)?$' THEN previous_value::numeric END AS p,
    CASE WHEN current_value ~ '^-?[0-9]+(\.[0-9]+)?$' THEN current_value::numeric END AS c,
    CASE WHEN absolute_change ~ '^-?[0-9]+(\.[0-9]+)?$' THEN absolute_change::numeric END AS a,
    CASE WHEN percentage_change ~ '^-?[0-9]+(\.[0-9]+)?$' THEN percentage_change::numeric END AS pct
  FROM changes ch LEFT JOIN facts cf ON cf.id=ch.current_fact_id
  LEFT JOIN facts pf ON pf.id=ch.previous_fact_id WHERE change_type IN ('increased','decreased','unchanged')
), checked AS (
  SELECT id, CASE
    WHEN p IS NULL OR c IS NULL OR a IS NULL OR current_unit IS NULL
      OR current_unit IS DISTINCT FROM previous_unit
      OR current_unit NOT IN ('USD','USD million','USD billion','KRW','KRW million','KRW billion','KRW 억원','%','shares') THEN 'uncheckable'
    WHEN a <> c-p THEN 'absolute_mismatch'
    WHEN (p<=0 OR current_unit='%') AND percentage_change IS NOT NULL THEN 'undefined_percentage'
    WHEN p>0 AND current_unit<>'%' AND (pct IS NULL OR abs(pct-(c-p)/p*100)>0.00005) THEN 'percentage_mismatch'
    ELSE 'consistent' END AS result FROM parsed
)
SELECT * FROM checked ORDER BY id;
