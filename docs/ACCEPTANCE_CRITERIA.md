# SignalBrief Acceptance Criteria

Version 1.1 • Future implementation/release gates; none claimed passed by this specification

## 1. Testable acceptance contracts

| ID | Given / when / then | Required verification evidence | Release |
|---|---|---|---|
| AC-01 Authentication | Given valid/canceled/expired Google journeys, when callback/refresh/logout runs, then one correct profile/session exists or a safe retryable state appears; unsafe redirect/state mismatch rejected. | Staging real Google flow plus callback/expiry fixtures; cookie/token inspection | P0 |
| AC-02 Ownership | Given users A/B and non-admin, when every private/nested route and Ops route is exercised, then unauthorized reads/writes fail and no identity leaks through pooled DB context or cache. | API/RLS integration matrix, A→B pooled request, authenticated cache headers | P0 |
| AC-03 Setup | Given one supported name, unsupported name, duplicate or 30-name list, when saved, then one-name setup succeeds, unsupported coverage is explicit, duplicate is idempotent and cap cannot be raced. | API/domain tests and mobile browser journey | P0 |
| AC-04 Eligibility/ranking | Given watched/held/unfollowed companies and published/withdrawn candidates, when feed is read, then only eligible safe versions appear with reproducible score/reasons and stable pagination. | Hand-computed ranking fixtures; subscription-union tests; cursor snapshot tests | P0, portfolio extension P1 |
| AC-05 Ingestion | Given paginated filings, amendments and provider errors, when discovery/fetch runs, then raw documents and multiple immutable parsed artifacts/spans are preserved, cursor commits only on full poll, duplicate work dedups and gaps/freshness remain visible. | KR/US fixtures; same bytes with two parser versions retain both locator histories; bounded live staging smoke and source reconciliation sample | P0 |
| AC-06 Comparison | Given same/mismatched periods/bases/units, missing baseline, zero/negative/range/rate values, when matched/compared, then only valid context yields exact derived deltas; others have explicit non-comparison status. | Decimal and temporal domain tests; gold case outcomes; original/prior span inspection | P0 |
| AC-07 Claims/citations/numbers | Given an emitted factual or comparative claim, when published, then every material clause resolves to matching immutable evidence; comparison cites both sides and math; numbers match source/rounding context. | Citation locator/hash/numeric fixtures, semantic/human adjudication, published-holdout 100% gate | P0 |
| AC-08 Policy/uncertainty | Given prohibited advice, unsupported causation, conflict or inadequate evidence, when generation/validation runs, then prohibited claims do not publish and limitations/refusal/abstention are truthful. | Adversarial suite, conflict case review, no admin hard-gate override | P0 |
| AC-09 Revision lifecycle | Given published content and correction/withdrawal/duplicate consolidation, when processed, then version visibility is atomic, old unsafe narrative is hidden, lineage remains and exposed viewers receive persistent P0 accuracy notices independent of normal alert preferences/analytics consent. Duplicate pointers are same-issuer, root-only and acyclic; canonical timeline entry appears once. | Transaction/crash/cache/late-view/fanout-retry fixtures; A↔B concurrent cycle and cross-issuer rejection; opt-out/mute/unfollow/no-consent notice delivery and acknowledgement persistence; Ops correction/withdrawal drill | P0 |
| AC-10 Feedback | Given a user sees revision N and reports/rates it, when stored, then feedback links N and its run, ratings dedup, private notes remain private, and confirmed errors require adjudication. | API tests + user→Ops fixture journey | P0 |
| AC-11 Ops | Given active authorized operator with required assurance, when reviewing/replaying/withdrawing, then source/run/validator visibility is sufficient, actions are audited and invalid candidates cannot be approved. | Role/assurance/gate/concurrency tests; screen action drill | P0; config rollback P1 |
| AC-12 Portfolio | Given optional manual positions, when entered/replaced/removed, then null weights remain unknown, totals/caps validate atomically, stale weights lose bonus and independent watchlist eligibility persists. | Domain/concurrency/RLS tests; mobile edit flow; no live valuation or broker route | P1 |
| AC-13 Follow-up | Given event-scoped answerable/unanswerable/prohibited/stale questions, when accepted, then quota/idempotency hold, evidence stays bounded, answer displays only after validation and outcome states differ. | API/worker/UI tests, injected/out-of-scope examples, token/privacy inspection | P1 |
| AC-14 Calendar | Given confirmed/estimated/date-only/unknown/rescheduled dates, when displayed, then original precision/source/timezone/status is preserved and no inferred calendar date is invented. | Calendar/date fixtures + approved source inspection + mobile agenda | P1 |
| AC-15 Alerts | Given opt-in/mute/cap and publication retries, when fanout/read happens, then normal alerts are relevant and deduped, cap is atomic, and the Alert Center incorporates existing P0 accuracy notices without duplicating or suppressing them. | Outbox/concurrency/preference tests; user flow; no outbound channel added | P1 |
| AC-16 Privacy/settings | Given consent withdrawal, export/deletion and disabled account, when processed, then control works, access stops immediately, owned data/jobs are purged/reconciled and actual retention is disclosed. | Consent payload tests, own-export/no-cross-user tests, deletion/backup-retention record | P0 |
| AC-17 Analytics | Given qualifying/nonqualifying/duplicate/background sessions, when events aggregate, then exact NS/activation/retention rules hold; no raw sensitive payload or nonconsented export; report mature counts/N/A. | Event schema snapshot and derivation fixtures; PostHog staging event inspection | P0; P1 events before beta |
| AC-18 Evaluation | Given approved real gold bundles and locked grouped split, when a candidate runs, then all ten formulas, numerator/denominator or distribution records, versions, scopes, N/A/incomplete states and authoritative exports are present, holdout leakage absent, safety targets pass and no measured result is invented. | Dataset/reviewer hashes; reproducible report/export with all ten metrics, cost per completed/attempted/published analysis, failure/no-output coverage and config signoff | P0; rerun P1 additions |
| AC-19 UX/accessibility | Given all screen fixtures, when at 360/768/1280px, keyboard and 200% zoom, then key flows remain usable with empty/loading/error/stale/correction states and accessible labels/focus/contrast. | Browser/accessibility checks + inspected screenshots for critical states; no claim of WCAG certification from an automated scan alone | P0/P1 as delivered |
| AC-20 Execution/deployment | Given clean setup and isolated staging, when installed/migrated/built/run, then services start, frontend build passes, documented env vars suffice and real core source/auth journey succeeds; rollback is reviewable. | CI logs, migration install/upgrade, README/env manifest, bounded integration smoke, rollback/restore drill | P0; full P1 smoke |
| AC-21 Jobs/recovery | Given retries, worker crash, duplicate scheduler and lease expiry, when jobs resume, then logical publication/fanout dedup, stale workers fenced and failed work remains visible. | Fault-injection integration tests, dead-letter/replay drill | P0 |
| AC-22 Source/secrets safety | Given malicious URL/XML/archive/HTML/PDF/source instructions, when ingested/rendered, then unsafe fetch/parse/execute paths blocked; privileged secrets never enter repo, browser or telemetry. | SSRF/parser/injection fixtures, secret/bundle/log checks, approved source-rights records | P0 |
| AC-23 Cost/latency | Given model calls/retries/unknown usage/concurrent questions, when accounted, then all attempts/costs count, budget reserves enforce cap, unknown cost is explicit, latency and failures measured against targets. | Usage/cost formula tests, concurrent budget admission, eval/load report with misses | P0/P1 |
| AC-24 Honest fallback/coverage | Given no change, absent baseline, source outage, unsupported format and generation failure, when user reads, then distinct states appear; only verified facts can fallback and no invented event fills an empty feed. | Fixture-driven pipeline/API/UI checks + omission audit | P0 |

## 2. Release quality thresholds

Canonical AI metric formulas/thresholds are in [AI_EVAL.md](AI_EVAL.md); do not replace them with click-through metrics. Hard content/security gates cannot be averaged away. Proposed operational targets are engineering hypotheses:

| Measure | Beta target / required handling |
|---|---|
| Precomputed read API | p95 <500ms under 20 concurrent users; document load/tool conditions |
| First useful page content | <2.5s target under recorded device/network conditions; loading remains accessible |
| Analysis execution | p95 ≤120s target; hard deadline 180s, with queue/review time separately reported |
| Follow-up execution | p95 ≤20s target; hard deadline 60s; failures included |
| Source freshness | 15-minute poll target; source-delayed warning after >45min since last complete success |
| First-seen → publication | p95 <30min during staffed review periods; actual backlog disclosed outside staffing |
| API reliability | ≥99% valid-request success target during measured beta window; show request count and outage duration |
| Cost | Mean company analysis ≤$0.05, p95 ≤$0.15; mean Q&A ≤$0.03 proposed targets; all attempt/usage completeness recorded |
| Restore | Demonstrated RPO ≤24h and RTO ≤4h for selected paid-tier configuration; record actual capability |

Performance/cost misses trigger a measured narrowing/optimization plan and an explicit release decision; security/content-policy failures block release. Do not imply target achievement from this document.

## 3. P0 pilot and V1 beta gates

**P0 pilot:** F01–F14 complete, relevant AC-01–11 and AC-16–24 pass; real approved data/auth integration; 120-case evaluation process complete with reviewed gold/holdout; all first 100 publication candidates manually reviewed; working deployed core loop. P1 features are hidden until ready.

**V1 beta:** P0 plus F15–F19, AC-12–15, all thirteen requested screens, evaluated Q&A/policy tests, source-confirmed calendar and opt-in normal alerts integrated with the already-required P0 accuracy notices. Operations staffing and cost cap configured; public coverage, source-rights and actual retention policy reviewed by owner.

**Learning gate:** record activation, repeat qualified sessions, usefulness and response rate, source availability, omissions, trust comprehension and price-context gap over mature cohorts. PRD thresholds guide learning, not safety exceptions. If real data show weak value, narrow/change product hypothesis instead of adding unrelated features.

## 4. Completion record required for every task

Task ID; dependencies met; changed behavior; files/migrations; commands and actual results; acceptance IDs tested; fixture vs live distinction; missing external prerequisites; remaining risks; README/env update; rollback implications. Never label a stub, mocked login, synthetic financial event or untested citation as production-ready.

## 5. This specification's own acceptance

This deliverable is complete when all fifteen requested docs and a separate first-ten-task file exist, all ten phases are covered, source evidence and assumptions are distinct, n=49 branch/aggregate limitations remain explicit, screen/stage contracts are complete, internal links and task dependencies are valid, and no application code is included. The final review record in README describes checks on these documents only.
