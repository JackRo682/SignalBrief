# SignalBrief Execution Plans

Use a living, reviewable execution plan for every bounded BUILD_PLAN task. A plan states what is authorized, what exists, what will change and how correctness will be established. It is not evidence that work has happened. Read [AGENTS.md](../AGENTS.md), the referenced canonical docs and actual checkout first.

Create one task-specific file under .agent/plans/ named by task ID and short purpose, or maintain a clearly labeled section here for a tiny task. Keep each plan self-contained enough for another engineer to resume. Update it when evidence changes, a check runs, scope changes or a blocker appears. Preserve actual findings and decisions; never include secrets, private reasoning, personal data or invented command output.

## Required plan sections

### Context

State the user-authorized task, why it matters, applicable BUILD_PLAN task/feature/acceptance IDs, canonical documents and known constraints. Link evidence within the repository or an authorized verified source. Distinguish source facts, decisions and unvalidated assumptions.

### Goal

Describe the observable outcome and completion condition in one or two sentences. Identify the specific consumer or user flow.

### Non-goals

List excluded behavior and later tasks so the change cannot silently grow. Record prohibited actions or missing publication/deployment authority separately from technical choices.

### Current state

Record checkout/branch/commit when available, files inspected, relevant existing implementation, dependency status and actual environment/tool versions. Separate observed facts from assumptions. Note absent credentials/services and whether fixtures can progress independent work.

### Implementation

Provide ordered, bounded steps and affected paths; dependency order and intermediate validation should be explicit. Keep a status per step and concise evidence of completed work. Split multi-session tasks into bounded instances without losing the parent acceptance contract. Do not silently substitute mocked behavior for required integrations.

### DB/API changes

State tables, keys, indexes, grants/RLS, migration/backfill/compatibility implications and API/schema/client versions. Use “None” when genuinely unchanged. Preserve raw/parsed provenance, canonical duplicate constraints, P0 notices and authoritative evaluation mappings whenever touched.

### Risk

List plausible failure modes, privacy/security/source-rights effects, concurrency/idempotency risks and mitigation. Identify which evidence or authority is required to proceed. Continue unaffected work while a dependent step is blocked.

### Tests

Map each relevant acceptance criterion to a unit, contract, integration, migration, fixture, evaluation or browser test. Include invalid/null/missing/duplicate/stale/timeout/permission cases and any race. Describe fixtures and expected outcomes before execution; do not label them passed here by intent.

### Verification

Record exact command, environment/commit, result and evidence path for each actual check. Distinguish passed, failed, blocked and not run. Include relevant logs/screenshots/reports with secrets removed. Live provider/auth verification is separate from fixtures. Recheck after later edits and report the final version only.

### Rollback

Explain rollback or forward repair, migration reversibility, feature flags/kill switch, previous known-good app/config and data retention. Never propose deleting immutable evidence or silently repointing citations. If no state is changed, say so and identify the reversible file change.

### Acceptance criteria

List completion gates with objective evidence, unresolved blockers and final disposition. Include documentation/env updates and any remaining owner/provider prerequisite. Close only when the bounded outcome is established; state partial/blocked honestly.

## Initial T01 plan outline

Status: ready to plan against the actual repository; no application implementation or runtime checks are claimed by this handoff.

### Context

T01 Repository foundation, feature F01/F14, AC-20. Read README, PRD, ARCHITECTURE, SECURITY, BUILD_PLAN, ACCEPTANCE_CRITERIA and AGENTS. The approved architecture is Next.js/TypeScript web/BFF, Python/FastAPI API plus worker, PostgreSQL/Supabase interfaces and shared contracts. The specification corrections precede application implementation.

### Goal

Establish or adapt the smallest runnable, locked-dependency web/API/worker foundation with reproducible local setup, health smoke, dummy environment documentation and CI checks.

### Non-goals

No product features, live OAuth integration, ingestion, domain extraction, model calls, production provisioning or deployment. T02 owns executable canonical schemas; T03 owns actual shared-content migrations. Do not implement later tasks in T01.

### Current state

Inspect the actual checkout, existing README and instructions before replacing anything. This handoff contains only documentation/contracts. Record branch/commit and versions from real commands, then list any existing scaffold to preserve. GitHub authentication or repository creation alone does not prove local runtime, DB or deployment readiness.

### Implementation

1. Inspect and preserve existing work; establish T01 file boundaries and real prerequisites
2. Choose supported versions against current official docs; pin dependencies/lockfiles, with no unrecognized-source installation
3. Create/adapt apps/web, services/api, services/worker, packages/contracts, db/migrations and evals only as needed for foundation; avoid empty abstraction layers
4. Add minimal process health behavior and clean startup/shutdown; no source/data/AI feature logic
5. Document setup, genuine commands, environment variable purpose and dummy values; configure matching CI lint/type/build/smoke/secret checks
6. Run clean-install/build/import/health and secret checks; resolve failures within T01; record verified results and unresolved external prerequisites

### DB/API changes

No product tables or migrations in T01. Establish migration location/tool convention for T03 and health boundary only: liveness exposes no secrets; readiness checks configured dependencies without requiring paid model/provider calls. Do not duplicate T02's authoritative application schema in ad hoc health scaffolding.

### Risk

Dependency/version incompatibility, accidental secret bundling, unbounded service startup and false readiness claims. Use pinned reproducible setup and minimal health checks; separate missing optional future provider credentials from genuine startup errors. Keep remote deploy/provisioning and new access grants outside this local foundation unless separately authorized.

### Tests

AC-20: clean installation, frontend build, API import/start/health, worker import/start/shutdown and documented command smoke. Secret scan includes ignored/dummy env handling and build artifacts. Confirm later product routes, source fetch and model invocation are absent. Test unavailable dependency/readiness behavior where a readiness check exists.

### Verification

Not run in this specification handoff. During implementation replace this statement in the task-specific plan with actual commands, tool versions, exit results and useful evidence. Mark any CI that has not run as not run; do not infer a remote CI pass from local tests.

### Rollback

Revert only T01 scaffold/config changes against the recorded baseline, retaining specifications and existing user work. No product data migration or source/evidence deletion should be necessary. If implementation discovers preexisting state, revise this plan before touching it.

### Acceptance criteria

Fresh-checkout setup and frontend/API/worker health smoke succeed with documented prerequisites; lockfiles and meaningful CI are present; no secrets or product functionality were added; README/env documentation matches executable commands; actual checks and blockers are reported. T02 may start only after this foundation's required evidence is recorded.
