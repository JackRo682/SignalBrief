# Reference-screen release — 2026-10-03

## Source of truth

The presentation is derived from the ten user-uploaded standalone TXT screen bundles and their screenshots. `apps/web/src/reference/source-manifest.json` records hashes of the original files. Trusted static HTML and CSS are reused without executing the original Node servers or inline scripts. Typed controllers connect the presentation to the authenticated application. Dynamic strings are escaped, URLs validated, and no service-role key enters the browser.

The original standalone portfolio code deleted every row with a non-null ID using a service-role key. That code is not deployed. The replacement `sb_reference_setup` RPC derives its owner from auth.uid(), locks that user's profile, validates company IDs/decimal strings, and replaces only that user's watchlist and positions in one transaction. Invalid input rolls back both replacements.

## Routes

| Uploaded screen | Application route |
| --- | --- |
| 01 Ops console | /ops |
| 02 Alert center | /alerts |
| 03 Event calendar | /calendar |
| 04 AI event chat | /questions?event=EVENT_ID |
| 05 Company timeline | /companies/COMPANY_ID or /timeline |
| 06 Event detail / evidence | /events/EVENT_ID |
| 07 Today portfolio changes | /today |
| 08 Watchlist / portfolio setup | /watchlist and /portfolio |
| 09 Onboarding | /onboarding |
| 10 Landing / authentication | / and /login |

## Interactions

Navigation, search, account controls, real profile/density, onboarding selections, watchlist chips/counts, holdings modal/inputs, atomic save, CSV resolution/import/export, detail sections, evidence filters/collapse, timeline filters, cited question/history, Sunday-first timezone-safe month calendar, calendar CRUD/export/subscription, notification read status, alert rule CRUD, thresholds, foreground browser notifications, Ops date ranges/filters/actions are connected. Account ownership and administrator checks remain server-side.

Corporate logos and the onboarding robot are small crops from user-supplied screenshots. No person's photograph or font file is included. Typography uses available system fonts, so this is not a claim of a measured pixel-identical match.

## Financial and delivery boundaries

No sample financial number, quote, uptime statistic or user count is represented as live data. Prices, historical charts, market valuations and returns require a configured licensed market gateway; see market-contract.md. Without it, the panels remain visible and show unavailable data. The current hosted catalog has seven real starter companies and zero ingested real filings at the checked time.

DART/SEC ingestion worker, OpenAI generation, outbound alert email and background push are not activated by this release. Evidence-bound Q&A searches stored verified documents and may abstain. Calendar reminder switches save an interest flag, not a promise that a background notification will fire. Email/daily/push delivery controls are disabled with an explanation until the corresponding service is connected. Foreground browser notifications require permission and an open page.

## Verification layers

- 107 frontend unit tests passed locally (66 existing + 41 reference tests).
- Full frontend typecheck and production build passed locally; ESLint has zero errors and six navigation warnings.
- 64 real-Chromium rendered-DOM/controller checks passed across 1534x960 desktop and 412x915 mobile. These use explicitly synthetic adapters, not real financial records or Google accounts. They test native hit targets without forced clicks and enforce no horizontal overflow/JavaScript errors.
- 15 selected live PostgreSQL checks passed inside a rolled-back transaction: owner isolation, atomic replacement, exact decimals, invalid-input rollback, reminder ownership, non-admin denial, Ops date ranges and public safe aggregates. No fixture accounts or holdings remain.
- Real Google consent/session callback, SMTP delivery, licensed market ingestion, production load/backup restore and all possible authorization combinations are not established by these results.

The previous screen-specific Playwright suite targets the prior React UI and its local FastAPI demo contract. It is retained as legacy coverage, not silently claimed to validate this hosted-RPC release. `tests/reference/browser_checks.py` is the current network-free screen integration suite. Live hosted API probes and SQL security checks are separate layers.

## Deployment and safety

No paid infrastructure is created. Existing Vercel/Supabase accounts are reused. The database migration in `supabase/reference-migrations` has already been applied to the existing project; do not rerun CREATE TABLE on that project. The optional market gateway credentials are server-only; absent configuration does not enable fake quotes.

The full dependency audit previously reported a development-tool braces advisory, while production-only audit reported zero. Keep the full audit output visible; do not equate a production-only result with a clean development dependency tree. The exposed Google OAuth client secret should be rotated by the owner. Administrator membership is never assigned to the first user automatically.
