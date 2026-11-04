# Home upcoming events — 2026-11-04

## Problem and observed cause

The homepage's upcoming-events panel returned an empty result although Calendar
contained confirmed future events. Read-only production diagnostics found 17
registered companies, three followed memberships, and 12 confirmed official
events from November 4 through December 4. None of those events belonged to a
followed company. The old Home query and client filter both restricted results
to the watchlist; Calendar defaults to all companies.

## Correction

- Default only the upcoming-events panel to all companies, matching Calendar's
  company scope. Keep its explicit next-30-day window and date-only presentation.
- Provide an explicit All companies / Followed companies control. The following
  scope remains constrained by the successfully loaded watchlist, including an
  empty watchlist or an overbroad response.
- Keep private personal events excluded. Reuse the existing RLS-protected
  `useCalendarData()` query and canonical calendar-occurrence links unchanged.
- Let all-company dates load even if the separate watchlist request fails.
- Resolve company names from the existing catalog, with a watchlist fallback.
- Add a refresh control and an All companies recovery action for a followed
  scope with no events. The followed-company updates panel remains unchanged.

No schema, RLS, authentication, provider, collection job, API endpoint or stored
user data is changed. Calendar's longer future horizon and collection polling
remain on Calendar; this fix addresses the confirmed scope mismatch.

## Validation and release

Regressions cover the observed case (no followed-company dates, available dates
for another registered company), explicit following isolation, empty/error
watchlists, personal and out-of-window exclusions, refresh, canonical links and
mobile layout. Run the repository full verifier with `TZ=UTC`, browser tests,
scope protection and the existing PostgreSQL CI gate. Final results and the
released commit are recorded in the pull request.

## Rollback

Revert this frontend fix or redeploy the preceding frontend release. There are
no database writes or migrations to undo.
