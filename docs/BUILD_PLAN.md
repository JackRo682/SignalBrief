# SignalBrief Implementation Plan

Version 1.1 • Future work only; this document does not authorize implementation in the present specification task

## 1. Handoff and task discipline

Read README, PRD, the relevant specification and acceptance IDs before each task. Inspect the target repository and applicable AGENTS.md before editing. Use [.agent/PLANS.md](../.agent/PLANS.md) for a living execution plan and [AGENTS.md](../AGENTS.md) for engineering/verification rules. Reuse existing implementations if discovered. Implement **one bounded task** per change, run its relevant checks, and report behavior, verification and remaining prerequisites. Do not add unrelated features or implement P2/Not Now items.

Each row is Epic → Feature → Task → Acceptance Criteria. Dependency IDs must be complete before execution. Provider/account prerequisites can be handled with fixtures while preserving explicit integration gates; never invent successful live access. No task is complete merely because code was generated. A task expected to exceed one focused implementation session should be split before work, preserving its acceptance contract.

Default task output: scoped code/migrations/config, meaningful tests, updated setup/environment instructions, and a concise completion record. Human labeling, rights approval, account configuration and live-user research are dependencies with human review; Codex can prepare evidence and tooling but cannot fabricate approval or independent judgments.

## 2. Dependency map

| Sequence | Outcome | Gate |
|---|---|---|
| Foundation T01–T07 | Contracts, identities, private access and durable jobs | Ownership and queue tests |
| Sources T08–T13 | KR/US discovery, immutable evidence, parsing and labeling rubric | Correct issuer, locators, rights/coverage records |
| Intelligence T14–T22 | Normalized facts, comparisons, evidence, validation and publication | No invalid published claims; correction lifecycle |
| Core product T23–T33 | Ops, onboarding/watchlist, feed, detail, timeline, feedback and measurement | P0 journey and instrumentation tests |
| P0 readiness T34–T38 | Gold evaluation, privacy, hardening, staging and pilot gate | All P0 acceptance IDs and real integration smoke evidence |
| P1 beta T39–T48 | Portfolio, grounded Q&A, calendar, alerts and configuration controls | Full beta acceptance matrix |
| Beta operation T49–T50 | Reviewed live events and longitudinal learning | Measured results; no claimed PMF from small samples |

Rows are displayed in a valid dependency order. Some tasks can be independently executed after prerequisites, but this plan does not require multi-agent work or simultaneous changes.

## Epic E1 — Foundation

Feature F01/F14: typed, secure application foundation.

| Task | Dependencies | Deliverable / bounded work | Acceptance and verification |
|---|---|---|---|
| T01 Repository foundation | None | Inspect repository; establish proposed web/API/worker/contracts/migrations/evals structure, dependency locks, local run commands, env example and CI skeleton. No product functionality beyond health stubs. | Fresh checkout installs/runs health stubs; Next build, Python import/health smoke and secret scan pass; no credentials committed. AC-20 |
| T02 Canonical domain/API contracts | T01 | Encode the shared types, enums, stage input/output envelopes (including receipts, diagnostics and publication/final dispositions), decimals/date precision and validation contracts; generate frontend types from one authoritative API schema. | Invalid unit/value shape/enum/extra fields rejected; API/frontend contract compatibility check; nullable number differs from zero. AC-06/07/20 |
| T03 Shared content schema foundations | T02 | Migrate companies, instruments, source registry, coverage, immutable raw documents, parsed_artifacts and artifact-linked spans with keys/indexes/grants. | Empty DB install and upgrade fixture pass; duplicate provider/hash prevented; ticker ambiguity preserved; source revisions append; same bytes/two parser versions preserve both span histories and immutable hashes. AC-05/07/22 |
| T04 Google Auth and BFF session | T01, T02 | Implement server-side Supabase/Google start/callback/refresh/logout and thin authenticated proxy; protected route entry. | Valid sign-in/logout; expired/canceled/state-mismatch callback; unsafe redirect rejected; tokens absent from client bundle/logs. Live staging callback is an external configuration gate. AC-01 |
| T05 User tables and ownership boundary | T03, T04 | Profiles/watchlist/preferences/coverage request schema; API runtime role; verified transaction-local claims; RLS and active-account checks. | A/B users cannot read/change each other; pooled A→B request has no inherited identity; browser direct table access denied. AC-02 |
| T06 Supported company/source registry | T03 | Prepare proposed 20-company roster, provider-ID mappings, ticker validity, supported forms and source-rights review records; directory endpoint. | KR/US mappings resolve provider identifiers; unsupported/unreviewed coverage cannot be enabled; UI/API coverage explains known gaps. Owner approves roster/rights, not Codex alone. AC-03/05/22 |
| T07 Durable jobs and scheduler | T03 | Jobs/idempotency/outbox foundations, leases/heartbeats/fencing, scheduled-bucket uniqueness, retry/dead-letter and safe replay interface. | Crash, duplicate scheduler and expired lease fixtures produce one logical result; 429/5xx bounded retry; max-attempt poison job visible. AC-21 |

## Epic E2 — Source ingestion and provenance

Feature F03: official documents before generation.

| Task | Dependencies | Deliverable / bounded work | Acceptance and verification |
|---|---|---|---|
| T08 DART discovery adapter | T06, T07 | Filing-list pagination, dates/status codes, amendment inclusion, canonical IDs, cursor and rate-budget handling. | Multi-page/amendment/empty/status-error fixtures; cursor advances only on full success; key redacted. One bounded live key smoke after configuration. AC-05 |
| T09 SEC discovery adapter | T06, T07 | Submissions/history discovery with CIK/accession identity, approved User-Agent and aggregate rate limiter. | Multi-file history, 429/403 and duplicate fixtures; no request above configured shared budget; original URL constructed from provider metadata. Bounded live smoke. AC-05 |
| T10 Immutable source acquisition | T08, T09 | Approved-host fetcher, bounded redirects/bytes/archive safety, content hashing/private object storage, fetch receipts and revision mapping. | Same bytes reuse object; changed bytes create version; bad host/redirect/zip traversal/oversize rejected; retries do not duplicate documents. AC-05/22 |
| T11 HTML/XML text and table parsers | T10 | Immutable parser-versioned artifacts with deterministic normalized text, table cell extraction and offset/section locators for representative KR/US sources. | Golden source spans resolve exactly; qualifier/table headings retained; scripts/entities disabled; encoding error quarantined. AC-07/22 |
| T12 PDF parser and gap handling | T10 | Versioned parsed artifacts from text-PDF extraction with page locators and parse-quality diagnostics; scanned/garbled PDFs quarantined without automatic OCR. | Numeric/table/excerpt fixture checks; no confident analysis from empty text; PDF size/time limits; unsupported type counts visible. AC-07/24 |
| T13 Gold rubric and first development fixtures | T11, T12 | Labeling guide, case schema, source-family grouping and twelve diverse real development bundles, prepared for human verification. | Every label links a checked source span/cutoff; ambiguity notes; zero invented events; reviewer approval recorded or explicitly pending. AC-18 |

## Epic E3 — Change intelligence

Features F04/F05/F07/F12: explain supported differences with reproducible checks.

| Task | Dependencies | Deliverable / bounded work | Acceptance and verification |
|---|---|---|---|
| T14 Event/fact persistence and normalization | T02, T03, T11, T13 | Events/facts/comparisons schema with same-issuer canonical_event_id distinct from amendment lineage; root-only/cycle-safe constraints; metric dictionary, Decimal conversion, period/basis/scope fields and unknown-value semantics. | Scale/currency/quarter/YTD/GAAP fixtures; unmapped metrics remain incomparable; idempotent canonical keys. AC-06 |
| T15 Bounded event/fact extraction | T14, T07 | Structured extraction/classification stage with source-span IDs, schema checks, model-call accounting and refusal handling. | Multi-event filing, missing qualifier, hallucinated ID and refusal fixtures; usage/attempts recorded; invalid facts blocked. AC-07/08/23 |
| T16 Comparable prior matching | T14, T15 | Structured candidate filters, as-of retrieval, supported comparison relations, ambiguity and amendment handling. | Wrong issuer/basis/period and future-document traps fail; no-baseline/ambiguous states explicit. AC-06/09 |
| T17 Numeric/qualitative change detection | T16 | Exact numeric/pp/range calculations; paired-excerpt qualitative change check; no-change/new/revised/not-comparable output. | Zero/negative prior, sign-crossing, ranges and source rounding; missing text not treated as withdrawal. AC-06 |
| T18 Deterministic significance and relevance | T17, T05 | Versioned materiality/novelty/recency rules and subscription-union ranking; portfolio bonus disabled until P1. | Hand-calculated score fixtures, stable ties, date-only precision, no price/source-quality phantom inputs. AC-04 |
| T19 Bounded evidence retrieval | T16, T17 | Exact event/prior evidence retrieval, contradiction inclusion, immutable locators and context limits; lexical first. | Correct URL/wrong excerpt trap rejected; context cannot cross issuer/cutoff; missing evidence abstains. AC-07 |
| T20 Analysis generation and safe fallback | T15, T17, T19 | Claim-structured factual/interpretive summaries, plain-language glossary and deterministic validated-fact template. | All factual summary/title clauses represented as claims; unsupported interpretation removed; model failure uses only independently validated facts. AC-07/08/24 |
| T21 Citation/numeric/policy validation | T20 | Validator records, ID/hash/location/arithmetic checks, semantic entailment/policy check and gate completeness. | Unrelated citation, changed qualifier, causal leap, forbidden advice and injection fixtures blocked; uncertain checks not silently pass. AC-07/08/22 |
| T22 Publication/correction service | T21, T07 | Brief/claim/citation persistence, current revision transaction, required human-review mode, withdrawal, P0 exposure registry/accuracy actions/notices and idempotent outbox fanout/reconciliation. | Publish only passing candidate; retry produces one revision; correction/withdrawal invalidates old current content and keeps history; late exposure, crash, no-consent and opt-out users still receive persistent deduped accuracy notices. AC-09/21 |

## Epic E4 — Operator control

Feature F11: inspect evidence and enforce publication lifecycle.

| Task | Dependencies | Deliverable / bounded work | Acceptance and verification |
|---|---|---|---|
| T23 Ops authorization and review API | T04, T05, T22 | Admin membership/assurance, run detail, approve/reject/withdraw/duplicate/replay/pause routes with reasons and audit. | Non-admin/stale assurance denied; admin cannot override hard failure; replay budget/idempotency/version and duplicate-cycle/cross-issuer/alias-visibility tests. AC-09/11 |
| T24 Minimum Ops UI | T23 | Review queue, source/comparison/claim/validator inspection, action confirmations and heartbeat/lag indicators. | Complete passing/rejected/conflict fixtures; no secret fields; mobile withdrawal/pause; stale version 409 recoverable. AC-11/19 |

## Epic E5 — Core user experience

Features F02/F06/F07/F08/F09/F10/F14.

| Task | Dependencies | Deliverable / bounded work | Acceptance and verification |
|---|---|---|---|
| T25 Watchlist/directory APIs | T05, T06 | Search, add/remove, coverage request and onboarding-completion APIs; atomic caps/natural-key idempotency. | One-name continuation, duplicates, ticker/exchange collision, 30-cap race, unsupported request fixtures. AC-03 |
| T26 Login/onboarding/watchlist UI | T04, T25 | Three P0 screens with timezone/consent and accessible setup; route to Today without portfolio amounts. | Browser fixture flow, one-name continue, no-results/error/loading/keyboard/mobile states; no fictitious holdings. AC-01/03/19 |
| T27 Feed/detail/evidence/timeline read APIs | T18, T19, T22, T25 | Published-only relevant feed, signed cursor snapshot, stable revision detail, evidence/timeline and P0 accuracy-notice list/acknowledgement endpoints; minimal served-exposure recording independent of analytics. | Private no-store; no subscription leakage; late backfill separately labeled; quiet vs delayed response fixture. AC-04/07/09/24 |
| T28 Today screen | T26, T27 | Ranked top-three + all-events pagination, filters, freshness, quiet/current/backfill states, explanation of relevance and P0 accuracy-notice banner/list/acknowledgement. | Exact eligible feed; no fabricated card to fill three; mobile card and error states; zero model call on load. AC-04/19/24 |
| T29 Event detail/evidence/glossary UI | T27, T28 | Before/after, source panels, interpretation/uncertainty, original language and correction states. | Claim→correct location; mobile stacked units/context; focus return; withdrawn content absent; plain-language comprehension fixtures. AC-06/07/08/09/19 |
| T30 Company timeline UI | T27, T29 | Chronological sourced list, amendment grouping, filters, coverage start and previous-event links. | Stable pagination/history fixtures; no price-causality display; empty/partial coverage distinctions. AC-09/19 |
| T31 Feedback/reporting | T05, T22, T29, T23 | Rating/error report API and UI, exact-version links, Ops report resolution and acknowledgments. | Idempotent rating/report, correct run association, private note; unresolved/report rate not treated as confirmed error. AC-10 |

## Epic E6 — Measurement and P0 readiness

Features F12/F13/F14.

| Task | Dependencies | Deliverable / bounded work | Acceptance and verification |
|---|---|---|---|
| T32 Telemetry capture/consent/export | T05, T07, T28, T31 | Product-session table migration, explicit event schemas, session/foreground timing, same-origin ingest, consent filter, outbox exporter and Sentry scrubbing. | No raw holdings/question text; no duplicate export; opt-out prevents product events; failure doesn't break UI. AC-17 |
| T33 Derived metrics and dashboards | T32, T22 | Qualified-session/activation derivation, signup/retention windows, useful/source/alert metric definitions and operations counters; read-only evaluation-summary schema/reader and ten-metric mapping fixtures, with real results supplied by T35. | Background time or failed question cannot qualify; mature-cohort and empty denominator fixtures; WEBS dedup and concentration stats. AC-17 |
| T34 Complete and freeze gold dataset | T13, T17, T21 | Execute repeatable labeling batches of **10–12 bundles each** until target 120; each batch is its own bounded task instance. Then freeze grouped split and independent-review status. | Each batch has source/label QA; final strata/counts/splits recorded; holdout not exposed to tuning. Human review is a required dependency. AC-18 |
| T35 Evaluation runner and release report | T21, T34 | Per-case predictions/counts, all ten metric formulas, authoritative ops.eval_metric_summaries and versioned JSON export/API, coverage/yield/abstention/cost reports, threshold decision and prior-version comparison. | Known manual scoring fixtures reproduce all ten formulas/count mappings; N/A/incomplete and pre-gate/published scopes correct; failed/no-output attempts and cost per completed/attempted/published analysis counted; export repeatability and grouped leakage checks. Actual model results reported, not assumed. AC-18/23 |
| T36 Settings/export/deletion | T04, T05, T07, T32 | Settings screen, recent-reauth challenge, private export and disable→purge workflow with status receipt. | User isolation, account disabled immediately, queued/in-flight jobs canceled/rechecked, telemetry deletion reconciliation and retention disclosure. AC-16 |
| T37 Security/reliability and UI release checks | T24, T26, T28, T29, T30, T31, T33, T35, T36 | Targeted integration/adversarial/load/browser gates, secret/dependency checks and restore/withdrawal runbooks. Split security, recovery and UX checks into separate executions if needed. | All P0 hard gates pass with recorded evidence; critical failure cannot be waived by product metrics. AC-02/08/19/21/22/23/24 |
| T38 Staging deployment and P0 gate | T37 | Isolated Vercel/Render/Supabase staging, migrations, actual bounded DART/SEC/Auth smoke, pipeline/evidence journey and README/env/rollback update. | Clean setup, real valid event and original source inspected, mobile journey, backup/restore and withdrawal smoke; unmet external prerequisites labeled blocking. AC-20 |

T34 is a task family, not a claim that Codex can independently label 120 cases in one turn. T37 is a gate with bounded constituent checks, not an instruction to rewrite the entire application. T38 can be split into provider configuration and integration smoke sessions when credentials/rights are not available together.

## Epic E7 — Optional portfolio and grounded questions (P1)

Features F15/F16.

| Task | Dependencies | Deliverable / bounded work | Acceptance and verification |
|---|---|---|---|
| T39 Manual portfolio schema/API/ranking context | T05, T18, T27, T38 | One-portfolio/position migrations, atomic full replacement, manual weight/staleness and subscription union. | Null vs zero, sum/cap/concurrency, held+watched eligibility, stale bonus ignored; no valuation endpoint. AC-12 |
| T40 Portfolio UI | T39 | Optional add/edit/remove held companies, manual percent fields, known total/as-of and skip path. | Incomplete weights not normalized; removal explains independent watchlist; mobile/empty/error states. AC-12/19 |
| T41 Follow-up admission and pipeline | T19, T21, T35, T38 | Question tables/API/quota/idempotency jobs, bounded retrieval, validation, answer/refusal/abstention/failure states. | No private holdings in prompt; duplicate POST one job; quota race; out-of-scope/refusal/conflict/timeout/stale revision fixtures. AC-13/23 |
| T42 Follow-up UI and telemetry | T41, T29, T32 | Event composer, poll/validated answer, citation links, quota, clear scope and correction handling. | No pre-validation streaming; submitted/failed does not qualify; actual answer view tracked; mobile keyboard states. AC-13/17/19 |

## Epic E8 — Calendar, alerts and mature Ops (P1)

Features F17/F18/F19.

| Task | Dependencies | Deliverable / bounded work | Acceptance and verification |
|---|---|---|---|
| T43 Official calendar ingestion/API | T06, T10, T11, T22, T38 | Approve a bounded IR source set; source-linked dates, precision/timezones, revisions/reschedules and calendar query. | No extrapolated earnings date; date-only/unknown handling; stale/canceled source fixtures; source rights recorded. AC-14 |
| T44 Calendar UI | T43, T30 | Mobile agenda, desktop optional grid, source/status display, range/company filters. | Date precision preserved across timezones; reschedule history accessible; empty range not “no events exist.” AC-14/19 |
| T45 In-app alert engine/API | T22, T27, T39, T32 | Opt-in/mute preferences, normal-alert fanout outbox/cap/read endpoints; reuse the P0 accuracy-notice store and API without migrating delivery to an opt-in path. | Unique notification on retry; normal cap atomic; opt-out; amendments distinct; existing P0 accuracy notices survive P1 activation/preferences and bypass normal opt-in/mute/cap. AC-15/21 |
| T46 Alert Center UI/metrics | T45, T28, T33 | Alert/read/mute/preferences screens with exact alert telemetry and usefulness join. | No email/push prompts; read≠useful; 409 preference recovery; mobile interaction; consent respected. AC-15/17/19 |
| T47 Evaluated configuration activation/rollback API | T23, T35 | Immutable approved configs, admin activation/rollback, safe future-run switch and audit. | Failed-eval config blocked; no arbitrary production prompt write; current outputs preserved; concurrent activation version conflict. AC-11/18 |
| T48 Ops cost/quality/config UI | T24, T47, T33 | Run comparison, lag/cost completeness, evaluation gate and rollback controls. | Unknown cost not zero; config shown per run; safe authorized rollback and kill switch; no hidden overrides. AC-11/23 |

## Epic E9 — Full beta and discovery

| Task | Dependencies | Deliverable / bounded work | Acceptance and verification |
|---|---|---|---|
| T49 Full beta gate and first reviewed publications | T40, T42, T44, T46, T48 | Full P0+P1 acceptance report; first 100 candidate-review policy; tester invitation readiness and narrow public coverage/policy. | All 13 screens usable; end-to-end Google→watchlist→sourced event→Q&A→alert plus correction/deletion passes; actual results/blocks reported. AC-01–24 |
| T50 Longitudinal beta review | T49 | Weekly review task template repeated for 4–6 weeks; 20–30 consenting testers if recruited by owner; analyze actual cohorts, feedback, price-context gap and omission audits. | Counts/uncertainty/consent/mature windows shown; survey statements not substituted for behavior; versioned scope decision and next experiment. Recruitment and reviewer participation are owner dependencies. |

## 3. Milestones and release acceptance

- **M0 Foundation:** T01–T13; safe identities/jobs/sources; no generated publication before validation exists.
- **M1 Core P0:** through T38; actual runnable source-grounded pilot, all P0 gates and evaluated quality. Not a static demo.
- **M2 V1 beta:** through T49; P1 screens/features complete, real server deployment and operational review enabled.
- **M3 Discovery decision:** T50 produces observed learnings; P2 work requires specific unmet-need evidence and new dependency approval within normal project planning.

Do not turn V1's earlier illustrative eight-week roadmap into a deadline. Schedule depends on provider access, data parsing, labeling/review capacity and actual test failures. At each milestone narrow issuer/class coverage rather than removing evidence/security gates to meet a date.

## 4. Standard Codex task prompt template

> Implement Task [ID] from docs/BUILD_PLAN.md. First inspect existing code and applicable AGENTS.md, and read the referenced contracts/acceptance IDs. Confirm the task's dependency status and external prerequisites using evidence. Implement only this task's behavior. Preserve the evidence-first policy, source provenance, ownership boundaries and P0/P1 scope. Add meaningful tests for the stated edge cases, run the relevant build/tests, update README/environment documentation, and report changed behavior, verification and any unresolved blocker. Do not claim live integration passed if only fixtures ran. Do not implement unrelated tasks.

The next developer should start with [FIRST_10_TASKS.md](FIRST_10_TASKS.md), not jump directly to chatbot generation.
