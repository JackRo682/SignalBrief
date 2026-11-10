# Public search and acquisition setup
Public home, features, about and pricing explicitly override the default noindex with canonical, index/follow, Open Graph and Twitter metadata. Only these four routes enter the sitemap. Authenticated pages keep the default noindex and their existing authorization.

Search Console domain ownership was verified using an additive DNS TXT record. GA4 property 563550999 (stream 16309409757, G-TF2SCW0R3Q) is linked to that domain. The production NEXT_PUBLIC_GA_MEASUREMENT_ID is configured. Google-side sign_up is a key event once per session, with no assigned monetary value.

The Google script loads only after a visitor opts in. Basic consent keeps advertising storage, signals and personalization disabled. Only fixed public screen names, canonical paths and referrer origins are sent. Sensitive queries, OAuth codes, record IDs, account IDs, questions and holdings are excluded. Do Not Track / Global Privacy Control and storage refusal fail closed. Browser consent can be changed on public pages. Public visitor consent is separate from account-level internal research analytics, which remain unchanged. Confirmed signup is queued across the authentication redirect and emitted on the destination with a fixed signup URL; no private pageview is emitted.

A signup attempt alone is not a conversion. Only a Supabase-returned session or a verified OAuth user whose creation time belongs to the pending new signup can queue sign_up. No timestamp/unknown user, an existing account, or refusal produces no signup conversion. This is conservative browser-based attribution: different-device email confirmation, blocked storage/tags and missing consent are excluded; GA4 conversion totals are not total registered users.

Validation must distinguish isolated unit/browser transport from actual Google receipt. Repository release checks, native PostgreSQL and desktop/mobile browser checks are required before production release. Native Google receipt and sitemap submission are post-deployment checks; not yet claimed by this source commit.

The protected-source manifest is refreshed only for the exact public/auth sources authorized by this request; the scope verifier and retained feature hashes are unchanged.
