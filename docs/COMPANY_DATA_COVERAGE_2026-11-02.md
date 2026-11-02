# Company data, issuer search, and calendar repair — November 2, 2026

## Release status

Implementation and the final local release gate are complete. The server-route
bridge is live; the complete collector/UI release is not yet deployed. The baseline production runtime is
`1541494637d89b46e2b2c53b15186c0e51f3ec62` at https://signalbrief.online.
The source branch is `fix/company-data-coverage-20261102`, based on the
documentation-only child `8df7a9e2815a847248bbcb417f4d976e0ed5c61c`.

The release record below will distinguish synthetic regression tests, actual
official-source replay, and signed-in production acceptance. No synthetic
company, figure, or calendar date is inserted into production.

## Reproduced defects

The signed-in Companies screen returned Visa together with unrelated substring
matches including Televisa and 비상교육. Visa's overview had a basic SEC industry
description but no leadership, formation, products, business segments, or
reported figures. Its Events tab showed no upcoming or historical events.

These were separate data and lifecycle problems, not a single rendering failure:

| Problem | Responsible path | Repair |
|---|---|---|
| Exact company searches mixed in unrelated names | `app_content_private.discovery_search_filtered` and the `design_directory` branch of `app_content_private.redesign` | Shared identity ranking prefers exact tickers, exact names, and whole Latin words before weak substring matches, within the selected market scope. |
| Basic SEC metadata could never populate the richer profile fields | `signalbrief-profiles/core.ts` and the old basic profile response | An additive source-backed enrichment pipeline reads the issuer's annual/latest reports, explicit same-issuer charter links, and reviewed official leadership sources. |
| Korean company descriptions depended on a small curated list | Profile acquisition and DART document transport | The same profile contract now accepts archived periodic OpenDART reports, parsed through the existing authenticated Node relay. |
| Figures depended on older event/fact rows | Company workspace legacy facts join | A separate reported-financials contract collects SEC companyfacts or OpenDART financial statements with exact values, periods, units, filing dates, and source evidence. |
| New company analyses were not scheduled fairly, and excerpts could contain only report covers | Collector selection and analysis source excerpt | Durable per-company requests feed the existing bounded collector; extraction selects supported financial-statement text while retaining full-source offsets. Approval requirements remain enforced. |
| An analysis approved after the initial empty page load remained absent | Company detail request lifecycle | Newly observed approved counts trigger a bounded reload of the approved list. |
| Company news was limited to a fixed ticker dictionary | `apps/web/src/app/api/news/route.ts` | Authenticated canonical company identity supplies a bounded query; the public topic endpoint keeps its existing allowlist. |
| Unlisted SEC issuers had no automatic IR calendar source | Calendar source onboarding and worker | Canonical SEC identity and issuer-filed explicit IR links lead to reusable official event feeds/pages, with persisted issuer and source evidence. |
| Company Events did not update after an in-flight collection | Company detail and `useCalendarCoverage` | Bounded collection polling refreshes the events request when source collection completes. |

## Source and identity rules

Profiles retain original archived bytes, SHA-256, provider/issuer identity,
publication precision, retrieval time, and exact quotations with normalized
text positions. Optional source failures preserve a previously verified profile.
Concurrent collection has a short lease and bounded UI polling.

Formation preserves the source's meaning and precision. A legal incorporation
date is labeled as incorporation; a year-only date stays a year. A filing's
leadership is shown with its filing date, rather than being asserted as a live
executive directory. No executive name or financial number is hardcoded.

DART collection checks the corporation and receipt against the official final
periodic report list. The original ZIP and normalized text are both archived and
hash-bound. Any recovered document markup is explicitly identified to the user
as requiring further structural review. A same-day older receipt cannot replace
a newer accepted report.

Reported numbers preserve the exact source decimal, period, scope, currency/unit,
filing date, and source context. They are not converted with floating point or
presented as a newer period merely because a later disclosure exists. Cached
data must still belong to the company's current provider identity.

Company news accepts a company ID, verifies authorization and canonical identity,
then derives the provider query server-side. Arbitrary client search text is not
forwarded through the company endpoint.

Calendar discovery requires canonical SEC identity and an explicitly filed IR
link. Destination pages must identify the same legal issuer; an acquisition
counterparty's IR page is rejected. Untrusted official-page destinations are
fetched through a bounded, authenticated HTTPS relay which pins the connection
to checked public IP addresses. Redirects, internal addresses, excess bytes, and
expired/replayed authentication are rejected by the relevant transport gates.
Event dates are extracted only when the source states them.

## New-company lifecycle

Registering a company creates durable collection work. The company page can
request the same idempotent financial/profile collection, and subsequent polls
are reads. Calendar onboarding is independent of optional financial collection,
so failure in one provider does not cancel the other path.

The UI distinguishes loading, collection in progress, a provider error with
retry, a source that does not disclose a field, an unpublished calendar, and
analysis awaiting review. It clears stale account/company results and aborts
obsolete requests when the selected identity changes.

The previous Calendar and Saved release remains part of the regression scope.
Saved displays records the user actually bookmarks; this repair does not create
bookmarks or claim an empty personal archive contains missing public data.

## Verification record

### Actual official sources, replayed locally

These results are parser/archival compatibility evidence, not production UI
acceptance:

- Visa profile: annual/latest report, same-issuer charter, and official leadership
  page produced business excerpts, products/services, a reported segment,
  leadership with a checked date, and legal incorporation information.
- Visa calendar: the issuer's official IR source produced five upcoming and two
  historical events at the verification date.
- Tesla calendar: the official source produced one historical event and no
  invented future date.
- Visa companyfacts retained 44 exact reported contexts. Its latest available
  companyfacts period and a later disclosure date remain separate.
- Actual NAVER periodic-report parsing remains pending the deployed authenticated
  acquisition path. Synthetic DART tests do not prove that live source format.

### Release gates

| Gate | Current status |
|---|---|
| Focused issuer-search PostgreSQL | 24 passed, zero skips, including the existing picker suite |
| DART profile PostgreSQL | 44 passed, zero skips |
| Frontend profile/financial lifecycle | 1,474 tests passed in 111 files |
| Desktop/mobile browser suite | 92 passed against isolated, fail-closed synthetic fixtures |
| Full eight-stage verifier and disposable PostgreSQL | All eight stages passed at 01:59:37 UTC; 829 backend tests, zero skips |
| Exact commit CI | Node bridge `07d6f0d8`: all required workflows passed, including 90 browser cases; full release pending publication |
| Production schema/Edge/web deployment | Node bridge READY and public release identity verified; five SQL migrations applied with exact SHA-256 matches; collectors/full UI pending |
| Signed-in live acceptance and screenshots | Full release pending; initial Visa empty-screen reproduction preserved |

The first full run exposed unresolved imports outside the app root. The build
now uses the repository root for bundling and tracing, and the standalone
container paths retain that layout. A repeat run also exposed reuse of the
hosted-schema test database and a wall-clock debounce assertion; a fresh
disposable database and deterministic request/timer synchronization resolved
those verification issues without relaxing product assertions. The final full
run passed compilation, OpenAPI export, Ruff, ESLint, TypeScript, tests and the
production build. ESLint retains five pre-existing warnings.

The migration files are aligned with ledger versions `20261102020437`,
`20261102020442`, `20261102020446`, `20261102020450`, and `20261102020454`.
The five stored SQL hashes exactly match the local files. The affected 169
PostgreSQL cases passed again after the filename alignment, with zero skips.

## Rollout and operational limits

Deploy additive schema and authenticated Node relay capabilities before the new
Edge clients. The new generic SEC calendar worker is gated until its worker
capability is explicitly marked ready. Keep existing operator-disabled sources
disabled. Verify source commit, exact required CI, Vercel READY, production
`/api/release`, and the Supabase migration ledger independently.

Recheck Visa search and overview, Tesla and Visa events in detail and Calendar,
NAVER's actual report, company news, and an issuer outside the curated content
dictionary. A source failure must be investigated rather than relabeled as
successful empty collection. Record both actual successes and remaining source
limitations here before closing the release.

Official sources do not guarantee that every company publishes every field or
announces a future event. An unapproved model analysis remains private review
work. This change does not certify exhaustive issuer coverage, model accuracy,
or a globally bug-free product.
