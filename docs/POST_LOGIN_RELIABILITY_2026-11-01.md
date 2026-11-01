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
| Company search | Normalize Unicode, spaces and punctuation consistently in all three SQL search projections. A new search query clears inherited company/category/source/date scope. | `company-search.ts`, `search.tsx`, discovery migration |
| Company coverage | Search a separate official SEC/OpenDART directory. Activate only an identity selected by the user. Do not register the entire directory as collection work. | `signalbrief-discovery/*`, `company-discovery.tsx`, `/api/company-discovery` |
| Company detail collection | Collect validated provider profile and filing metadata for the selected issuer; archive the original source first. Return `ready` only after persistence completes. Expose failures and allow retries. | `signalbrief-discovery/service.ts`, `company.tsx` |
| Issuer/share-class identity | Preserve the existing canonical issuer record; verify a selected alternative ticker against the official directory before describing it as the same issuer. | `company-discovery.tsx`, `company.tsx` |
| Profile errors | Distinguish an unavailable provider field from a failed profile request, with a retry for the latter. SEC fields absent from the source remain unknown. | `components/company-profile.tsx` |
| Approved numeric evidence | Show exact numeric source quotations from approved analyses separately from normalized structured figures. Never invent a unit, period, basis or approval timestamp. | discovery migration, `workspace/contracts.ts`, `company.tsx` |
| Calendar company search | Use the server's alias-aware company search instead of filtering only the first 100 names in the browser. | `calendar.tsx` |
| Calendar date queries | Apply company/personal-event scope before the 500-row cap. Query past and future ranges independently; offer navigation to a known nearby event. | `calendar-data.ts`, `calendar.tsx` |
| Personal calendar item | Validate and persist the submitted company ID while retaining ownership checks and existing mutation limits. | calendar reliability migration |
| Calendar coverage | Expose authenticated, sanitized coverage counts and selected-company source state. Coverage lookup failure does not suppress the event list. | calendar reliability migration, `calendar-data.ts` |
| Collector fairness | Prioritize overdue followed/held companies without increasing the existing per-run provider collection budget. | discovery migration, `signalbrief-collector/index.ts` |

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
- Discovery parser/route/UI, search-scope, detail/profile and calendar regression
  files cover failure/retry states and the public contracts.
- `apps/web/e2e/redesign-reliability.spec.ts`: desktop/mobile user interaction
  through real browser rendering, with synthetic HTTP fixtures. These tests do
  not claim live provider or new OAuth-login verification.

## Release order

1. Pass the repository full verification gate, Deno type checks, focused browser
   regressions, and the new real-PostgreSQL migration regressions.
2. Apply `20261101034637_company_discovery_reliability.sql`, then
   `20261101040435_calendar_reliability.sql`. Both preserve existing content;
   expected-function guards stop application if the live definition has drifted.
3. Deploy the new discovery function and affected existing Edge Functions with
   their complete relative dependencies and pinned runtime imports.
4. Build the reviewed Git commit in the existing Vercel project. The production
   DART relay must accept the new fixed `directory` operation before warming the
   directory, because the Edge relay client uses the existing production origin.
5. Verify authenticated home, Korean/English/company-code search, company
   selection and detail, calendar scope/date navigation, source status, provider
   snapshots and post-release runtime errors.

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
