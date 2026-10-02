# SignalBrief Product Specification and Development Handoff — V1.1

The separate synthetic UI preview is documented in [UI_PREVIEW.md](docs/UI_PREVIEW.md), including 13 routes, local commands, browser evidence and existing Vercel project handoff. Actual services and backend task gates remain disconnected.

Prepared 2 October 2026. This package specifies a deployable evidence-first company/portfolio intelligence service. It contains **no application code**, no fabricated beta results and no completed gold dataset. It is the product/architecture baseline to hand to a developer.

## Start here

Current checkout includes a T01 local web/API/idle-worker foundation. See [Local development](docs/LOCAL_DEVELOPMENT.md) for setup and [T01 execution plan](.agent/plans/T01-foundation.md) for evidence. No financial product, live integration or deployed release is claimed. The document-only handoff record describes the original specification baseline.

1. Read [Product Vision](docs/PRODUCT_VISION.md), [User Research and Source Audit](docs/USER_RESEARCH.md) and [PRD](docs/PRD.md).
2. Review [MVP Scope](docs/MVP_SCOPE.md) and [Acceptance Criteria](docs/ACCEPTANCE_CRITERIA.md).
3. For development, read [AGENTS.md](AGENTS.md) and [.agent/PLANS.md](.agent/PLANS.md), then [Build Plan](docs/BUILD_PLAN.md) and the separate [First 10 Tasks](docs/FIRST_10_TASKS.md).
4. Review the bounded [V1.1 corrections](REVIEW_CORRECTIONS.md) before implementing the affected schemas and publication paths.

All prose is English. Korean source filenames and original issuer/source content are preserved where necessary. A/B/C/D labels distinguish documentary requirements, survey observations, inferences and unvalidated assumptions/design defaults. Product thresholds and architecture choices are decisions to test, not established empirical truths.

## Document index and requested-phase coverage

| File | Purpose | Phase |
|---|---|---|
| [PRODUCT_VISION.md](docs/PRODUCT_VISION.md) | Mission, promise, principles, target and exclusions | 1, 3 |
| [USER_RESEARCH.md](docs/USER_RESEARCH.md) | Complete source audit, survey interpretation, segments/limits and follow-up research | 1, 2 |
| [PRD.md](docs/PRD.md) | Product definition, assumptions, requirements, dependencies, risks and success | 3 |
| [MVP_SCOPE.md](docs/MVP_SCOPE.md) | P0/P1/P2/Not Now with per-feature dependencies and acceptance | 4 |
| [USER_FLOWS.md](docs/USER_FLOWS.md) | User and operator journeys, navigation and cross-flow behavior | 3, 5 |
| [UX_SPEC.md](docs/UX_SPEC.md) | All 13 screens and their state/mobile contracts | 5 |
| [AI_SYSTEM.md](docs/AI_SYSTEM.md) | Typed stages, matching, scoring, evidence, validation and fallbacks | 6 |
| [DATA_MODEL.md](docs/DATA_MODEL.md) | Entities, keys, ownership, provenance, transactions and retention | 7 |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Runtime boundaries, jobs, integrations, deployment, env and references | 7 |
| [API_SPEC.md](docs/API_SPEC.md) | Authenticated REST contracts, errors, pagination and idempotency | 7 |
| [ANALYTICS.md](docs/ANALYTICS.md) | PostHog taxonomy, qualification and exact metric denominators | 9 |
| [AI_EVAL.md](docs/AI_EVAL.md) | 120-case plan, ten formulas, independent review and release gates | 8 |
| [SECURITY.md](docs/SECURITY.md) | Threat controls, privacy, financial-content policy and incidents | 7, 8 |
| [BUILD_PLAN.md](docs/BUILD_PLAN.md) | Epics/features/tasks/acceptance in dependency order | 10 |
| [ACCEPTANCE_CRITERIA.md](docs/ACCEPTANCE_CRITERIA.md) | Shared testable P0 and full-beta gates | All |
| [FIRST_10_TASKS.md](docs/FIRST_10_TASKS.md) | Separate first-ten-task handoff and first-task prompt | Final handoff |

## Decisions that matter

- Activate from one supported company; portfolio entry is optional. Survey median was four followed names.
- P0 tests the actual source→change→evidence loop. P0 includes persistent accuracy notices for exposed viewers. P1 retains portfolio, follow-up, calendar and normal opt-in in-app alerts for full beta.
- Original-source evidence, plain language and fact/interpretation separation are early requirements. Calendar dates and comparisons must be real and sourced.
- Price-linked timeline demand is recognized but not equated with the simpler sourced-event timeline. Licensed price context is a separate future hypothesis; no causal price explanation is promised.
- Survey concept ratings indicate moderate stated usefulness. Adoption, willingness to pay, retention, segment differences and PMF are not established.
- Aggregate-only data cannot support experience/market/search-time cross-tabs. The n=49 recent-move recall branch is distinct from n=105 questions.
- Shared company briefs and deterministic personal ranking avoid repeating model work or transmitting portfolio details.

## Pending implementation prerequisites

The specification is complete without resolving live-account credentials. Before the corresponding build/release gates, the owner/developer must configure Google/Supabase, approve the issuer roster and source rights, obtain DART access, declare compliant SEC automated access, select/evaluate an available model and price table, label/review gold cases, verify vendor retention/backup settings and recruit consenting testers. These are explicit execution gates, not reasons to invent integration or research results.

## Consistency authority

AI_SYSTEM owns stage/status/scoring contracts; API_SPEC owns endpoint/error contracts; DATA_MODEL owns persistence/retention; ANALYTICS owns event/metric definitions; AI_EVAL owns evaluation formulas; MVP_SCOPE owns priorities; ACCEPTANCE_CRITERIA owns release gates. If implementation finds a genuine conflict, amend the relevant canonical contracts and record the change before expanding behavior.

## Specification review record

The final packaged version is checked for requested file presence, phase/screen/stage coverage, source denominator/arithmetic correctness, original/copy identity, relative links, task ordering/references, acceptance links, and absence of application files. Technical integration details were checked against official references listed in ARCHITECTURE. No build/test/deployment result for the future application is claimed by this document review.

V1.1 document checks: 20 Markdown files (15 requested documents, one separate first-ten-task handoff, README, AGENTS.md, .agent/PLANS.md and review corrections); 13 screen contracts with all eight requested fields; all 12 requested AI stages and 10 evaluation metrics; all eight analytics categories; 50 unique tasks in acyclic dependency order; 24 defined acceptance IDs; no broken relative links, malformed table rows, unresolved placeholder markers or application files.

Review resolved two implementation gaps: explicit product-session persistence/capture and history-only treatment for unchanged filings. It also preserved the unresolved research limits: aggregate-only segmentation, the price-context hypothesis, unproven adoption/retention, and the fractional Q5 total. No added specification requirement is presented as a new survey fact.

V1.1 closes the parser-version and canonical-duplicate persistence gaps, makes accuracy notices a P0 safety requirement, and maps all ten evaluation metrics to versioned authoritative records/exports. The engineering contract and execution-plan format guide subsequent implementation. All original research evidence remains unchanged. Document validation does not establish that application code, migrations, CI, model evaluations or live integrations have run.
