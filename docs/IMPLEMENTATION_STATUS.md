> November 1, 2026 reliability repair: home date defaults, company discovery/collection recovery, normalized search, approved numeric-source excerpts, calendar scope/coverage, and personal-event company binding are implemented and regression-checked. See [POST_LOGIN_RELIABILITY_2026-11-01.md](POST_LOGIN_RELIABILITY_2026-11-01.md) for observed defects, deployment dependencies and remaining source-coverage limits. This implementation status is separate from live deployment verification.

> Earlier November 1, 2026 release: The ten Korean post-login screens from the screenshot package were implemented and deployed. The new dashboard/directory RPC and calendar-interest removal migration were applied. Release code: `7a7dbc1ef6d29edda60493039a35fba976c64b7b`. Historical status tables below are retained as originally recorded. See VERIFICATION for current validation and limits.

> New local execution results: [LOCAL_VERIFICATION_2026-10-02.md](LOCAL_VERIFICATION_2026-10-02.md). Supplier results below are historical.

# Implementation status and scope decisions

Statuses are evidence boundaries, not a percentage of completion. See VERIFICATION for measured results.

| Area | Code present | Current boundary |
|---|---|---|
| Next web / 13 screen categories | Yes, real API calls and states | Syntax checked; package install/build/lint/type/E2E still unverified here |
| FastAPI / identity / portfolios | Yes | Local regression and asymmetric JWT verification tested; live OAuth not tested |
| PostgreSQL schema / RLS | 29 tables, 2 migrations | SQLite upgrade/downgrade tested; actual Postgres role test pending |
| DART / SEC ingestion | Provider abstraction and CLI implemented | Mock transport fixtures tested; no live credentials/network verification |
| Original raw source / provenance | Local + private Supabase storage adapters | Local hashes, identity conflict, originals tested; live bucket not connected |
| Job queue | Retry/backoff, quota, leases, outbox | SQLite lifecycle/concurrency regressions tested; actual PG locks pending |
| Extraction / citations | Structured OpenAI, strict quote/number/context checks | Conservative; live financial semantic accuracy not claimed |
| Change comparison / ranking | Deterministic and evidence-linked | Real price reaction unavailable, membership not market value weighting |
| Brief / follow-up | Extractive answers + contextual templates | Not an unrestricted free-form financial analyst |
| Approval / Ops | Admin-only review/reject/rerun/duplicate/audit | Live defaults to manual review; operating team is not supplied |
| Alerts / calendar | App notifications, manual/explicit source dates | No email/push or inferred calendar coverage |
| pgvector | Optional model-specific index/query implemented | Not required by default flow; live SQL/embedding integration untested |
| PostHog / Sentry | Consent-aware export/error integration | Real project keys/account transport untested |
| Evaluation | Runner + 120 synthetic cases + reports | Not the independently expert-labeled 100–150 real-case Gold Dataset |
| Deployment | Docker, Render, CI, Vercel runbook | Not built/deployed on real accounts here |

## P0 before public beta
Install dependencies, fix any lint/type/build errors, lock versions and audit them. Run desktop/mobile E2E and actual PostgreSQL
RLS isolation tests. Configure Google OAuth/keys/private durable bucket and test real providers. Human-review real financial
extraction/false acceptance. Validate backups/restore and finalized privacy/operating information. Verify HTTPS production auth.

## Declared deferred/non-goal work
PDF/OCR and over-budget document support; unrestricted semantic entailment; full XBRL taxonomy; exhaustive issuer coverage;
market feed / stock-price overlays / market-value position weights; real-world labeled Gold Dataset; email/push; payments and
native apps. Some are extensions, some are deliberate non-goals. Do not rebrand them as already complete.
