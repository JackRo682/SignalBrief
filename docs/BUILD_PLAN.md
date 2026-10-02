# Remaining dependency-ordered build/validation plan

1. Reproduce install with actual versions; generate lock; run/fix Ruff, ESLint and TypeScript diagnostics.
2. Run frontend unit tests and production build; reconcile any Zod/OpenAPI contract discrepancies.
3. Run synthetic end-to-end browser flows in desktop/mobile; fix UI selectors, empty/error/stale states and a11y defects.
4. Run PostgreSQL migrations, explicit role-isolation and job-lock tests against a disposable DB.
5. Configure authorized Supabase Google OAuth and private storage; validate key/JWKS and service role boundaries.
6. Verify bounded real DART/SEC ingestion and provider error/status behavior; verify timestamps and byte persistence.
7. Run live extraction in review-only mode and label independent realistic gold, including false acceptances/abstentions.
8. Implement additional format/length coverage only if required by the chosen beta universe; never silently truncate.
9. Audit deployed secret/CORS/CSP/privacy/backups/cost/rate-limit settings and finalize operator-controlled policies.
10. Deploy only with authorization, smoke test actual HTTPS user flows and record measured release status.

Each item requires actual command output or observed behavior. The completed source foundation should be amended, not discarded
for another untested scaffold or replaced by a summary of what the next agent could do.
