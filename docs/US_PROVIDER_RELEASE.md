# US-first integration — 2026-10-03

This release extends the existing `codex/reference-publish-20261003` code; it does not replace the project. Google sign-in, existing reference screens, portfolios and RLS remain. `/us` adds recent SEC filing metadata, reviewed excerpt analyses, daily FX and provider readiness.

## What the implementation supports

- Server-side SEC submissions for supported US companies; exact submissions payloads and filing HTML archived privately before analysis. The current source is a bounded recent-submissions list, not an unlimited historical SEC database.
- FMP stable quote and daily historical chart adapters. Cached, timestamped responses, eight network-backed symbols per request and a shared daily request cap. Korean prices explicitly unavailable. API access alone never proves website display rights.
- Frankfurter v2 USD/KRW and selected reference FX pairs; displayed with observation date, never labeled live trading FX.
- OpenAI `gpt-4.1-mini-2025-04-14` structured claim extraction from a bounded normalized SEC excerpt. Exact quote/numeric checks, private raw provenance, an analysis lease preventing concurrent duplicate calls, and required human semantic review. This is not a complete-document or real-world financial accuracy certification. Approved results are separate from the legacy Evidence-First event pipeline.
- Resend verified-domain lookup and an explicit operator-self test email only after exact sender-domain verification. Bulk alert/digest delivery is not implemented in this release.
- GNews headline/link retrieval only after deployed-site entitlement is documented and enabled. No article text is copied into unrestricted public responses.
- Google PKCE initialization hardening, single-flight code exchange, safe redirects and verified Auth session lookup. `/status` distinguishes provider redirection from completed interactive sign-in.

## Secrets and approvals — project owner

The four keys pasted into chat are exposed; rotate them. The automated secret-provisioning attempt was blocked by the platform security check. It was not retried by another route. Its temporary database provisioning functions were removed. **No supplied private credential was committed or successfully provisioned.**

Enter replacements in the existing Supabase project's Edge Functions **Secrets** screen:

```
OPENAI_API_KEY
FMP_API_KEY
RESEND_API_KEY
GNEWS_API_KEY
SEC_CONTACT_EMAIL
```

Only set GNEWS_API_KEY for an account whose plan may be used on a deployed website. `SEC_CONTACT_EMAIL` must be a real owner-approved contact; do not invent one. The Edge runtime reads these with `Deno.env.get`. Its optional existing Vault fallback is service-role-only; no browser role can execute the secret RPC.

The Google OAuth Client ID and rotated Client Secret belong in **Authentication → Sign In / Providers → Google**, not OpenAI API settings. Google Cloud administration/consent still requires the owner's Google Cloud session; the current connectors do not expose that administration API.

## Safe defaults

No new paid resource or subscription is created. OpenAI daily budget = 0; scheduled ingestion = off; FMP public display = off; GNews deployed usage = off. No administrator is assigned automatically to the first sign-up.

After the owner supplies documented permissions, an operator can configure these non-secret values in `app_private.us_config`:

- `fmp_display_enabled`, `fmp_license_reference`, `fmp_license_until` (ISO timestamp).
- `gnews_display_enabled`, `gnews_license_reference`, `gnews_license_until`.
- `ai_daily_budget_usd` (explicitly approved positive numeric USD ceiling).
- `resend_from` (verified sender address).

Enabling a boolean is not license verification. Retain a copy of the entitlement/contract. Do not select a paid plan or turn on an automated worker without approval. The daily AI reservation is a conservative application-side bound for the pinned model; it is not the provider's billing report and needs review if pricing changes.

## Deployment

Deploy `supabase/functions/signalbrief-us/index.ts` with its two source modules. Gateway verify_jwt is disabled only because this function implements explicit Supabase Auth `getUser` verification for every private route and an administrator RPC gate for every operation. The only public routes are health, safe status, OAuth initiation diagnostics and daily reference FX.

The existing Vercel public Supabase variables suffice for `/api/us/*`; vendor secrets must never be placed in NEXT_PUBLIC variables. The server's `/api/auth-config` exposes only an enabled public/anon project key, never service credentials. The `/api/market` route now connects to the FMP adapter instead of the old generic gateway placeholder.

Migrations in `supabase/us-migrations` are additive, with a forward cleanup of the unused provisioning mechanism; apply only missing migrations after reviewing the remote migration ledger. There is no cron schedule in this release. Manual operator ingestion and analysis require credentials and budget. No hidden periodic billing starts when the website is deployed.

## Verification boundaries

Provider contract tests use synthetic fixtures and cannot prove an account's current entitlements, quota, sender status or actual model accuracy. The real Google browser probe deliberately stops at the provider sign-in screen; it cannot establish successful personal consent/session completion without the owner. Live provider results and outstanding configuration must be reported separately from successful builds/unit tests.

Primary references:
- https://www.sec.gov/search-filings/edgar-application-programming-interfaces
- https://www.sec.gov/about/developer-resources
- https://site.financialmodelingprep.com/developer/docs
- https://site.financialmodelingprep.com/pricing-plans
- https://developers.openai.com/api/docs/models/gpt-4.1-mini
- https://frankfurter.dev/
- https://resend.com/docs/api-reference/domains/list-domains
- https://gnews.io/pricing
- https://supabase.com/docs/guides/auth/sessions/pkce-flow
