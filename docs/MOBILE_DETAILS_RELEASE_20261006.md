# Mobile detail screens — second reference set, 2026-10-06

This release continues GitHub main `e14e1788a61d96ad467ad1bae214b6152c198389`.
It implements the second set of ten supplied 864 × 1536 PNGs as dedicated,
interactive mobile views. It retains the existing desktop views and real
authenticated data contracts. Synthetic reference-image numbers, dates, user
identities, security claims and service-health labels are not production data.

## Screen and source mapping

| Reference | Screen | Route | Primary mobile module |
|---|---|---|---|
| `01-1000000213.png` | AI follow-up questions | `/questions?event=…` | `apps/web/src/mobile/questions.tsx` |
| `02-1000000212.png` | Appearance and language | `/settings/appearance` | `apps/web/src/mobile/appearance.tsx` |
| `03-1000000211.png` | Help and support | `/help` | `apps/web/src/mobile/help.tsx` |
| `04-1000000210.png` | Document detail | `/documents/[id]?kind=document` or `filing` | `apps/web/src/mobile/document.tsx` |
| `05-1000000209.png` | Security and sign-in | `/settings/security` | `apps/web/src/mobile/security.tsx` |
| `06-1000000208.png` | Account information | `/settings/account` | `apps/web/src/mobile/account.tsx` |
| `07-1000000217.png` | Calendar | `/calendar` | `apps/web/src/mobile/calendar.tsx` |
| `08-1000000216.png` | Company timeline | `/timeline`, `/companies/[id]/timeline` | `apps/web/src/mobile/timeline.tsx` |
| `09-1000000215.png` | Notification settings | `/settings/notifications` | `apps/web/src/mobile/notifications.tsx` |
| `10-1000000214.png` | Alert center | `/alerts` | `apps/web/src/mobile/alerts.tsx` |

The shared mobile shell provides compact back/title/search/account headers for
detail pages. Questions use a fixed composer and omit the bottom navigation.
Document detail selects Saved in the bottom navigation; company timelines select
Watchlist; the alert center selects Alerts. The alert badge follows the page's
actual unread count and is scoped to the authenticated account, without a duplicate
notification fetch. Only the visible desktop or mobile screen mounts.

## Implemented interactions and persistence

Questions preserve event-specific persisted conversations, full numbered source
citations, follow-up suggestions, context selection and history restore/delete.
The existing hosted answer service retrieves reviewed evidence and retains
answered, abstained, policy-blocked and unavailable outcomes.

Appearance uses versioned account preferences for light/dark/system theme,
compact/comfortable spacing, text size, motion and language. Sliders retain focus
while moving and commit on pointer release, keyboard completion or blur. Failed
saves retain the persisted setting. Reduced motion disables chart animation;
system reduced-motion settings also apply. The preview uses supported company
records and displays quotes/charts only when the provider returns them.

Help searches the authored help catalog, filters categories and expands FAQs.
Support submissions use an idempotency key and private account-owned tickets.
PNG/JPEG/WebP/PDF attachments are content-validated, bounded to 5 MiB, stored in the
private support bucket and linked to an owned ticket. Partial upload failure
retains the saved ticket and permits attachment retry. My requests shows actual
state and private attachment links. Operator controls remain server-authorized.
The service-status row points to actual diagnostics and does not assume health.

Account information reads the real Auth identity and profile; it edits name/bio,
time zone and locale, exports account data, and signs out the current device.
History and analytics preferences and the privacy/deletion-request route remain
available. No request is shown as an already completed account deletion.

Security shows actual linked identities, MFA factors, sessions and audit actions.
TOTP setup is activated only after a successful code check. Removal also verifies
a current code. Password changes reauthenticate the current password and any
verified MFA factor before updating; OAuth-only accounts use verified password
recovery. Provider unlinking refreshes identities and blocks removal of the final
sign-in method. Other-session sign-out uses the existing Auth operation. Unknown
device location, password-presence status or suspicious-activity verdict is not
invented. Unimplemented security-email preferences are disabled and labelled.

Calendar supports real dates, month/day selection, company/category views,
sorting, source/event destinations, private personal schedules and existing
calendar actions. Event-interest toggles save the actual reminder association.
The current reminder API returns `delivery: saved_interest_only`; it does not
promise a timed push or email. Timeline type counts and period filters derive
from actual events, with source links, watchlist persistence and expandable
published interpretations.

Notification settings persist in-app permission, minimum importance, excluded
companies, quiet hours and daily caps through existing account APIs. Email/digest
and security-email delivery are unavailable until a delivery implementation is
connected. The alert center filters real notifications, navigates to their
actual event/company destinations and persists individual/all read state. A
failed mutation does not change the UI to a successful state.

## New document detail API

`POST /api/workspace` accepts:

```json
{"action":"document_detail","p":{"id":"<document UUID>","kind":"document","section_offset":0}}
```

`kind` is `document` or `filing`. The optional section offset is an integer from
0 through 2147483600. Unknown fields and caller-selected identities are rejected.
The BFF verifies the bearer token with Auth, checks browser origin, bounds the
request body and returns private, non-cacheable responses. It invokes
`public.sb_document_detail(p)` with the caller's JWT and the public project key.

The additive migration is
`supabase/workspace-migrations/20261006130828_mobile_document_detail.sql`, whose
timestamp was generated by Supabase CLI. The public entry point is SECURITY
INVOKER. Its privileged helper is in the isolated, unexposed
`app_mobile_private` schema, uses an empty search path and independently checks
Auth identity, MFA, strict input, rate limits and existing resource visibility.
Anonymous execution is revoked. Existing tables, user data and policies are
retained. The existing rate counter is the operation's only write.

The response contains an exact resource, safe stored MIME/size/hash/provenance,
published summaries, supported numeric facts as exact strings, reviewed source
sections, linked visible events and related documents. `raw_blobs.object_key`,
private download URLs and arbitrary provider metadata are never returned.

Section visibility matches existing `document_chunks` RLS: a chunk needs a
visible reviewed fact; a published event does not expose every unreviewed chunk.
Source text and quotes remain complete. Sections paginate 12 at a time with
`sections_total` and `next_section_offset`; other arrays have an explicit cap of
50 and separate full counts. Prior-period evidence links to an actually visible
current event when its origin event is not published. Rejection of an ancestor
continues to hide the dependent analysis.

Missing file size, MIME type and page count remain null. SEC form names do not
establish a PDF type or page count. A filing's stored checksum identifies its
archived SEC submissions envelope and is labelled "SEC submissions SHA-256";
it is not described as a checksum of the filing document bytes. The separate `us_analyses` pipeline is not
silently treated as published legacy `events`/`briefs`. A filing can therefore
have an original-source link and metadata while having no published summary or
question context. Document AI actions choose a linked published event and use
that event's reviewed evidence.

## Services, configuration and availability

This release adds no new paid resource, subscription, outbound messaging service,
provider budget, scheduled worker or webhook. It reuses the existing Vercel and
Supabase projects. Existing project/usage billing continues under the owner's
plans; deployment is not a claim of unlimited free hosting.

| Capability | Required existing configuration | Availability boundary |
|---|---|---|
| Website and authenticated BFF | Vercel; `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`; same-origin `/api` routing | Public variables must be present in the deployed environment; private vendor/service keys must never use `NEXT_PUBLIC_` |
| Account data, documents, tickets and storage | Supabase PostgreSQL/Auth/private storage; existing migrations plus the new document-detail migration | Existing caller ownership, visibility and MFA gates apply |
| Google sign-in | Google OAuth client ID/secret in Supabase Auth provider settings; authorized Google callback `https://xabzzhtdmqsaqdauthbu.supabase.co/auth/v1/callback`; site/redirect allowlist including `https://signalbrief.online/auth/callback` | Provider initiation/callback configuration is distinct from a completed interactive Google consent session |
| Password recovery and verification mail | Configured Supabase Auth email delivery/SMTP and valid recovery redirect | Email sending and receipt need a separate live delivery check; no SMTP service is purchased by this release |
| TOTP MFA | Existing Supabase Auth MFA; user's authenticator app | Enrollment and code verification are required; no SMS service is introduced |
| SEC source collection | Edge secret `SEC_CONTACT_EMAIL`; operator ingestion and reviewed source pipeline | A configured contact is not evidence that a filing has already been collected or reviewed; scheduled ingestion remains separately gated |
| Prices/charts | Edge secret `FMP_API_KEY`, valid documented display rights, `fmp_display_enabled`, `fmp_license_reference`, `fmp_license_until` | API-key presence alone does not grant display rights; absent entitlement means unavailable quotes |
| Generative SEC extraction | Edge secret `OPENAI_API_KEY` and an approved positive `ai_daily_budget_usd` | Zero/unapproved budget stays disabled; current event follow-up evidence retrieval is separate |
| Optional headlines | `GNEWS_API_KEY` and documented deployed-site entitlement/configuration | Not required by these ten screens; no news subscription or license is activated |
| Outbound investment email/digest | Delivery implementation, `RESEND_API_KEY`, verified sender and `resend_from` | Bulk alert/digest delivery is not implemented by this mobile UI release; no misleading enabled toggle |
| Background push / timed event reminders | A separately implemented delivery worker and permission/subscription lifecycle | The current saved-interest association is persistent; it is not a timed delivery guarantee |
| Korea disclosures/prices | Separate supported provider, credentials, legal display rights and collection/review integration | Remains outside active supported coverage |
| Optional Python worker | Existing `apps/api` implementation and its server-only `SB_*` configuration | Source is included in the project; this release does not provision a running worker |

The exact current non-secret provider readiness and data counts are checked
read-only during release. Only names and configured/not-configured state should
be recorded; credential values must never be included in artifacts or GitHub.
No numeric vendor price is asserted without a current provider quote. Any later
paid plan, license or positive usage budget needs explicit cost authorization.

Read-only checks on 2026-10-06 confirmed the deployed database health endpoint as
ready, SEC contact/FMP/OpenAI credentials present, Resend/GNews credentials absent,
and FMP display, generative AI budget and scheduled ingestion disabled. Korea
coverage remains deferred. The fresh `/api/us/auth-diagnostic` result at
13:24:51 UTC reported Google enabled, a 302 Google redirect and matching Supabase
callback/client-ID format, with interactive sign-in explicitly unverified. An
older persisted Google error in provider history does not replace that newer,
narrower initiation check. No account or provider configuration was changed.

## Verification and release evidence

Required gates are `python scripts/verify.py --full`, the existing desktop/mobile
browser suite plus `mobile-details.spec.ts`, and the real disposable PostgreSQL
workspace replay. Browser tests use explicit synthetic responses for UI coverage;
they do not claim live financial-provider quality or mutate production accounts.
The new SQL cases verify exact quote/decimal preservation, private metadata
exclusion, section pagination, document visibility, predecessor lineage,
account-scoped saved state, input rejection, Auth/MFA and narrow function grants.

Final test outcomes, CI run links, reviewed screenshots, migration ledger entry
and production deployment identity are recorded in the release pull request.
`GET /api/release` returns `mobile-details-v1` and the actual deployment commit.
A release is complete only after required checks pass and that revision is
reachable at the canonical production URL, https://signalbrief.online.

For rollback, redeploy a previous MFA-aware web revision. The additive detail
function can remain installed. Do not delete user histories, preferences,
bookmarks, support attachments, holdings or the existing MFA checks.
