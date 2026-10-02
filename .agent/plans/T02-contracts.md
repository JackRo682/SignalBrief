# T02 Canonical contracts

## Context
Authorized T02 (BUILD_PLAN, schema portions of AC-06/07/20). Read AGENTS, PLANS, FIRST_10_TASKS, BUILD_PLAN, AI_SYSTEM, DATA_MODEL, API_SPEC and ACCEPTANCE_CRITERIA. The separate codex/t02-contracts worktree fast-forwarded to approved T01 main merge 4f96231a9fe6ba8aa473633bafc29ae0ca8a009d without losing local changes. T01 main push CI 36978089785 was observed completed/success via the public read-only Actions API. User authorizes a separate T02 draft PR/CI, without main merge or deployment. Preserve original BUILD_PLAN/instructions; requested separate UI-preview follows T02 before T03.

## Goal
One strict Python authority for domain/API/all thirteen stage contracts, deterministic schemas and generated frontend types with versioned synthetic compatibility fixtures.

## Non-goals
No DB/RLS, live product endpoints/auth, queue, providers/LLM, ingestion/parsing/comparison/scoring/publication algorithms, UI or deployment. No PR2 main merge/auto-merge. Shape validation cannot prove financial truth or committed database state.

## Current state
services/contracts contains scalar/domain/API/stages/exchange modules. Pydantic 2.13.5 is explicitly pinned; jsonschema 4.26.0/types-jsonschema 4.26.0.20260518 are dev-only; openapi-typescript 7.13.0 is locked. Dedicated .venv uses Python 3.12.14; Node 24.19.0/npm 11.6.2. Existing T01 checkout/branch preserved. Official Pydantic/openapi-typescript references and registry versions checked. No new credentials/persistent authentication.

## Implementation
1. Complete: explicit engineering enum/nested-field defaults in AI_SYSTEM/API_SPEC and DATA_MODEL mapping; priorities and hard gates retained.
2. Complete: required-nullable strict scalar/domain/API models with value/unit/range/period/precision/provenance rules, unknown weights/cost distinct from zero.
3. Complete: all thirteen typed discriminated stage input/result variants, exact raw/artifact/upstream identity/hash pins and stage-specific reference closure in StageExchange.
4. Complete: Python-derived Draft 2020-12 schemas, OpenAPI 3.1 components with empty paths, isolated model proposal schemas and generated TypeScript; no competing manually maintained frontend shapes.
5. Complete locally: versioned synthetic stage/API fixtures, invalid/coercion/reference/gate tests, generator drift and TS assertions, baseline regression/build/health/audits. Remote CI is verified after publication; its exact head/run evidence is reported separately in the draft PR and handoff.

## DB/API changes
No SQL/live endpoints. Contract version 1, health routes unchanged. Python is authority; packages/contracts holds generated artifacts/fixtures/compile assertions. Analysis title/summary require resolved claim IDs. Publication requires nine blocking pass categories, all supplied blocking checks passing, required reviewer reference, and consistent receipt for published final dispositions. Public DTOs exclude publication mutation/internal receipts; Ops excludes raw prompts, private inputs and chain of thought.

## Risk
JSON Schema/TS express structure; Python relational validation is additionally required after untrusted output. Span hash/length cannot prove the substring of a stored artifact; IDs cannot prove persisted validated upstream results. Semantic entailment, source rights, reviewer assurance, per-claim policy completeness, database ownership, concurrent duplicate cycles, lease/revision fencing and atomic outbox remain later gates. Model exports are standard JSON Schema, not tested with a provider's restricted subset. Enum defaults require versioned extension. No source truth, gold evaluation or production readiness claim.

## Tests
AC-06 schema: malformed/coerced/nonfinite/exponent decimals; zero/null; value/range/period/unit/context and percent baseline/sign constraints. Exact math/gold outcomes later.
AC-07 schema: raw versus parsed hashes, diagnostic identity, Unicode codepoint span/hash, source/artifact/upstream pins, issuer/fact/citation references and both-side comparison citations; missing/failed/uncertain gates, review/receipt failures.
AC-20 schema/execution: every stage ok/retryable/blocked/skipped, missing/extra/unknown discriminators, API fixtures, deterministic exports, TS negative assertions and baseline clean-install/build/health.

## Verification
Executed dedicated hash-locked dev install and npm ci --ignore-scripts. Passed npm format:check/lint/typecheck/contracts:check/contracts:typecheck/test/build; one existing web test; npm audit reported zero known vulnerabilities. Python passed ruff format/check, strict mypy (18 files), export --check, pytest (157 tests), pip check, API/worker real loopback health smoke (live200/ready503/graceful shutdown/closed listener), source/static secret-pattern/env-hygiene scan and runtime/dev pip-audit. git diff --check passed. Audits are time-specific, pattern scans limited. Final generated/client/doc consistency and secret checks were rechecked before remote publication. CI preserves Ubuntu Python3.12.15/Windows3.12.10 compatibility matrix from T01.
Not run: real auth/provider/model/DB/RLS, persisted artifact resolution, arithmetic/semantic/gold evaluation, product browser/accessibility, staging/deployment or production security. Fixtures are synthetic schema cases, not real events or evaluation gold.

## Rollback
Revert T02 only to merged T01, regenerate artifacts; no persisted state/evidence migration. No force push or history rewrite.

## Acceptance criteria
Close bounded T02 after final checks and exact draft PR head/CI verification. Full AC-06/07/20 release gates stay open. PR main merge requires separate approval. After completion propose UI-preview from existing UX_SPEC's thirteen screens without modifying the original remaining plan.

Final review corrected overly broad rejection of all URL queries: public document identifiers are retained, userinfo/common credential and signed-query keys are rejected. No fetch permission or exhaustive secret safety is inferred. Six synthetic URL cases were added. Initial head f0625a36ab17a0c88a745a831e23e02af6ac7e22 passed all three CI jobs in run 36982301281; final follow-up head must also pass and is reported in PR/handoff.
