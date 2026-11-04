# Watchlist reference layout — 2026-11-04

## Scope

The supplied Companies-screen image is implemented on `/watchlist` only. The
page title and active navigation remain `관심 기업`. The Companies route, component,
shared navigation, shared styling, authentication and database schema are unchanged.

The new body uses a compact company list with three information tiles per row,
a search/sort/filter toolbar, and upcoming-date and recent-update side panels.
The sidebar moves below the list on smaller screens; information tiles stack on
mobile. All new CSS selectors are rooted under `.sb-redesign .rd-w-page` so they
cannot restyle Companies after client navigation.

## Existing integrations

| Behavior | Existing production integration |
| --- | --- |
| Personal company membership | `GET /v1/watchlist` |
| Follow / remove | `PUT` / `DELETE /v1/watchlist/:companyId` |
| Registered company search | `GET /v1/companies?q=...&limit=50` |
| Official issuer discovery and activation | Existing `CompanyDiscovery` and `/api/company-discovery` |
| Latest filings, reviewed analyses and counts | `/api/workspace`, `source_overview`, `scope: following`, `days: 0` |
| Company notification preference | Existing versioned `preferences_save` / `muted_companies` |
| Confirmed upcoming dates | Existing `useCalendarData` with the signed-in JWT and calendar RLS |
| Document, analysis and event navigation | Existing `resourceHref` and `calendarHref` |

No provider calls, fake production data, new tables, migrations, API endpoints,
packages, accounts, API keys or paid services are introduced. Existing Supabase
Auth, PostgreSQL, Edge Functions and Vercel settings continue to apply. Relevant
existing web environment variables are `NEXT_PUBLIC_API_URL`,
`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`; retain the already
configured API proxy/Edge Function settings. No service-role key belongs in the
browser. Existing provider collection availability still determines the records
that can be shown.

## Deliberate data semantics

- Every displayed company, monitoring result and date is intersected with the
  authoritative personal watchlist. The overview's empty-watchlist fallback must
  not populate a personal screen with all-company data.
- Calendar reads include followed company IDs before the database limit, request
  confirmed entries, exclude personal reminders, and cover the next 365 days.
  Date-only records retain date precision and link to their actual occurrence.
  The existing 500-record bound is disclosed when the response is truncated.
- `업데이트 순` orders by the newest filing publication or approved-analysis
  review/publication time. A future event and an ingestion retry do not count as
  new content. Name and ID provide stable tiebreakers.
- The sidebar title is `최근 업데이트된 기업`. Its `최신 자료순 · 누적 공시·승인 분석`
  note is intentional: existing monitoring counts are cumulative, even if the
  overview's `days` parameter is changed. Analysis counts include published
  reviewed event records and approved US/DART analyses, following the existing
  application contract. No recent-period count is invented.
- The reference's redundant interest chip becomes `알림 켬` because every row on
  this page is already followed. The date chip says `일정 예정` because confirmed
  company dates include shareholder meetings and other events as well as earnings.
  US/Korean filters use explicit exchange groups; London/Tokyo/Hong Kong are not
  mislabeled as US.
- Notification and removal writes retain confirmed state on failure. Successful
  changes refresh membership, monitoring, calendar and shared content caches.
  Search alone never follows or activates a company.

## Verification

Local checks on the implementation:

- TypeScript: pass.
- ESLint: no errors; five existing navigation warnings outside this change.
- Frontend unit suite with `TZ=UTC`: **1,718 tests / 120 files passed**.
- Focused Watchlist/picker/persistence suite: **50 tests / 4 files passed**.
- Two subsequent review regressions cover pending/failed alias lookup and
  collected content without usable update timestamps; the final dedicated
  component file passed **9/9 tests**.
- Next.js production build: pass.
- New browser scenarios: **6 desktop/mobile cases passed**. They cover the
  reference layout, 320px viewport, real UI filter/sort/search behavior, keyboard
  interaction, mutation failure/persistence, personal scoping, calendar retry,
  empty states, and Companies style preservation after client navigation.
- Existing full research and Watchlist issuer-discovery journeys: **4/4
  desktop/mobile cases passed**, for **10/10 focused browser cases** overall.
- Scope guard: pass; protected public, admin and auth files remain intact.
- The UTC full repository verifier completed all eight stages successfully.
  Local backend: **364 passed, 740
  skipped** because disposable PostgreSQL services are not installed here.
  PostgreSQL checks must be assessed from CI separately; these skips are not
  evidence of a passing PostgreSQL integration run.

The first full local run found an existing `customer-content-sql.test.ts` date
assertion that assumes UTC but ran under the host's `America/Chicago` timezone.
It reproduced in isolation without importing the changed screen. The unchanged
test passed under UTC, and the complete unchanged-assertion suite then passed
under UTC, matching CI. No test expectation or production SQL was weakened.

Browser fixtures are explicitly synthetic and confined to local test transports.
They establish UI behavior, not real provider accuracy or new OAuth-flow coverage.
The existing Companies component and shared CSS are byte-for-byte unchanged; the
browser compares Companies computed styles before and after visiting Watchlist.

Release identity and production acceptance are reported separately after the
deployment becomes ready.
