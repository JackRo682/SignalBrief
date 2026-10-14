# Production provider release — 2026-10-14

## Email
The user selected alerts@notify.signalbrief.online and a personal verification inbox. The dedicated domain is verified, including DKIM/SPF. Sender tracking is disabled and TLS enforced. The sending key is domain-restricted and stored in Supabase Vault. No credentials are in the repository.

New email notifications require explicit per-user opt-in and an existing reviewed/published app notification. Quiet hours, muted issuers, verified recipient identity, publication state and suppression are checked again before sending. A durable outbox records submission separately from delivery. Retries reuse the same deterministic provider idempotency key, at most three attempts and within 20 hours. Delivery/bounce/complaint events require a valid, recent Svix signature and are deduplicated.

Delivery is processed by the existing 15-minute collector. Daily digest and streaming push remain unavailable.

## OpenDART
Document retrieval uses the official document.xml endpoint. Preserve exact ZIP bytes and SHA-256, inspect the central directory before decompression, reject unsafe members/encryption/expansion bombs, verify CRC and member sizes, reject DTD/entities, parse all supported XML members and archive the entire normalized text. Limits: 20 MB compressed, 32 MB expanded, 20 XML members. Over-limit or unsupported documents fail explicitly.

AI analysis is explicitly a bounded normalized excerpt, while the complete normalized text and original bytes are preserved. Failed drafts cannot be approved; stored validated drafts require an authenticated administrator's review. Actual production verification still requires DART_API_KEY.

## Stocks and indices
KIS Korean equity REST snapshots and KOSPI/KOSDAQ index requests use official identifiers and transaction IDs. Auth tokens use private caching, provider-expiry-aware TTL and a database lease to avoid concurrent token issuance. Returned retrieval times are explicitly different from exchange timestamps. Korean historical charts and streaming subscriptions are not supplied by this release.

FMP NASDAQ Composite and S&P 500 use ^IXIC and ^GSPC. Index endpoint entitlement is separate from general stock display permission. No provider call is made without verified rights. The website displays explicit unavailability instead of synthetic values.

## Operator configuration
- DART_API_KEY: Supabase Edge Function secret or Vault name signalbrief::DART_API_KEY.
- KIS_APP_KEY / KIS_APP_SECRET: server credentials only. Actual public display authorization requires kis_display_enabled=true, kis_license_reference and unexpired kis_license_until.
- FMP: require actual fmp license proof/expiry. fmp_indices_display_enabled remains false until index access and rights are verified.
- GNEWS_API_KEY: server credential plus actual permitted usage plan; gnews display reference and expiry are mandatory.
- Paid vendor plans require a concrete quote and user approval; the existing $1/day OpenAI cap does not authorize unrelated subscriptions.

## Live verification evidence
The production application queue sent one authorized verification email. Resend reported delivery and both signed sent/delivered callbacks returned success; the private outbox recorded delivered after one attempt. No users were opted in automatically. SEC collection succeeded on the same run; DART lacked a key and a numerically invalid AI response was rejected rather than published. Private UI flows require signed-in browser verification; provider activation remains incomplete until the missing credentials and display agreements exist.
