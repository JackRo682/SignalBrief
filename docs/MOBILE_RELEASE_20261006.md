# SignalBrief authenticated mobile release — 2026-10-06

## Release status

The mobile work continues from `82e86ca` on the existing GitHub project. The reviewed
migration is applied, full repository release checks pass at the recorded `bd16c6a`
snapshot, and all eight new mobile browser journeys pass. Two existing performance
journeys still require the CI rerun described below. This snapshot does not claim a
completed production web deployment.

[PR #10](https://github.com/JackRo682/SignalBrief/pull/10), its
[checks](https://github.com/JackRo682/SignalBrief/pull/10/checks) and linked deployment
records are the living evidence for the final head, CI outcome and deployed revision.
Use those records for later results rather than treating this document's snapshot as the
final release status.

The ten supplied PNGs are the mobile visual references. The implementation uses live DOM,
interactive controls and responsive CSS. Financial rows, dates, prices, balances, source
quotes and identities come from authenticated APIs or licensed providers; the sample
financial content in the reference images is not inserted into the production database.

## Pages and navigation

`ResponsiveScreen` mounts the mobile view at widths up to 767 px, and the existing desktop
view at wider widths. Only the visible view mounts, avoiding duplicate requests and
mutations from hidden desktop/mobile copies. The shared mobile shell handles login and
onboarding gates, account navigation, bottom navigation and compact company/event headers.
The event view uses the reference's compact header without a bottom navigation bar.

| Mobile area | Routes | Implemented behavior |
|---|---|---|
| Onboarding | `/onboarding` | Three steps for company selection, optional actual holdings and preferences; preserves existing selections and costs; validated completion and empty skip route to Today |
| Today / home | `/today` | Authenticated published feed, relevant company/source/detail links, account overview counts, filters and quick links to timeline, calendar, saved items and help |
| Explore / search | `/explore`, `/search` | Supported companies and actual source types; query, type, market, period and pagination controls; company/event/document destinations; persisted opt-in recent searches |
| Company overview | `/companies/[id]` | Company identity, provider prices/history when available, sourced facts, published changes, related documents, watch toggle, exact holding edit and timeline link |
| Event detail | `/events/[id]` | Persisted event detail, changes, interpretation, relevance, uncertainty, monitoring points, exact sources, bookmark toggle, evidence panel and real follow-up answer API |
| Watchlist | `/watchlist` | Separate mobile company list, live membership changes and company navigation |
| Portfolio | `/portfolio` | Separate holdings view, add/edit/remove dialogs, currency-aware presentation and provider-backed valuation where inputs exist |
| Timeline | `/timeline`, `/companies/[id]/timeline` | Supported-company search, canonical company route selection, period/type filtering, event navigation and source links |
| Questions | `/questions?event=…` | Actual event context, evidence-bound follow-ups, restored saved conversations, history selection and confirmed history deletion |
| Calendar | `/calendar` | Existing authenticated schedule data, selectable dates/events and underlying calendar actions |
| Saved / history | `/saved` | Persisted event/document bookmarks and opt-in visits; company/type/period filters, saved-item removal and exact item destinations |
| Alert center | `/alerts` | Existing authenticated notifications, event/company destinations and read-state actions |
| Settings | `/settings` and subroutes | Mobile settings overview linked to existing account, security, notification and appearance functions |
| Help / source detail | `/help`, `/documents/[id]` | Existing authored FAQ, private support requests and exact document details within the mobile shell |

The existing public marketing, login, signup, recovery and desktop screens remain in the
project. The routes use the existing authenticated API and visibility rules; no replacement
authentication service or new vendor account was introduced.

## Persistence and correctness changes

Event bookmarks now read and update the actual saved state. A failed mutation does not
report success. `?panel=evidence` opens the quoted evidence, and each document points to
its exact document detail. Full quotes remain intact. Direct document and event visits
respect opt-in history; the database checks the current preference again.

Desktop company holding edits now load the current portfolio before enabling Save.
Quantity, average cost and currency are prefilled, including exact expansion of
scientific-notation decimal strings without converting the amounts through JavaScript
`Number`. A failed prefill blocks overwrite. The existing currency is retained unless the
user changes it. Desktop setup companies are actual company links, and desktop event
detail also has persistent bookmarks and document/evidence links.

Mobile event/question state is keyed to the selected event. Timeline company and period
state is also scoped to the selected route/window. A late request from a previous event or
company cannot populate the current view. Timeline date filtering preserves source
publication precision, and source financial values remain strings.

Question history is rendered from persisted row IDs. Selecting a history entry navigates
to `/questions?event=…&question=…`, restores that event's conversation and highlights the
selected row. A newly returned answer is shown while history refreshes and is reconciled
when its persisted row arrives; refresh does not duplicate it. Separate repeated questions
are retained as separate rows. Successfully deleted history stays removed from the current
view even if the subsequent refresh fails. The server returns at most the latest 100
questions; the interface states this boundary when that limit is reached.

## Additive API and database changes

`POST /api/workspace` retains verified bearer authentication, strict payload validation,
bounded request bodies, same-origin browser checks and private no-store responses. The
new operations use the existing public project key and the caller's JWT; they do not use
service-role credentials.

| Workspace action | Payload | Database operation |
|---|---|---|
| `search_delete` | `{query: string}`; trimmed length 1–100 | `sb_workspace_searches`: deletes only the caller's exact search term |
| `searches_clear` | `{}` | `sb_workspace_searches`: deletes only the caller's search list |
| `onboarding_complete` | `{company_ids, removed_company_ids, positions, analytics_consent?}` | `sb_mobile_onboarding`: atomic explicit watchlist deltas and holding upserts, then completed profile |

Search-list deletion does not remove browsing history or bookmarks. Existing deliberate
combined history deletion remains available under `history_clear` and is labelled as
deleting both visits and searches.

Onboarding accepts at most 10 added company IDs, 50 explicitly removed original IDs and
10 explicit holding drafts. All three arrays are required; empty arrays complete onboarding
without replacing any lists. Duplicates, conflicting IDs, unsupported/demo companies,
unknown fields and invalid decimals/currencies are rejected. Quantity is positive; quantity
and optional average cost use up to 20 integer and 8 fractional digits. Average cost may be
null. Omitted analytics consent preserves its prior value.

The SQL function verifies `auth.uid()` against Auth, enforces MFA, initializes the profile,
applies the existing rate limit and locks the caller's user row. Watchlist operations affect
only explicit additions/removals. The existing `sb_user_action('positions', …)` upserts only
explicit drafts, preserving unrelated holdings. A failure at any point rolls back the
whole RPC, including earlier watchlist writes. No paid provider or AI operation is called.

An empty mobile skip (all three arrays empty and analytics consent omitted) also preserves
the existing alert configuration. The legacy onboarding trigger normally creates a default
alert on first completion; the mobile RPC sets a transaction-local marker scoped to the
current user only around the skip update and then restores the previous setting. The
trigger checks that marker without changing its security mode, owner or search path.
Normal completion, including an explicit consent value with no stocks, retains the legacy
default-alert behavior. Repeated completion does not recreate an alert a user removed.
The completed profile is returned directly from the update without rerunning initialization.

The reviewed migration was applied after the existing hosted/reference/US/workspace
migrations:

`supabase/workspace-migrations/20261006091139_mobile_search_history.sql`

Its filename was generated with Supabase CLI 2.119.0. It adds the two scoped functions,
their explicit authenticated execution grants, the bounded skip condition in the existing
`app_private.sb_default_alert` trigger function and a schema reload notification. Anonymous
execution of the new RPCs is revoked; existing tables and policies are not replaced, and the
onboarding trigger remains installed and enabled. Successful disposable PostgreSQL replay
and review preceded application as ledger `20261006095100_mobile_search_history`.
Read-only catalog checks confirmed security-definer functions with empty search paths,
anonymous execution denied and authenticated execution granted. No production fixtures or
real-user mutations were part of verification.

## Data and provider boundaries

SEC filing discovery and the reviewed US excerpt-analysis pipeline remain separate from
the legacy `events`/`briefs` pipeline, as documented in
[US_PROVIDER_RELEASE.md](US_PROVIDER_RELEASE.md). A collected SEC filing does not by itself
create a published legacy event. Today, company changes, timeline, event questions and
notifications can therefore be empty even when source filings are available. These states
are shown explicitly; this UI release does not publish synthetic events or bypass review.

Prices and charts require the existing configured provider and display entitlement.
Missing quotes, prices, cost basis or FX inputs are not inferred. Mixed-currency holdings
are not combined into an unsupported single-currency total. The quote adapter's three-year
request currently returns up to one year of daily history; the timeline price-chart caption
states this when the three-year event period is selected. No unprovided sentiment,
popularity rank, sector classification, performance history or projected return is invented.

Follow-up answers use the existing evidence search API and retain answered, abstained,
unavailable and policy-blocked states. This release does not activate unrestricted
generative financial advice, new model budgets, market licenses, automatic broker import,
scheduled ingestion, investment email delivery or background push.

## Verification evidence

| Check | Observed result | Boundary |
|---|---|---|
| Full repository release checks | **Passed** at `bd16c6a`; **294 web unit tests passed** | The browser gate is separate; see [PR checks](https://github.com/JackRo682/SignalBrief/pull/10/checks) for the final head |
| Desktop/mobile browser suite | **66 passed, 2 failed, 8 skipped** | [Run 37447539525](https://github.com/JackRo682/SignalBrief/actions/runs/37447539525); all **8 new mobile journeys passed** |
| Remaining browser failures | Two performance journeys | Next's development status badge intercepted clicks on the mobile Home tab; the next CI run is pending |
| Workspace PostgreSQL replay | **25 passed**, zero failures/skips; workspace Ruff passed | [Run 37444961579, job 112207454995](https://github.com/JackRo682/SignalBrief/actions/runs/37444961579/job/112207454995); PostgreSQL 17, tested migration unchanged |
| Remote migration | **Applied successfully** | Ledger `20261006095100_mobile_search_history`; scoped grants and function security verified |
| Production web deployment | No completed deployment recorded in this snapshot | Final evidence belongs to [PR #10's linked deployment records](https://github.com/JackRo682/SignalBrief/pull/10) |

The prepared `next.config.ts` correction disables only the development status badge when
`CI=true` outside production. Compile/runtime error overlays remain enabled. The two
performance journeys need a passing rerun; this document does not infer that result from
the configuration change.

The SQL suite covers search-only deletion, visits/bookmarks preservation, ownership,
anonymous denial and MFA. Onboarding coverage includes exact decimals, empty skip,
idempotency, malformed input, interleaved unrelated account edits and rollback after a late
holding failure. Alert cases verify skipped completion, normal legacy/mobile defaults,
restored transaction scope and preservation of existing or deliberately removed alerts.
The original failing empty-skip assertion was retained. These are transaction replay tests,
not a simultaneous-connection concurrency claim.

The applied migration matches the replayed source, SHA-256
`3188438d8c2c6b52aa8a4b9e9996147758f47f0997f08f29ef0e2e14722809b3`.
The job reported one existing Starlette/AnyIO deprecation warning. SQL fixtures require
`SB_TEST_WORKSPACE_POSTGRES_URL` to reference a loopback disposable database ending in
`_test`; browser, unit and SQL fixtures never target production accounts or providers.

## Release and rollback notes

Complete the corrected browser gate and verify the deployed revision and public/authentication
HTTP behavior. The reviewed migration is already applied and must not be reapplied as a new
change. Record final CI and deployment evidence on PR #10. Live OAuth consent, SMTP delivery,
licensed-provider delivery and real-user mutation checks remain separate from isolated tests.

A page rollback should target an MFA-aware prior web revision. The new helper functions
can remain installed while an older frontend runs; do not delete user histories,
preferences, bookmarks, support requests or holdings during rollback. Retain the existing
MFA enforcement and provider entitlement gates.
