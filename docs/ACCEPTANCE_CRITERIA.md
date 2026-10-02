# Acceptance criteria

## Automated regression (implemented)
Authentication denies invalid/expired/wrong issuer/role/algorithm tokens; admin metadata spoofing is ignored.
Users cannot alter/read another user's watchlist/positions/alerts/calendar. Production refuses demo settings.
Re-ingestion preserves one document identity, one immutable original and atomic parse enqueue. Same-ID changed bytes are audited.
Every excerpt belongs to a real persisted source chunk. Wrong numeric tokens/units and missing/conflicting sources block publication.
Numeric changes use decimal values and valid comparable old/new context; missing history is explicit.
Job lease expiration, fencing, cooldown, retry exhaustion and request budgets are enforced.
App source/brief/ops API happy and failure paths, consent exports and synthetic seed reruns are covered.
SQLite frozen schema upgrades/downgrades and real asymmetric cryptographic JWT verification are covered locally.

## Required integration acceptance (not yet met in this environment)
A real clean npm install → lint → full TypeScript check → tests → Next production build succeeds.
Browser desktop and mobile complete login/onboarding/source-follow-up/settings and denied-Ops flows.
Real Supabase Google OAuth callback and logout/session expiry function on final HTTPS domains.
A disposable PostgreSQL database passes migrations and direct role-based owner-isolation checks.
A real DART and SEC document survive download, private raw persist, parse, review and idempotent retry.
An approved case publishes with both historical/current evidence; rejected historical evidence blocks dependents.
No real user sees synthetic fixtures, raw provider keys, or confidential Ops payloads.
Server/worker redeploy leaves original raw documents retrievable, and database restore is tested.
Independent human review establishes acceptable actual financial extraction/abstention performance before public release.
