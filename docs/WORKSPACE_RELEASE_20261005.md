# Nine authenticated workspace screens

## Routes and integration

| Screen | Route | Data / interactions |
|---|---|---|
| Company overview | `/companies/[id]` | SEC company, gated published events, verified facts, original documents, licensed quote feed, watchlist and holdings writes |
| Discover | `/explore` | Supported companies, actual filing types/markets, opt-in recent searches, links to company/source results |
| Search results | `/search` | Search term, market, type, date, sort, pagination in URL; exact source detail links; bookmarks |
| Saved / history | `/saved` | Persistent private bookmarks, filters, sorting, opt-in viewing history, history deletion |
| Account | `/settings/account` and `/settings` | Real authenticated identity, display name/bio, timezone, history/analytics choices, JSON data export, logout |
| Security | `/settings/security` | Supabase password change/reset, verified TOTP enrollment/removal, linked identities, own sessions/activity, sign out other sessions |
| Notifications | `/settings/notifications` | Real in-app delivery switch/threshold, per-company mute, timezone-aware quiet hours and per-day cap enforced by database trigger |
| Appearance | `/settings/appearance` | Persisted theme, density, font size, reduced motion, chart animation, Korean/English for new workspace screens |
| Help / support | `/help` | Authored searchable FAQ, categories, durable idempotent private tickets, optional private attachments, own request status; authorized staff review |

Existing company timeline moves to `/companies/[id]/timeline`; `/timeline` remains.
Existing event detail, Today, portfolio, watchlist, calendar, alert center, Ops, public
marketing, signup and password recovery are preserved. Shared menus expose the additions.
Layouts use real DOM and responsive CSS, not screenshot backgrounds or clickable overlays.

## Scope and honest unavailable states

No sample prices, identities, market events, help-article counts or uptime claims are
copied from the images. Displayed financial content comes from the existing database
and provider APIs. Missing price rights, unavailable providers, an empty event pipeline,
or no reviewed facts are shown explicitly. Raw SEC filings are distinguished from
reviewed analyses. Company sector/industry ranking and popularity rankings are not
invented. Profile initials are used without leaking avatar requests to a third party.

Email investment alerts, scheduled digest delivery, background browser push, automatic
broker import, portfolio return calculation and immediate account deletion are not
pretended to work. Privacy/deletion requests go to a durable private support ticket.
Security recovery emails still use the existing Supabase Auth configuration. Appearance
and translated navigation apply to the new workspace; the existing analysis density and
source-document language remain separate. JSON export is an actual account data export,
not a canned spreadsheet. Support uploads are private downloads, not rendered HTML.
There is no malware-scanning service in this release; operators should treat files as
untrusted and not execute them.

## Dependencies, external services and cost

No new external account or new paid service is required for these pages.

* Vercel serves the existing Next.js app and new `/api/workspace` POST BFF.
* Existing `NEXT_PUBLIC_SUPABASE_URL` and public `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  identify the same Supabase project. No service-role key is required by the BFF.
* Existing Supabase Auth handles Google/email login and TOTP. Google OAuth still uses
  its existing client configuration and `/auth/callback`. No new OAuth redirect is added.
* Additive workspace migration creates private owner-scoped state, support tickets and
  a private `signalbrief-support` bucket (5 MB/file; PNG/JPEG/WebP/PDF; three attachments
  per ticket). These consume normal project database/storage quotas.
* Existing quote endpoint uses FMP only when its key and display entitlement are enabled.
  This release does not enable paid display rights, market API calls on unauthorized
  feeds, OpenAI generation budgets, Resend campaigns or ingestion schedules.
* Auth emails depend on the existing Supabase mail settings/quotas. Investment email
  alerts/digests remain unavailable without a separately implemented delivery worker.

## Security

The BFF checks the bearer through Auth.getUser, validates a strict operation payload,
limits body size, checks browser Origin and uses private no-store responses. SQL binds
all ownership to `auth.uid()` again. All six new tables have RLS and no direct browser
write privileges; only bounded definer RPC actions may mutate them. Search uses literal
substring matching, not user-built SQL. Existing event/document visibility predicates
exclude unpublished/withdrawn/invalid analysis. Saved items recheck current visibility.

Preferences use optimistic versions. History is off by default. Support submission has
an idempotency key and daily quota. Attachment policy requires both own account and own
ticket; attached metadata must match the stored object. Only the existing server-side
admin role can review other users' requests and change their state. Session queries return
no Auth secrets, no access tokens and no inferred device geography. TOTP is enabled only
after code verification. Last-provider unlinking is blocked. Already-issued access tokens
may remain valid until expiry after other-session revocation, as shown in the interface.

## Migration, tests and rollback

Apply `supabase/workspace-migrations/20261005094500_workspace_pages.sql` once after existing
hosted/reference/US migrations, before deploying this app revision. Do not run disposable
schema tests against production. `tests/workspace/test_workspace_schema.py` rejects
anything other than loopback databases ending `_test`. It replays frozen application
DDL and hosted/reference/US/workspace SQL against disposable Auth/Storage/Vault stubs.
Actual Supabase OAuth/SMTP and third-party price delivery still require live account checks.

Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` from `apps/web`.
Run `workspace-pages.spec.ts` with the existing isolated Next E2E configuration on desktop
and mobile. Synthetic browser/SQL fixtures live only in test files; no production seeding.
Run existing backend and auth/public/navigation regressions as well.

Rollback the web deployment/commit without dropping the new tables: user bookmarks,
preferences and support requests must be retained. To suspend only the new notification
filter during a reviewed rollback, drop `sb_workspace_notification_preferences` trigger;
keep its data and function intact. Never restore production fixtures or reset user records.

## Verification status

Local TypeScript check, lint (warnings only), 230 web unit tests and a Next production
build passed during implementation. The local managed Chromium blocks navigation, so
browser screenshots and journeys run in GitHub Actions instead. Hosted-schema and browser
results must be reviewed before merge/deploy; this document does not claim they passed
until their run reports exist. No user password, session revocation, MFA enrollment,
account deletion or other destructive action is executed against a live user during QA.
