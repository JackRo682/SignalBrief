# SignalBrief MVP Scope

Version 1.1 • Canonical scope register

P0: necessary to test the core hypothesis with real users. P1: important to complete V1 beta. P2: only after product-market signals and dependency validation. Not Now: explicitly excluded. These priorities are design decisions informed by [USER_RESEARCH.md](USER_RESEARCH.md), not direct survey conclusions.

Complexity is relative solo engineering effort: S = bounded integration/UI; M = several contracts and edge cases; L = substantial data/quality/security work. It is not a schedule estimate. Dependencies name feature IDs. All delivered features must meet the shared release criteria in [ACCEPTANCE_CRITERIA.md](ACCEPTANCE_CRITERIA.md).

Feature dependencies describe required capabilities and release gates; candidate generation and its evaluation can be developed before publication is enabled. The acyclic task graph in BUILD_PLAN is the execution authority, so Ops/evaluation gates do not create a circular implementation requirement.

## P0 — Core pilot

| ID / feature | User problem → expected outcome | Acceptance criteria | Dependency | Complexity | Data dependency | AI dependency |
|---|---|---|---|---|---|---|
| F01 Google login / account boundary | Need persistent private lists → authenticated account | Valid callback creates one profile; logout/expiry handled; other users' resources inaccessible | Supabase/Google configuration | M | Auth identity | None |
| F02 Onboarding + watchlist | Setup friction → first supported company quickly | One-name continue; suggested three; search distinguishes ticker/exchange; duplicates idempotent; max 30; coverage visible | F01, F03 | M | Issuer/instrument directory | None |
| F03 Official ingestion + source registry | Late/missing information → traceable company documents | KR/US adapters preserve amendments and timestamps; hashes and stable IDs; retries/dedup; coverage/freshness exposed | Provider access/rights, jobs, DB | L | DART/SEC, initial roster, backfill | None for fetch/identity |
| F04 Event normalization + comparison | Cannot identify changes → valid before/after | Class/metric contracts; comparable periods and units; missing/ambiguous baseline does not generate change; corrections retained | F03 | L | Source spans + previous filings | Bounded extraction/classification; deterministic arithmetic |
| F05 Evidence-backed analysis + validation | Unclear explanations → grounded concise brief | Every material claim has supported citation; fact/inference split; numeric/policy gates; valid fact fallback | F04, F07; publication additionally gated by F11/F12 | L | Validated facts/evidence | Generation, semantic validation |
| F06 Today's Changes / ranking | Overload → small relevant prioritized feed | Eligible published events only; top three then pagination; ranking reasons; quiet/stale/error distinguished | F02, F05 | M | Subscription union, event scores | No live model call to rank |
| F07 Event Detail + Evidence panel | Cannot verify claims → inspect source and comparison | Claim-level links open correct span; old/new source dates; conflict/withdrawal visible; persistent P0 accuracy-notice banner/list independent of normal alerts; no fake confidence percent | F03–F04 | M | Immutable document versions/locators | Consumes validated output |
| F08 Basic company timeline | Hard to understand sequence → inspect sourced chronology | Prior/current event links and correction grouping; only known dates; no price causality | F04–F07 | M | Event history | None additional |
| F09 Plain explanations / glossary | Jargon blocks comprehension → readable first view | Short summary, expandable terms; original technical phrase accessible; translations labeled | F05, F07 | S/M | Curated glossary + claim source | Validated explanatory text only |
| F10 Feedback + useful/not useful | Errors and irrelevant results persist → actionable review | Feedback linked to exact brief/run; one current rating/user/version; report confirmation and Ops queue | F01, F05 | M | Feedback and version IDs | No automatic fact or rank edits |
| F11 Minimum Ops console | Unsafe failures hidden → inspect/control pipeline | Admin-only queue, provenance, approve/reject/withdraw/replay, same-issuer acyclic duplicate linking, P0 accuracy-action/fanout reconciliation, immutable audit; cannot override failing hard gates | F03–F05, RBAC | L | Runs, validation, jobs, audit | Shows model/prompt versions |
| F12 Evaluation harness + gold process | Unknown quality → measured release gate | 120-case plan, strict definitions, leak-safe split, frozen holdout, evaluation report linked to release | F04–F05 | L | Labeled source cases | Runs candidate pipelines; human adjudication |
| F13 Analytics + observability | Cannot learn or detect failure → trustworthy operations/metrics | Validated event taxonomy, consent, backend authoritative transitions; latency/cost/coverage alerts | F01, F03, F06 | M | Product events, traces, costs | Run accounting |
| F14 Settings/privacy/security/deletion | Lack of control → safe private service | Timezone, analytics choice, logout/delete, policy/coverage; RLS and API tests; deletion completion tracked | F01, F13 | M | Profile, consent, retention registry | No sensitive analytics/model content |

## P1 — Complete beta

| ID / feature | User problem → expected outcome | Acceptance criteria | Dependency | Complexity | Data dependency | AI dependency |
|---|---|---|---|---|---|---|
| F15 Optional portfolio | Held names may matter more → manual context | One portfolio; company held flag + optional manual weight; weights 0–1 and sum ≤1; dates visible; no quote/value/performance claims | F01–F03, F06 | M | User-entered holdings | None; private values excluded from prompts |
| F16 AI follow-up | Need clarification → event-scoped grounded answer | Evidence-scoped questions; numeric/citation/policy checks before display; unsupported/refusal and timeout states; quota; no unvalidated streaming | F05, F07, F12, F14 | L | Published version + approved related evidence | Retrieval/generation/validation |
| F17 Event calendar | Future checks forgotten → known company dates | Officially sourced dates only; precision/timezone/status; reschedules supersede; date-only never fabricated midnight event | F03, F08 | M | Allowlisted issuer IR or filed dates | Optional extraction + deterministic date validation |
| F18 Alert Center | Need selective return cues → quiet in-app notifications | Explicit opt-in; threshold/mute/read; unique event revision; max 3 normal items/user/local day; integrate existing P0 accuracy notices without duplicate records; no outbound delivery | F06, F10, F14 | M | Preferences, publication outbox | No extra generation |
| F19 Ops version operations | Safe iteration → reproducible releases | Evaluated prompt/model config, rollback reference, run comparison, cost/lag dashboard; no arbitrary prompt editor in production | F11–F13 | M | Versioned config/eval results | Candidate runs under budget |

## P2 — Conditional expansion

| ID / feature | User problem → expected outcome | Acceptance before implementation/release | Dependency | Complexity | Data dependency | AI dependency |
|---|---|---|---|---|---|---|
| F20 Licensed price-context timeline | Understand coincident price moves → clearly labeled context | Redistribution rights, adjustment/time alignment tests, no unsupported causation; evidence of unmet demand after beta | F08, research | L | Licensed OHLC, market calendars, actions | Only sourced possible factors |
| F21 ETF look-through / sector exposure | ETF/indirect holdings unserved → bounded exposure context | Licensed holdings with effective dates; no duplicate exposure or stale weights; demand demonstrated | F15, F20 optional | L | Holdings composition and classifications | Optional relationship explanation |
| F22 Email/push/digests | Return without opening app → useful opt-in delivery | Proven in-app relevance; consent/unsubscribe, delivery dedup, quiet hours, provider monitoring | F18 | M/L | Delivery provider/contact permission | None beyond approved brief |
| F23 Advanced personalization | Simple ranking insufficient → improved relevance | Offline/online lift with safety guardrails, sufficient feedback, documented treatment policy | F10, F13 | L | Consented labeled interactions | Optional reranker; no trading optimization |
| F24 Separate density modes / English UI | Differing reading needs → tailored density/language | Test default disclosure first; translate claims without changed meaning | F09 | M | Terminology/i18n | Evaluated translation |
| F25 Broader issuer/form coverage | Unsupported names block adoption → reliable wider coverage | Per-class/parser evaluation, rights, ingestion budget and operator capacity | F03, F12 | L | New source formats/history | Extractor validation |
| F26 Event bookmarks | Need later review → personal saved events | Demand confirmed; private CRUD and corrected-version links | F07, F14 | S | Saved-event table | None |

## Not Now — Explicit exclusions

Acceptance for these items is absence from V1 routes, tools, marketing claims and data collection. Complexity estimates describe avoided work, not authorization to build.

| Feature group | Possible user problem / outcome | Exclusion criterion | Dependency if ever reconsidered | Complexity | Data | AI |
|---|---|---|---|---|---|---|
| Buy/sell advice, target prices, sizing, certain price forecasts | Desire for decisions | Block prohibited advice even in follow-up; no recommendation CTA | Requires new mission and separate qualified review | L | Unspecified | Prohibited by mission |
| Trade execution / algorithmic trading / robo-advice | Act automatically | No orders, broker credentials or trading tools | Outside project mandate | L | Brokerage/custody | Prohibited |
| Brokerage account sync | Reduce manual setup | No brokerage OAuth/key/account import | New privacy/rights/security scope | L | Private account feeds | None necessary |
| Stock screener / complex tick charts / full financial modeling | Broader research | No discovery screener, live quotes, valuation models | Distinct hypothesis and licensed data | L | Market/forecast data | Optional, excluded |
| Community / social feeds | Discuss ideas | No user posts or social ranking | Moderation and network-effect thesis | L | User content | Moderation, excluded |
| General news aggregation | Broad awareness | No scraping/republication pipeline | Licensing, incremental relevance evidence | L | Licensed news | Dedup/analysis, excluded |
| Crypto | Non-equity assets | No tokens/crypto sources | New data/risk model | L | Crypto data | Excluded |
| Billing / native mobile apps | Monetization / device distribution | No payment integration or app-store build in beta | Measured demand and platform decision | M/L | Payments/mobile infrastructure | None |

V1's original ranking example included abnormal market reaction. It is removed from the initial scoring contract because no price feed exists. Sector propagation and portfolio valuation are likewise deferred. This avoids representing unmeasured inputs as zero-valued evidence.
