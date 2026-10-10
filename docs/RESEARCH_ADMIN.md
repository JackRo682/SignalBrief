# Research administration release

The existing `/ops`, document detail, run detail, and public application remain available. The research extension uses the existing Supabase Auth identity and trusted admin allowlist. All writes use validated `/api/research` requests and a server-enforced RPC; raw research tables are private and have RLS enabled. No new browser secrets are needed.

## Routes

| Route | Behavior |
|---|---|
| `/ops/analytics` | Consent-only views, clicks, active time, UTC DAU/WAU, bounce, mature D1/D7 observed cohorts, transitions, date/device/screen filters |
| `/ops/experiments` | Create immutable experiment definitions, A/B allocation or AB/BA crossover, ratios, hypotheses, primary outcomes |
| `/ops/experiments/[id]` | State transitions, assignment/exposure/submission denominators, medians, pseudonymous responses and confidence |
| `/study/[id]` | Separate authenticated participant flow, consent, stable random assignment, exposure, question, submission, withdrawal |
| `/ops/evaluations` | Dataset creation, SEC ingestion, A/B/C comparison, shared daily AI budget configuration |
| `/ops/evaluations/datasets/[id]` | Current/previous SEC filing pair, exact-decimal gold, period/unit/excerpts, independent approve/reject/hold |
| `/ops/evaluations/runs/[id]` | Frozen snapshot, model/prompt versions, actual execution, source hashes, tokens, latency, per-case errors, prior-run comparison |
| `/ops/quality` | Existing validated SEC approvals/rejections and links to original review/rerun/report handling |
| `/ops/reliability` | Queue/run states, provider checks, measured legacy API 5xx ratio, explicit unknown Python-worker heartbeat, evidence log |
| `/ops/reports` | Fresh consent-aware CSV/JSON and print-to-PDF report with samples, methods and limitations |

## Deployment

1. Apply `supabase/research-migrations/20261010114340_research_admin.sql` to the existing hosted project after review and disposable PostgreSQL replay. It creates new private tables/functions, two consent/onboarding triggers, and an optional pg_cron job. It does not change existing event or document data. Confirm `signalbrief-research-retention` is active on hosted Supabase.
2. Deploy `signalbrief-research` with `index.ts`, `core.ts`, `deno.json`. The function validates Auth, MFA and admin status itself. Gateway JWT verification can be disabled only because this custom verification is mandatory. It uses the existing server-side Vault keys and private raw bucket.
3. Redeploy the existing `signalbrief-api` entrypoint with additive nonblocking metrics. Failure to record telemetry never fails a user request. Public configuration stays free of Auth/database round trips.
4. Deploy the Next application from `apps/web` using the existing project environment. No new environment values or resources are required.

Rollback web and Edge code first. The additive database objects may remain; do not drop research data as part of rollback. Unschedule the research cleanup only if the feature is entirely disabled and a replacement retention process exists.

## Measurement and privacy

General analytics starts only after the existing explicit analytics consent. It records screen categories (never raw URLs or IDs), coarse viewport class, click counts and foreground active time; no holdings, question text, email, IP or user-agent is stored. Active time stops after 30 seconds without input, and is sent in bounded intervals. Browser telemetry is descriptive, not fraud-proof. Onboarding completion is recorded by a database transition trigger with device `unknown`, not inferred from visits. Signup conversion is unknown because anonymous visitors are not tracked.

Research consent is separate. Participants authenticate to prevent repeat enrollment; administrators see random participant IDs, never the account-to-participant mapping. Assignment and submission are transactional and retries idempotent. Withdrawal deletes observations immediately, bars re-entry during record retention, and excludes the participant from newly generated exports. Already downloaded copies cannot be remotely revoked. Raw events and observations expire after 90 days and are removed by daily cleanup; the minimal consent/withdrawal row expires 30 days later. Analytics withdrawal deletes the new analytics history in the same transaction. Admin exports always query current consent/expiry state.

Experiments are immutable after creation; a changed design is a new experiment ID/version. Crossover retains order and phase, and is not analyzed as independent samples. Rates are descriptive only: accuracy uses submitted answers, completion and evidence use actual exposures. No p-value, power, or causal claim is generated. Detail lists cap at 500 observations; summary counts use all eligible rows.

Gold dataset registration binds two existing SEC filings from the same real company and different dates. Review and holdout splits cannot share a filing, including concurrent imports. A distinct authorized reviewer must approve all cases before a run can be created. A run freezes the dataset; changes require a new dataset. Gold numeric values are serialized as decimal strings. Evaluation prompts never include gold answers or answerability labels.

A asks the LLM to extract and calculate. B extracts structured values and uses exact decimal arithmetic. C additionally checks quoted substrings, number grounding, periods and units before acceptance. These are structural validations, not a proof of financial semantic truth. Actual SEC documents are fetched with a configured SEC contact, bounded to 5 MB, archived in private storage, and checked for the approved excerpts. Models receive the excerpts, not an asserted complete filing. Runs support at most 20 cases and a bounded execution time; unprocessed/failed cases count against useful completion. Cost is null without a verified billing basis; the per-call USD 0.04 reservation is only a conservative budget ceiling. Existing daily provider quotas still apply.

The reliability API rate covers completed `signalbrief-api` requests only (5xx / requests in hourly buckets over the recent 24 hours). It excludes public config, preflight, Vercel failures and unrelated provider routes. Python Worker telemetry is unavailable until that service is connected. Fault injection is performed only in disposable tests; manually entered evidence is an operator assertion, not an automatically certified pass.

## Verification

`python scripts/verify.py --full`, PostgreSQL replay under `SB_TEST_WORKSPACE_POSTGRES_URL` pointing to a disposable loopback database ending `_test`, and `npm run test:e2e -- e2e/research.spec.ts` cover the extension. `scripts/export_research_contract.cjs` exports the real Zod union into `packages/shared/research-openapi.json`. The main FastAPI contract remains unchanged because the new endpoint is hosted Next/Supabase functionality.

All browser/integration test participants are synthetic and confined to local fixtures. No synthetic participant, Gold answer, benchmark result or pass record is inserted into production.
