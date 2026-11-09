# Home loading and B readability

## Problem and scope

The November 8 navigation cache removed repeated reads between prepared tabs, but cold Home A/B still requested overlapping customer projections. The source-overview response computed considerably more than Home's followed-company monitoring rows. Home B separately requested company/document/analysis catalogs, saved analyses, and notifications. Each workspace RPC acquired the same per-account, per-minute rate-limit row before doing its read, so otherwise parallel requests could serialize for the duration of those transactions.

This change addresses the default Home data path and the readability of B. It preserves the existing customer publication predicates, source metadata, consent checks, custom filters, calendar reads, and mutation APIs.

## Data flow

`POST /api/workspace` validates `{action:"home_snapshot",p:{today:"YYYY-MM-DD"}}`, verifies the bearer session with Auth, and calls `sb_home_snapshot`. Its invoker wrapper delegates to a private, empty-search-path definer that checks a current identity, MFA, completed onboarding, and one rate-limit acquisition. Callers cannot select an account.

The snapshot materializes the authoritative customer-resource projection once, then derives the default watchlist, followed-company monitoring, company directory, recent documents, approved analyses, saved analyses, notifications, and A dashboard. Monitoring never substitutes all companies for an empty watchlist. No history rows are returned; the saved history count is read only when history consent is enabled. Existing endpoints remain authoritative for custom filters, alternate saved tabs, and notification refreshes.

Both previews share a validated, account-scoped, in-memory snapshot with a 30-second fresh period and the existing bounded stale-display behavior. Home can start preparing it while the profile-dependent screen is mounting. Preview intent and normal navigation reuse the same pending request. Calendar, coverage, and news retain independent loading and failure paths. Mutations still invalidate or update the affected account cache; notification acknowledgements patch the snapshot notification slice so returning Home cannot restore an already-read item.

Transport/server/response-validation failures can fall back to the existing independent widget reads. Authentication, MFA/onboarding, and quota denials do not enable that fallback. A visible error and retry preserve the distinction between an unavailable snapshot and a valid empty response.

## B layout decisions

- Main text is 15–16px; section headings are 20–22px; secondary text is 12–14px. The former 10–11px labels have been removed from B's scoped rules.
- Card gaps are 16px and metric gaps 12px. More room is allocated inside cards: 24px desktop insets and 20/18px mobile insets. Metric cards are at least 104px tall.
- Content titles wrap into a second line. Document buttons, notification timestamps, and badges have separate positions instead of competing with titles for one narrow row.
- Below 1401px the sidebar moves underneath the main cards; below 901px the card grid becomes a single column. Small screens keep 44px controls and separate document action rows.

## Verification and release record

The full backend suite passes 1,245 tests with zero skips against disposable PostgreSQL. The 26 dedicated snapshot tests compare every default DTO with its existing query, check ordering/page limits and exact totals, reject unauthorized identities and unapproved evidence, verify account isolation, and prove one resource-projection call plus one quota call. With history disabled, transaction statistics show no history-table scans. A 5,000-filings fixture returns bounded lists and exact totals within a three-second statement budget. The API/contract boundary passes 68 tests; preview/navigation priority checks pass 17 tests.

The additive migration is applied as `20261109031209_home_snapshot.sql`. The production ledger contains the exact reviewed SQL bytes (SHA-256 `65fabe363e6c91660d4d79c5bd0aff781c90cde32e2abeb9e08cb88b84d977d8`); both function bodies match their local source hashes. Anonymous execution is denied, only the private helper is a definer, and both functions have empty search paths. Security and performance advisor findings are unchanged from the baseline. The existing web release continues using its original reads until the frontend deployment.

The final `python scripts/verify.py --full` completed at 2026-11-09 03:17:56 UTC with all eight stages passing: 1,245 backend tests with zero skips, 2,228 frontend tests across 143 files, Python compilation, API schema export, Ruff, TypeScript, ESLint, and the production build. ESLint retains five existing navigation warnings and no errors. The protected-scope guard passes for all 106 protected files, 17 retained features, and two customer entrypoints.

The browser release gate covers real DOM rendering and interactions on desktop/mobile, including 320/768/1024/1280/1440/1920px layouts, exactly one snapshot across cold A/B preview swaps, blocked repeat content requests, independent calendar/coverage/news, saves, read acknowledgements, and error recovery. Local Chromium cannot launch in this execution environment; browser results must come from the exact-source CI runner. At this source publication, that CI gate and the new web deployment remain pending. The pull request's workflow artifacts and the live `/api/release` endpoint record the subsequent release outcome.

## Measurement limits

One resource projection and one quota acquisition remove repeated database work; request deduplication removes duplicate Home reads. These are structural improvements, not a promise of zero network latency. Cold authentication, external news, fresh calendar queries, and custom filters can still require network work. Historical database statement statistics and synthetic test timings are not measured production click-to-content latency.

In the isolated populated PostgreSQL fixture, three warm repetitions measured a median 20.544ms for the snapshot, versus 118.560ms for A's legacy widget set and 212.391ms for B's. The first snapshot took 24.499ms. These measurements use Python `perf_counter` around SQLAlchemy loopback reads within one transaction; they exclude HTTP, Supabase Auth, calendar/news requests, rendering, and concurrent lock contention. They demonstrate reduced database work on that fixture, not a production latency guarantee.
