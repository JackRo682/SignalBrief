# Reference-screen publication R2

Chosen existing branch: codex/reference-publish-20261003, starting at dbab1491484de65019126b70e250b2edce987b6a. Its source manifest matches all ten uploaded TXT files by SHA-256. The older functional-ui branch was still serving the production alias when this work began.

This update keeps the ten-screen source-derived layout and authenticated controllers. It adds an illustrated mini-application preview matching the reference composition without fake prices, consistent SVG icons, a multicolor Google mark, keyboard Space activation, labeled search inputs, and a working onboarding cancel/logout action. The landing HTML is server-rendered before hydration rather than initially blank. /api/release exposes only build identity for deployment verification.

The existing reference controllers cover real navigation, profile density, onboarding, combined watchlist/portfolio atomic save, CSV resolution and decimal strings, detail/evidence panes, timeline filtering, cited question/history, calendar views/CRUD/ICS/subscriptions, alert rules/read states/preferences, and administrator-scoped queues/actions. Their database functions are present in the existing Supabase project. No service-role browser credentials or global delete calls from the sample TXT servers are used.

## Checks during this update

- 114 frontend unit tests passed locally.
- TypeScript and Next production build passed; ESLint reported zero errors and six existing internal-navigation warnings.
- 72 isolated Chromium controller checks passed across desktop and mobile, including native save-button hit targets, evidence collapse, filters, CSV, calendar and notification operations. Tests use synthetic adapters; no fixture financial records are published.
- 241 backend tests passed locally; two disposable-PostgreSQL tests were skipped locally because no disposable database was supplied. CI's PostgreSQL job is separate.
- Nine selected hosted database checks passed in a rolled-back transaction: preferences, atomic watchlist/positions save, exact decimals, invalid-input rollback, reminder persistence, cross-user isolation and administrator denials.
- The hosted project has all nine recorded migrations, private raw storage, seven starter companies, and zero ingested real documents at the checked time. All public tables have RLS enabled.

## Remaining boundaries

A UI publication is not a completed live-data launch. DART/SEC worker ingestion, OpenAI generation, licensed prices/FX, outbound email alerts and background push are not enabled. Empty/data-unavailable panels remain visible, not populated with screenshot financial examples. Reminder switches persist saved interest, not a claim of background delivery. Full Google consent/session completion requires the account owner and is not established by anonymous probes.

No paid resources are created. The exposed Google client secret still needs owner rotation. Prior full-tree dependency audit warnings are not hidden or claimed fixed by this presentation update. Production-only and full development-tree audit results must be reported separately.

The current rendered-controls suite is tests/reference/browser_checks.py. Old apps/web/e2e tests describe the previous React/FastAPI demo layout and are preserved as legacy tests, not represented as end-to-end tests of the hosted-RPC reference UI.
