# SignalBrief Engineering Contract

This file governs work throughout the repository. Read it before editing, then the task's canonical specifications and any narrower applicable instructions. Inspect the actual checkout and existing tests before assuming a file, command, service or integration exists. Work in one bounded task from [BUILD_PLAN](docs/BUILD_PLAN.md), using [.agent/PLANS.md](.agent/PLANS.md). Current handoff contains specifications and engineering contracts; runnable application infrastructure remains T01 work.

## Mission and scope

Help self-directed investors see what changed in supported companies, compare earlier information, inspect original evidence and understand uncertainty. Facts → evidence → comparison → interpretation → uncertainty is the provenance order. Produce investment information without buy/sell or sizing advice, target prices, certain forecasts, trades, brokerage connection, price-causation claims or invented financial facts.

Preserve P0/P1/P2/Not Now priorities in [MVP_SCOPE](docs/MVP_SCOPE.md). P0 includes persistent correction/withdrawal notices to exposed viewers; P1 adds optional normal alerts, portfolio, event-scoped follow-up, calendar and richer Ops. Do not let a P1 feature flag or analytics opt-out disable P0 accuracy obligations. Do not build later tasks merely because their types are described.

The survey is aggregate evidence from 105 respondents with an n=49 recalled-move branch. It establishes neither respondent-level segments nor adoption, willingness to pay, retention or PMF. Preserve A/B/C/D distinctions in [USER_RESEARCH](docs/USER_RESEARCH.md). Targets, example events and proposed beta counts are not observations. Never create real-looking financial results to fill empty states.

## Canonical decisions and conflicts

- AI_SYSTEM owns stage schemas, statuses, comparison/scoring and publication logic
- DATA_MODEL owns storage identities, constraints, RLS and retention
- API_SPEC owns routes, typed payloads, auth/errors, idempotency and concurrency
- AI_EVAL owns formulas and evaluation gates; ANALYTICS owns persisted metric/export mappings and measurement semantics
- MVP_SCOPE owns priority; ACCEPTANCE_CRITERIA owns release gates; BUILD_PLAN owns task dependencies

When a genuine contradiction appears, stop the affected behavior, document the conflict and update the canonical contract plus dependents before implementation. Do not silently weaken a hard gate, substitute an unmeasured heuristic or broaden data rights. Ask only for a decision/authorization that cannot be resolved within the current request; continue unaffected work.

## Architecture boundaries

Use the approved small deployment footprint: Next.js/TypeScript web and thin BFF; Python/FastAPI API; Python worker; Supabase PostgreSQL/Auth/private object storage; PostgreSQL durable queue. Proposed directories are apps/web, services/api, services/worker, packages/contracts, db/migrations, evals and docs. Pin supported dependency versions and retain lockfiles; verify current vendor APIs before integration.

- Web renders bounded UI state, accessibility and generated typed clients; it does not interpret source facts or enforce authorization only in the browser
- BFF owns server-side OAuth/refresh/session/CSRF and safe forwarding; no duplicate domain ranking, publication or ownership logic
- API verifies JWT and active-account state, executes RLS-scoped CRUD, read/rank and job admission; long parsing/analysis belongs to workers
- Worker owns provider-aware ingestion, immutable evidence and typed stage orchestration; it has no per-user sessions or general private-account browsing
- Domain stages own pure/testable normalization, decimal arithmetic, as-of matching and explicit validation; model output is untrusted input
- Publication service owns hard gates, lease/revision fencing and atomic revision/action/outbox commits
- Analytics exporter sends only consented allowlisted product events and minimized operational aggregates; PostgreSQL remains authority

Do not add Redis/Celery, microservices, Kafka, Kubernetes, graph databases, autonomous agent orchestration or embeddings without a measured need and explicit scope change. No model tool may browse arbitrary URLs, execute commands or access private holdings.

## Coding and schema conventions

Keep modules small, typed and single-purpose; separate provider adapters, pure domain rules, persistence and transport. Reuse existing patterns rather than adding parallel abstractions. External JSON is UTF-8/snake_case; IDs are UUID strings; timestamps UTC RFC3339; date-only values remain dates. Preserve source timezone and date precision.

Use exact Decimal/numeric values and decimal strings at boundaries. Distinguish null/unknown from zero/false; never normalize unknown portfolio weights. Reject unknown fields, enums, malformed numbers, incompatible contexts and unvalidated model payloads. T02 establishes one authoritative machine-readable API/schema source and generated frontend types; no hand-maintained competing shapes. Validate inputs and outputs at every external/stage boundary. Schema changes require versions, compatibility fixtures and dependent doc/client updates.

Stage inputs pin pipeline/schema versions, raw documents, parsed artifacts, upstream outputs and any retrieval cutoff. Define fetch receipts, parser diagnostics, publication decisions and final dispositions explicitly; prose-only object names are insufficient. Do not imply all T02 stage variants are implemented merely by adding a common envelope.

## Evidence and numeric provenance

Raw document identity and parser output identity are separate. Immutable documents are unique by source/provider ID/content hash; parser/config/schema changes create parsed_artifacts and artifact-linked spans. Same-byte retries reuse the raw document. Preserve old artifacts, hashes, locators and citation IDs. Never regenerate offsets in place or choose a latest parser implicitly for historical claims.

Every external factual/comparative clause, including title/summary, links typed facts and immutable source spans. Numeric output carries original literal, issuer, metric, unit/scale/currency, period, accounting basis, consolidation/segment context and deterministic calculation lineage. Comparisons cite both sides and obey as-of availability. Wrong/missing/ambiguous context gives an explicit non-comparison status. Missing/zero/negative baselines never become fabricated percentage changes; rate deltas are percentage points under AI_SYSTEM rules.

Duplicate events have a persistent same-issuer canonical root pointer, separate from amendments. Enforce no self-link, chains or cycles, including concurrent writes; aliases are feed-ineligible and cannot reveal private/unpublished canonical narrative. Never merge contradictory evidence. Material corrections/withdrawals retain history, hide unsafe narrative and durably notify exposed viewers.

## Database and migrations

PostgreSQL is the system of record; normalized ownership and provenance keys are not replaced by arbitrary JSON. Migrations are ordered, reviewable and version-controlled. Test empty install and upgrade with existing immutable evidence. Use expand → backfill → constrain/contract where compatible; record rollback/forward-repair and retained-data implications. Never edit an already-applied migration silently or destroy historical source/claim data to make a test pass.

Keep API, worker and migrator roles distinct. API is non-owner/non-BYPASSRLS, sets verified claims transaction-locally and also applies explicit owner predicates. RLS and grants are default-deny; browser has no application-table grants. Test pooled A→B identity isolation. Ops role/MFA/recent-auth checks are server-side and cannot be overridden by a request field.

Use locked transactions for caps, duplicate re-rooting, publication/current revision and notice action/outbox writes. Queue work is at-least-once with unique dedupe keys, leases/heartbeats and stale-worker fencing; do not promise exactly-once external execution. P0 exposure/accuracy fanout must reconcile retries, late view registration and crashes without requiring optional analytics.

## Security and secrets

Never commit credentials, tokens, personal survey rows, real holdings, raw private questions, provider query keys, privileged URLs or unredacted logs. .env.example documents variable names with dummy values only. Use isolated environments and least-privilege managed secrets; do not create persistent access, spend money, accept new terms, push, merge or deploy beyond the current authorization. A permission or credential blocker is not a reason to bypass controls.

Source documents and model output are untrusted. Enforce host/IP/redirect allowlists, HTTPS, bounded archives/files/time/memory, safe XML/PDF parsing, active-content removal and sanitized text rendering. No arbitrary URL/tool invocation from source text. Protect cookies/CSRF/redirects/JWT validation and private no-store responses. Secret/dependency checks cover source, logs, telemetry and frontend bundles. Preserve financial-content prohibitions even if a user question requests prohibited app behavior.

## Models and evaluation

Record requested/returned model identifier, available snapshot, prompt version/hash, schema/parser/config versions, input/evidence hashes, retrieval snapshot/cutoff, commit, usage, latency, price-table version and validation outcome. Unknown provider snapshots or usage stay unknown, never invented or zero. Model self-confidence is not calibrated accuracy. No private chain-of-thought storage.

Model/prompt/parser/policy changes require regression fixtures and versioned evaluation before publication. Keep grouped development/holdout separation, human adjudication and first-100-candidate review requirements. Do not tune labels to predictions or treat synthetic cases as real-source gold. Store all ten metric numerators/denominators or distributions, failures/no-output, scopes, exclusions, N/A/incomplete states and cost per completed/attempted/published analysis under ANALYTICS §4.1. Clicks cannot substitute for citation correctness. Missing required evaluation evidence cannot pass a gate.

## Verification and definition of done

Select checks from the task's acceptance IDs before coding and record exact commands/results in the plan. Establish real runnable commands in T01; until then, mark unavailable checks not run rather than inventing commands or passes. For changed behavior run applicable formatting/lint, type/schema compatibility, unit/domain, API/RLS/integration, migration, fixture pipeline, regression/evaluation, dependency/secret and frontend build checks. Add failure/edge/concurrency tests, not only the happy path. UI work includes keyboard/mobile/200% zoom and interrupted/repeated/back/cancel flows with inspected evidence.

A task is done only when:

1. Its dependencies and authorized scope are verified; implementation satisfies the bounded acceptance IDs
2. Tests cover normal, invalid, empty/stale, retry, permission and relevant concurrency cases; failures are fixed or explicitly block completion
3. Final changed files are rechecked; schema/client/doc/migration consistency and no-secret checks pass
4. README/setup/env instructions and canonical affected docs reflect actual behavior
5. Plan records changed behavior/files, commands and actual outcomes, fixture versus live coverage, unrun checks, external prerequisites and residual risks
6. Rollback/forward-repair protects immutable evidence and user isolation; no claim of live integration, deployment, evaluation success or production readiness exceeds evidence

Commit/push/publication/merge/deployment are separate actions governed by the user's current authorization. When authorized to push, verify the exact remote commit and required CI before claiming success. Use draft PRs unless instructed otherwise. Do not treat an initial repository/README as a runnable foundation.
