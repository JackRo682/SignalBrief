# Technical verification and repository audit

Audit date: **2026-10-09 (Asia/Seoul)**. Base: `main` at `f680feab8bee13996e71210c566e2cc4da3d2339`. Work is isolated on `codex/career-analytics-evidence-20261009`. This report supersedes old verification summaries only for the checks explicitly rerun here. The repository contains older reports with conflicting deployment/security statements; their presence is not fresh evidence.

## What was actually inspected

| Area | Evidence found | Boundary |
|---|---|---|
| Actual PostgreSQL | Connected SignalBrief Supabase project, PostgreSQL 17; 42 public tables, 302 columns; 18 recorded migrations | Read-only schema/catalog queries; **no customer data read or changed** |
| Core schema | 29 SQLAlchemy application models/tables plus Alembic version table; frozen `001_initial` and `002_rls` | Core Alembic schema is not the whole hosted schema |
| Hosted additions | `supabase/hosted`, `reference-migrations`, `us-migrations`, `workspace-migrations`; Edge Functions | Includes question_history, preferences, US filings/analyses, workspace history/saved/searches/tickets/attachments and reminders |
| Schema evidence | [schema-snapshot.json](evidence/schema-snapshot.json) records column names/types and live migration versions | Some checked-in migration filenames differ from applied versions; filename equality is not schema equality. The network-extension migration has no equivalent checked-in file |
| Security catalog | RLS enabled on all 42 public tables; inspected live `sb_track`/`sb_mobile_onboarding` definitions and grants | RLS presence alone is not proof of correct policy isolation. Both inspected RPCs deny anon EXECUTE and grant authenticated EXECUTE |
| FastAPI | Real auth, watchlist/portfolio, feed/detail, questions, feedback, calendar/alerts, analytics and admin routes | Pydantic/SQLAlchemy implementation exists; no newly verified live FastAPI deployment |
| Frontend | Next 16.3.8 / React 19.3, TypeScript, Zod, Supabase browser Auth, desktop/mobile screens | Current `/api` proxy calls Supabase Edge; `/api/workspace` calls SQL RPCs. A technology in the PRD does not establish the active runtime |
| User journey | Login/signup → profile initialization → onboarding → watchlist/Today → detail/source → follow-up; bookmarks/history/settings/support | Mobile skip-onboarding and workspace flows differ from original 3-company FastAPI onboarding. Mobile feedback form is absent |
| Existing analytics | AuthProvider consent gate → `/v1/analytics`; FastAPI `user_events` + outbox; hosted `sb_track` local insert | No external provider was connected. Signup/complete onboarding/hosted mutation coverage is incomplete |
| Existing AI quality | Decimal comparison, evidence validators, stored sources/locations/hashes, synthetic eval runner | Automated supported status and synthetic evaluation are not independent real-world accuracy |
| Tests/CI | Pytest, Vitest, typecheck/ESLint, Next build, Playwright, PostgreSQL CI service | This PR adds SQL tests, API examples, mobile tracking tests and retained PostgreSQL CI reports |
| Deployment dependencies | Vercel/Next public configuration; Supabase Auth/DB/Edge/Storage; optional Python API/worker/cron config in Docker/Render example | No deployment, secret/configuration changes, migration application, merge or external export performed |

## Implemented change

Added consent-aware mobile `brief_opened` and `evidence_opened` signals using the existing authenticated API. The only properties are event_id and the bounded screen label. The helper suppresses repeated effects for the same mounted user/event, handles evidence deep links, and avoids recording failed/unloaded details. It does not persist a browser identifier, collect holdings/questions/source URLs, add infrastructure or require a database migration.

Eighteen executable SQL files and their fixture/tests cover joins, grouped aggregates, CTEs, windows, ordered funnels, cohorts, exact D7 retention, quality audits and safe division. Ten metric contracts explain denominators, censoring, consent/coverage limitations and product interpretation. Three FastAPI case studies link generated schemas to executable examples.

## Current local execution record

| Check | Result | Meaning |
|---|---|---|
| New FastAPI case-study tests | **5 passed** | Consent/PII allowlist, duplicate PUT, schema parse, advice refusal, invalid questions and missing resources; synthetic SQLite/TestClient |
| `python scripts/verify.py --full` Python suite | **249 passed, 75 skipped**, exit 0 for this subcheck | Includes new API examples and non-PostgreSQL regressions. PostgreSQL tests skipped without configured local service variables |
| Python compile / Ruff / OpenAPI export | **Passed** | Correctness beyond these checks is not implied |
| Frontend ESLint / TypeScript | **Passed** | Static checks only |
| Frontend Vitest / Next build | **Blocked by environment**; commands exited 1 | Native Windows realpath/canonicalization failed with EPERM/access denied before tests/build could run, even after specific workspace access was granted |
| Full verification command | **Exit 1** | Not an all-green release gate because frontend execution failed |
| Local PostgreSQL exercises | **Execution attempted; not yet verified in this record** | Windows disposable server reachability/init issues; no production database used |
| Browser E2E | **Not locally verified** | Local Next build/server execution is blocked; Linux CI must provide independent execution evidence |

The first local Python attempt failed during test setup because the Windows sandbox temporary directory was inaccessible. Redirecting TEMP/TMP into the task workspace resolved that failure; assertions were not weakened. Node 18 was initially on PATH; dependency installation was rerun successfully with Node 22.23.3. The tested Python runtime is 3.12.10. These setup failures are not represented as passing application tests.

Fresh Linux CI results and any SQL corrections will be recorded below before completion. A CI configuration or a queued run is not a passed run.

## Security concerns and deployment blockers

1. The read-only Supabase security advisor reported disabled leaked-password protection, public/authenticated SECURITY DEFINER functions requiring review, and three RLS-enabled internal tables without policies. No-policy internal tables can intentionally deny access; a definer-function warning is an audit finding, not proof of an exploit. Reviewed `sb_track` verifies auth.uid and consent, has an empty search_path, and rejects anon execution. Other functions require separate review. See [Supabase function-exposure guidance](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [RLS guidance](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) and [password-protection guidance](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
2. Existing analytics accepts client-supplied server milestone names and generic allowed string fields. No durable client-event idempotency token, telemetry retention job, consent history or trustworthy environment/staff label is implemented. Current consent is rechecked, but historical telemetry is not automatically erased on withdrawal. Metrics document these biases; telemetry is unsuitable for billing/security decisions.
3. The FastAPI watchlist cap uses count-then-insert and is not demonstrated safe under concurrent distinct additions. Mobile question length and onboarding contracts differ from FastAPI. These are existing findings outside the narrow analytics behavior change.
4. Do not apply all migration folders blindly. Core Alembic, hosted, reference, US and workspace additions have distinct dependencies and live version drift. Rehearse the correct ordered migration set in a disposable database and review rollback/data preservation before any release.
5. This change has not been deployed. Promotion requires user approval and successful relevant checks. Live OAuth with two users, production role isolation, consent collection/export after withdrawal, retention/erasure policy, backups/restore, actual source ingestion, private raw storage and real load behavior remain untested here.
6. Hosted architecture and Python worker deployment are separate. Do not claim a running ingestion worker from repository code or old runbooks. FastAPI live use needs its PostgreSQL URL, Supabase URL/JWKS, private storage/service key and admin allowlist; DART needs its key, SEC a configured contact user agent, and OpenAI a configured model/key/budget. None were supplied or used for this implementation. Optional PostHog/Sentry transport was not verified or enabled.

## What an interview can legitimately demonstrate

- **SQL reasoning:** build and explain joins, CTEs, window functions, ordered funnels, mature cohorts, exact-day retention, zero-denominator handling and data-quality checks, with executable synthetic expectations. Claim actual PostgreSQL execution only where the final run evidence below confirms it.
- **Product analytics specification:** define a unit of analysis, numerator/denominator, attribution window, meaningful return event and maturity cutoff; identify consent and missing-instrumentation bias; separate activity, successful answers and independent quality.
- **API literacy and testing:** read implementation-derived contracts; explain authorization, ownership, validation, idempotency, domain refusals and rate limits; test failure cases and preserve decimal/null semantics.
- **Privacy-conscious implementation:** add minimal consented first-party UI signals using existing architecture and test opt-out, no-loaded-data and duplicate-render cases, without sending sensitive content or adding a provider.
- **Engineering judgment:** compare production schema metadata to migrations/models, identify two execution architectures, preserve source evidence, isolate a feature branch, and disclose blocked/untested checks.

You cannot claim measured real-user signup/retention uplift, product-market fit, independently validated AI accuracy, production load/security certification, live OAuth/LLM verification, completed deployment or personally authoring/understanding every existing system. In an interview, explain and reproduce the new queries and tests yourself; describe AI assistance honestly if asked. “I defined and validated a reproducible measurement specification using synthetic fixtures” is defensible; “SignalBrief achieved these conversion/accuracy percentages” is not.
