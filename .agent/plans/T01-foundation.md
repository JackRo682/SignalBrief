# T01 Repository foundation

## Context
Authorized local T01 only: BUILD_PLAN F01/F14, bounded AC-20 foundation checks and AC-22 secret hygiene. All twenty handoff Markdown files are the baseline; canonical sources are AGENTS, PLANS, PRD, ARCHITECTURE, SECURITY, BUILD_PLAN and ACCEPTANCE_CRITERIA. Full staging AC-20 is a later release gate.

## Goal
Install, build and run minimal web/API/worker processes without accounts, provider calls or financial content. Reproduce checks through pinned dependencies and CI.

## Non-goals
T02 domain/schema generation, T03 product migrations, T04 auth, T07 queue, ingestion, AI, paid services and deployment. This change has no remote write or publication step.

## Current state
Actual clean detached checkout 0ee4ac87733100cd91115cad57a14688521c7920 from public JackRo682/SignalBrief, cloned without credentials. Earlier signalbrief/README.md preserved separately. Node 24.19.0, npm/npx 11.6.2, Python 3.12.14; tools outside repo in ../.tools. No runtime implementation, secrets, database or provider configuration. Library Windows transfer failed; repository source is authoritative for this implementation.

## Implementation
1. Complete: inspect baseline and boundaries; verify official Next/FastAPI documentation and package registry versions.
2. Complete: minimal Next App Router, FastAPI liveness/readiness, idle worker heartbeat/lifespan and health server; no product routes.
3. Complete: contracts/migrations/evals ownership notes, dummy env, exact versions, npm integrity lock and Python hash locks including dev tooling.
4. Complete: health/lifecycle/invalid-route tests, format/lint/typecheck/build, bounded HTTP subprocess smoke and credential-pattern checks.
5. Complete locally: source-only separate copy, fresh npm ci/new Python venv, all applicable checks; matching CI and local setup. Remote CI has not run.

## DB/API changes
No tables, grants, RLS, migrations or domain contracts. Only /health/live and /health/ready: readiness returns 503 foundation_only until actual DB/queue checks exist. Both services default to loopback; readiness is for internal local monitoring. T02 owns authoritative generated schemas. T03 owns ordered SQL migrations.

## Risk
Versions may conflict: installation and build are evidence. Readiness must never imply DB/queue functionality. Health contains no environment values or credentials. Worker has no external work. Smoke uses loopback and bounded startup/shutdown, with process cleanup. Dependency and pattern scans are limited checks, not certification.

## Tests
AC-20: web SSR scaffold unit test and production build; API exact liveness, no-cache, 503 readiness, unsupported route/method; worker startup/liveness/not-ready/stopping state, invalid settings and unknown route; subprocess HTTP smoke and clean shutdown. No DB/provider fixtures are relabeled live integration.
AC-22: ignored env/config/generated assets and recognizable credential pattern scan; official registries only.

## Verification
Verified 2026-10-02 on Windows: source baseline 0ee4ac87733100cd91115cad57a14688521c7920 plus the uncommitted T01 files. This is an actual detached checkout, not a claim of a new remote code commit. All original specification/instruction files remain unchanged; only README has an additive implementation pointer. Initial clone used no credentials.

Commands below ran at the root, using workstation npm.cmd shim on session PATH and `.venv/Scripts/python.exe` (shown as `python`). An independent source-only copy under the sibling tool directory had no node_modules, .next or venv before verification. It is a local source snapshot, not a second Git checkout.

| Command | Actual final result |
|---|---|
| `git rev-parse HEAD`; `git status --short` before edits | Exact baseline commit; clean |
| `npm ci --ignore-scripts` in source-only copy | Exit 0, final dependency lock installed, 66 packages added |
| `python -m venv .venv`; `python -m pip install --require-hashes --index-url https://pypi.org/simple -r requirements-dev.lock` in source-only copy | New environment installed successfully from hash lock |
| `npm run format:check` | Exit 0, all matched files formatted |
| `npm run lint` | Exit 0, Biome recommended Next/React/test + general preset, 8 authored files checked |
| `npm run typecheck` | Exit 0, Next typegen + strict tsc |
| `npm test` | Exit 0, 1 SSR scaffold test passed |
| `npm run build` | Exit 0 in both checkout and source copy, Next 16.3.8 production static build |
| `node ../../node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 0` from apps/web; Python urllib HTTP assertion | Real production server returned 200, Korean scaffold/no-product text and absent X-Powered-By verified; server stopped by interrupt |
| `python -m ruff format --check services scripts tests` | Exit 0, 10 authored files formatted |
| `python -m ruff check services scripts tests` | Exit 0 |
| `python -m mypy` | Exit 0, strict check of 10 service/script/test files |
| `python -m pytest` | Exit 0, 7 passed, no warnings after httpx2 update; repeated in fresh environment |
| `python -m scripts.health_smoke` | Exit 0, API/worker actual HTTP live 200, ready 503, graceful lifespan/server shutdown and closed listeners; repeated in fresh environment |
| `python -m pip check` | Exit 0, no broken requirements, including fresh environment |
| `npm audit --audit-level=high` | Exit 0, zero known vulnerabilities for final lock |
| `python -m pip_audit -r requirements.lock --disable-pip`; same with requirements-dev.lock | Exit 0, no known vulnerabilities found for both runtime/development locks |
| `python scripts/check_secrets.py` after final build | Exit 0, source/static credential patterns + env-ignore hygiene; 63 files scanned before final plan expansion |
| `git diff --check` | Exit 0; Git warns only that Windows checkout may convert README LF to CRLF |

Resolved failures: npm's extracted Windows launch scripts assumed a global install layout; the external task-tool shim now invokes the downloaded CLI directly. Mypy nullable stdout narrowing and git check-ignore multiple-path quiet syntax were fixed and rechecked. Latest Starlette TestClient warned on httpx, so the pinned recommended httpx2 removed that warning. ESLint 9 was deprecated, and ESLint 10 had incompatible React rules/peer ranges; final implementation uses official-supported Biome with no forced ESLint peers. Biome migration unexpectedly changed config root and scanned generated .next files; explicit authored-project root, generated-directory excludes and recommended preset fixed it. These failures are not remaining pass claims or waived checks.

CI actions are pinned to SHA values verified from official action tags; contents read only, checkout credentials not persisted, web job and Linux/Windows Python jobs. Remote CI, Linux execution, migration/RLS, live auth/source/AI, gold evaluation, product browser/mobile/keyboard/zoom journeys, staging and deployment are **not run**. The static scaffold HTTP/SSR check is not product UX acceptance. Dependency audits and credential patterns are bounded checks, not a security certification.

## Remote integration follow-up

Authorized to publish T01 branch and draft PR, not merge. Main remained at the baseline with no intervening user changes. Connector-created initial code commit 4478a0cee0dad7a050fd435f70f11e5ed7d71931 on codex/t01-foundation, draft PR #1. All 34 remote files matched the frozen local manifest by SHA-256 and original specification blobs were retained. First PR Actions run 36976624494: web passed; Windows setup-python failed because 3.12.14 x64 is not distributed for Windows; Linux canceled by matrix fail-fast before checks. No code-test failure was established by that run.

Official Actions manifest inspection found latest supported 3.12 distribution: Linux 3.12.15, Windows 3.12.10. Workflow now tests these explicit versions independently with fail-fast disabled; local runtime remains 3.12.14. Windows is a compatibility job, not the eventual production patch policy. Latest official checkout/setup-node/setup-python releases were verified to use Node24 and pinned by their exact tag SHAs. README mixed CRLF was normalized to LF to retain a concise additive diff. Final follow-up CI is pending at commit preparation; live accounts/deployment remain outside T01.
## Rollback

Remove or revert only T01 files against the recorded document commit. README additions retain the original specification. No persistent data or schema state is changed.

## Acceptance criteria
Local T01 foundation acceptance satisfied by the evidence above. No remaining local check failure. Setup/CI/env reflect the implemented commands. No product data, real credential, DB migration, live account or paid call was added. Full AC-20 release/staging and later acceptance criteria remain unfulfilled by design. Changes are ready for review/remote integration; not pushed or committed in this step. T02 canonical contracts is next after foundation review/remote CI.
