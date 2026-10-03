# Hosted security review — 2026-10-03

The Supabase security advisor was run against the existing project after migrations. It reported no ERROR-level items, but it is not a clean bill of health: WARN-level results identify authenticated/public SECURITY DEFINER RPCs and three INFO items identify intentionally inaccessible internal tables with RLS and no client policy.

## Intentional elevated RPCs

User mutations, profile creation, rate accounting, evidence-bound answers and operator actions are SECURITY DEFINER because browser roles have no direct write permission. Their functions pin an empty search_path, use schema-qualified names, derive identity from auth.uid(), enforce ownership and limits, and check the separate private administrator allowlist for operator actions. The live rollback probes verified cross-user isolation, direct-write denial, non-admin denial and bounded mutation behavior. This is selected operation coverage, not a proof of all possible database behavior.

Public calendar-subscription functions accept a 256-bit opaque bearer capability whose SHA-256 hash is stored privately. URLs expire in 90 days and can be revoked. Anyone holding a valid subscription URL can see its calendar events; the UI explicitly warns users not to share it. Public health returns only a readiness flag and schema version, never user data. The legacy sb_calendar_feed is retained for compatibility; new code uses sb_calendar_subscription_feed. These endpoints warrant continued abuse/load testing even though their public accessibility is intentional.

The three no-policy tables are alembic_version, provider_limits and rate_buckets. Browser access is intentionally denied; policies must not be added merely to silence the advisor.

The Edge Function disables the gateway's legacy verify_jwt mode for publishable-key compatibility but explicitly verifies every private bearer token with Supabase Auth before database access. The same bearer identity executes RLS-backed queries. Anonymous and invalid-token calls to account/portfolio/operator routes were tested and rejected. Public config/health and token-capability calendar requests are explicit exceptions.

## Remaining security work

Rotate the Google OAuth client secret exposed earlier in the conversation before public release. The new secret must stay in the Google provider settings, never source, frontend config, screenshots or logs. Real Google login requires the account owner to complete the interactive consent flow; authorization redirects alone do not verify successful session exchange.

A high-severity development-only dependency advisory remains in the full npm tree. The production-only audit reports zero; the full-tree gate stays failing. See SECURITY_ADVISORY_20261003.md. Production backup/restore, realistic load/outage tests and final privacy/retention policy still require validation.

Advisor references:
- https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable
- https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable
- https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy
