# Signed-in content publication contract

This change affects authenticated customer pages. Existing administration and review RPCs remain available. It does not approve pending analyses, alter source dates, send emails, enable subscriptions, or infer missing financial data.

## One publication projection

`app_private.sb_approved_filing_analyses()` selects SEC and DART rows only when `status='approved'`, the company is supported and non-demo, the canonical filing URL matches the analysis source URL, the recorded validation type is recognized, and every nonempty claim quotation is an exact substring of the stored normalized excerpt. The check applies to administrator accounts using customer pages too. It does not claim that an excerpt covers the complete filing.

`app_private.sb_customer_resources()` feeds overview, company pages, catalog, document detail, saves, history, monitoring and app notifications. `public.sb_customer_workspace` is a security-invoker facade over an authenticated private function. All user-owned joins use `auth.uid()`. Saved items and notifications are joined back to the current publication projection, so rejection/withdrawal immediately removes them from visible results while preserving stored user records.

A filing excerpt has canonical kind `us_analysis` or `dart_analysis` and ID equal to its filing UUID. Published comparison events remain kind `event` and are not relabeled as excerpts. The UI link is `/documents/{filing_id}?kind=filing&analysis=us|dart`. Document detail returns claims, quotations, canonical URL, coverage, creation date and review date, without exposing the full stored excerpt or private object metadata.

`published_at` remains the original filing date with `publication_precision='date'`. `reviewed_at` is obtained from approval audit history at or after the current analysis creation; if unavailable it is null. Recent approval does not turn an old filing into a new disclosure.

## Scope and measurements

`source_overview` accepts `scope: 'all'|'following'`, optional `company_id` and `days` (`0` includes all available history). A new account with no followed companies explicitly reports `scope='all'` and `fallback_to_all=true`. It returns future and historical verified calendar entries separately, plus each company's latest filing, latest approved analysis, next confirmed event, collection timestamp and content counts.

Overview counts are measured from the database. Web contracts leave newly introduced counts optional for older responses, so missing values render as unavailable rather than a measured zero. Saved counts have separate event, source-document and filing-analysis buckets.

## In-app alerts

Approved excerpt transitions can create one app notification per user/resource. They require the followed company, enabled app channel, unmuted company, time outside quiet hours and remaining daily capacity. Event and excerpt notifications share the same cap calculated between consecutive midnights in the user's timezone, including daylight saving changes. Invalid timezone or malformed quiet/cap preferences fail closed. Both insertion paths lock the same user row before counting, and the excerpt path visits users in deterministic order. Existing event relevance-score rules remain unchanged; excerpt alerts have no invented score.

The unified `content_notifications` action returns current visible event/excerpt resources and an unread total. `content_notification_read` accepts an owned ID or `{all:true}`. There is no email outbox relation from excerpt alerts and no historical alert backfill.

## Email availability

`20261031132007_email_readiness_gate.sql` adds one private readiness check used by both preference endpoints, event-email queueing, digest enqueue, email claim, permission recheck and scheduled dispatch. It requires explicit `email_enabled`, a valid `resend_from`, `resend_domain_verified`, a nonempty Vault `RESEND_API_KEY`, a configured Vault `RESEND_WEBHOOK_SECRET`, `email_delivery_verified`, and `email_dispatch_verified`. Missing values mean unavailable. Credential values are never returned; the service-role-only readiness RPC exposes booleans.

Credentials must exist in the central Vault for this shared check; an Edge-only environment variable does not establish database readiness. No verification flags are set by the migration. Verifying actual delivery and the recurring dispatcher is a separate operational step. The migration does not send a test email or start a schedule.

When unavailable, preference endpoints return `available=false` and effective `enabled=false`; `preference_enabled` preserves the recorded opt-in state. Disabled readiness does not consume attempts or delete queue rows. Explicit opt-out and unsubscribe remain usable, idempotent and scoped to the relevant user. Existing webhook, suppression and delivery-result processing remain available.

## Deploy and rollback

Apply the workspace content migration before the email-readiness migration, and both before deploying the new web API routing and delivery function. Apply only after the disposable PostgreSQL replay passes. Production application is performed by the release owner; these files alone do not establish a deployment.

To roll back the customer release, restore the preceding web deployment first, then run `supabase/workspace-rollbacks/20261031125310_signed_in_content_workspace.sql`. It disables excerpt alert triggers, revokes the new customer RPC and restores the preceding event alert gate. The unchanged legacy `sb_workspace` and `sb_document_detail` remain available. All widened resource identities, saves, histories, notifications and sources are retained. The adjacent `.resume.sql` reverses this rollback without reapproving content or backfilling alerts.

The email rollback file restores the frozen preceding function bodies without removing preferences, outbox data, secrets or the harmless readiness helper. This restores older availability behavior; keep `email_enabled=false` unless that behavior is intentionally desired. Revert the delivery function alongside that rollback. A normal customer-web rollback can leave the stricter email gate active. Reapplying the idempotent email-readiness migration restores its gate after rollback.

## Verification boundaries

Focused tests execute the publication SQL, validate drafts and malformed evidence are absent, test account separation, unknown versus zero counts, no-follow fallback, saves/withdrawal, notification preferences and customer rollback/resume. Native PostgreSQL tests replay the actual workspace schema and exercise role isolation and quiet/local-day behavior. Readiness tests use synthetic mail addresses and synthetic Vault values; dispatcher tests prove unavailable readiness does not claim work or call a provider. These tests do not establish real provider delivery or receipt.
