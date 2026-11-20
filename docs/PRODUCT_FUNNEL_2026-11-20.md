# SignalBrief visit and product funnel

## Outcome and scope

The existing GA4 integration continues to measure consenting public-page visitors,
signup clicks, and verified new signups. This release adds actionable first-party
product events and a real administrator funnel to `/ops` under **방문 → 탐색 → 이벤트 상세**.

Microsoft Clarity is not active. Automatic browser approval review rejected the
Google sign-in needed for Clarity, and access to the private GA4 dashboard was also
rejected. No account access was bypassed, no Clarity project ID was invented, and
no screen recording is claimed. The fallback uses the existing SignalBrief
database and deployment; it requires no new third-party account or API key.

## What is measured

| Stage or event | Trigger | Stored detail |
| --- | --- | --- |
| Landing | Existing consented `page_view` with public `page=home` | Browser identity, fixed page/source classification |
| `search_used` | Explicit search submission, or settled calendar company search | Fixed screen classification |
| `filter_used` | A user changes an actual filter | Screen and allowlisted filter type |
| `event_detail_click` | Published event or official calendar link clicked | Screen and published/calendar type |
| `event_detail_view` | Matching published non-demo or official calendar detail successfully loaded | Fixed detail screen and published/calendar type |

Initial renders, prefetching, repeated active filters, pagination, failed detail
loads, personal-calendar contents, and demo-account actions are excluded. Search
text, company/event identifiers, full URLs, titles, and question contents are not
accepted by the product event contract. The private database associates product
records with the authenticated user solely for consent enforcement and deletion.

Home and header search controls are covered, along with the shared desktop/mobile
search, calendar, and detail components. Product events remain first-party. They
are not sent to Google or Microsoft.

## Consent and correctness

Product collection requires all of:

- A current public-visitor consent and its random browser identity.
- A fresh product grant for consent version `2026-11-20`; older public-only
  grants do not authorize the new collection.
- An authenticated, non-administrator, non-demo account with optional account
  analytics enabled. The server independently verifies the live user/session and
  current account consent.
- No Do Not Track or Global Privacy Control opt-out.

The same existing banner explains the expanded first-party scope. Visitors can
decline without losing product functionality. `/privacy` has **방문 통계 설정** for
withdrawal. Account analytics remains controlled by the existing account setting.
The privacy notice describes exactly which provider receives which data.

Public and product records use one ordered browser queue so a prior landing request
finishes before its subsequent product actions. Pending product events recheck the
browser grant and current account. Revocation invalidates queued actions, including
a revoke/regrant race. Analytics errors never block search or navigation.

Browser withdrawal deletes associated public/product records using the existing
secret-verified erasure flow and tombstone. Account analytics withdrawal or profile
deletion deletes that account's product records. Account-row locking serializes
in-flight product writes with withdrawal. The existing 90-day visitor retention
job cascades to product records. No raw-table privileges are granted to anonymous
or signed-in browser roles; the existing narrow RPC enforces access.

## How to read the administrator panel

The administrator's selected dates use Asia/Seoul boundaries. The conversion
cards count distinct browsers in an ordered cohort:

1. A public home visit occurs within the selected period.
2. The same browser subsequently uses search or a filter.
3. It subsequently clicks an event detail.
4. It subsequently loads an eligible detail successfully.

The stages are nested, so a downstream count cannot exceed the preceding count.
They describe order within the selected date interval, not a single-session funnel
or a guarantee that the click and view refer to the same event. Event IDs are not
collected. A separate action table includes all eligible product activity in the
period, including direct app entries without a landing visit. These action totals
are not the funnel's unique-browser denominators. Existing acquisition metrics
remain unchanged by product-only activity.

Zero denominators display **측정 대기**, not a fabricated conversion rate. Counts
describe consenting, measurable browsers, not total people or all registered users.
The panel does not claim causality, statistical significance, or historical data
before the feature was enabled. Compare before/after periods with their actual
sample sizes and use qualitative usability observations alongside these metrics.

## Deployment and verification

Migration: `supabase/migrations/20261120043507_product_funnel_analytics.sql`.
The migration adds a private product-event table, retains the old acquisition
implementation as a private helper, and extends the existing RPC. No historic
acquisition rows are rewritten. An operational rollback can repoint the public
wrapper to the retained acquisition helper without deleting stored records.

Release verification and deployment status are recorded in the completion update
below. Test fixtures are synthetic and are not sent to production analytics.

### Verification record

The integrated local run passed 1,281 backend tests, 2,326 frontend tests,
Python and frontend lint, TypeScript, and OpenAPI export. The 27 product-funnel
PostgreSQL tests also passed against a disposable database using SCRAM password
authentication, including the actual concurrent consent-withdrawal test.

The production build completed successfully on a normal retry after an existing
Next.js dependency advisory reminder. Vercel also built the implementation preview
successfully. Browser checks run in the normal GitHub Actions environment because
the local execution sandbox could not start Chromium. Current release and browser
results are recorded in the
[verification workflow](https://github.com/JackRo682/SignalBrief/actions/workflows/ci.yml).
The deployed commit is available from `/api/release`.

The first CI PostgreSQL run exposed a test-only connection issue: psycopg omits
the password from `Connection.info.dsn`. The concurrency test now reuses the
validated disposable test URL and changes only the isolated database name. Its
locking and consent assertions are unchanged; password-authenticated execution
passed after this correction.

### Existing dependency follow-up

The unchanged Next.js 16.4.3 production dependency has seven moderate advisories
fixed in [Next.js 16.4.5](https://github.com/vercel/next.js/releases/tag/v16.4.5).
The production dependency audit found no high or critical findings. Inspection
found no matching documented execution path in this app: Cache Components and
the affected cache APIs are unused, the build contains no Edge functions, and
the deployment is hosted on Vercel. This does not remove the dependency finding;
a separate tested patch upgrade remains advisable.
