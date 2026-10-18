# Scheduled email notifications and daily digest

Daily digests are explicitly opt-in, independently from individual email alerts. A verified authenticated account can set its delivery time (default 09:00) in the existing notification settings on desktop and mobile. The user's existing time zone applies. No user is opted in by this release.

The digest covers the previous local calendar day's reviewed, published app notifications after consent, with event links. Empty days send nothing; muted issuers are excluded. At most 50 distinct events are included, with titles capped at 250 characters. This is a digest of persisted app alerts, not an additional ingestion or AI summarization pipeline.

A private unique key on user and digest date prevents duplicate generation. The existing private email outbox, Resend idempotency key, verified sender, delivery webhook and bounce/complaint suppression remain in use. Quiet hours defer queued messages without consuming send attempts, including across midnight. Claims recheck account email, consent, muted issuers and publication. Retries stop within 20 hours of the first attempt, maximum three attempts; unsent work expires after 48 hours.

The new `signalbrief-notifications` Edge Function is invoked every five minutes by `app_private.enqueue_notifications()`. Every invocation receives a random, short-lived, single-use token, stored only as SHA-256 in a private RLS-protected table. Worker RPCs are service-role-only. The preferences RPC checks `auth.uid()` and only changes that user's settings. Provider credentials stay in the existing Vault/Edge secrets.

Every non-test claimed message includes a no-login unsubscribe URL. GET displays a confirmation form without mutation; POST disables both optional email channels and suppresses queued messages. The new worker also sets one-click unsubscribe headers. The existing collector remains deployed unchanged; its claims receive the same unsubscribe footer from SQL. Replacing the multi-provider collector was declined by automatic approval review, so this release uses a dedicated notification worker.

## Applied production components

- `docs/sql/daily-digest.sql`: preferences, digest generation, claims, consent checks, unsubscribe and quiet-hour deferral.
- `docs/sql/notification-schedule.sql`: five-minute job and authenticated worker tasks.
- Function URL: https://xabzzhtdmqsaqdauthbu.supabase.co/functions/v1/signalbrief-notifications
- Settings URL: https://signalbrief.online/settings/notifications

Production scheduler invocation returned HTTP 200 with `queued:0`, `status:idle`. There were no opted-in users or pending messages. No customer address was opted in and no customer email was sent as a test. A new real recipient inbox-delivery test is not claimed; the pre-existing delivery transport was already verified in the provider release.

## Verification

`python scripts/verify.py --full`: all eight checks passed. Backend 308 passed, 44 skipped; frontend 533 passed. Skipped hosted/workspace database suites are not treated as passed. New PostgreSQL digest suite after the final midnight deferral change: 11 passed. Final provider/unsubscribe and digest UI subset: 26 passed. Typecheck, both linters, Next production build passed. Disposable PostgreSQL only was used for synthetic mutation tests. Existing advisory warnings remain; the new preferences function is intentionally available to authenticated users and enforces ownership, and private worker tables intentionally have no client RLS policy.

Browser background push is not implemented by this release. Browser notification permission alone is not background push. That requires a service worker, push subscriptions and server push credentials/delivery. This feature must remain described as unavailable.

Desktop and mobile Playwright E2E: 2 passed with isolated synthetic accounts, including opt-in, saved time, reload and opt-out. Initial attempts exposed missing test API/CSP settings and the controlled switch's asynchronous save behavior; the test environment was corrected and asserts the actual persisted response. The user subsequently explicitly approved GitHub upload and production deployment. PR #29 contains this release; production deployment is tracked in Vercel. The multi-provider collector remains unchanged. Backend scheduler runs at 05:30 and 05:35 UTC succeeded.

## Recovery

Disable only this schedule with `select cron.unschedule('signalbrief-notifications');`. Disable optional email delivery through the existing `email_enabled` configuration if needed. Preserve outbox rows and provider IDs for audit and deduplication. Do not drop preferences/outbox columns to roll back the UI.

Scheduling reference: https://supabase.com/docs/guides/functions/schedule-functions
Idempotency reference: https://resend.com/docs/dashboard/emails/idempotency-keys

## Production web verification

Deployment `dpl_7B4ndHE6SPeEk91Up9FAq8bLZu9C` is READY and aliased to https://signalbrief.online. `/api/release` reports implementation commit `3cdddd015c7c736907cee8a4ddc7c8ab6cf835e3`. `/email/unsubscribe` serves a no-login HTML confirmation with no-store/no-referrer headers; malformed links and unknown POST tokens return 400 without a success message. Supabase rewrites HTML responses to text/plain, so its GET unsubscribe endpoint uses a 303 redirect to the website confirmation; POST continues to implement provider one-click unsubscribe directly. The final route tests passed (4 tests) and the final Next build passed. No new real inbox-delivery result or signed-in production account mutation is claimed.
