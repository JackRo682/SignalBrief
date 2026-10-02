# SignalBrief Security and Responsible Operation

Version 1.1 • Required engineering controls, not a legal-compliance certification

## 1. Threat boundaries

Protect login tokens, private watchlists/holdings/questions, source integrity, publication controls, provider credentials, and spend limits. Attack surfaces include browser/BFF, API ownership checks, worker queue, remote filings/IR documents, model prompts/outputs, admin sessions, analytics and storage URLs. Treat all source documents, free text and model output as untrusted.

| Threat | Required control | Verification |
|---|---|---|
| Cross-account object access | JWT verification + active profile + owner predicates + RLS; not ID secrecy | User A cannot list/get/change/delete user B objects, including nested positions/questions/exports |
| Forged/stale JWT | Verify signature with allowed algorithm/key, issuer, audience, expiry/nbf and sub; JWKS refresh bounded | Invalid algorithm/issuer/audience/expired/unknown-key fixtures fail closed |
| Session theft / CSRF | Secure HttpOnly SameSite=Lax cookies; PKCE/state; Origin/CSRF checks for BFF mutations; safe redirects | OAuth state mismatch, external return URL and cross-origin writes rejected |
| Admin privilege escalation | Server-controlled active membership; recent auth and MFA for write controls; no user metadata roles | Non-admin 403; self-role edit impossible; stale auth requires reauth |
| Prompt injection | Evidence as data; no arbitrary tools/URLs; allowlisted source IDs; validate outputs | Malicious document cannot change policy, leak secrets, call tools or self-approve |
| SSRF / malicious sources | Fixed provider hosts, HTTPS, bounded redirects; block private/link-local/metadata IPs on every hop; no user URL ingestion | Redirect/DNS/IP bypass fixtures rejected |
| XML/zip/PDF abuse | Disable external entities/scripts, cap compressed/uncompressed bytes/pages/time/memory, sandbox parser | Zip bomb/path traversal/XXE/oversized malformed document blocked |
| XSS / unsafe rendering | Text-only excerpts, sanitized Markdown allowlist, CSP, no arbitrary iframe/source HTML | Embedded scripts and malicious links do not execute |
| Source tampering / stale citations | Immutable source hashes/locators, revision lineage, compare checks | Changed bytes force new version and invalidate prior locator assumptions |
| Numeric/context error | Exact decimal logic, basis/period checks, dual citation, human review of risky cases | Zero/negative, currency/scale, YTD and amendment fixtures |
| Provider spend abuse | Admission quotas, atomic budget reservations, concurrency and deadline caps | Concurrent submissions cannot exceed allowance; unknown pricing blocks calls |
| Secret leakage | Managed secrets, separate runtime roles, log/telemetry scrubbing, secret scan | Build bundle and logs contain no privileged key/JWT |
| Privacy leakage through telemetry | Consent and property allowlists; no replay/autocapture; retention/delete jobs | Snapshot payload assertions; analytics opt-out and purge tests |
| Duplicate publication/notification | Unique keys, lease fencing, transaction + outbox | Crash/retry/concurrent worker yields one logical publication/notification |

## 2. Authentication and authorization details

Google identity is federated through Supabase. Server-side start/callback handles code/PKCE; permitted redirect URLs are explicit for local/staging/production. Do not build passwords. A thin BFF stores access/refresh session securely; refresh tokens are never handed to FastAPI. FastAPI validates the access token independently using a maintained JWT library and project JWKS; never decode without signature verification. Support key rotation, bounded caching and unknown-key refresh without accepting untrusted issuers.

For deletion/export and Ops mutation, reauthenticate within 10 minutes. Proposed `/auth/reauth` starts a new verified provider/session challenge; server issues a short-lived, one-use action-bound reauth token. Ops users additionally enroll a supported MFA factor before mutation rights. If provider/session cannot establish required assurance, disable Ops mutation until configured; do not downgrade to a client boolean.

API DB role is not an owner and cannot bypass RLS. Transaction-local verified user claims must be cleared by transaction end. Worker and migrator use separate credentials. RLS provides defense in depth, while explicit repository ownership checks make intent reviewable. Restricted worker functions for alerts/deletion are narrowly parameterized and audited; if SECURITY DEFINER is used, fix search_path and reject caller-supplied arbitrary SQL/owner identity.

## 3. Evidence policy and financial content

Never produce buy/sell recommendations, sizing advice, target prices, automatic trades, certain forecasts, or unsupported financial facts. Classify facts, comparisons, interpretations and next checks. Conditional interpretation cannot introduce unsupported causal assertions. “This filing occurred before a price move” would require licensed price evidence and still would not establish causation; V1 contains no such feature.

Source tier is an authority rule, not a truth guarantee. A Tier 1 filing can contain company estimates, risk statements or corrected errors. Match context and preserve amendments. Disputed claims do not become true because a higher-tier document is newer; disclose conflict and date/basis. Human reviewers may approve a limited supported presentation, never override failed numerical/citation gates.

Display information-only scope plainly. This label does not determine regulation, privacy obligations, source copyright or redistribution rights. Before public beta the owner must document allowed access/redistribution for each provider/issuer, privacy terms/data locations and any necessary qualified legal review. No blanket legal conclusion is made here.

## 4. Data minimization and retention

Collect only Google account identity needed for login, chosen companies, optional manual weights, preferences, feedback, event-scoped questions and minimal served/rendered revision exposures and accuracy-notice acknowledgements needed for corrections. No brokerage credentials, financial account numbers, trade history, payment data or precise wealth. Keep names/emails out of model prompts; send only public-company context and the minimum question text. User deletion removes owned data and model-context copies under our control; provider-side retention is separately disclosed and verified before beta.

Retention defaults are canonical in DATA_MODEL. Configure vendor settings and paid-tier backup retention before claiming them. Vendor region, data processing agreement and cross-border transfer obligations remain launch checks, not invented facts. Model provider training/retention behavior must be checked against current account settings and contract at implementation; do not promise zero retention by default.

## 5. Operational controls

- TLS everywhere; private source objects; authenticated excerpt service. Original public source links are direct approved URLs with no authentication keys.
- Store secret keys only in runtime secret managers. Separate dev/staging/prod and API/worker/migrator credentials. Rotate on exposure and rehearse it.
- Daily cost caps use cost reservations plus actual reconciliation; a crash must release/reconcile reservations, not create unlimited budget.
- Backups encrypted under provider capabilities; restore drill with documented RPO/RTO and access restrictions.
- Audit actor, time, subject, old/new version and reason for review/publish/withdraw/replay/config changes. Never store private reasoning traces or full tokens.
- Dependency pinning/lockfiles, vulnerability triage, secret scanning and least-privilege CI credentials. A failed check has an owner and disposition, not a silent skip.

## 6. Incident and release gate

Severity 0: cross-user data disclosure, active secret compromise, unauthorized admin publication. Disable affected access immediately, rotate/revoke credentials, preserve audit, identify scope, follow applicable notification obligations after qualified review.

Severity 1: published wrong issuer, materially wrong number/comparison, unsupported material claim or forbidden advice. Pause affected class, withdraw narrative, persist and deliver P0 correction/withdrawal notices to exposed viewers through the authenticated app, regardless of normal alert opt-in, mute, cap or optional analytics consent, investigate source/run/config lineage and re-evaluate before resuming.

Severity 2: delayed provider, parser gaps, excessive irrelevant alerts, retry/cost issue. Show freshness, cap intake, repair and reconcile gaps without inventing content.

Release blockers: failing ownership tests, unverifiable publication gates, leaked privileged secrets, unbounded source fetch/AI spending, lack of source rights record, or undisclosed coverage/retention limitations. P0 release also requires a working persistent accuracy-notice path and catch-up reconciliation for exposure/withdrawal races. This is an in-app accuracy obligation; it does not add email/push delivery. Accessible mobile error handling and a rollback/withdrawal/notice drill are required alongside happy-path tests.
