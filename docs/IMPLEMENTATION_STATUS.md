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
