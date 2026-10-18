# Korean company profiles through OpenDART

## Context and acceptance

The requested company profile feature uses the already-authorized OpenDART
company overview API while Public Data Portal account access remains unavailable.
This does not claim that the Public Data Portal application was submitted.
Success means an authenticated Korean-company screen displays verified real
company records, source attribution and retrieval time, with private server cache,
missing-data/error handling and no browser API key. Prices, employees, industry
names inferred from codes, affiliate relationships and US profiles are out of scope.

## Implementation and API contract

`GET /api/company-profile?company_id=<uuid>` requires a bearer session and proxies
only to `signalbrief-profiles` in the existing Supabase project. The Edge function
validates the session against Auth and checks `sb_rate_limit`, then reads a real,
non-demo company under the caller's RLS identity. Only `provider=dart` and valid
eight-digit DART / six-digit stock identities are eligible. Client input cannot
select an upstream URL, DART identity or credential.

The Edge runtime reuses existing `DART_API_KEY` and `DART_RELAY_SECRET`. The private
Vercel relay allows the fixed `https://opendart.fss.or.kr/api/company.json` path.
HTTPS verification, bounded downloads, 60-second HMAC validity and database-backed
nonce rejection remain enabled. No secret is copied into the web bundle or Git.

Success: `{status:"verified", provider:"OpenDART", company_id, fetched_at,
source_sha256, source_url, profile:{corp_code,ticker,name,english_name,ceo,address,
website,established_on,industry_code,fiscal_month}}`. Nullable fields remain null.
Dates are calendar-validated ISO dates; only supplied HTTPS website links are
shown. Response DART and stock identities must match the stored company.
The browser validates the response with Zod before rendering text and source links.

Explicit upstream no-data returns `status:"not_available",profile:null`;
unsupported providers return `status:"unsupported",profile:null`. Invalid IDs: 422;
anonymous/expired sessions or invalid operations signatures: 401; missing company:
404; quota: 429; missing key: 503; upstream/mapping/response failures: 502.
Transport errors and provider error bodies are never reflected to clients.

Original immutable JSON bytes are archived in private `signalbrief-raw` under
`dart/profiles/<sha256>.json` before a normalized result becomes visible. The
existing private `sb_us_cache` stores verified results for 86,400 seconds and
explicit no-data for 600 seconds. Cache identity includes the company UUID, DART
identity and stock code. Failures are not cached. No new cache table is needed.
`fetched_at` is retrieval time, not a provider publication/update timestamp.

Live verification found an older SEC-only company resource predicate. The
`20261018054538_korean_company_profiles.sql` workspace migration adds non-demo
DART company rows to the existing private resource function. Its private schema,
caller grants, per-user saved state and reviewed-evidence predicates are preserved.

Operations may warm the same cache with `POST` directly to the Edge function using
`{kind:"company-profile-refresh",company_id,nonce}`, signed using the existing
HMAC format and replay-protected database claim. This cannot accept credentials or
arbitrary upstream URLs from a caller. The function uses application authentication
(`verify_jwt=false`), supporting both Supabase user sessions and signed operations.
Unsigned and replayed operations requests are refused.

## Verification

Production commit `7aa9ed486367dd06174ebe1936ce2d50f3066e16` is READY at
https://signalbrief.online (`dpl_GcActARqa6qJoqVWzLmUHs4nE8jw`). It incorporates
the existing daily-digest release without changing that feature. The user approved
follow-up backend fixes, production SQL and deployment through actual verification.
The `signalbrief-profiles` Edge function v2 is active and the Korean company resource
migration is applied. Anonymous profile requests return HTTP 401.

Real signed production requests for Samsung Electronics (005930), SK hynix (000660)
and Hyundai Motor (005380) all returned HTTP 200 / `verified` on 2026-10-18.
DART corp codes and stock codes match the stored companies. All three original
responses are archived by SHA-256 in private Storage. Repeat requests returned the
same source hashes and `fetched_at` values, confirming cache reuse. No synthetic
record or synthetic API key is used as evidence of successful provider access.

Local verification on the integrated release: backend 251 passed / 103
environment-gated skips; frontend 573 passed across 51 files with two workers;
compile, export, lint, typecheck and production build passed. The default parallel
frontend run encountered existing timing failures; no assertions were weakened.
Deno typecheck, profile-specific tests and desktop/mobile profile E2E passed.
Signed-in production browser verification confirmed all three companies display
company name, CEO, establishment date, industry code, fiscal month, address,
OpenDART attribution and retrieval time. Desktop/mobile layout and retry behavior
also passed isolated E2E checks.

All 36 disposable-loopback PostgreSQL workspace tests passed, including Korean
company lookup, demo exclusion and anonymous-access regression checks. Regressions
also cover mismatched companies, invalid dates/links, missing values, authentication,
operation replay rejection, archival, cache reuse and retry. Browser fixtures are
clearly synthetic and are not provider evidence.

## Rollback

Remove the profile components and proxy route from the web release and redeploy
the previous web commit. The new function may remain inaccessible to anonymous
GETs. Restore the prior SEC-only company resource function to roll back Korean
discovery if needed. Existing filing
collection continues with its list/document relay modes. Archived sources are
retained. Profile-cache entries expire within one day.

Official schema: https://opendart.fss.or.kr/guide/detail.do?apiGrpCd=DS001&apiId=2019002

