# SQL case study: 18 reproducible product questions

SignalBrief explains financial-document changes with evidence. These exercises show how SQL can help a PM distinguish a successful journey, a measurement gap and a quality failure.

**Every result here is synthetic. None is user adoption, production reliability or real AI accuracy.** The examples use projections of actual audited PostgreSQL columns. Two explicitly proposed fixture tables (`signup_attempts`, `claim_reviews`) cover capabilities the product does not yet have. They are not migrations.

## Reproduce and verify

1. Create a disposable **local** PostgreSQL database whose name ends in `_test`. Never use a production connection. No new hosted service is required.
2. Install the repository's Python development dependencies, then set `SB_CAREER_POSTGRES_URL` to that local connection (SQLAlchemy `postgresql+psycopg` form).
3. Run `python -m pytest tests/test_career_sql.py -q`. Without a database, PostgreSQL checks are **skipped**, not passed. Existing CI's PostgreSQL job executes the marked tests using its disposable service.

[The fixture](sql/fixture.sql) creates only temporary tables, contains invented IDs and `.test` source URLs, and is rolled back after each test. `search_path=pg_temp` prevents accidentally falling back to real public tables. The runner rejects non-loopback hosts and database names without `_test`, bounds query execution, and never reads customer rows. Do not execute the fixture in the Supabase production SQL editor.

[Validation tests](../../tests/test_career_sql.py) execute the exact published files, compare hand-calculated results, run **all 18 on empty data**, inject five corruption types, test retention boundaries, verify UTC/Asia-Seoul invariance, and compare projected column types against the [read-only live schema snapshot](evidence/schema-snapshot.json). These projections deliberately omit unused columns and constraints; migration/RLS tests are separate and must not be inferred from these exercises.

The examples bind `:start=2026-01-01T00:00Z`, `:end=2026-01-10T00:00Z`, `:as_of=2026-01-12T00:00Z` through SQLAlchemy. Session timezone is UTC. Q15 expects midnight bounds. Require start < end <= as_of. Queries are read-only; parameters are values, never interpolated SQL strings. Q11/Q16/Q17/Q18 are current-state audits rather than time-window reports. For approved real analysis, use a restricted read-only role, select a known non-demo environment and collection period, inspect consent coverage, and review the [metric definitions](PRODUCT_METRICS.md) first.

Empty denominators return NULL rather than a misleading 0%. Synthetic examples are deliberately tiny and pedagogical; execution plans, production indexing and scale performance have not been benchmarked. Existing `user_events.user_id` indexes do not prove that cohort queries are efficient at scale. Review an authorized replica's EXPLAIN plan before considering composite indexes or materialized reports.

## Exercises and solutions

Each question below can be attempted before reading its solution. `test_published_query[N]` validates its expected result and `test_every_query_on_empty_data[N]` validates its empty-input behavior. The test matrix and fresh results are recorded in [TECHNICAL_VERIFICATION.md](TECHNICAL_VERIFICATION.md).

### 01. Signup completion

**Business question:** Which signup attempts complete within 24 hours?

**Skills:** CTE, conditional aggregate, NULLIF.

**Synthetic expected result:** 1 / 4 = 0.2500.

**Interpretation and edge cases:** Synthetic-only proposed signup_attempts. One completion, one missing, one exactly at +24h, one backwards timestamp; a recent attempt is outside the window.

**Canonical query:** [01_signup.sql](sql/01_signup.sql).

```sql
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
```

### 02. Watchlist activation

**Business question:** Do users save a company within seven days?

**Skills:** EXISTS, correlated subquery.

**Synthetic expected result:** 2 / 3 = 0.6667.

**Interpretation and edge cases:** Real table contract; synthetic user_events. Empty auto-created watchlists do not count. Telemetry coverage gaps are described in PRODUCT_METRICS.

**Canonical query:** [02_watchlist.sql](sql/02_watchlist.sql).

```sql
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
```

### 03. First detail activation

**Business question:** Do users reach a financial explanation?

**Skills:** CTE, semi-join.

**Synthetic expected result:** 3 / 3 = 1.0000.

**Interpretation and edge cases:** Duplicate views count once. Immature profiles and current opt-outs are excluded.

**Canonical query:** [03_first_detail.sql](sql/03_first_detail.sql).

```sql
WITH eligible AS (
  SELECT id, created_at FROM users
  WHERE analytics_consent AND created_at >= :start AND created_at < :end
    AND created_at + interval '7 days' <= :as_of
), counts AS (
  SELECT count(*) FILTER (WHERE EXISTS (
    SELECT 1 FROM user_events e WHERE e.user_id = u.id AND e.event_name = 'brief_opened'
      AND e.created_at >= u.created_at AND e.created_at < u.created_at + interval '7 days'
  )) AS numerator, count(*) AS denominator FROM eligible u
)
SELECT *, round(numerator::numeric / nullif(denominator, 0), 4) AS rate FROM counts;
```

### 04. Evidence engagement

**Business question:** Do viewed event pairs lead to source inspection within 24 hours?

**Skills:** JOIN, GROUP BY, JSON extraction.

**Synthetic expected result:** 2 / 5 = 0.4000.

**Interpretation and edge cases:** Pre-view clicks, another event and exactly +24h do not qualify. Not external-source page loads.

**Canonical query:** [04_evidence.sql](sql/04_evidence.sql).

```sql
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
      AND e.properties->>'event_id'=v.event_id AND e.event_name='evidence_opened'
      AND e.created_at >= v.viewed_at AND e.created_at < v.viewed_at + interval '24 hours'
  )) AS numerator, count(*) AS denominator FROM eligible v
)
SELECT *, round(numerator::numeric / nullif(denominator, 0), 4) AS rate FROM counts;
```

### 05. Exact D7 retention

**Business question:** Do users return during their eighth elapsed day?

**Skills:** Interval arithmetic, EXISTS.

**Synthetic expected result:** 1 / 3 = 0.3333.

**Interpretation and edge cases:** Day seven starts at +168h. Exactly +192h and login-only activity are excluded. New users cannot yet fail retention.

**Canonical query:** [05_retention.sql](sql/05_retention.sql).

```sql
WITH eligible AS (
  SELECT id, created_at FROM users
  WHERE analytics_consent AND created_at >= :start AND created_at < :end
    AND created_at + interval '8 days' <= :as_of
), counts AS (
  SELECT count(*) FILTER (WHERE EXISTS (
    SELECT 1 FROM user_events e WHERE e.user_id=u.id
      AND e.event_name IN ('brief_opened','evidence_opened','watchlist_added','followup_asked','feedback_submitted')
      AND e.created_at >= u.created_at + interval '7 days'
      AND e.created_at < u.created_at + interval '8 days'
  )) AS numerator, count(*) AS denominator FROM eligible u
)
SELECT *, round(numerator::numeric / nullif(denominator, 0), 4) AS rate FROM counts;
```

### 06. Follow-up usage

**Business question:** Which viewed pairs generate an accepted follow-up attempt?

**Skills:** Pair attribution, EXISTS.

**Synthetic expected result:** 1 / 5 = 0.2000.

**Interpretation and edge cases:** A request can produce a refusal. The question text is never required by this calculation.

**Canonical query:** [06_followup.sql](sql/06_followup.sql).

```sql
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
```

### 07. Feedback engagement

**Business question:** Which viewed pairs lead to a saved feedback submission?

**Skills:** Deduplication, conditional aggregate.

**Synthetic expected result:** 2 / 5 = 0.4000.

**Interpretation and edge cases:** Two feedback edits for one user/event still count once. This is response rate, not satisfaction.

**Canonical query:** [07_feedback.sql](sql/07_feedback.sql).

```sql
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
      AND e.properties->>'event_id'=v.event_id AND e.event_name='feedback_submitted'
      AND e.created_at >= v.viewed_at AND e.created_at < v.viewed_at + interval '24 hours'
  )) AS numerator, count(*) AS denominator FROM eligible v
)
SELECT *, round(numerator::numeric / nullif(denominator, 0), 4) AS rate FROM counts;
```

### 08. Processing failures

**Business question:** How often do completed extraction attempts fail?

**Skills:** Stage filtering, terminal-state aggregation.

**Synthetic expected result:** 2 / 3 = 0.6667.

**Interpretation and edge cases:** Exclude running, duplicate-skipped and follow-up runs. Retry success does not erase attempt failure.

**Canonical query:** [08_processing.sql](sql/08_processing.sql).

```sql
WITH counts AS (
  SELECT count(*) FILTER (WHERE status IN ('failed','validation_failed')) AS numerator,
    count(*) AS denominator
  FROM ai_runs WHERE stage='extract_validate_compare'
    AND status IN ('validated','failed','validation_failed')
    AND finished_at >= :start AND finished_at < :end AND finished_at <= :as_of
)
SELECT *, round(numerator::numeric / nullif(denominator, 0), 4) AS rate FROM counts;
```

### 09. Citation review

**Business question:** What fraction of independently reviewed claims have correct citations?

**Skills:** FILTER, review coverage.

**Synthetic expected result:** 1 / 2 = 0.5000; coverage 2 / 4 = 0.5000.

**Interpretation and edge cases:** Proposed synthetic claim_reviews only. Pending and future-dated reviews reduce coverage, not the reviewed denominator.

**Canonical query:** [09_citations.sql](sql/09_citations.sql).

```sql
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
```

### 10. Numeric review

**Business question:** What fraction of reviewed numeric claims are correct in financial context?

**Skills:** Applicability filtering, review coverage.

**Synthetic expected result:** 2 / 3 = 0.6667; coverage 3 / 4 = 0.7500.

**Interpretation and edge cases:** Synthetic review labels only; not-applicable text claims are excluded. No real AI accuracy claim.

**Canonical query:** [10_numeric.sql](sql/10_numeric.sql).

```sql
-- SYNTHETIC REVIEW CONTRACT: claim_reviews does not exist in production.
-- One adjudicated label per sampled claim and review kind; not model self-assessment.
WITH counts AS (
  SELECT count(*) FILTER (WHERE verdict='pass' AND reviewed_at <= :as_of) AS numerator,
    count(*) FILTER (WHERE verdict IN ('pass','fail') AND reviewed_at <= :as_of) AS denominator,
    count(*) FILTER (WHERE verdict <> 'not_applicable') AS sampled
  FROM claim_reviews WHERE kind='numeric' AND sampled_at >= :start AND sampled_at < :end
    AND sampled_at <= :as_of
)
SELECT *, round(numerator::numeric / nullif(denominator, 0), 4) AS rate,
  round(denominator::numeric / nullif(sampled, 0), 4) AS coverage FROM counts;
```

### 11. Current watchlist breadth

**Business question:** How many distinct companies are saved per consented user?

**Skills:** LEFT JOIN, GROUP BY, COUNT DISTINCT.

**Synthetic expected result:** u1=2, u2=1, u3=0, u5=0, u6=0.

**Interpretation and edge cases:** Multiple lists with the same company do not double-count it. Keep zero-item users. This is a present-state snapshot, not historical creation.

**Canonical query:** [11_watchlist_join.sql](sql/11_watchlist_join.sql).

```sql
-- Current state snapshot, not historical adoption. Keep users with zero saved items.
SELECT u.id AS user_id, count(DISTINCT i.company_id) AS companies
FROM users u LEFT JOIN watchlists w ON w.user_id=u.id
LEFT JOIN watchlist_items i ON i.watchlist_id=w.id
WHERE u.analytics_consent
GROUP BY u.id ORDER BY u.id;
```

### 12. Latest processing attempt

**Business question:** Which attempt should an operator inspect first per document?

**Skills:** ROW_NUMBER window function.

**Synthetic expected result:** d1/a5/duplicate_skipped; d2/a3/validation_failed; d3/a4/running; d4/a7/validated.

**Interpretation and edge cases:** Break equal created_at ties by ID for deterministic output. Latest does not mean latest successful. Status is current mutable state, not an as-of status reconstruction.

**Canonical query:** [12_latest_attempt.sql](sql/12_latest_attempt.sql).

```sql
WITH ranked AS (
  SELECT document_id, id, status,
    row_number() OVER (PARTITION BY document_id ORDER BY created_at DESC, id DESC) AS rn
  FROM ai_runs WHERE stage='extract_validate_compare' AND created_at <= :as_of
    AND document_id IS NOT NULL
)
SELECT document_id, id, status FROM ranked WHERE rn=1 ORDER BY document_id;
```

### 13. Ordered activation funnel

**Business question:** How many mature profiles add a company and then open a detail?

**Skills:** Multiple CTEs, correlated MIN.

**Synthetic expected result:** cohort=3, watchlist=2, detail=1.

**Interpretation and edge cases:** u2 viewed before adding and has no later view inside its seven-day window. Counting independent milestone totals would falsely report conversion.

**Canonical query:** [13_ordered_funnel.sql](sql/13_ordered_funnel.sql).

```sql
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
```

### 14. Weekly retention cohorts

**Business question:** Do signup-profile weeks differ in exact D7 return?

**Skills:** DATE_TRUNC, GROUP BY.

**Synthetic expected result:** 2025-12-29 UTC week: users=3, retained=1, rate=0.3333.

**Interpretation and edge cases:** ISO weeks begin Monday. Do not mix immature users into the next week or session-local timezone into cohort labels.

**Canonical query:** [14_cohorts.sql](sql/14_cohorts.sql).

```sql
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
```

### 15. Daily activity trend

**Business question:** Is detail-reading activity sustained, including zero-activity days?

**Skills:** GENERATE_SERIES, window AVG.

**Synthetic expected result:** Daily counts: 1,2,1,0,0,0,0,1,1; last rolling average=0.4286.

**Interpretation and edge cases:** Calendar spine preserves missing days. First six averages use the observed days so far, not an invented full prior week. This is a moving average of daily uniques, not seven-day unique users.

**Canonical query:** [15_daily_activity.sql](sql/15_daily_activity.sql).

```sql
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
```

### 16. Telemetry quality

**Business question:** Which records would make metrics misleading or leak sensitive fields?

**Skills:** LEFT JOIN, JSON validation, CASE.

**Synthetic expected result:** Clean fixture: 0; corrupt fixture: 5 distinct issues.

**Interpretation and edge cases:** Inject orphan_user, missing_event_id, future_timestamp, invalid_properties and unexpected_property. Check IDs and property names without returning private payload contents.

**Canonical query:** [16_event_quality.sql](sql/16_event_quality.sql).

```sql
SELECT e.id, CASE WHEN u.id IS NULL THEN 'orphan_user'
  WHEN e.event_name IN ('brief_opened','evidence_opened','followup_asked','feedback_submitted')
    AND nullif(e.properties->>'event_id','') IS NULL THEN 'missing_event_id'
  WHEN e.created_at > :as_of THEN 'future_timestamp'
  WHEN json_typeof(e.properties) <> 'object' THEN 'invalid_properties'
  ELSE 'unexpected_property' END AS issue
FROM user_events e LEFT JOIN users u ON u.id=e.user_id
WHERE u.id IS NULL OR e.created_at > :as_of OR json_typeof(e.properties) <> 'object'
  OR (e.event_name IN ('brief_opened','evidence_opened','followup_asked','feedback_submitted')
    AND nullif(e.properties->>'event_id','') IS NULL)
  OR EXISTS (SELECT 1 FROM json_object_keys(CASE WHEN json_typeof(e.properties)='object'
    THEN e.properties ELSE '{}'::json END) k WHERE k NOT IN ('event_id','company_id','screen','density','count'))
ORDER BY e.id;
```

### 17. Citation integrity

**Business question:** Do saved facts still have a source and an exact quoted span?

**Skills:** Multi-table LEFT JOIN, text containment.

**Synthetic expected result:** f2, f3, f4, f5 are flagged.

**Interpretation and edge cases:** Catches invented quote, missing chunk, blank source URL and blank quote. Real FKs prevent some corrupt rows; fixture omissions are intentional for defensive auditing. Exact substring is stricter than whitespace-normalizing validators and cannot prove entailment.

**Canonical query:** [17_citation_integrity.sql](sql/17_citation_integrity.sql).

```sql
-- Structural and verbatim-quote check only; does not establish semantic correctness.
SELECT f.id AS fact_id FROM facts f
LEFT JOIN document_chunks c ON c.id=f.chunk_id
LEFT JOIN documents d ON d.id=c.document_id
WHERE c.id IS NULL OR d.id IS NULL OR nullif(btrim(d.source_url),'') IS NULL
  OR nullif(btrim(f.quote),'') IS NULL OR strpos(c.text,f.quote)=0
ORDER BY f.id;
```

### 18. Numeric integrity

**Business question:** Are persisted same-unit deltas and percentages arithmetically plausible?

**Skills:** Guarded numeric casts, CASE, decimal arithmetic.

**Synthetic expected result:** n1/n2 consistent; n3/n7 undefined_percentage; n4 absolute_mismatch; n5 percentage_mismatch; n6 uncheckable.

**Interpretation and edge cases:** Missing/malformed values and unsupported/different units are uncheckable. Zero/negative baseline or percentage-point unit has undefined relative percent. Four-decimal rounding tolerance is 0.00005 percentage points. This does not establish period/scope/accounting compatibility.

**Canonical query:** [18_numeric_integrity.sql](sql/18_numeric_integrity.sql).

```sql
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
```
