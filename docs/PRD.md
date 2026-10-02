# SignalBrief V1 PRD

Version 1.1 • Specification baseline • 2 October 2026

## 1. Current state

Two unique source documents, supplied project instructions, and no existing application code are available. Research shows stated usefulness, not actual adoption. This package freezes implementable behavior and explicitly configurable assumptions. Application build, data acquisition, deployment, gold labeling, and beta operation remain future work.

Normative sources: [PRODUCT_VISION.md](PRODUCT_VISION.md), [USER_RESEARCH.md](USER_RESEARCH.md). Every new threshold below is D / proposed product policy, not a survey result.

## 2. Problem and scope

An investor following several companies must sift through information, understand what changed, and distinguish credible facts from explanations. V1 addresses official company-event monitoring and comparison. It does not promise a complete account of market moves, total portfolio risk, or investment recommendations.

P0 is a functioning core pilot. P1 completes the beta. P2 is conditional expansion. The canonical per-feature specification is [MVP_SCOPE.md](MVP_SCOPE.md); no surface listed there is silently omitted.

## 3. Persona, jobs, and use cases

| Persona | Job and context | Product treatment | Evidence status |
|---|---|---|---|
| Primary: self-directed small-watchlist investor | “When there is new company information, help me know what changed and verify it quickly.” | Watchlist first, concise explanation, transparent evidence | C based on S1 Q2/Q5/Q13; no verified cluster |
| Secondary: investor doing deeper checks | “Let me compare original periods and ask a constrained follow-up.” | Before/after metrics, timeline, event-scoped Q&A | C; experience-specific demand unknown |
| Internal operator | “Show failed/unsafe analyses and let me correct the publication lifecycle.” | Review queue, provenance, replay, withdrawal, version controls | A: V1 §14/I1 |

Primary use case: review a new supported-company filing and compare a material fact with a valid earlier statement. Secondary: investigate a known event's evidence/history; inspect confirmed upcoming company events; ask a question about the displayed evidence. A quiet day must be useful through honest coverage status and optional recent history, without fabricated urgency.

## 4. Core journey and loop

Google login → choose one or more supported companies → read Today's Changes → inspect before/after → open evidence → optionally mark useful or ask a supported follow-up → return when another relevant validated event appears.

The backend ingests once per company, extracts and matches comparable events, validates evidence, generates a versioned brief, then applies user eligibility/ranking. Feedback creates review work; it never immediately rewrites ranking weights or facts. [USER_FLOWS.md](USER_FLOWS.md)

Activation event: within seven days of signup, save ≥1 supported company and complete the first qualified evidence-backed session. Suggested three names is UI guidance, not a gate. Measure watchlist saved and first event opened as separate funnel milestones. Users with no available relevant events remain in overall denominators and also appear in an event-available diagnostic cohort.

Retention mechanism: relevant new events and visible company histories; optional normal in-app alerts in P1. Essential correction/withdrawal notices already exist in P0 and do not require alert opt-in. Do not optimize notification volume as a substitute for useful changes.

## 5. Functional requirements

| ID | Requirement | Acceptance reference |
|---|---|---|
| FR-01 | Authenticate via Google and isolate all private account resources | AC-01, AC-02 |
| FR-02 | Add/remove supported company watchlist entries; one name is sufficient | AC-03 |
| FR-03 | Show only eligible, validated, deduplicated published event versions with transparent ranking | AC-04, AC-05 |
| FR-04 | Represent prior/current periods, metrics, units, source locations and comparability status | AC-06, AC-07 |
| FR-05 | Separate facts, interpretations, uncertainty and next checks; expose original evidence | AC-07, AC-08 |
| FR-06 | Preserve revisions, withdrawals, same-issuer canonical duplicates, no-change/missing-baseline semantics and persistent P0 notices to exposed viewers | AC-09 |
| FR-07 | Allow feedback tied to exact analysis version | AC-10 |
| FR-08 | Provide authorized Ops review, safe replay, rejection, duplicate marking and audit trails | AC-11 |
| FR-09 | Offer optional manual portfolio context without prices or brokerage access | AC-12 |
| FR-10 | Constrain follow-up to event evidence and validate before display | AC-13 |
| FR-11 | Display source-confirmed calendar dates and in-app alerts | AC-14, AC-15 |
| FR-12 | Respect preferences, deletion and analytics privacy | AC-16 |

## 6. Data and content boundaries

- Proposed launch universe: 20 curated issuers (12 KR / 8 US), selected through data feasibility and tester relevance, not popularity assumptions. Search shows a coverage badge and accepts unsupported-company requests without pretending coverage exists.
- KR adapter: OpenDART company identities, filing list including amendments, original filings and available structured financial data. US: SEC submissions, 10-K/10-Q/8-K and relevant exhibits; original filing is the citation authority. Structured facts alone do not establish source location.
- Initial backfill: up to 24 months, extending to 36 only for an explicitly required baseline. Until done, show coverage start and baseline unavailable. No historical future-data leakage.
- Event classes: `financial_results`, `guidance`, `capital_allocation`, `shareholder_return`, `governance`, `material_risk`, `other`. Only six named classes receive automatic analysis; `other` is retained for coverage/Ops.
- P1 official IR/calendar sources are allowlisted and manually reviewed before enabling. No promise of exhaustive earnings calendar or macro releases.
- Unsupported: ETFs/look-through, indices, crypto, foreign issuers needing unsupported filing forms, general news, market-price feeds, FX valuation, trade/account data. Coverage is issuer-specific; unsupported form types are counted as skipped.

## 7. Key design decisions and assumption register

| ID | Decision/assumption | Why | How to challenge |
|---|---|---|---|
| D-01 | Watchlist-first; one-name activation | Median four followed names; no account-linking dependency | Observe setup completion and first useful event |
| D-02 | P0 official company sources only | Evidence quality, data rights and solo scope | Audit missed developments and price-context complaints |
| D-03 | Shared company brief, deterministic personal ranking | Minimize cost and private-data exposure | Compare usefulness across relevance bands |
| D-04 | No price-causation explanation | No licensed price data or causal evidence | Test labeled context separately in P2 |
| D-05 | Korean-first product, English spec | Source/user base context | Ask language preference in beta; no inferred segment proof |
| D-06 | Single API, worker, PostgreSQL queue | Manageable by one developer | Revisit only for measured throughput/reliability limits |
| D-07 | Human review all first 100 publication candidates | Limited gold set and unknown errors | Enable auto-publication only after gates, per class |
| D-08 | No raw portfolio/question text in analytics | Sensitive financial context | Inspect captured payloads in staging |
| D-09 | P1 in-app alerts only | Lowest Q23 salience; avoid channel complexity | Evaluate alert usefulness/muting before adding channels |
| D-10 | Portfolio weights optional, manual, no real-time value claim | No quote/FX dependency | Test whether manual maintenance is worth its benefit |

## 8. Dependencies and risks

| Dependency / risk | Consequence | Required handling / owner |
|---|---|---|
| Company roster and source coverage | Users may get empty feeds | Product + Data: commit roster, show coverage, measure availability |
| DART key, SEC access policy, issuer rights | Ingestion/redistribution limits | Operator: verify access and record terms before connector launch |
| Comparable source history | Invalid “changes” | Data: same context matching; abstain on ambiguity |
| Bias / hallucination / causal claims | False financial narrative | AI: atomic claims, bounded retrieval, numeric checks, human gates |
| Gold-set quality and correlated cases | Inflated evaluation | Product: grouped split, independent review, locked holdout |
| Google/Supabase configuration | Signup failures | Engineer: staging callback and session tests |
| Single operator / manual queue | Delayed publication | Cap universe and daily work; display delay; stop growth at backlog |
| Privacy and jurisdictional classification | Launch uncertainty | Owner: resolve policies/rights and necessary qualified review; disclaimer alone is insufficient |
| Model, deployment and data cost | Unsustainable beta | Budget reservations, shared generation, cached analysis, hard cap |

## 9. Success criteria and guardrails

North Star: weekly evidence-backed qualified sessions (WEBS), defined precisely in [ANALYTICS.md](ANALYTICS.md). Report weekly unique qualifying users and sessions/user alongside it to expose concentration.

Exploratory beta decision targets, not promises: ≥60% activation within seven days; median first-value time ≤5 minutes among completers; ≥60% useful among rated events with response rate shown; W4 qualified retention ≥30% of mature activated cohort. With 20–30 users these are learning thresholds, not statistically reliable PMF gates. Include counts, confidence bounds where meaningful, opportunity-adjusted diagnostics and qualitative reasons. No conversion target overrides safety.

Hard gates: no unauthorized cross-account access; no unsupported material or policy-prohibited claim in publication tests; all displayed numeric claims traceable and correct; explicit stale/empty/error states; [AI_EVAL.md](AI_EVAL.md) thresholds; critical mobile/accessibility flows pass. Reliability/cost targets are in [ACCEPTANCE_CRITERIA.md](ACCEPTANCE_CRITERIA.md).

## 10. Delivery and change control

Implement in [BUILD_PLAN.md](BUILD_PLAN.md) dependency order. First ten tasks are separately enumerated in [FIRST_10_TASKS.md](FIRST_10_TASKS.md). Each task includes verification, not just file creation. README, environment-variable documentation, migration validation, tests, source rights, actual staging flow and rollback evidence are part of release acceptance.

Scope changes require an updated decision entry: hypothesis served, source/evidence status, affected contracts, data rights, tests, and release impact. Updating a model or prompt requires evaluation and a versioned rollout. No application implementation, provider provisioning, gold labeling, user recruitment or deployment is claimed by this specification.
