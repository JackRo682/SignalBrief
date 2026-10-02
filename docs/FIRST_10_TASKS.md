# The First 10 Tasks Codex Should Perform

Version 1.1 • Dependency order • Implementation starts only in a subsequent authorized build task

This file is a separate handoff list. Read [AGENTS.md](../AGENTS.md), [.agent/PLANS.md](../.agent/PLANS.md), [BUILD_PLAN.md](BUILD_PLAN.md) and referenced contracts before execution. Start by inspecting any actual repository; the specification task found no application, but a future repository may contain existing work. These tasks build the secure source foundation before analysis or chatbot features.

| Order | Task | Depends on | Concrete result | Completion check |
|---:|---|---|---|---|
| 1 | **T01 — Repository foundation** | None | Web/API/worker/contracts/migrations/evals structure, locked dependencies, local setup, CI and dummy env manifest | Fresh-checkout run, frontend build, API/worker health smoke, no committed secrets |
| 2 | **T02 — Canonical contracts** | T01 | Validated domain/API/stage types including parser artifacts, fetch receipts, diagnostics, publication/final dispositions, decimal/date precision, status enums and shared error envelope | Invalid/missing/extra-field fixtures and frontend/API schema compatibility |
| 3 | **T03 — Shared content schema** | T02 | Company/instrument/source/coverage/raw-document/parsed-artifact/span migrations and provenance keys | Empty-install/upgrade tests, immutable raw/artifact hashes, two-parser-version span preservation and duplicate constraints |
| 4 | **T04 — Google Auth and BFF** | T01, T02 | Supabase Google code/PKCE flow, protected server session, refresh/logout, safe proxy | Sign-in/cancel/expiry/state/redirect tests; actual staging callback only after configuration |
| 5 | **T05 — Private data and RLS** | T03, T04 | Profiles/watchlist schema, least-privilege API role, verified transaction-local ownership | A/B access isolation, pooled-identity leakage test, no direct browser table access |
| 6 | **T06 — Coverage registry** | T03 | Proposed 20-issuer roster, provider IDs/ticker mapping, supported forms, reviewed source records | Unsupported/ambiguous names handled; roster/rights approval genuinely recorded or pending |
| 7 | **T07 — Durable job queue** | T03 | Scheduler dedup, leased queue, retries/dead-letter, fencing and outbox foundations | Crash/duplicate/expired lease/poison-job integration checks |
| 8 | **T08 — OpenDART discovery** | T06, T07 | Pagination, amendment-inclusive list, IDs/date cursor, key/status/rate handling | Multi-page/amendment/429/error fixtures; bounded live smoke if key configured |
| 9 | **T09 — SEC discovery** | T06, T07 | CIK/accession discovery, history handling, declared User-Agent, shared rate limiter | Duplicate/403/429/history fixtures; bounded live policy-compliant smoke |
| 10 | **T10 — Immutable source acquisition** | T08, T09 | Approved-URL safe fetch, bounded archives, hashes/private objects/version receipts | Same-byte dedup, changed-byte version, SSRF/oversize/archive-safety tests |

After T10: deterministic parsers and real gold fixtures (T11–T13), then fact extraction/matching/change detection and validation (T14–T22). Do not skip directly to generated answers.

## Copy-ready first task instruction

> Work on SignalBrief Task T01 only. Read README.md, docs/PRD.md, docs/ARCHITECTURE.md, docs/SECURITY.md, docs/BUILD_PLAN.md and docs/ACCEPTANCE_CRITERIA.md. Inspect the existing repository and applicable AGENTS.md first; create/update the bounded execution plan required by .agent/PLANS.md. Establish or adapt the minimum web/API/worker/contracts/migrations/evals structure, pinned dependencies, local run commands, dummy environment-variable example and CI checks. Verify fresh setup, the frontend build and API/worker health smoke. Keep secrets out of source. Report the actual checks and prerequisites. Do not implement product features, source ingestion, AI generation or later tasks in this change.

## External setup that must be reported honestly

Supabase/Google callback configuration, isolated staging credentials, DART access, a valid SEC contact User-Agent, source-rights decisions and later OpenAI usage/pricing configuration are owner/provider dependencies. A fixture passing is useful evidence, but cannot be described as a successful live integration. Work that can proceed without those prerequisites should continue within its task scope.
