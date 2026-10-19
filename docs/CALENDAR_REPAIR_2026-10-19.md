# Official calendar ingestion

Issue 7: `calendar_items` is empty and no scheduled job collects confirmed dates.
The old origin constraint also requires an AI event and document chunk for every
official date, so an issuer IR announcement cannot be stored independently.

## Implementation

- A dedicated collector reads allowlisted Microsoft and Samsung Electronics IR
  pages every six hours. The first reads on 2026-10-19 extracted six Microsoft
  dates and two Samsung dates, including recent history (90 days).
- Microsoft uses the issuer's structured `eventsData` identities, local date and
  named timezone. Samsung uses explicit title/date pairs in Upcoming Events.
  Neither adapter predicts a future reporting date. Coverage is currently these
  two issuers; Apple returned HTTP 403 and no Apple dates were inserted or seeded.
- Raw UTF-8 response bytes are hashed and archived without overwriting in the
  existing private `signalbrief-raw` bucket. Private immutable snapshots retain
  the source URL through the source registry, hash, archive path, normalized
  evidence and fetch time. `verified_at` records a successful refresh per item.
- Stable source/company/event identities deduplicate repeated collections and
  preserve calendar IDs when dates change. Old snapshots remain available.
  Disappeared future dates are withdrawn only after a successful complete parse.
  Fetch errors and format changes preserve existing dates and record an error.
- Read access permits validated official snapshots as well as the existing
  published-event path. Original RLS ownership and MFA policies are preserved.
  Collection RPCs are executable only by `service_role`; raw tables have RLS and
  no grants to ordinary users. Each scheduled request uses a random, hashed,
  short-lived, single-use task token. The Edge Function checks it before fetching.
- The API applies membership and requested date boundaries before its 500-item
  limit, excludes withdrawn entries and preserves the official source URL.
  Existing desktop/mobile calendar components can display these records and
  link to their source without a frontend deployment. ICS subscription filtering
  includes confirmed IR dates for watched/held companies.

## Validation and release status

The ten Deno parser/network regressions pass. They cover leap dates, rollover,
ambiguous dates, timezone handling, duplicates/conflicts, changed source markup,
archive boundaries, unapproved URLs, HTTP failures and oversized responses.
The migration was replayed on disposable local PostgreSQL. The regression passes
for idempotent collection, invalid dates/quotes/timezones, corrections, retained
snapshots, withdrawal, authenticated read access, privileged RPC denial, private
snapshot denial and task replay rejection. Both Edge Function entrypoints pass
Deno type checking. Live official source HTML was parsed successfully locally.
The API transport regression also passes against the actual handler and query
builder, verifying source links, date validation, membership before LIMIT and
authentication rejection. CI includes both Deno tests and a dedicated disposable
PostgreSQL database for the calendar migration regression.

The full repository verification command passed Python compilation, the OpenAPI
export, backend lint and 251 backend tests (104 skips, including suites requiring
other disposable DB configurations). Frontend lint/types/unit/build were BLOCKED
because this checkout has no installed frontend dependencies. It returned exit 1;
this is not a complete release gate pass. The calendar PostgreSQL regression was
run separately and passed with its disposable DB configured.

Production deployment was explicitly approved by the user and completed on
2026-10-19. `signalbrief-calendar` v1 and `signalbrief-api` v14 are active at the
existing SignalBrief Supabase project. Two real Edge refreshes (request IDs 865,
866) each confirmed six Microsoft and two Samsung dates. The canonical table
holds eight stable IDs after the second refresh; raw snapshots retain both
responses. The six-hour cron is active. Unauthenticated API requests and missing
or invalid collector tokens return 401; GET on the collector returns 405.

The authenticated production desktop calendar displayed the October 28 Microsoft
earnings call in the watchlist scope, and its details linked to the official IR
page. An empty portfolio scope remains valid for an account without applicable
holdings. This change preserves the existing membership rules: official dates
appear for watched/held companies. No real user's holdings, watchlist, saved dates
or subscription were modified for testing. Exhaustive desktop/mobile E2E and the
next automatic cron firing remain unverified.

The saved-date RPC was also updated to recognize verified IR snapshots while
retaining membership restrictions and rejecting withdrawn dates. The disposable
PostgreSQL regression additionally verifies saved-date eligibility and private
subscription inclusion/removal. Security advisors show unchanged WARN counts;
the three new private tables have an expected RLS-with-no-policy INFO finding
(default denial, with all ordinary grants revoked).

## Approved deployment order

1. Apply `20261019070909_official_calendar_ingestion.sql` to the SignalBrief
   Supabase project. This adds the collector infrastructure without starting cron.
2. Deploy `supabase/functions/signalbrief-calendar/{index.ts,core.ts,deno.json}`.
   Set `verify_jwt=false`: authentication is the database-backed one-time task
   token, not a public JWT. Never remove that token validation.
3. Deploy `supabase/functions/signalbrief-api/{index.ts,deno.json}`, preserving its
   current JWT setting and its own verified bearer-token handling.
4. Invoke `select app_private.enqueue_calendar();`. Inspect `calendar_runs`,
   `calendar_sources`, HTTP status and `calendar_items`. Run again to confirm
   stable IDs and counts. Check logged-out/invalid requests fail without writes.
5. Apply `20261019071743_official_calendar_schedule.sql`: runs at 00:17, 06:17,
   12:17, 18:17 UTC (09:17, 15:17, 21:17, 03:17 Asia/Seoul).
   Apply `20261019073620_official_calendar_reminders.sql` so the existing saved-date
   RPC also accepts confirmed IR dates for watched/held companies.
6. Sign in with an existing authorized test account, watch MSFT/005930, open
   October 2026 and verify source links and October 28/29 dates on desktop/mobile.
   Verify another month, personal dates, weekly view, export and subscription.
   Never create a production login or alter a real user's watchlist for testing.
7. Run Supabase security advisors and ensure this change adds no new warnings.

## Rollback

Disable `signalbrief-official-calendar` in `cron.job`, set both registry rows
`enabled=false` and restore the previous `signalbrief-api` function bundle if
needed. Confirmed snapshot dates then disappear through RLS. Keep snapshots and
added columns for investigation; no destructive data rollback is necessary.

## Reproduce local tests

```text
deno test supabase/functions/signalbrief-calendar/core_test.ts
deno test --allow-env supabase/functions/signalbrief-api/calendar_test.ts
deno check supabase/functions/signalbrief-calendar/index.ts
deno check supabase/functions/signalbrief-api/index.ts
SB_TEST_CALENDAR_POSTGRES_URL=postgresql://postgres@127.0.0.1:55440/calendar_test pytest tests/test_calendar_ingestion.py -q
python scripts/verify.py --full
```

The PostgreSQL test requires a fresh disposable local database ending `_test`.
