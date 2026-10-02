# Execution plan format

For a nontrivial change record: context; goal; non-goals; observed current behavior; assumptions;
implementation files; schema/API changes; risks; tests; actual verification output; rollback; acceptance criteria.

First unresolved execution plan: install real JS/Python dev dependencies; resolve lint/type/build issues;
run browser E2E; run actual PostgreSQL/RLS tests; connect authorized external accounts; validate live source ingestion;
perform human financial review and operational security checks before opening a beta.
Use `docs/VERIFICATION.md` as evidence, not a blanket production-readiness claim.
