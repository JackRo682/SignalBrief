# Unified operations page and notification read state — November 6, 2026

## Requested outcome

Consolidate the information previously split between `/ops` and
`/ops/user-logs` into one continuous administrator page. Keep notification read
status and the customer header bell consistent, and explain how to clear unread
notifications.

The canonical administrator destination is `/ops`. The legacy user-log and
analytics destinations redirect there. The old `?view=data`, `model`, `users`,
and `audit` links point to the corresponding section of the same page. Detailed
document/run pages and specialized research editors remain available for their
existing actions.

## Information on the page

The page combines the existing usage overview, activity filters and pagination,
pipeline metrics, pending review and failure records, citation/duplicate checks,
user feedback, recent original documents, model execution records, limited user
directory, and administrator audit records. In-page links move between sections
without replacing their content with separate overview screens.

The existing Korean-time date filter and refresh action are shared. Activity
filters apply only to the activity table; administrator-traffic inclusion affects
usage records and their aggregates. Current backlogs and the latest document,
user and audit lists retain their own explicitly labeled scope.

Production inspection identified an additive version-2 `sb_reference_ops`
response beyond the repository's original ten-metric response. The new client
also accepts and displays its collection, publication, delivery, and activity
fields. It preserves unknown values, partial-cost qualifications, total versus
displayed counts, and the server's measurement notes. Provider analysis and
collector record identifiers must not be used as legacy event/run identifiers.
This frontend change does not overwrite the deployed database function.

## Notification semantics

The bell indicates persisted unread notifications. Opening the list is not a
read mutation. The notification list provides individual read controls and
`모두 읽음으로 표시` (Mark all as read). The existing all-read operation applies to
all of the authenticated user's stored notifications, including records older
than the most recent 100 displayed items.

The baseline already dispatched a same-window content update event after a
successful read, and the header already listened to it. That event was not previously absent. The relevant gaps are independent
header/list state, lack of cross-tab and focus refresh for the header, and
notification opening with modifier keys bypassing the read operation.

Both active customer headers and the notification list use a shared read-state
hook. Read state is acknowledged only after the existing authenticated operation
succeeds. A failed operation keeps the item unread and presents a retryable
error. Refresh and session changes must not allow an older response to restore
a stale unread badge. Merely opening the bell does not silently acknowledge
unread items.

## Access and data boundaries

The unified page uses the existing administrator shell, bearer API calls, and
administrator RPCs. Server authorization, live-session verification and MFA
remain authoritative. Any access denial hides the combined private content;
an independent temporary source error is shown in that source's section.
Session/identity changes discard previous results.

No database migration, account creation, administrator grant, tracking-consent
change, new external service, or paid resource is introduced. Read-only
production inspection checked the notification handler and operations response
contract without marking the user's notifications as read.

## Verification and release

Baseline: `2ab91e2e3f30357cc38c9230a33631a9c82f8e5a` from
`JackRo682/SignalBrief/main`.

The branch also incorporates the latest main commit
`20ac5b070a1bc0c065b2412617832b467b3dffa2` (Saved navigation release), preserving
that implementation and merging the shared personal-screen test file.

The local full verifier completed at 05:07:21 UTC on November 6. Python
compilation, 1,219 backend tests with zero skips against four disposable
PostgreSQL 17.11 databases, OpenAPI export, Ruff, TypeScript, ESLint and the Next
production build passed. ESLint retained five existing warnings and no errors.
The frontend suite initially passed 2,057 tests and failed one obsolete
administrator navigation-label assertion. The test was updated for canonical
`/ops`, including its login return path and accessible navigation label; all 12
administrator-shell tests then passed. The final full verifier on the published
application source completed all eight stages successfully at 05:17:00 UTC:
1,219 backend tests with zero skips and 2,070 frontend tests in 134 files. The
latest Saved release was included in that final run.

The first CI browser run passed 135 cases, skipped three existing conditional
cases, and failed the delayed-authentication audit bookmark test on both desktop
and mobile. The test awaited the redirect before releasing the authentication
response it deliberately withheld. That setup ordering was corrected while
retaining the final canonical URL, actual audit-heading viewport position and
runtime-error checks. Application source did not change for this correction;
the final exact-source CI result is recorded on the pull request.

Focused tests cover v1/v2 responses, actions, stale responses and identities,
access denials, notification failures and confirmed writes, cross-tab/focus
refresh, and both active customer headers. The unchanged source-scope verifier
passes with 106 protected sources, 17 retained implementations and two verified
entry points; the manifest records the user-authorized source hashes.

Local Chromium could not start because the environment rejected its process
socket operation. The single escalation attempt was rejected automatically, so
browser assertions and visual artifacts must come from the existing CI workflow.
The browser suites use isolated fixtures, block unintended external requests,
and cover both desktop and mobile. Synthetic fixture measurements are not live
operational measurements. Signed-in production acceptance is separate: the
available live browser was signed out.

The associated pull request and its Actions checks record the final gate
outcomes; deployment acceptance requires Vercel READY and the public
`/api/release` identifying the merged commit. No production read mutation was
performed on the user's behalf.
