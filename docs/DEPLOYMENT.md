# Deployment runbook — not an executed deployment

## 1. Verify locally first
Install actual dependencies and generate a genuine `apps/web/package-lock.json`; run lint, TypeScript, frontend unit tests,
Next build, Python tests, synthetic eval and desktop/mobile Playwright. Fix failures rather than disabling checks.
The production artifact should use the resolved lock and a recorded Python dependency snapshot/security audit.

## 2. Supabase
Create a project under your own account. Record HTTPS project URL, a browser-safe publishable/anon key and a server-only service
key; never interchange them. Set up Google provider in Supabase with a Google OAuth client you control. In Google use the actual
Supabase provider callback shown by your project; in Supabase allow the exact web site URL and `/auth/callback` redirect.
Use asymmetric JWT signing supported by the configured JWKS verifier. Create **private** bucket `signalbrief-raw`.

Use a PostgreSQL connection appropriate for a persistent Python backend, require TLS (for example `sslmode=require` in the URL)
and percent-encode special password characters. Keep it in server secrets. Back up before applying migrations.
Run `alembic upgrade head` once through the release/pre-deploy step, not concurrently on every worker.
Optional embeddings: apply `supabase/enable_vector.sql` in the same database and configure a 1536-output embedding model.

## 3. Server environment
Set these consistently in API, worker and scheduler:

```text
SB_ENVIRONMENT=production
SB_DEMO_MODE=false
SB_DEMO_ADMIN=false
SB_DEMO_SEED_ON_START=false
SB_AUTH_MODE=supabase
SB_STORAGE_MODE=supabase
SB_DATABASE_URL=<real PostgreSQL URL with TLS>
SB_SUPABASE_URL=<real HTTPS project URL>
SB_SUPABASE_SERVICE_KEY=<server-only key>
SB_STORAGE_BUCKET=signalbrief-raw
SB_ALLOWED_ORIGINS=https://<actual-web-domain>
SB_ALLOWED_HOSTS=<actual-api-domain>
SB_ADMIN_USER_IDS=<trusted Supabase user UUIDs, comma separated>
SB_DART_API_KEY=<own API key>
SB_SEC_USER_AGENT=SignalBrief <real monitored contact email>
SB_OPENAI_API_KEY=<own API key>
SB_OPENAI_MODEL=<available Responses structured-output model>
SB_AUTO_PUBLISH_VALIDATED=false
```

Do not paste angle-bracket placeholders as actual credentials. Supply optional token unit prices only after checking your active
model pricing; unset prices display unknown. Configure request/day limits and provider quotas appropriate to the real account.
Render `render.yaml` contains API, worker, hourly cron and environment group definitions. Review availability, runtime patch versions,
service plan, pre-deploy support and actual charges before applying; this file does not imply a free deployment.
API starts uvicorn, worker starts `python -m signalbrief.cli worker`, cron runs `python -m signalbrief.cli schedule`.
Set up monitoring and ensure `/health/ready` returns ready after migration. Restrict trusted proxy and host settings appropriately.

## 4. Web / Vercel
Project root is `apps/web`; framework Next.js; install with npm; build `npm run build`.
Set public build-time `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
A change to these values needs a rebuild. There is no backend service key in this set.
Add the final HTTPS site origin to backend CORS and the exact OAuth redirect allowlist. Test on the deployed URL, not just localhost.

## 5. Actual data activation
Run `signalbrief sync-companies dart` and `signalbrief sync-companies sec`; then `signalbrief companies --query <name>` to obtain
internal company IDs. Ingest bounded date windows. Start the worker, inspect raw hashes and evidence, review analyses, then approve
only supported results. Add user watchlists/positions so the scheduled job has companies to monitor. Prefer a small initial universe.

## 6. Release and rollback
Confirm two separate user accounts cannot read/mutate each other's positions and no normal user can access Ops/raw/prompt runs.
Confirm production rejects demo tokens. Check one actual DART and one actual SEC source, plus retry behavior and persistence.
Recheck unknown timestamps/costs, disabled autoplay publishing, operational alerting and privacy notices.
A failed release stays private. Roll back service image/code first; migrate backward only after backup and understanding data loss.
`alembic downgrade base` is destructive and only demonstrated in disposable test databases.
