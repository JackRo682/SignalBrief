# Product metrics: what SignalBrief can honestly measure

This is a measurement specification and executable SQL portfolio, **not an adoption report**. All example results come from invented fixtures. No customer activity was queried. The schema audit on 2026-10-09 read database metadata only. See [verification](TECHNICAL_VERIFICATION.md) for the exact evidence boundary.

For a PM, the central question is whether a person reaches a useful, traceable explanation and comes back. More clicks or more generated answers are not automatically better. An appropriate refusal can be a successful safety outcome.

## Common calculation rules

- SQL is in [sql/](sql/); Q01–Q10 below are the canonical calculations, executed by [tests/test_career_sql.py](../../tests/test_career_sql.py).
- Bind `:start` inclusive, `:end` exclusive, and `:as_of` (observation cutoff) as timezone-aware timestamps through SQLAlchemy. Set the session timezone to UTC. The synthetic example uses start 2026-01-01T00:00Z, end 2026-01-10T00:00Z, as_of 2026-01-12T00:00Z. Require start < end <= as_of. Q15 assumes midnight UTC reporting bounds.
- A rate is numerator / denominator, reported as a decimal between 0 and 1. Multiply by 100 for percent. A zero denominator produces NULL, meaning **not measurable**, never 0% success. Display denominator and coverage beside every rate.
- User metrics use first-party `users.id`, never email, IP, fingerprint, holdings or question text. Each eligible user counts once; engagement metrics use distinct (user, financial event) pairs. `events` are financial events; `user_events` are telemetry. They are different tables and units.
- Q02–Q07 and Q13–Q15 filter current `users.analytics_consent=true`. This is a consented observable population, not all signups. Consent history and collection-start timestamps do not exist. Late opt-in creates missing early actions; later opt-out removes a person from recalculated cohorts. These rates cannot yet estimate unbiased whole-product conversion or historic consent snapshots.
- `users.created_at` is first application-profile initialization, **not verified account signup time**. Until signup instrumentation exists, label these cohorts “new application profiles.” Run only for a known environment and post-instrumentation period; there is no trustworthy per-user demo/staff exclusion field. Do not combine demo/test/production databases or assume a company `is_demo` flag labels users.
- Views are rendered-detail signals, not API fetches or feed impressions. Network failures, blockers, browser termination and best-effort delivery can lose events. Receipts use server time; client events have no durable occurrence time or retry idempotency key. Distinct units reduce repeated-count inflation but do not recover lost events or prevent client spoofing.
- All maturity windows are elapsed UTC time: a full 7 days for activation, 8 days for exact D7 retention, 24 hours for engagement. Recent, incomplete windows are excluded rather than called failures.

## 1. Signup completion — Q01

**Definition:** proportion of tracked signup attempts resulting in confirmed account completion within 24 hours. This is an attempt conversion rate, not unique-person conversion.

**Numerator:** eligible attempt IDs with completion >= start and < start + 24 hours. **Denominator:** attempts started in the reporting interval whose full 24-hour window has elapsed by as_of.

**Required events/data:** proposed `signup_started(attempt_id, started_at)` and authoritative `signup_completed(attempt_id, completed_at)` with consent before optional collection, deduplicated into `signup_attempts`. This table exists **only in synthetic fixtures**. The authenticated `user_events.user_id NOT NULL` contract cannot represent anonymous drop-offs. Existing `sign_up` enum support alone does not establish coverage, and `onboarding_completed` is not signup completion.

**SQL:** [01_signup.sql](sql/01_signup.sql). Synthetic result: 1/4 = 25%.

**Edge cases:** repeated callbacks update one attempt; a second genuine attempt is separate; completions before start are invalid; exactly 24h is excluded; pending attempts need time to mature. Cross-device linking, email verification and OAuth callbacks need an explicit attribution design. Do not collect email or browser fingerprints to solve this implicitly.

**Interpretation:** identifies registration friction after implementation. It cannot currently establish real signup conversion. This PR deliberately does not introduce anonymous tracking or fabricate identity linkage.

## 2. Watchlist creation / activation — Q02

**Definition:** a new application-profile user records at least one successful company addition in their first 7 days. An automatically provisioned empty watchlist does not count.

**Numerator:** eligible users with `watchlist_added` in [profile creation, creation + 7d). **Denominator:** consented profiles created in the report interval with a complete 7-day window.

**Required event:** `watchlist_added`, emitted after a successful new insertion, not a repeated PUT. FastAPI already does this. Its onboarding bulk insert emits `onboarding_completed` rather than each watchlist addition; hosted/mobile onboarding uses a separate RPC and does not guarantee equivalent telemetry. Therefore this query is executable against real tables but **partially instrumented**, and is not yet a total activation measure.

**SQL:** [02_watchlist.sql](sql/02_watchlist.sql). Synthetic result: 2/3 = 66.67%.

**Edge cases:** repeated adds count once per user; deletion should not erase an already collected milestone; automatic container creation is excluded. A current-state join (Q11) cannot reconstruct removed items or past creation. Backfills must be tagged and must not be represented as historical event capture.

**Interpretation:** assesses whether users express an interest needed for relevant briefs. Complete onboarding and hosted mutation coverage before comparing cohorts or screens.

## 3. First event-detail view — Q03

**Definition:** reach at least one successfully rendered financial event detail within 7 days of profile creation.

**Numerator:** eligible users with at least one `brief_opened` inside their own 7-day window. **Denominator:** the same mature profile cohort as Q02.

**Required event:** `brief_opened` with `event_id`. Desktop detail already calls tracking. This PR adds mobile detail tracking after a valid detail response is loaded. The helper does not emit for a failed load and suppresses duplicate effects for the same user/event within one mounted view.

**SQL:** [03_first_detail.sql](sql/03_first_detail.sql). Synthetic result: 3/3 = 100%; this is an engineered test expectation, not a launch result.

**Edge cases:** remounts or genuine revisits can emit again, but the SQL counts a user once. An empty feed is not a failed view; report content availability separately. Late opt-in and earlier desktop-only instrumentation can bias the measured rate.

**Interpretation:** a first-value proxy. It proves an opportunity to read, not comprehension or investment value.

## 4. Evidence-source engagement — Q04

**Definition:** for each distinct user/event pair first viewed in the report interval, at least one evidence interaction occurs within 24 hours of that first view.

**Numerator:** eligible pairs with `evidence_opened` for the same event at or after the view and before view + 24h. **Denominator:** first-in-window view pairs with a complete 24-hour observation window. “First” is within the reporting interval, not necessarily first ever.

**Required events:** `brief_opened`, `evidence_opened`, both with event_id. Mobile emits evidence engagement when nonempty source quotes expand (including an evidence deep link), when a document link is clicked, or when a safe original-source link is clicked. It records only event_id and `screen=mobile_detail`; it never exports the URL or quote. One evidence signal per mounted user/event suffices for this binary rate.

**SQL:** [04_evidence.sql](sql/04_evidence.sql). Synthetic result: 2/5 = 40%.

**Edge cases:** pre-view evidence signals and another event’s clicks do not count; exactly +24h does not count; repeated expansions do not inflate conversion. External destination load and actual reading are unobserved. A hidden/automatic API fetch is not engagement. Desktop source-link coverage is partial.

**Interpretation:** indicates use of the product’s evidence promise. It is not proof that users checked correctness or trusted the answer.

## 5. Seven-day retention — Q05

**Definition:** exact elapsed-day D7 retention: meaningful activity in [profile creation + 168h, profile creation + 192h).

**Numerator:** mature cohort users with at least one qualifying event in that interval. **Denominator:** consented profiles in the report interval with creation + 8d <= as_of.

**Required events:** any of `brief_opened`, `evidence_opened`, `watchlist_added`, `followup_asked`, `feedback_submitted`. `login` and `brief_impression` do not qualify. The signup-origin caveat and coverage gaps above apply.

**SQL:** [05_retention.sql](sql/05_retention.sql); [14_cohorts.sql](sql/14_cohorts.sql) groups the same definition by UTC signup-profile week. Synthetic result: 1/3 = 33.33%.

**Edge cases:** a day-six or day-eight visit is not day seven; partial cohorts are omitted; duplicate events count once. This is neither “returned at any time within seven days” nor rolling retention after day seven. Holidays and episodic filings can make daily cadence unsuitable; examine weekly return as a separate future metric.

**Interpretation:** a reason to investigate repeat value, not a claim of product-market fit. Publish uncertainty intervals only when an appropriate real sample exists.

## 6. AI follow-up usage — Q06

**Definition:** accepted follow-up-attempt engagement within 24h of a pair’s first-in-window detail view. It does not measure answer quality or successful answers.

**Numerator:** eligible user/event view pairs followed by `followup_asked` for the same event within 24h. **Denominator:** the mature viewed pairs used by Q04.

**Required events:** `brief_opened`, `followup_asked`. FastAPI records after event authorization and rate limiting but before answer generation; policy refusals and unavailable responses can still count as attempts. Hosted evidence Q&A saves `question_history` via a different path and does not establish equivalent event coverage. No question text belongs in analytics.

**SQL:** [06_followup.sql](sql/06_followup.sql). Synthetic result: 1/5 = 20%.

**Edge cases:** 401/404/429 requests do not reach FastAPI’s emitter; answered, abstained, policy_blocked and unavailable are distinct outcomes. Do not infer LLM calls from every follow-up: hosted Q&A can be deterministic and policy refusals may have no run ID. Client-submitted copies of server event names remain a spoofing/double-emission risk in the pre-existing endpoint.

**Interpretation:** shows demand for clarification. High usage with frequent abstentions can mean content gaps, not strong AI performance.

## 7. User-feedback submission — Q07

**Definition:** at least one saved feedback submission within 24h of first-in-window detail view per user/event pair.

**Numerator:** eligible pairs with `feedback_submitted` in the view’s 24h window. **Denominator:** mature viewed pairs as in Q04.

**Required events:** `brief_opened`, `feedback_submitted`. FastAPI upserts feedback and telemetry in one transaction, so a commit failure saves neither. Hosted coverage must be verified separately; the current mobile detail has no feedback form.

**SQL:** [07_feedback.sql](sql/07_feedback.sql). Synthetic result: 2/5 = 40%.

**Edge cases:** updates produce additional telemetry but do not increase the distinct-pair numerator. Feedback table `created_at` remains first creation after edits; it is not an edit timestamp. Comment text and ratings are not copied into the new engagement events. Do not treat support-ticket submissions as event feedback.

**Interpretation:** measures willingness/opportunity to respond, not satisfaction. Helpful/unclear/wrong-evidence mix needs a separate, consent-aware analysis with selection-bias disclosure.

## 8. Event-processing failure rate — Q08

**Definition:** terminal failed attempts in the FastAPI `extract_validate_compare` stage, grouped by completion time. A document can have multiple attempts.

**Numerator:** `failed` + `validation_failed` attempts. **Denominator:** `failed` + `validation_failed` + `validated` attempts finished within [start,end) and by as_of.

**Required operational records:** `ai_runs.stage/status/finished_at`; no user event or analytics consent is needed for system reliability. Exclude running, duplicate_skipped, followup-stage runs and missing finish timestamps. There is no `event_processing_failed` emitter in the product contract.

**SQL:** [08_processing.sql](sql/08_processing.sql). Synthetic result: 2/3 = 66.67%. Q12 diagnoses the latest attempt per document.

**Edge cases:** successful retry does not erase an earlier failed attempt; terminal failures before the stage (download/parser/queue) are not in this denominator. `validated` need not mean published. Missing terminal timestamps need an operational data-quality alert. The hosted US pipeline uses `us_filings`/`us_analyses`, so this metric does not measure that system’s reliability.

**Interpretation:** distinguish provider/system failure from conservative evidence rejection before responding. Rejected unsupported claims can mean the safety checks worked. Report those two numerator categories separately in an operational dashboard.

## 9. Citation correctness — Q09

**Definition:** independently adjudicated sampled claims for which all required citations exist, resolve to the right version/location and support the whole claim. A missing required citation is a failure, not an excluded claim.

**Numerator:** eligible sampled claims with a completed `pass` citation review by as_of. **Denominator:** sampled claims with completed pass/fail review by as_of. **Coverage:** reviewed / all applicable sampled claims; pending or future reviews stay out of correctness but remain in coverage’s denominator.

**Required data:** a versioned evaluation manifest linking displayed claim, output/model/prompt version, preserved source evidence and independent review; one final adjudicated label per claim/kind. The `claim_reviews` table in Q09 is a **synthetic projection of a proposed evaluation contract**, not a deployed schema or real review program. Operational `validations.status='supported'` is automated acceptance, not independent ground truth.

**SQL:** [09_citations.sql](sql/09_citations.sql). Synthetic correctness 1/2 = 50%; coverage 2/4 = 50%.

**Edge cases:** sample from all displayed claims, not only claims with citations; keep unreviewed visible; adjudicate disagreement; do not cherry-pick easy examples. Claim IDs must identify an immutable output revision and evaluation batch. Q17 checks source/quote integrity only and cannot establish entailment.

**Interpretation:** supports a quality claim only after a representative, independently labelled real evaluation exists. None was created or claimed in this work.

## 10. Numeric consistency — Q10

**Definition:** independently reviewed numeric claims whose value, sign, scale, currency/unit, period, scope, accounting basis and displayed arithmetic all match the cited evidence.

**Numerator:** applicable numeric claims with completed pass reviews. **Denominator:** applicable numeric claims with pass/fail reviews completed by as_of; report review coverage as in Q09. Nonnumeric/not-applicable claims are excluded from both the reviewed denominator and applicable sample.

**Required data:** the same proposed `claim_reviews` contract with kind=numeric and a review rubric that checks all dimensions, including rounding tolerance. No production human-labelled numeric benchmark is present.

**SQL:** [10_numeric.sql](sql/10_numeric.sql). Synthetic correctness 2/3 = 66.67%, coverage 3/4 = 75%. [18_numeric_integrity.sql](sql/18_numeric_integrity.sql) is a separate deterministic decimal-arithmetic check on existing `changes` columns.

**Edge cases:** unknown or malformed values are uncheckable; zero baseline produces NULL percent, not infinity; negative baselines and percentage-point units also require NULL percent, matching the implementation convention; mismatched currencies/scales/periods must fail or abstain before arithmetic. Q18 checks only equal, recognized units, reports other units as uncheckable, and allows four-decimal rounding error (0.00005 percentage points). It cannot verify the other semantic dimensions.

**Interpretation:** useful for catching harmful financial misrepresentation. A passing arithmetic test is a narrower claim than correct financial interpretation.

## Privacy and rollout contract

This PR adds no analytics provider, database migration, cookie, local-storage identifier or network destination. The existing authenticated endpoint rechecks consent. FastAPI’s optional exporter checks consent again at delivery and is disabled without a PostHog project key; the hosted `sb_track` path persists locally and does not use that worker. No external analytics project was configured.

The pre-existing endpoint accepts client event names and generic bounded property strings; it does not establish trusted semantic event provenance. Do not use it for billing, security decisions or exact model-call accounting. A future change should separate server-only milestones, validate object references and introduce explicit event-version/environment tags with a tested migration. Consent withdrawal suppresses future collection/export, but does not itself delete historical local telemetry. Set retention, access, erasure and consent-history policies before a broad rollout. These are identified gaps, not completed features.
