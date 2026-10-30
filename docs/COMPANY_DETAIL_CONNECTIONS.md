# Company detail connections — 2026-10-19

Company pages previously omitted Korean documents/events from the shared resource projection and did not include the separately ingested DART filing list. The profile widget also skipped every US issuer.

## Changes

- Include SEC and DART canonical documents/events using the existing `sb_document_visible` and `sb_event_visible` checks. Publication and validation requirements are unchanged.
- Include authenticated DART filing metadata as `kind=filing`, matching the existing SEC filing flow. Require a 14-digit receipt, its exact official DART URL and date precision. Exclude demo companies. Do not return private storage paths or pending analysis.
- Add DART filing-list provenance to document detail; label its checksum as the list envelope rather than original filing bytes.
- Extend the existing authenticated `/api/company-profile?company_id=<uuid>` endpoint's Edge Function to SEC submissions. Check both CIK and ticker, archive source bytes, cache by issuer/provider, and retain the original DART flow. Enforce MFA before provider reads. SEC contact configuration and provider quota checks remain required.
- Display the profile in desktop, mobile and workspace company views. Validate returned ticker, isolate state by session/issuer, and retain retry/loading/missing-data states. Show provider source and retrieval time. SEC does not supply CEO or founding date here; those fields stay null.
- Keep financial facts connected to published, supported canonical evidence. Explain absent financial figures. Keep charts connected to the existing licensed quote API and distinguish display-license, missing-credential and transport failures. No price display flags are enabled.

The profile response retains `status`, `profile`, `source_url`, `fetched_at` and `source_sha256`. `provider=SEC EDGAR` and optional `profile.industry_description` distinguish SEC issuer information. This Next.js proxy contract is separate from the FastAPI OpenAPI document.

## Hosted database verification

The `company_detail_connections` migration was applied to the SignalBrief project on 2026-10-19. A guard checked that the two hosted function definitions still matched the reviewed versions before replacing them.

Read-only checks returned 9 Samsung Electronics filings, 1 Hyundai Motor filing and 1 SK hynix filing. Existing US resources remained present, including Apple's 2 canonical documents and 2 events. All projected DART receipt URLs matched the official source; anonymous execution remained denied for both changed private functions.

The migration changes functions only, without inserting, approving or publishing financial analysis. The 4th checklist issue (review and canonical publication) still determines whether pending Korean financial facts/events can appear. Provider authorization still determines chart availability.

## Validation and release state

- Disposable PostgreSQL/PGlite executes the actual migration and checks Korean/US visibility, unpublished/demo exclusion, official DART URLs, document metadata and denied anonymous calls. Visibility helpers in that isolated test are synthetic stubs; the existing full publication-validation policies are retained verbatim, not re-proven by this test.
- Company profile/Edge/core/UI regression tests pass, including issuer mismatch and archival/cache behavior. These are synthetic responses, not live SEC accuracy claims.
- Backend: 251 passed, 103 skipped. Skips require the repository's separate disposable PostgreSQL environment. The new migration has its own executable PostgreSQL regression above.
- TypeScript and production build pass. Lint has no errors; existing navigation warnings remain.
- Final frontend suite: 587 tests passed across 53 files. The earlier full run exposed test synchronization races. Tests now wait for the retry button to be enabled and the persisted remaining row to reappear, preserving the original failure/retry/partial-delete assertions. The focused company SQL/profile/UI and discovery set also passed all 70 tests.
- Desktop/mobile browser checks: 4 passed against the local production build, using isolated synthetic responses. They cover profile, exact financial strings, Korean document links, chart rendering, display-permission explanations and horizontal overflow. Real signed-in production browsing and live SEC retrieval are not claimed.
- Production Edge Function replacement was rejected by automatic approval review because it changes a live authenticated/provider/storage path beyond the reviewed database migration. The new SEC profile implementation and frontend changes are prepared for review; neither is claimed as deployed. Obtain explicit deployment approval before release.

For database rollback, restore the `sb_workspace_resources` definition from `20261018054538_korean_company_profiles.sql` and the `app_mobile_private.document_detail` definition from `20261006130828_mobile_document_detail.sql` using `CREATE OR REPLACE FUNCTION`, retaining their original grants. Do not replay the entire earlier migration, which also creates existing schemas/wrappers.
