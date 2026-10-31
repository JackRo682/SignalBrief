# Research MVP — 2026-10-31

The public product now centers on official disclosures, company research and monitoring.
The operations pages, admin checks, authentication, MFA, RLS, records and legacy implementations remain intact.

## Public scope

- Responsive research home: published analyses across available history, recent filing metadata, watched companies, notifications, confirmed upcoming dates and existing company news search.
- Company/disclosure directory: real catalog queries, company/filing/analysis/document tabs, market filtering and pagination. Global queries search all resource kinds.
- Company pages: source-linked introductions for seven connected issuers, official identity profiles, published facts, original documents, analyses and company-filtered NAVER news.
- Monitoring: follow/unfollow, per-company mute settings and published analysis history, with real authenticated mutations and error states.
- Existing evidence questions, document sections, bookmarks, calendar and app/email notification settings are retained.
- Onboarding selects companies without requesting holding quantities or costs.
- Marketing, feature and pricing pages describe the narrower product. Portfolio and billing entry points redirect to monitoring and free pricing.
- Live quotes, indices, charts, valuations, comparison tabs and unsupported screening filters are outside public MVP scope. No new paid service was added.

Set `NEXT_PUBLIC_RESEARCH_MVP=false` and rebuild to restore retained legacy page branches. Admin routes are excluded from the public research context. No tables or holdings were deleted.

## Data and backend work

- Verified actual collector completion logs, not just cron status: SEC/DART rotation runs every 15 minutes; notification scheduling runs every 5 minutes; official calendar scheduling runs every 6 hours.
- Two queued legacy parse jobs already had processed source documents, chunks and later validated published results. `scripts/sql/reconcile_completed_parse_jobs.sql` reconciled only these completed jobs and recorded two audit entries. This is queue reconciliation, not deployment of a Python worker.
- The 7 US drafts contain 35 claims, and the 44 DART drafts contain 142 claims. Their stored quotes match the corresponding stored normalized excerpts. Mechanical checks do not establish semantic correctness. All 51 drafts retain `needs_review`: the existing publication contract requires human semantic review.
- API source/citation questions now retrieve existing authorized evidence even without literal keyword overlap. Topic-specific requests still require matching evidence, and no new facts are generated.
- Existing email delivery has two `email.delivered` receipts, most recently 2026-10-14. Those receipts verify historical provider delivery, not current inbox receipt for every user.

## Verification

- `python scripts/verify.py --full`: all eight checks passed after fixes. Backend: 340 passed, 108 skipped; skipped external/disposable-server cases are not passed checks.
- Final frontend suite: 666 tests passed, including new research-flow, error-handling and evidence-selection regressions. Existing PGlite tests execute source-visibility/search/authorization SQL in disposable PostgreSQL.
- Production build and TypeScript checks passed. ESLint has no errors; existing navigation warnings remain.
- Managed local preview could not launch Next.js because the preview runner appends unsupported Vite flags. No security or network configuration was changed to bypass that limitation.
- Hosted browser verification is recorded separately after publication. New paid checkout and automatic semantic approval are deliberately excluded.
