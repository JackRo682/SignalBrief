# Hosted release scope — 2026-10-03

## Deployed architecture

The existing Free Supabase project hosts PostgreSQL, Auth, private source storage, and the signalbrief-api Edge Function. Vercel hosts the Next website and a same-origin /api proxy. The proxy forwards only a browser-public project key and the authenticated user's bearer token; private data access is enforced by database RLS and bounded SECURITY DEFINER RPCs.

No Render service, paid plan, database branch or billable add-on was created. Free quotas are finite and not an uptime guarantee. The Python/FastAPI ingestion, extraction, validation, ranking and worker code remains in apps/api and is not deployed as a running worker in this release.

## Functions implemented

Blue/white responsive landing, Google/email signup/login/recovery interfaces, 3-step onboarding, watchlist management, exact-decimal holdings, CSV import/export, personalized Today feed, event detail/evidence, company timeline, evidence-bound Q&A and saved history, personal/official calendar, ICS export and private revocable subscriptions, app alerts, foreground browser notifications, density/consent settings, admin queues/actions/audit/source inspection.

The hosted company catalog currently contains a small reviewed starter list. User portfolios and preferences are real persistent records, not local mock state. Empty financial feeds remain empty until real documents are ingested and reviewed. Screenshots' illustrative revenues, prices, portfolio values, charts and P&L are not fabricated as live data.

## Not activated or not yet verified

- Real DART/SEC ingestion and running Python worker: server credentials/contact and deployment remain required.
- OpenAI financial extraction/generation: inactive; no paid API call was made. Current hosted Q&A retrieves verified stored evidence and abstains when missing.
- Outbound alert email and background web/mobile push: not delivered. Foreground notifications work only with permission while the Alerts view is open.
- Full Google browser sign-in/callback session and email delivery: not yet independently verified. Provider settings/authorization redirects are a separate, narrower check.
- PDF/OCR, oversized documents, real prices/FX/P&L and a human-labelled financial evaluation dataset remain out of completed scope.
- Real-world backup/restore, load testing, production operator identity and finalized privacy/retention contact require completion before broad launch.

## Release gates

Do not call a page's HTTP200 response, a Next.js build, or synthetic evaluation equivalent to production readiness. Track backend tests, hosted SQL isolation, frontend type/lint/unit/build, desktop/mobile browser journeys, live API and Google initiation checks separately.

Full npm audit flags one high-severity braces advisory along a five-package development-tool dependency chain. Production-only npm audit is zero as of the checked 4bc995 artifact. The full audit remains failing, not suppressed. See SECURITY_ADVISORY_20261003.md. Broad public launch requires remediation or explicit owner risk acceptance.

A preview may not have Supabase public variables because the user configured them for Production. Never treat preview 503 supabase_configuration_missing as a database failure, silently use demo auth, or expose service keys to solve it.
