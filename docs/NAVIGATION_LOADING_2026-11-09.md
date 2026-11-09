# Primary-tab loading — November 9, 2026

## Problem and scope

The signed-in Companies, Home, Watchlist, Calendar and Saved tabs repeatedly
waited for data that had already been fetched. The existing Next.js links
prefetched route assets, but did not prefetch the client-side data requests.

Source inspection found three independent causes:

- The shared cache allowed only the `catalog` workspace read. The newer
  `design_directory`, `source_overview`, `design_dashboard`, `saved_list`, and
  notification reads had no retained values or in-flight deduplication.
- Calendar used component-local Supabase reads and cleared the list on every
  mount. Home also waited for the watchlist before starting its following overview,
  although the server resolves following membership itself.
- The notification header and Home independently requested the same collection;
  the shell additionally refreshed it on every navigation.

This change covers customer navigation data. It does not modify the page designs,
the A/B assignment contract, backend authorization, database schema or source
collection jobs.

## Behavior

Successful read results stay in the existing in-memory, token-scoped cache.
Returning to a loaded tab renders its snapshot synchronously. Stale entries
revalidate in the background; request failures still reach the existing error
and retry controls. No personalized response or token is persisted to browser
storage by this cache.

| Read | Freshness window |
| --- | --- |
| Company directory | 60 seconds |
| Source overview, dashboard, catalog, saved content, notifications | 30 seconds |
| Calendar date queries | 60 seconds |
| Calendar coverage | 30 seconds |
| History, settings, security, exports and help requests | Not cached |

The previous five-minute maximum stale-display window remains. An expired
freshness window causes a new read; it does not mean the previous content is
presented as a newly verified response. Different filters, ranges, selected
companies, personal-event visibility and sort order have distinct keys.

The navigation shell prepares likely destinations after initial rendering,
sequentially by route to limit contention. Pointer, keyboard focus and touch
intent also start preparation. Automatic warming is disabled for reduced-data
or 2G connections. It does not write data or read browsing history. The default
assigned Home variant is prepared; a different administrator preview can require
an initial read.

Home starts the watchlist and following overview in parallel. The visible
updates still intersect overview results with the actual watchlist, so an empty
watchlist never exposes the server's all-company fallback as followed content.

Calendar keeps its existing RLS, response validation, date filtering before the
row limit, and explicit truncation reporting. Multiple consumers share a bounded
request. Leaving one screen does not cancel a request another consumer needs.
Confirmed collection progress and explicit refresh force a fresh date read.

## Invalidation and account isolation

Targeted retry invalidates only that request, preserving the other tabs. An
invalidated entry is replaced so an earlier in-flight response cannot overwrite
a later refresh or acknowledged update.

Confirmed saves, history deletion, preference changes and onboarding changes
clear retained customer reads. The existing generic mutation handlers continue
to clear the cache for other writes. Notification reads use their dedicated
confirmed-write handler: it updates the cached read state before broadcasting
the shared refresh, without discarding unrelated tab data.

Logout, authorization failures, MFA requirements and account changes retain the
existing cache reset behavior. The cache's generation and entry identity checks
prevent older responses from repopulating cleared entries. Delayed prefetch
continuations check the current scope before starting dependent reads.

## Verification

Local validation before the release branch was prepared:

- 1,219 backend tests passed with zero skips against disposable local PostgreSQL
  17.6 clusters, including the existing ownership and RLS regressions.
- 2,183 frontend tests passed in 141 files.
- TypeScript and the Next.js production build passed.
- The unchanged workspace scope guard passed for 106 protected files, 17 retained
  implementations and two verified customer entry points.
- The first full verifier run found one callback dependency omitted from
  `useCallback`. The dependency was added and the subsequent full ESLint command
  passed with zero errors and the same five pre-existing navigation warnings.
- The local browser runner could not launch Chromium because its process socket
  was denied by the execution environment. No application assertion ran there;
  the browser release gate must pass on the normal CI runner before production.

New regressions cover synchronous cached rendering, concurrent request sharing,
stale refresh, targeted retry, account changes, late responses, history exclusion,
notification acknowledgement, collector refresh and canonical calendar scopes.
The browser case in `home-ab-layout.spec.ts` prepares the primary tabs, rejects
subsequent content requests, and verifies the actual lists still render. It runs
in both desktop and mobile projects through the existing release-suite selection.

Local checks, exact-commit CI, Vercel deployment readiness and authenticated
production acceptance are separate evidence. Their final statuses belong to the
release PR and `/api/release`; a successful local build alone is not a deployment.

The change removes repeated network waits for prepared reads. It does not promise
zero network latency on a new browser session, a new filter/date range, or a
connection where preparation has not completed. Automation command duration is
not a reliable measurement of user-visible rendering latency.
