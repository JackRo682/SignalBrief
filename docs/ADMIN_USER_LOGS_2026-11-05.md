# Administrator user activity logs — November 5, 2026

## Requested change

Add one private user activity page to the existing SignalBrief site, usable by the administrator account identified by the owner, with normal recovery for login, permission, and service failures. The administrator's email and user ID are deliberately omitted from this public repository.

The existing verified Supabase account already belongs to the server-owned `app_private.sb_admin_users` allowlist. This release preserves that account and role; it does not create accounts, change passwords, add a public role editor, or enable analytics consent.

## User-facing behavior

Open the account menu → **사용자 활동 로그**, or visit `https://signalbrief.online/ops/user-logs`. The existing operations navigation also links to the page.

The page displays consented signed-in usage records and existing recorded product events, using Korean time. Filters cover date, internal user UUID, event, screen and device. Administrator traffic is excluded by default. Results have 50-row keyset pagination, safe record details, retry, and manual refresh. Four summaries describe the selected logs: records, distinct users, known sessions, and active time.

No records are fabricated or backfilled. No anonymous visitor or signup-start tracking is added by this change. The existing `/ops/analytics` page remains available; this release does not claim to implement the previously proposed eight-card PostHog dashboard. User activity and security audit records are distinct. Only allowlisted activity fields are returned; email, free text, raw errors, tokens and product payloads are excluded.

Optional analytics consent remains authoritative. The query only includes currently consenting users and the last 90 days. This describes the read window; it does not assert a new physical deletion job. Administrator test traffic can be included explicitly if that administrator has opted in.

## Access enforcement

`POST /api/admin/user-logs` validates the bounded request, current Supabase user and server-owned admin membership using the caller's bearer token and public project key. The SQL RPC independently verifies current identity, account status, the live auth session, administrator membership and MFA. It queries private records only after authorization. Public wrappers use invoker permissions; private guarded helpers have a fixed search path. Ordinary and anonymous clients cannot directly select raw log records or write their own admin grants.

Responses have `Cache-Control: private, no-store`, an Authorization Vary header, and a request ID. Errors contain allowlisted codes rather than database internals. The UI stores no logs in persistent browser storage and hides prior results immediately on account, token, permission or filter changes.

The Next.js route is documented in `packages/shared/admin-user-logs.openapi.json`, with request and response schemas derived from `apps/web/src/admin-logs/contracts.ts`. It is separate from the unchanged FastAPI schema. Reads use the existing request limiter and write only bounded access metadata to the existing private audit table.

## Recovery and failure states

- Signed out: show a sign-in action and retain an allowlisted internal return destination.
- Wrong account: show access denied, local-device sign-out/account switching, and service navigation. Google sign-in for an administrator return destination explicitly requests the account chooser so an existing Google session does not silently select the same wrong account.
- Expired or revoked session: return no logs and offer reauthentication.
- MFA: use the existing challenge flow.
- Missing administrator grant: fail closed; the project owner must restore a verified account through trusted project administration. No client-side automatic role assignment exists.
- Temporary auth/database failure: show an explicit error and retry without losing filters.
- Slow or abandoned requests: timeout and abort; ignore late responses.
- Rate limits: show a bounded cooldown.

The shared auth provider now invalidates the previous profile when the bearer token changes, ignores stale initial-session snapshots, and uses request revisions so earlier profile reads cannot overwrite newer role checks. A failed local sign-out preserves the current cache identity so later 401 responses still clear the session. Password and Google sign-in preserve only allowlisted internal return paths; the existing password-reset flow remains intact.

## Scope/provenance

Baseline: `3a6548955b42057c531c2c5fa1858fd36af89e4b` from `JackRo682/SignalBrief/main`.

The requested admin page and authentication recovery necessarily change previously protected admin/auth files. `docs/signed-in-workspace-boundary.json` records their reviewed before/after hashes and adds protection for the new admin source. The scope verifier and its failure assertions remain unchanged. Unrelated public pages, customer content, disabled feature flags and provider data are not changed.

## Verification

The local eight-stage `scripts/verify.py --full` gate passed: 364 backend tests, 1,904 frontend tests (including 33 actual embedded PostgreSQL cases), lint, type checking, schema export and the production build. The subsequent administrator Google account-chooser correction passed its 30 focused auth/return tests, scoped lint and type checking. Native PostgreSQL cases are intentionally skipped locally because there is no disposable server; 47 new cases are collected for the repository's native PostgreSQL CI job.

Desktop/mobile browser cases are part of the existing research suite. The release requires the exact-source CI checks, the native PostgreSQL suite, migration application, and live administrator acceptance before production completion. Review and CI results are attached to https://github.com/JackRo682/SignalBrief/pull/52. This document describes the implementation and gates; the deployment record and live URL establish production status.

References used during implementation:

- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/auth/sessions
- https://supabase.com/docs/reference/javascript/auth-signout
- https://supabase.com/changelog
- Installed Next.js route-handler and router documentation for version 16.4.3.
