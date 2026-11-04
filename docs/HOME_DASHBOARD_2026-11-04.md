# Homepage dashboard redesign — 2026-11-04

## Context and goal

Recreate the supplied Korean homepage design in the existing `/today` route,
including a usable mobile layout. Reuse the existing Watchlist, Calendar,
dashboard, company-news and shared UI implementations. Keep the shared shell
and white background. All displayed records must come from real requests.

## Current behavior

Home renders four metrics, permanently expanded company/date filters and four
separate resource panels. Watchlist already exposes latest company monitoring
through `source_overview`; Calendar exports an authenticated, RLS-protected
date hook. The existing news endpoint returns one selected company's results.

## Implementation

- Recompose `apps/web/src/redesign/home.tsx` into a briefing banner, metrics,
  compact followed-company updates, upcoming dates and tabbed recent activity.
- Add narrowly scoped responsive presentation and a decorative inline SVG.
- Keep the existing filters available from a compact disclosure control.
- Share the existing resource identity helpers, company logos, authentication,
  Zod contracts, news requests, watchlist request and calendar hook.
- Add pure activity composition helpers and regressions for scope, dates,
  interactions, failure states and responsive browser journeys.

## Boundaries and risks

No new API, schema, migration, auth flow, external asset service or dependency.
No price or percentage displays. Monitoring contains a limited latest-record
preview, so it must not be presented as a comprehensive update count. Dashboard
metrics retain their company/date scope; selected-company news retains its
independent latest-search scope. Verified calendar rows have date precision;
never invent a meeting time. Scope records against the successfully loaded
watchlist, including when monitoring has an all-company fallback. Distinguish
an empty response from a failed request and keep each request retryable.

## Acceptance and verification

Desktop follows the supplied section order, sizing, color, badges and spacing.
Mobile stacks panels, uses a two-column metric grid and readable activity rows
without page overflow. Tabs, filters, search, view-all and detail links work.
Use the repository typecheck, lint, unit tests, build, scoped desktop/mobile
browser suite, full verifier and disposable PostgreSQL gates. Record actual
results below; synthetic browser fixtures do not establish live data coverage.

## Verification record

- `TZ=UTC python3 scripts/verify.py --full`: all eight checks passed on
  2026-11-04. Frontend: 1,691 tests across 118 files; backend: 364 passed,
  740 skipped because the required disposable databases/provider credentials
  are not configured locally. Typecheck, lint, production build, Python
  compilation, backend lint and OpenAPI export passed. Frontend lint retains
  five existing navigation warnings outside the changed homepage.
- `python3 scripts/verify_workspace_scope.py`: passed; 90 protected files,
  17 retained features and both customer entry points remain intact.
- The focused homepage regressions passed: 27 tests across two files,
  including news loading/failure/retry, following isolation and date precision.
- Visual fixture checks at 1790, 1280, 1024, 768, 680, 390 and 320 pixels found
  no horizontal overflow or browser runtime errors. These fixtures are confined
  to tests and do not populate the product.
- The final browser suite includes `home-dashboard.spec.ts` alongside the
  repository's existing signed-in/public/authentication suites, on desktop and
  mobile. The unchanged real PostgreSQL CI job remains a release gate.

Run the verifier with `TZ=UTC`: an existing PGlite SQL test compares the date
prefix of a timezone-dependent JSON timestamp. No application or assertion was
changed to bypass that test. The local PostgreSQL executable refuses this
environment's root account; database-backed CI results are reported separately.

The pull request and accompanying implementation TXT record the final browser,
CI and deployment results and the exact released commit. No production data
changes or new credentials are required.

## Rollback

Revert the homepage commit or redeploy its parent. There are no data migrations
or persisted user changes to reverse.
