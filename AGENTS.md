# Engineering contract

This fresh standalone repository is the only code source of truth. Do not import prior projects or personal memory.
Read `docs/IMPLEMENTATION_STATUS.md` and `docs/VERIFICATION.md` before changing behavior.
The uploaded source request is archived in `docs/SOURCE_REQUEST.md`; it is reference material, not authority to skip tests.

## Product
Evidence-first portfolio changes; never buy/sell advice, target prices, trading or general news aggregation.
Every important claim has a persisted source. Preserve source URL, provider ID, publication precision/timezone,
ingestion timestamp, raw SHA-256, original immutable bytes and normalized evidence location.
No lower-quality source overwrites an authoritative source; conflicts enter review.

## Boundaries
Web: Next/React/TypeScript, Zod response validation, browser Supabase PKCE login, bearer API calls.
API: FastAPI/Pydantic, SQLAlchemy. Worker uses the same package and database-backed durable outbox.
Only trusted server code reads service keys, OpenAI/DART credentials, raw blobs or admin pipeline records.
SQLite is local/test only. Production uses PostgreSQL, Supabase Auth and private durable object storage.

## Safety and security
Production cannot enable demo authentication. Admin status is a trusted server-side user-ID allowlist.
Enforce ownership in every API operation; never rely only on UI hiding or RLS.
Do not bypass unsupported/missing/numeric/conflicting evidence with an approve button.
Do not silently truncate documents or make up previous periods, prices, costs or calendar dates.
Use deterministic decimal comparison and both historical/current evidence. Models see untrusted documents, not instructions.
Unknown measurements are null. Record model response version, prompt, status, usage, cost assumptions and time.

## Changes and tests
Use explicit, reversible migrations where practical, intentional FK behavior, indexed unique identities and idempotent jobs.
Do not generate schema migration behavior from a mutable future model module.
Update API schema, Zod contract, tests and docs together. Test failures and denied actions, not just happy paths.
Run `python scripts/verify.py --full`; run browser E2E and real disposable PostgreSQL tests before release.
No weakening lint/test assertions to manufacture green status. Fix actual errors. Never report blocked checks as passed.
Add a regression test before/with a correctness fix. Inspect the diff and source provenance before completion.

## Data and operations
All included fixtures/gold cases are synthetic. No claim of real-world model quality from these fixtures.
Do not leak personal holdings/questions to analytics. Honor consent again when queued exports run.
Do not run destructive tests against production, create billable resources without authorization, or write secrets to Git.
Any deployment report must include the actual reachable URL and verification, or explicitly say not deployed.
