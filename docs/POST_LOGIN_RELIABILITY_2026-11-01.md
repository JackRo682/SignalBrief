# Post-login reliability repair — November 1, 2026

## Scope and observed baseline

The authenticated production UI and its deployed database were inspected against
repository commit `7e9f0d665bdfca69c2f96a9b45e905a91a1a343a`.

Observed through the connected browser:

- Home initially selected November 1 only and displayed zero matching records.
  Selecting the recent month showed 63 disclosures, 26 approved analyses and
  three confirmed events; the underlying records were present.
- The directory had seven registered companies. `NAVER` and `SK 하이닉스` returned
  no matching registered company; `AAPL` returned Apple.
- Apple detail loaded its profile, disclosures and existing structured figures.
  A universal failure of every company detail page was not reproduced.
- Calendar listed Apple with an empty picker query but returned no result for
  `애플`. The November grid was empty while a confirmed Microsoft event was listed
  for December 8.
- The database had two enabled calendar source adapters, for Microsoft and
  Samsung. Other companies did not have equivalent official schedule collection.
  Samsung's latest source refresh reported `no_confirmed_dates`; previously
  verified records remained available.

These observations distinguish missing source coverage, a legitimate empty date
range, filtering defects, and request failures. They are not interchangeable.

## Changes

| Boundary | Repair | Principal files |
| --- | --- | --- |
| Home date selection | Default to the inclusive previous 30 days. Explain a genuinely empty range and provide recent/all-history navigation. Keep request failures visible. | `apps/web/src/redesign/home.tsx` |
| Home news selection | In the all-company view, choose the first company covered by the shared news-query allowlist. Preserve an explicitly selected company and explain when no company has coverage. | `home.tsx`, `redesign-discovery.test.tsx` |
| Company search | Normalize Unicode, spaces and punctuation consistently in all three SQL search projections. A new search query clears inherited company/category/source/date scope. | `company-search.ts`, `search.tsx`, discovery migration |
| Rapid search filters | Compose pending tab/source/date changes until navigation acknowledges them. Preserve later choices across intermediate commits and discard them on unrelated navigation or browser history changes. | `search.tsx`, `search-scope.test.tsx` |
| Official English names | Preserve OpenDART `corp_eng_name` separately from the primary name and match it across discovery, lookup, catalog and directory by provider plus official company ID. | `server/dart-directory.ts`, official-directory-English-names migration |
| Company coverage | Search a separate official SEC/OpenDART directory. Activate only an identity selected by the user. Do not register the entire directory as collection work. | `signalbrief-discovery/*`, `company-discovery.tsx`, `/api/company-discovery` |
| DART directory CPU limit | Archive the original ZIP first; send its hash and a short-lived private read URL through the HMAC relay. Node validates, inflates and parses the complete archive; Edge validates only the bounded listed-company result before saving. | `signalbrief-discovery/service.ts`, `server/dart-directory-archive.ts`, `/api/internal/dart` |
| Official alphanumeric DART codes | Accept the source's six-character uppercase ASCII letters/digits consistently in XML parsing, Edge result/selection validation, database snapshot validation and profile loading. Keep corporation IDs numeric and eight digits. | `server/dart-directory.ts`, discovery core, profiles index, alphanumeric-code migration |
| Company detail collection | Collect validated provider profile and filing metadata for the selected issuer; archive the original source first. Return `ready` only after persistence completes. Expose failures and allow retries. | `signalbrief-discovery/service.ts`, `company.tsx` |
| Issuer/share-class identity | Preserve the existing canonical issuer record; verify a selected alternative ticker against the official directory before describing it as the same issuer. | `company-discovery.tsx`, `company.tsx` |
| Profile errors | Distinguish an unavailable provider field from a failed profile request, with a retry for the latter. SEC fields absent from the source remain unknown. | `components/company-profile.tsx` |
| Approved numeric evidence | Show exact numeric source quotations from approved analyses separately from normalized structured figures. Never invent a unit, period, basis or approval timestamp. | discovery migration, `workspace/contracts.ts`, `company.tsx` |
| Calendar company search | Use the server's alias-aware company search instead of filtering only the first 100 names in the browser. | `calendar.tsx` |
| Calendar date queries | Apply company/personal-event scope before the 500-row cap. Query past and future ranges independently; offer navigation to a known nearby event. | `calendar-data.ts`, `calendar.tsx` |
| Personal calendar item | Validate and persist the submitted company ID while retaining ownership checks and existing mutation limits. | calendar reliability migration |
| Calendar coverage | Expose authenticated, sanitized coverage counts and selected-company source state. Coverage lookup failure does not suppress the event list. | calendar reliability migration, `calendar-data.ts` |
| Collector fairness | Prioritize overdue followed/held companies without increasing the existing per-run provider collection budget. | discovery migration, `signalbrief-collector/index.ts` |
| Populated mobile home | Allow grid tracks to shrink with `minmax(0, 1fr)` so wide tables stay inside their own scroll containers. The observed 96-pixel page overflow is covered by the retained user-journey assertion. | `styles.css`, `research-workspace.spec.ts` |

## Source and access boundaries

- Official registries: SEC `company_tickers_exchange.json` and OpenDART
  `corpCode.xml`. Registry refreshes are leased, cached and source-hashed.
- Directory reads and selection require a verified Supabase user, MFA where
  required, and existing rate controls. Service-only refresh/activation RPCs are
  not executable by anonymous or authenticated database roles.
- New issuer activations are limited to 25 per user per database day. Reopening
  an existing issuer does not create a second issuer or consume a new-issuer slot.
- The new function performs its own authentication, so the gateway's legacy JWT
  verification flag follows the other authenticated application Edge Functions.
- The browser receives no service credentials or raw storage object keys. The
  Next route forwards only the bearer token and bounded, validated request input.
- No AI request, automatic analysis approval, email delivery, or expanded AI
  spending is introduced by company discovery.
- DART profile/list collection uses two bounded parallel network stages. A
  required page failure returns an incomplete-collection state, not success.
- SEC foreign-issuer disclosure forms are included alongside the existing forms.

## Verification evidence

The final verification and deployed-state results are recorded in
`docs/VERIFICATION.md`. The regression source is committed with the implementation:

- `tests/workspace/test_discovery_reliability.py`: real PostgreSQL directory
  permissions, normalized search, activation identity/idempotency, collection
  leases, approved-source quotations and collector prioritization.
- `tests/workspace/test_calendar_reliability.py`: real PostgreSQL company binding,
  invalid/demo-company denial, cross-user isolation and honest source coverage.
- `apps/web/tests/company-discovery-edge.test.ts`: executes actual Edge handler
  and orchestration code with simulated external boundaries; authentication,
  MFA, rate limits, identity spoofing, partial providers and persistence failure.
- `apps/web/tests/dart-directory-integration.test.ts`: connects the real Edge
  orchestration/HMAC client to the real Node route/parser, with synthetic provider,
  storage and database boundaries; checks a complete large registry, original hash
  preservation, substituted-byte rejection and the Edge import graph.
- Discovery parser/route/UI, search-scope, detail/profile and calendar regression
  files cover failure/retry states and the public contracts.
- `apps/web/e2e/redesign-reliability.spec.ts`: desktop/mobile user interaction
  through real browser rendering, with synthetic HTTP fixtures. These tests do
  not claim live provider or new OAuth-login verification.

### Release-gate reconciliation

GitHub's independent run of the first repair commit passed its full repository
verifier, backend, PostgreSQL, dependency audit, collector, calendar and evidence
checks. Its subsequent scope guard exposed two stale rules: the already-shipped
calendar and alerts routes mounted their authenticated redesign screens, while
the manifest still expected legacy portfolio gates. Their route files remain
byte-identical to `7e9f0d6`; the guard now verifies their exact audited hashes.
All 90 public/admin/auth hashes, 17 retained implementations, eight disabled
feature flags and remaining feature gates remain enforced.

The browser gate had not run after that guard failure. Its existing research
journeys and fixtures were updated to the already-shipped screen contracts while
retaining source provenance, state persistence, authentication, disabled-provider,
consent and unexpected-request assertions. It also found an omitted existing
consented analytics hook on the redesign event page. That hook now accepts only
loaded, matching, published non-demo analyses; calendar occurrence IDs and
unconsented sessions are excluded. Evidence engagement requires a real opening
or source/document click and remains deduplicated.

The populated mobile journey exposed a 96-pixel home overflow, repaired by
allowing the grid tracks to shrink within the viewport. Rapid tab/source changes
also reproduced lost filter choices when navigation had not committed. Focused
regressions first failed on the original merge behavior and now cover cumulative
pending choices, intermediate commits, new-query scope clearing and history or
external-route resets. The sequential browser journey additionally waits for
each selected tab to commit before its next action.

The new reliability browser spec is included alongside all ten existing CI
specs. Test fixtures use synthetic identities and intercepted HTTP boundaries;
these checks do not write production user records.

## Release order

1. Pass the repository full verification gate, Deno type checks, focused browser
   regressions, and the new real-PostgreSQL migration regressions.
2. Apply `20261101041747_company_discovery_reliability.sql`, then
   `20261101041751_calendar_reliability.sql`. Both preserve existing content;
   expected-function guards stop application if the live definition has drifted.
   Then apply `20261101050721_official_directory_english_names.sql` before deploying the English-name-aware discovery parser.
   Apply `20261101055057_dart_alphanumeric_stock_codes.sql` before enabling the corrected stock-code validators. All four migrations are already in the production ledger; do not reapply them.
3. Build and deploy the reviewed Git commit in the existing Vercel project first.
   The production Node `/api/internal/dart` route must accept both fixed
   `directory` and `directory_parse` operations before deploying the CPU-offload
   discovery Edge version: its relay client uses the existing production origin.
4. Deploy discovery and affected existing Edge Functions with their complete
   relative dependencies and pinned imports, then verify an actual DART cold
   directory warm. Successful local parsing does not establish live completion.
5. Verify authenticated home, Korean/English/company-code search, company
   selection and detail, calendar scope/date navigation, source status, provider
   snapshots and post-release runtime errors.

The first two database migrations are applied as versions `20261101041747` and
`20261101041751`, and the English-name migration as `20261101050721`. Filenames
match the actual ledger; do not reapply earlier draft timestamps. Discovery v2
was deployed with the English-name change. Its first live DART refresh hit the
CPU limit described below; the replacement requires the Node-first deployment
order above. Application authentication policies remain unchanged.

Rollback the Vercel deployment and affected Edge versions together if a new
request boundary fails. The additive private tables and nullable-compatible
projections can remain; do not drop official snapshots or user-created records
as a rollback shortcut. Personal events created after this repair retain their
company IDs even if the old frontend is restored.

## Commercial-readiness limits

Passing these checks establishes behavior for the repaired flows and tested
boundaries. It is not a guarantee that the application has no bugs.

Official directory coverage does not imply every issuer has an approved analysis,
comparable historical figures, a verified calendar source, or provider-supplied
CEO/founding-date fields. Calendar adapters remain explicitly limited to their
configured sources. No dates or missing company facts are fabricated to make an
empty panel appear complete.

New-account OAuth, payments, outbound notification delivery, backup restoration,
load at commercial scale, and independent real-world analysis quality are not
certified by this repair. The earlier project's broader release requirements
remain applicable to those areas.

## Official English-name follow-up

OpenDART documents `corp_eng_name` in its [corporation-code directory contract](https://opendart.fss.or.kr/guide/detail.do?apiGrpCd=DS001&apiId=2019018). The parser now retains this authoritative field, including XML entities and CDATA, without replacing the primary display name. The optional private field is validated and saved with the original snapshot hash and timestamp. Matching uses the official provider identity so a different issuer sharing a ticker cannot inherit a name. Missing or malformed values and removal on a later snapshot are tested.

The additive migration is applied in production as version `20261101050721`; its filename matches that ledger entry. The directory was verified cold before application. Discovery v2 was deployed, and the first live refresh exposed the resource limit below. No additional aliases, source facts or calendar dates are generated.

The follow-up passed the complete eight-stage verifier: 506 backend tests with zero skips, 877 frontend tests in 87 files, TypeScript, ESLint and production build. Deno discovery checking passed. The unchanged UI has the 80-case desktop/mobile result and independent successful GitHub verification at `9708e0d`. The release still requires actual authenticated provider and post-deployment screen checks.

## Production CPU failure and offload verification

The production discovery v2 log at **2026-11-01 05:12:13 UTC** recorded
**2,002 ms CPU time**, HTTP **546**, and `WORKER_RESOURCE_LIMIT` during the full
DART directory refresh. SEC had successfully saved **10,430 entries**. This was
a live resource failure that the earlier small parser fixtures did not expose.

The repaired flow archives the original ZIP with `upsert: false`, creates a
60-second signed read URL for that exact private object, and authenticates the
fixed `directory_parse` operation with HMAC and the existing nonce claim. Node
checks the object URL, original SHA-256, ZIP bounds/CRC and complete XML before
returning at most 4 MB of listed identities. Edge verifies the response hash and
identities before saving; its import graph no longer includes ZIP inflation or
full XML parsing. A substituted storage response fails without publishing a
snapshot. The browser receives no signed URL or provider credential.

The final **local** eight-stage verifier passed: **506 backend tests, zero skips**
against four disposable PostgreSQL databases; **930 frontend tests in 90 files**;
TypeScript, Ruff, production Next build and ESLint (**zero errors, five existing
warnings**). Deno checks passed for discovery, collector and profiles. The last
browser result remains **80/80 desktop/mobile cases** from the unchanged UI;
the server-only CPU repair did not rerun that browser suite.

The cross-boundary integration generated **224,000 synthetic issuers**, including
**4,000 listed identities**, as **52,391,577 XML bytes / 2,081,460 ZIP bytes**.
The actual Node route/parser returned **593,874 bytes**, taking **1,173.32 ms wall
time / 1,271.36 ms CPU time**; the complete synthetic refresh took **1,228.87 ms**.
These measurements use local compute and synthetic HTTP/storage/database
boundaries. They are not production latency or Supabase CPU measurements.

Separately, the production UI at `9708e0d` was checked: the default home range
showed **63 disclosures, 26 analyses and three events**; the calendar Apple picker,
coverage message, nearest-event navigation to **October 29**, and Microsoft
future-event detail worked. Apple's manual official-data refresh succeeded at
**14:22 KST (05:22 UTC)** on November 1. These observations do not establish DART
registry completion. **An actual DART cold warm after the Node-first deployment
is still pending.**

## Actual registry compatibility and repeat-CI follow-up

After the Node offload reached production at `c1d43da`, discovery v3 completed
without the earlier Edge resource termination. Its signed archive download
returned HTTP 200, but the strict parser rejected the registry. The original
private archive was preserved and its SHA-256 verified before local replay:

| Original source measurement | Result |
| --- | --- |
| SHA-256 | `2c0abccb2d38d4179e03ba0c3e4a0370599365ff934e61fca779a0aefb57631d` |
| ZIP bytes / expanded XML bytes | 3,632,941 / 30,358,952 |
| Issuer records / listed identities | 119,879 / 4,009 |
| Listed identities containing letters | 72 |

The exact previous Node code reproduced `invalid_dart_directory`. Changing only
the ticker predicate from six digits to six uppercase ASCII letters/digits
allowed the entire original registry to pass. The actual corrected source then
returned all **4,009 identities**, including all **72 alphanumeric codes**, in
**569,889 JSON bytes**. Local replay took **695.39 ms wall / 769.514 ms CPU**;
these are local measurements of actual provider bytes, not production latency.
No size, CRC, SHA, XML, name, or complete-snapshot checks were relaxed.

The same format is now enforced in Edge result/selection validation, the
profile-loading guard, and the additive database migration
`20261101055057_dart_alphanumeric_stock_codes.sql`. Its expected-definition guard
requires exactly one audited predicate and preserves source leases, full-snapshot
validation, provider identity, activation quotas, privileges and stored data.
Twenty-six real-PostgreSQL discovery regressions passed, including eleven new
positive/negative format and activation cases. The large synthetic cross-boundary
fixture now also carries an alphanumeric identity through archive, HMAC, Node
parse, Edge validation and save.

Authorized Node processing failures now emit only a fixed operation and an
allowlisted diagnostic code. Raw exception text, signed URLs, credentials and
issuer data never enter these diagnostics; public error responses are unchanged.

The independent `c1d43da` repair-branch gate passed all **80 browser cases** in
3.1 minutes. A repeated main run found a separate mobile test timing race: its
content and selection assertions passed, but it checked a React scroll effect
before the effect completed. The test now awaits the same scroll assertion with
the existing default timeout; application behavior is unchanged. Five isolated
rechecks passed. The combined full local gate then passed all eight stages:
**517 backend tests with zero skips, 958 frontend tests in 90 files**, TypeScript,
Ruff, ESLint, production build, all three Deno entrypoints and the scope guard.
Independent CI on the latest commit and the post-deployment DART warm remain
separate acceptance steps for this follow-up.

Additional live checks confirmed the approved numeric-evidence panel on Hyundai
despite no legacy structured figures, and SEC discovery returned official results
outside the original seven registered companies while DART was unavailable.
Official names and tickers are source-backed; directory support does not imply
arbitrary Korean transliterations or universal calendar/analysis coverage.


## Production acceptance and home news default

The `ccc0ca4` repair-branch and main verification runs both passed their complete
80-case browser commands. Its production deployment and discovery v4/profiles v5
were then exercised through the authenticated UI:

- OpenDART saved **4,009 listed identities**, including **72 alphanumeric codes**,
  under the original archive hash at **06:04:15 UTC**. SEC retained **10,430
  official entries**; both source error codes are null.
- Searching NAVER found the official `035420` / corporation `00266961` identity.
  Opening it completed profile/disclosure hydration, classified it as KOSPI and
  persisted **37 disclosures**. A full page reload retained its profile and
  recent disclosures. The same company appeared under ticker search and the
  KOSPI filter. The alphanumeric query `0068Y0` also returned its official match.
- Home still defaulted to the recent month and displayed **76 disclosures,
  26 approved analyses and three confirmed events** after that import.
- The live discovery requests returned HTTP 200; the checked post-release log
  window contained no repeated resource-limit error. Unauthenticated discovery
  still returned HTTP 401 with private/no-store caching.

Returning home exposed a separate default-selection problem: new companies can
precede the seven companies in the existing news-query allowlist. The all-company
news panel selected the first company regardless of its news coverage and showed
`company_news_not_supported`, hiding existing available news. The correction
selects the first covered catalog company using the shared allowlist. An explicit
company choice remains authoritative; no alternative company's news is substituted.
If no catalog company has news coverage, the page explains that state and sends
no request. Provider queries, company-news coverage and budgets are unchanged.

Two new regressions failed before this fix; the explicit-selection case already
passed and is retained. After the change, the component and news API suites
passed **20/20**, with TypeScript and focused ESLint passing. The full local
gate and independent browser CI for this small UI follow-up are recorded in
VERIFICATION and the structured summary. Its final live home check is separate
from the already completed directory/profile acceptance above.

The home-news follow-up full local gate passed all eight stages with **517 backend
tests and zero skips, 961 frontend tests in 90 files**, TypeScript, Ruff, lint,
production build and the scope guard. Independent local review found no blocker.
Its exact commit will run the complete 80-case CI browser gate before promotion.
