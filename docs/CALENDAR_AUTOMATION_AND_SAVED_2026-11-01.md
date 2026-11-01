# Calendar collection and Saved follow-up — 2026-11-01

## Release state

The final correction source is published as
`1541494637d89b46e2b2c53b15186c0e51f3ec62`, tree
`037126e89ec683718a0127bd181414a0f3d757f5`. All four required exact-source CI
workflows completed successfully, and main was promoted from `a28ca633` to this
commit. Vercel deployment `dpl_FxrMLugDeAVgk9s2rS5onQLt8Sd5` is **READY**, targets
production, and serves **https://signalbrief.online**. Its metadata matches this
commit and main. An independent public GET of
https://signalbrief.online/api/release returned HTTP200 and the exact
`1541494637d89b46e2b2c53b15186c0e51f3ec62` / `main` identity. Runtime promotion is
complete. The preceding web release was `a28ca633990b2e6dcd3dbeb54b7080e0566ecdeb`;
the earlier reproduction baseline below was
`85d3667a1bed15e71a534cf6161686d58419d7f5`.

The subsequent DART correction repair is active in **calendar Edge v4**, alongside
**discovery Edge v6**. Migrations `20261101103903` (source onboarding) and
`20261101111341` (correction lineage) are applied, and the collection worker is
enabled. Actual Kakao and SK hynix correction collection has succeeded. Readiness
and the production migration ledger have been verified. The queue checkpoint has
seven idle sources and one failed source: Samsung, `no_confirmed_dates`, attempt3.
That bounded source limitation is retained below; not every source is reported
healthy.

Final correction-phase local verification passed all eight stages: **660 backend
tests, zero skips; 1,162 frontend tests in 97 files**. A fresh LG Electronics
registration and its automatic collection acceptance also passed, and temporary
Saved/follow test data has been removed. Production collection times below are
stated in UTC. The local full-gate artifact records completion at
**2026-11-01 11:11:46.142039 UTC**. This report's final publication will be a
documentation-only child of the source commit; a report commit is not represented
as the deployed runtime commit.

## Reproduced production behavior

On the earlier baseline, the signed-in calendar at
`https://signalbrief.online/calendar` reported 11
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
registration. Verified deployed results and remaining source boundaries are
recorded separately below.

Every accepted occurrence must retain its canonical issuer, official source URL,
raw SHA-256, immutable original, retrieval timestamp and normalized evidence
location. A partial collection or archive failure must not erase previously
verified dates. Public material is not sent to a model for inferred event dates.

### DART corrections: the failure found during real registration

Registering Kakao through the live calendar picker correctly created its canonical
DART identity and queued `dart-ir-00258801`, but the first collector rejected the
company's corrected IR notice as `ambiguous_correction`. SK hynix encountered the
same restriction. This was a real supported-source compatibility failure, not a
reason to fabricate dates or silently skip a correction.

`supabase/functions/signalbrief-calendar/dart-ir.ts` now uses the v2 correction
manifest. Each official main page must corroborate the same family through its
explicit `#family` receipt list and literal `alertInvestNotice` current receipt,
document number, root receipt and correction flag. Every member's corporation,
receipt, main page and full body are checked and archived. The newest member must
be present in the complete receipt-window scan; an explicitly linked older root
may predate that window. A family is bounded to eight documents, all collection
work to forty documents, four MB and the existing thirty-second deadline.

The parser reads the complete replacement schedule below the correction table.
It does not select an old date from a before/after comparison. The event key stays
the original receipt; the latest corrected receipt, URL and body SHA are separate
provenance. The database updates that same calendar row in place, preserving its
ID and saved references. A corrected date outside the current display window is
still updated, so an obsolete original date cannot remain visible by omission.

The additive migration
`supabase/migrations/20261101111341_calendar_dart_correction_lineage.sql` preserves
v1 evidence, permits an unchanged singleton upgrade, and rejects stale revisions,
inconsistent or forked families, and contradictory evidence for the same selected
receipt. A v1 refresh cannot downgrade an accepted v2 correction. Missing linked
documents, failed archives, unknown correction forms, and unsupported withdrawals
remain closed. Acceptance requires explicit evidence; the source safeguards were
not generally relaxed.

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

| Gate | Verified result | Scope |
|---|---|---|
| Final local full verifier | All eight stages PASS; backend 660, zero skips; frontend 1,162 in 97 files | Includes the correction repair; compilation, OpenAPI export, Ruff, ESLint, TypeScript and production build passed |
| Correction parser | 58 tests PASS; TypeScript, ESLint and Deno check PASS | Synthetic regressions plus a separate replay of actual public Kakao/SK original bytes |
| Independent correction SQL | 40 tests PASS | Real disposable PostgreSQL; stable IDs, source identity, archives, stale/forked/conflicting denial |
| Combined calendar PostgreSQL after migration filename alignment | 116 tests PASS | Ledger-matching migration paths; no change to the applied SQL bytes |
| Exact `a28ca633` CI and browser selection | PASS; 90/90 browser cases, 45 desktop and 45 mobile | Deployed web follow-up, before the later correction-source commit |
| Exact `15414946` source CI and main promotion | PASS; all four required workflows terminal SUCCESS | Includes a new 90/90 browser run and 116-test calendar PostgreSQL job |
| Vercel deployment for `15414946` | READY / production PASS | Production alias, metadata SHA/main and HTTP200 `/api/release` exact SHA/main independently verified |

Exact final-source CI evidence:

| Workflow | Run / job | Terminal result |
|---|---|---|
| Verification | [41302244390](https://github.com/JackRo682/SignalBrief/actions/runs/41302244390), web job [124835444392](https://github.com/JackRo682/SignalBrief/actions/runs/41302244390/job/124835444392) | SUCCESS; 90 browser cases passed in 4.9m; browser log timestamp 11:41:02.6922501 UTC, workflow completed 11:41:11 UTC |
| Calendar | [41302244275](https://github.com/JackRo682/SignalBrief/actions/runs/41302244275), job [124835443991](https://github.com/JackRo682/SignalBrief/actions/runs/41302244275/job/124835443991) | SUCCESS; 116 passed, two warnings, 10.70s; log timestamp 11:32:09 UTC |
| Collector | [41302244250](https://github.com/JackRo682/SignalBrief/actions/runs/41302244250) | SUCCESS |
| Financial | [41302244287](https://github.com/JackRo682/SignalBrief/actions/runs/41302244287) | SUCCESS |

The branch Production health run
[41302276659](https://github.com/JackRo682/SignalBrief/actions/runs/41302276659)
was skipped as expected. That skip is not counted as a successful required check.

Earlier in this follow-up, the pre-correction full local gate passed 620 backend
tests with zero skips and 1,143 frontend tests in 97 files; its six Deno entrypoints
and scope guard also passed. The Saved focused regressions passed 36 tests, and
the first-save browser workflow passed on desktop and mobile, including persistence,
reload, filters, removal, mobile width and no incidental writes. Four targeted
calendar browser cases covered pending/completion, scope and manual refresh. These
overlapping focused counts are not added to the full-suite totals.

## Actual production acceptance

### Calendar

| Checked scope/source | Observed result | Evidence boundary |
|---|---|---|
| NVIDIA, Selected | 1 upcoming and 3 past events | Live calendar and official future call verified |
| All companies | 3 upcoming and 20 past | Snapshot before the Korean correction ingestion; not a claimed final global count |
| All companies, final post-correction UI | 4 upcoming and 27 past | Actual signed-in view; 13 registered / 10 connected companies |
| Following | 2 upcoming and 7 past | Temporary acceptance-test follow membership; not the account's permanent scope |
| LS / DART `00105952` | Successful source check, 0 events | No invented event; no verified recent qualifying IR notice |
| Kakao / DART `00258801` | Successful at approximately 11:15 UTC; final Selected UI shows 1 upcoming / 5 past | Original `20261008800604` and latest correction `20261016800407` are one Oct13 event; independent `20261014800334` supplies Nov5, also verified in the month grid |
| SK hynix / DART `00164779` | Successful at 11:14:56 UTC; 1 past event on Oct28 | Stable root `20261014800385`, latest correction `20261028800052` |
| Fresh LG Electronics / DART `00401731`, ticker `066570` | PASS; first attempt succeeded at 11:27:25.340421 UTC; 0 upcoming and 1 past | Registered through the actual calendar official picker, with no per-company source/admin setup or manual refresh/service call; the open screen changed from collecting to the completed result automatically |

The fresh LG Electronics row is canonical company
`6730b557-eaa6-4475-aa98-f1e26b43fd8e`, market KOSPI. Its confirmed past occurrence
is Oct28, **LG전자 · 2026년 3분기 경영실적 발표**. The durable source
`dart-ir-00401731` ended idle after one attempt, with no error and one visible
event. Its receipt is `20261007800158`. Current observed coverage is
**13 registered companies / 10 connected**. The captured LG screenshot shows the
Oct28 grid entry, 0 upcoming / 1 past, and the official last-check time of
20:27 Asia/Seoul; the corresponding database timestamp is 11:27 UTC above.

A separate read-only production check confirmed that all current Kakao6 + SK1 +
LG1 v2 events have their archived manifest and every referenced main/viewer
original present. The verified manifest SHA-256 values are:

| Source | Archived manifest SHA-256 |
|---|---|
| Kakao | `ec61f3c08d8926ff20c1b0e64a5479b0314c39bba7cfa7cfae88cd0d436c185b` |
| SK hynix | `883e7cc09a3ed8e60da1555af7f3ff0122530c80a13288f382fa26cb584a5019` |
| LG Electronics | `fec6850425ca015a07baf9d0b6e9e1d5713e90283efd2b8afe5d3ea4fcf060d9` |

Kakao's corrected disclosure also describes a second meeting in narrative text.
The current standard-table adapter does not turn that paragraph into an additional
structured calendar occurrence. DART dates remain date-only when the original
does not explicitly state a timezone; clock text in the quotation is not an
invented all-day event or a timezone-converted instant.

Official correction sources:

- Kakao original: https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20261008800604
- Kakao correction: https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20261016800407
- Kakao independent upcoming notice: https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20261014800334
- SK hynix original: https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20261014800385
- SK hynix correction: https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20261028800052

### Saved

The actual signed-in account explicitly saved **one Hyundai analysis, one Samsung
document and one NVIDIA calendar item**. A reload retained all three. Selecting
NVIDIA alone and then searching `nvda` retained the calendar item; resetting the
filters restored all three. All three acceptance-test saves were then explicitly
removed. History remained **OFF** throughout. This verifies both real persistence
and calendar-only company/ticker filtering; it does not claim that an initially
empty account already owned saved items. The temporary NVIDIA follow was also
removed: its company button returned to **팔로우**, and the original Following
scope was restored to **1 upcoming / 4 past**.

After cleanup, the actual empty Saved archive displayed **three real public
analyses and three real public documents** in the separate discovery panel. These
are suggestions with explicit Save actions, not pre-populated personal bookmarks.
The final empty-archive screenshot records that usable first-save state.

Screenshots captured by the production acceptance run:

| File | SHA-256 |
|---|---|
| [calendar-nvidia-live.jpg](verification/2026-11-01/calendar-nvidia-live.jpg) | `0a75d4084fb6f26de2fb352642bf3c0f62cc4955d4212c63a9957a411839f820` |
| [saved-persisted-live.jpg](verification/2026-11-01/saved-persisted-live.jpg) | `91fbbc980fc83c289b272fce0881d0511a05605cee74ea0ab68ddcbc2bd02ecf` |
| [calendar-lg-automatic-live.jpg](verification/2026-11-01/calendar-lg-automatic-live.jpg) | `f2e27d87ac5f9ea90ea5c56f956895e3d030b775e270955865cae0f272a3d60e` |
| [saved-empty-discovery-live.jpg](verification/2026-11-01/saved-empty-discovery-live.jpg) | `0167cef69d103afb956f7eccace4df4fb58d7f16bc02f00c314a4ac60c41e0bd` |

## Source coverage and operational limitations

Reviewed US feeds are Microsoft, Micron and NVIDIA. **Apple, Tesla and SNDK do not
have configured calendar feeds** in this release; their uncovered state is explicit.
Issuer search and successful profile/disclosure collection do not imply calendar
feed coverage. Korean canonical DART issuers use the shared validated IR-notice
path, subject to its complete-list, template and correction-evidence bounds.

Samsung's configured HTML source still reports `no_confirmed_dates` and preserves
its two prior verified events. A bounded read of the actual official response
confirmed a closed, empty November2026 upcoming list; its apparent sample event
rows were comments, and its schedule script only filters existing DOM rows. The
page still lists Oct29 and Oct8 in Past Events. This is not proof that every future
event is absent: there is no explicit all-future completeness statement. Returning
success with zero rows would currently permit blanket withdrawal of missing future
Samsung rows, so that condition was not weakened.

Samsung public-source check: HTTP200, 412,509 original bytes, SHA-256
`963e29aaf97cf2de5e3130d02353c37bb26f1e67686db6c5c8019ec07d51ff61`, from
https://www.samsung.com/global/ir/ir-events-presentations/events/.

Post-v2 advisor counts match the post-v1 checkpoint; no additional warning count
was introduced. Existing findings remain: security INFO `no-policy`27, WARN
`anon-definer`6 / `auth-definer`32 / `leaked-password`1; performance INFO
`FK`32 / `unused-index`20 and WARN `multiple-permissive`16. This comparison does
not claim a clean security report or resolution of those pre-existing findings.

Relevant remediation references are Supabase's
[database advisor guide](https://supabase.com/docs/guides/database/database-linter)
and [password-strength and leaked-password protection guide](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
They are follow-up references, not a claim that policies, permissions, indexes or
password-protection settings were changed by this release.

The source commit, exact-source CI, main promotion, Vercel READY and production
release response are verified. Fresh-company acceptance and test-data cleanup are
complete. A fresh Calendar navigation after the final production release again
showed All **4 upcoming / 27 past**, then Selected NVIDIA **1 upcoming / 3 past**
and its Nov17 month-grid entry, with coverage **13 registered / 10 connected**.
The NVIDIA screenshot above was replaced with that final-deployment capture. The
final report publication is a documentation-only child of `15414946`; it does not
change the deployed runtime identity.

The release owner also queried error/fatal runtime logs for
`dpl_FxrMLugDeAVgk9s2rS5onQLt8Sd5` over
**2026-11-01 11:27:53.523–11:42:53.523 UTC** and received no matching records.
This is a bounded observation of a newly created deployment, not a claim that no
error can occur or that unrelated deployments and earlier periods were checked.

## Interpretation

An unsupported source, a failed collection, a pending collection, a checked source
with no announced event, and an empty personal Saved archive are different states.
The implementation must expose those differences and must not fill any of them
with guessed dates or fabricated saved content. A successful test run is evidence
for the tested paths, not a guarantee that every issuer has announced events or
that the entire product has no bugs.
