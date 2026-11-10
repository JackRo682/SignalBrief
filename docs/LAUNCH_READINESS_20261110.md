# Public discovery and acquisition readiness — 2026-11-10

Scope: public SEO, consented visitor-to-signup measurement, signup validation, calendar access-restriction handling. No changes to authorization, personal data exposure, source evidence policy or paid services.

## Changes
- Nine allowlisted public pages override the private-by-default noindex metadata. Production canonical URLs, per-page descriptions, Open Graph, robots.txt and sitemap.xml are generated. Preview remains unindexed; authentication/private routes retain noindex and authorization.
- Independent, optional first-party acquisition consent. No email, IP, UA, raw referrer/query, question or search text is collected by this feature. Browser-local random identity expires after 90 days. Fixed source categories only. DNT/GPC and opt-out honored.
- Private RLS-protected tables and a narrowly validated RPC support bounded writes, duplicate suppression, live confirmed-session signup/onboarding validation, and administrator/MFA-only aggregate reads. No private-schema/table access is granted to anonymous visitors. Existing accounts are not counted as new signups. Existing logged-in research consent remains independent.
- Operations retains its existing single menu and activity-log-first layout, with a new external acquisition panel using the selected KST date range. It explicitly describes consent coverage, browser-based counts and conversion limitations.
- Withdrawal deletes event/source data, with minimum random identity/hash tombstones to prevent delayed requests recreating it. Failed deletion retries next visit. A scheduled retention task removes old identities and cascades associated events.
- Existing calendar evidence fallback remains intact. Authorized upstream 403/429 is classified separately, reports bounded retry information, and receives a five-minute cooldown in each warm relay instance. No anti-bot bypass, SSRF relaxation, fabricated event, or false successful response is introduced.

## Verification performed before release
- Full web suite: 146 files / 2,264 tests passed.
- TypeScript: passed. ESLint: zero errors; five pre-existing navigation warnings.
- Optimized Next.js production build: passed. Initial parallel build failed during typechecking; standalone typecheck and sequential rebuild passed.
- Exact migration executed in both embedded PostgreSQL tests and a disposable native PostgreSQL 18 instance. Anonymous write, erase, late-replay rejection and no private-schema access verified.
- Chromium at widths 390 and 1365: public home index/follow, signup noindex/nofollow, no horizontal overflow or page errors, zero analytics requests before consent/after decline. robots.txt and sitemap.xml both 200; nine public URLs.
- Read-only live mobile signup screen: required email/password/confirmation/terms present, 12-character minimum, empty form invalid, no horizontal overflow or JS errors. No signup request sent.

## Explicit limits
- A real production test-account creation attempt was blocked by the execution tool before execution. No account or verification email was created. Actual delivery/verification of a new signup email and full new-user onboarding are NOT certified by this release.
- Third-party 403 is not a SignalBrief permission that can be removed locally. Existing official-document fallback was observed succeeding; the new cooldown is per instance, not a global provider availability guarantee.
- The separate source `sec-ir-0001515940` reports `official_ir_link_not_found`; this is not the 403 issue and is not represented as fixed.
- Search engines decide indexing after crawl. No Search Console submission/ownership verification is claimed.
- Analytics starts after deployment and consent, cannot recover historical visits, and does not equal all humans or all site traffic.
