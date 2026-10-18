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
identity and stock code. Failures are not cached. No schema migration is needed.
`fetched_at` is retrieval time, not a provider publication/update timestamp.

Operations may warm the same cache with `POST` directly to the Edge function using
`{kind:"company-profile-refresh",company_id,nonce}`, signed using the existing
HMAC format and replay-protected database claim. This cannot accept credentials or
arbitrary upstream URLs from a caller. The function uses application authentication
(`verify_jwt=false`), supporting both Supabase user sessions and signed operations.
Unsigned and replayed operations requests are refused.

## Verification

Results and deployment identity will be recorded after live verification. New
regressions cover mismatched companies, invalid dates/links, missing values,
provider quota/key errors, authentication, operation replay rejection, archival,
cache reuse, retry and navigation. Browser regressions use clearly synthetic
records and run on desktop and mobile. Synthetic test data is not provider evidence.

## Rollback

Remove the profile components and proxy route from the web release and redeploy
the previous web commit. The new function may remain inaccessible to anonymous
GETs; no existing Edge function or schema has been replaced. Existing filing
collection continues with its list/document relay modes. Archived sources are
retained. Profile-cache entries expire within one day.

Official schema: https://opendart.fss.or.kr/guide/detail.do?apiGrpCd=DS001&apiId=2019002
