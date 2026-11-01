# Calendar collection and Saved follow-up — 2026-11-01

## Release state

Implementation and verification are in progress. The baseline production release is
`85d3667a1bed15e71a534cf6161686d58419d7f5`; this report does not yet claim that the
follow-up has been deployed. Times below are Korea Standard Time (UTC+9).

## Reproduced production behavior

The signed-in calendar at `https://signalbrief.online/calendar` reported 11
registered companies and only three connected official calendar sources.
Selecting NVIDIA reproduced **0 upcoming and 0 past events**, together with a
source-not-connected notice. All companies returned one upcoming and nine recent
past events; the account's existing followed companies returned one upcoming and
four recent past events. Thus the read path worked for connected sources, while
NVIDIA had no collection path.

NVIDIA's official October 28 announcement and public Q4 event feed both contain
the November 17, 2026 results call. The official announcement states 2 p.m. Pacific
and 5 p.m. Eastern. The application preserves source-stated clock text and its
existing date-only calendar contract; it must not invent an all-day duration or
silently reinterpret the event as a Korean local date.

Official source:
https://investor.nvidia.com/news/press-release-details/2026/NVIDIA-Sets-Conference-Call-for-Third-Quarter-Financial-Results/default.aspx

The Saved screen returned genuinely empty saved sections and showed that history
collection was disabled. The prior release's four-item save/reload check had been
cleaned up to restore that baseline. This follow-up does not characterize those
removed test saves as missing production records.

## Repairs

### Calendar collection

The backend connects NVIDIA's official feed and creates a durable collection
path for supported newly registered issuers. A private source registry binds each
reviewed US feed to the canonical provider identity. Korean listed companies can
use the shared DART IR-notice adapter, which validates the standard disclosure
document and archives the receipt list, main page and event body before publishing.

The migration backfills existing companies and queues future company insertions
and identity updates. A service-only readiness switch keeps outbound work paused
until the new worker is deployed. At most two workers run concurrently, each for
one source, with leases, bounded retries and minute-by-minute queue recovery.
Company activation also requests a refresh after hydration, including cached
hydration, without turning a calendar scheduling failure into a failed company
registration. The exact deployed coverage and live results will be recorded after
acceptance.

Every accepted occurrence must retain its canonical issuer, official source URL,
raw SHA-256, immutable original, retrieval timestamp and normalized evidence
location. A partial collection or archive failure must not erase previously
verified dates. Public material is not sent to a model for inferred event dates.

### Calendar refresh and scope

`apps/web/src/redesign/calendar-data.ts` accepts explicit server pending status.
It polls only a pending collection at ten-second intervals, up to twelve further
reads, and invalidates the month, upcoming and past queries as collection
progresses. Status failures stop automatic polling and leave event reads
independent. Selection/account changes and unmount cancel outstanding work.

`apps/web/src/redesign/calendar.tsx` distinguishes collection in progress from a
confirmed empty range. A visible refresh action rereads status, the three date
ranges and current followed-company membership. It does not itself start arbitrary
provider requests. After the automatic polling limit, the interface offers that
explicit refresh instead of polling indefinitely.

Company checkboxes now reflect the active selected-company scope. Switching to
All or Following no longer leaves a misleading checked company. Explicitly
choosing a company from either scope starts a fresh selected-company set, including
when the choice comes from the official company discovery results. Returning to
Selected retains the user's prior selected set until they make a new choice.

### Saved

`apps/web/src/redesign/saved.tsx` now offers **저장할 자료 찾기** on a successfully
loaded empty archive. It displays a separate set of real public analyses and
documents with canonical detail links and explicit Save buttons. No item is
automatically bookmarked, followed or added to history. Failed reads do not become
an empty archive, and failed writes do not become successful saves.

The company filter derives its choices from the complete bounded owner-scoped
archive instead of the first fifty companies in the global directory. The saved
read cap is 500, matching the save quota; history is bounded to 100. Saved calendar
rows retrieve their related company through the existing authenticated relation
and validate that the returned company ID matches the occurrence. This also fixes
name/ticker filtering for an issuer represented only by a saved calendar item.

Account changes reset personal filter state. The existing official-calendar
follow/holding prerequisite and history consent remain in force.

The new first-save browser test exposed a separate mobile defect: an absolutely
positioned accessible table header escaped its scroll wrapper and widened the page
by 322 pixels. Adding `position: relative` to the existing Saved-only table scroll
wrapper fixes the containing block while retaining the horizontally scrollable
table and its save-cancel controls.

## Verification

The full local release verifier completed at 2026-11-01 19:34:23 KST. All eight
stages passed: 620 backend tests with zero skips, 1,143 frontend tests in 97 files,
Python compilation, OpenAPI export, Ruff, frontend ESLint, TypeScript and the
production build. ESLint reported zero errors and five existing warnings.
The separate workspace scope guard and all six Deno entrypoints also passed.

Focused evidence includes:

- Calendar status/scope and picker regressions: 31 passed.
- Saved focused unit regressions: 36 passed.
- Saved desktop/mobile first-save workflow: 2 passed, including save, reload,
  company/ticker filter, reset and explicit removal; no incidental user-data writes.
- Calendar desktop/mobile pending, completion, scope and manual-refresh workflows:
  4 passed, including the automatic polling limit and no incidental user-data writes.
- DART parser and discovery POST scheduling regressions: 79 passed.
- Independent DART ingestion/visibility regressions on actual PostgreSQL:
  31 passed with zero skips.
- Onboarding, queue, Q4 and DART PostgreSQL regressions: 18 passed.
- Calendar worker, Q4, DART and discovery Edge unit regressions: 133 passed.
- Changed calendar and Saved TypeScript/ESLint checks passed.

The complete desktop/mobile browser selection passed: **90 of 90** cases, with
45 desktop and 45 mobile cases. After the migration filename was aligned to the
actual deployment ledger, all four calendar PostgreSQL suites passed again:
**76 tests, zero skips**. The SQL SHA-256 stayed unchanged. Exact-commit CI and
actual-account production acceptance remain to be recorded.

## Interpretation

An unsupported source, a failed collection, a pending collection, a checked source
with no announced event, and an empty personal Saved archive are different states.
The implementation must expose those differences and must not fill any of them
with guessed dates or fabricated saved content. A successful test run is evidence
for the tested paths, not a guarantee that every issuer has announced events or
that the entire product has no bugs.
