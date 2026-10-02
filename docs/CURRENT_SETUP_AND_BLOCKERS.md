# Consolidated operator setup

No external account, production connection, deployment or paid resource was created or changed. The local synthetic demo must not be published.

| Group | Required operator settings and permissions |
|---|---|
| Supabase | New/authorized project; HTTPS URL; browser publishable/anon key; server-only service key; PostgreSQL TLS connection; asymmetric JWT signing/JWKS; trusted admin UUID allowlist; permission and cost approval for project/resources |
| Google OAuth | Controlled Google OAuth client; Supabase provider callback; exact final web site URL and `/auth/callback` allowlist; actual HTTPS login/logout verification |
| Private raw storage | Private persistent `signalbrief-raw` bucket; shared API/worker access; privacy and persistence check after redeploy; backup/restore test |
| DART | Own OpenDART key, agreed bounded issuer/date scope and API quota; real collection approval |
| SEC | Real monitored contact email in `SB_SEC_USER_AGENT`; agreed issuer/date scope and request rate |
| OpenAI | Server-only key; actually available structured Responses model; budget/quota/cost approval; optional verified price assumptions; optional 1536-dimensional embeddings setup |
| Hosting | Authorized Vercel web and Render API/worker/hourly cron projects, service plans/cost approval, domains, exact CORS/hosts, production secret registration approval, monitoring and retention/privacy operator details |

Required server configuration: `SB_ENVIRONMENT=production`, `SB_DEMO_MODE=false`, `SB_DEMO_ADMIN=false`, `SB_DEMO_SEED_ON_START=false`, `SB_AUTH_MODE=supabase`, `SB_STORAGE_MODE=supabase`, `SB_AUTO_PUBLISH_VALIDATED=false`. Supply `SB_DATABASE_URL`, `SB_SUPABASE_URL`, `SB_SUPABASE_SERVICE_KEY`, `SB_STORAGE_BUCKET`, `SB_ADMIN_USER_IDS`, `SB_ALLOWED_ORIGINS`, `SB_ALLOWED_HOSTS`, `SB_DART_API_KEY`, `SB_SEC_USER_AGENT`, `SB_OPENAI_API_KEY`, `SB_OPENAI_MODEL` in server secrets/config.

Only `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` belong in the browser build. No private key, PostgreSQL URL or service secret may be placed in `NEXT_PUBLIC_*`, source or logs. Do not paste real secrets into this report.

P0 before release: live OAuth and production role isolation; private raw persistence/restore; real DART+SEC URL/hash/publication precision/review queue/idempotency checks; actual OpenAI review and human-labelled financial gold validation; approved hosting/costs and final HTTPS deployment verification. All are BLOCKED pending the settings and permissions above.

The development dependency advisory is resolved: Vitest/@vitest/mocker 4.1.11 and Vite 7.3.6 pass the full frontend checks and npm audit reports zero vulnerabilities. See `docs/DEPENDENCY_SECURITY_2026-10-02.md`.

P1: Final privacy notice/contact/retention and realistic document/load/outage validation remain unfinished. PDF/OCR, oversized long documents, unrestricted free-form semantic inference and a real human-reviewed gold dataset remain outside the completed local checks.

Never bypass unsupported claims, numeric mismatch or conflicting evidence. Live collection must enter review and preserve authoritative immutable evidence. Synthetic regression results establish neither real financial accuracy nor human gold validation.
