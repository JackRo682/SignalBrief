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
after code verification. An enrolled user must complete AAL2 step-up on later logins;
a front-end challenge, the PostgREST pre-request hook, explicit RPC checks and restrictive
RLS on private tables/Storage enforce this. Raw support uploads are serialized against
the owned ticket and limited to three objects, including uploads not yet attached.
Last-provider unlinking is blocked. Already-issued access tokens may remain valid until
expiry after other-session revocation, as shown in the interface.

## Migration, tests and rollback

Apply these files in order, once after the existing hosted/reference/US migrations,
before deploying this app revision:

1. `supabase/workspace-migrations/20261005094000_workspace_mfa.sql`
2. `supabase/workspace-migrations/20261005094500_workspace_pages.sql`
3. `supabase/workspace-migrations/20261005095000_workspace_guards.sql`

All three were applied through the Management API to the existing project on 2026-10-06.
Post-application inspection confirmed all six function bodies match the tested source,
all six private tables have RLS, the support bucket is private with a 5 MB limit,
19 restrictive MFA policies are installed, and anonymous workspace RPC execution is denied.
The original notification-preference trigger remains alongside the new delivery gate.

Do not run disposable schema tests against production.
`tests/workspace/test_workspace_schema.py` rejects anything other than loopback databases
ending `_test`. It replays frozen application DDL and hosted/reference/US/workspace SQL
against disposable Auth/Storage/Vault stubs. Actual Supabase OAuth/SMTP and third-party
price delivery still require live account checks.

Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` from `apps/web`.
Run `workspace-pages.spec.ts` with the existing isolated Next E2E configuration on desktop
and mobile. Synthetic browser/SQL fixtures live only in test files; no production seeding.
Run existing backend and auth/public/navigation regressions as well.

Rollback only to an MFA-aware web revision once any user enrolls a factor. Do not remove
server assurance checks to make an older client work. Retain the MFA challenge provider
and related API handling when reverting an individual page. Never drop the new tables:
user bookmarks, preferences and support requests must be retained. To suspend only the
new notification filter during a reviewed rollback, drop the
`sb_workspace_notification_preferences` trigger; keep its data and function intact.
Never restore production fixtures or reset user records.

## Verification status — 2026-10-06

Release gate: https://github.com/JackRo682/SignalBrief/actions/runs/37426044198
Published application source: `3067ca820f8962f04fe188037d9928b59cefd9f0`.

* `python scripts/verify.py --full`: all eight checks PASS on GitHub Actions.
* Web: TypeScript PASS; 230 unit tests PASS; production build PASS; lint zero errors
  with five pre-existing location-assignment warnings.
* Python: 256 PASS, two conditional legacy database checks skipped in this particular
  workspace-database job. No skips in the 13-case workspace PostgreSQL replay.
* Browser: 60/60 PASS, zero failed/flaky/skipped, covering desktop and mobile. Sixteen
  cases exercise the new workspace journeys, including navigation, persistent saves,
  preference failures, support requests, private data and MFA step-up. All nine screens
  were captured as actual DOM screenshots at both viewport sizes.
* The existing legacy PostgreSQL job and new workspace replay workflow also run on the
  final pull request; see their actual run status rather than treating skipped tests as PASS.

Local full verification was separately attempted: local Ruff was unavailable and that
local script correctly exited nonzero. The complete remote gate above had Ruff installed
and passed; local and remote outcomes are not conflated.

Browser/SQL fixtures are synthetic and isolated. Google OAuth redirects, SMTP delivery,
live TOTP enrollment/revocation and licensed market-data delivery were not exercised with
real user credentials. No live user password, session revocation, factor enrollment,
account deletion, portfolio mutation or production data seeding was performed during QA.
Production deployment identity and anonymous HTTP smoke results are recorded separately.
