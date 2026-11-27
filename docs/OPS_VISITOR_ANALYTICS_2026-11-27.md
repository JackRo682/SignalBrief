# Visitor analytics at /ops — November 27, 2026

## Authorized scope

The owner requested tracking and reporting in `https://signalbrief.online/ops`
comparable to `https://getopenprism.com/analytics`. The reference was inspected in
the owner's signed-in browser. Production SignalBrief baseline:
`d36ad4ac4da86bea2dfc78f5d730f201b77d5214`.

The existing acquisition, prelogin-session and surface-time collectors already
contained relevant real telemetry. This change makes those observations visible
first, adds reports and a private session explorer, and extends consented session
measurement with a coarse viewport category. The existing operational records,
account activity and access controls remain available on the same page.

## Behavior

- `/ops` starts with visitor analytics: recorded browser count, measured prelogin
  sessions, ordered authentication attempts and verified new-signup browsers.
- The ordered same-session flow is entry → authentication CTA → arrival on the
  selected auth screen → attempt on that screen. Direct auth entries are explicit.
  Attempts do not imply successful authentication or a new account.
- KST daily session charts have an accessible numeric table. Source and viewport
  summaries use actual counts. Historical absent device categories are unknown.
- Existing active time by surface/source/audience/release, feature actions,
  browser-level product funnel and last observed prelogin steps remain visible.
- Administrator-only session browsing is on demand, source-filtered and paginated.
  It shows up to the first 100 sequence-ordered steps, with explicit truncation.
- Equal-length preceding KST periods are loaded on demand. Percentage change is
  suppressed if today is incomplete, retained history cannot cover the preceding
  window, or the preceding denominator is zero.
- CSV exports the displayed aggregate datasets with their populations, dates,
  sources and measurement units. An explicitly loaded previous period is included.
  UTF-8 BOM supports Korean spreadsheet text; cells escape spreadsheet formulas.
- Date shortcuts cover today, 7, 30 and 90 days. Account-based analytics and detailed
  activity records follow the anonymous report and remain clearly separated.

## Measurement boundaries

Browser counts use distinct IDs with acquisition events (including signup events),
not proven people or exclusively page-view events. Daily browser counts must not
be added to estimate period-unique people. Session counts require a recorded
`seq=1` entry and can be lower than recorded browser counts. Anonymous and
authenticated populations overlap and must not be summed.

The new device value describes viewport width at session entry: below 768 pixels,
below 1024 pixels, and larger. It does not identify physical hardware. Renewed
`2026-11-27.prelogin` consent is required before the updated client emits it.
Old-version collector requests without the field remain valid. Refusal still
stops recording and requests erasure.

The report retains the original first-touch source buckets. It does not capture
raw URLs, search text, questions, email addresses, IP addresses, keystroke content
or screen recordings. QA-marked visits and authenticated administrators remain
excluded by the existing collectors. Unsigned-in administrators cannot be
identified as administrators. Tracking remains best effort and consent based.

Surface active time excludes hidden/blurred time and input inactivity beyond
30 seconds. Means and medians include zero-time measured views. Compare matching
surface, audience, source and release populations. Sequence order and server
arrival time can differ. Thirty minutes without observed steps marks a completed
observation window, not a proven browser close or a known reason for leaving.

`measurement` timestamps are the first retained observations, not proof of
continuous capture. Missing days and pre-installation history are not fabricated.
Period differences do not establish causal effects or statistical significance.

## Database and API

Migration `20261127075639_prelogin_analytics_dashboard.sql` adds the nullable
device column and partial entry index, a private session cohort helper and an
additive `sb_traffic` wrapper. Existing response fields and collector/erasure
behavior are preserved. New summary fields are optional in the browser validator
to support staged deployment.

`action: sessions` requires bearer authentication at the same-origin Node route
and the existing database live-user/live-session/admin/MFA/rate/date guard.
Bounds are offset 0–10000 and limit 1–50. No browser visitor identity, secret or
account identifier is returned. Private helpers and raw tables remain inaccessible
to anonymous and ordinary authenticated roles. All responses remain private/no-store.

Deploy the additive migration before the new client. Old clients keep working;
the new client can read older summaries while those fields are absent, but its
new-version journey writes and session explorer require the migration.

## Reviewed source boundary

The manifest's new reviewed-admin revision records only the current authorized
tracking, consent-disclosure, API and dashboard files and their exact normalized
hashes. New report modules are added to protected paths. The scope guard and its
negative assertions are unchanged. Existing authentication logic, workspace
feature flags, retained feature files and verified customer routes are outside
the change and retain their protected digests.

## Runtime maintenance

The first release build identified the existing Next.js 16.4.3 dependency as
covered by the November 3 security release. The release pins Next.js and its
matching ESLint configuration to 16.4.6, including the existing scoped glob
compatibility override. This is a patch update within the same release line.
Source: https://nextjs.org/blog/november-2026-security-release .
The runtime audit no longer reports the Next.js advisories. Separate existing
moderate development-tooling findings are not represented as resolved.

## Validation status

- Disposable PostgreSQL 17.12: 74 product/prelogin reporting tests passed with zero
  skips, including legacy behavior, access/MFA denial, KST cohorts, device versions,
  ordering, pagination/truncation, redaction and consent erasure.
- Full local release verifier: all eight stages passed on November 27 at 08:02 UTC,
  including 1,328 backend tests (zero skips), 2,417 frontend tests in 157 files,
  lint, TypeScript, OpenAPI export and the optimized Next.js 16.4.6 build.
- The unchanged source-boundary verifier passed for all 131 protected files,
  17 retained features and both verified customer entry points.
- Production dependency audit reports zero vulnerabilities; the full development
  audit retains seven moderate entries from the existing lint dependency tree.
- Desktop/mobile browser checks: all 16 cases passed against Next.js 16.4.6
  (12 dashboard/product scenarios and four public-consent/acquisition scenarios).
  CSV byte order mark and both periods, lazy requests, ordered paths, source
  filtering, empty states, responsive overflow and whole-page access denial
  were exercised. Screenshots were visually checked.
- The denial assertion is scoped to the application main landmark so the
  framework accessibility announcer does not create an ambiguous alert locator.
  All protected-panel removal assertions remain intact.

Production database migration `20261127075639_prelogin_analytics_dashboard`
was applied successfully. The nullable device column and entry index exist;
private helper execution remains revoked for anonymous and authenticated roles.
An anonymous session-report request returns `PT401 authentication_required`.
The before/after database security-advisor findings are identical.

Source review and exact-commit CI are available in [pull request 71](https://github.com/JackRo682/SignalBrief/pull/71).
The production destination is https://signalbrief.online/ops . Vercel deployment
state and signed-in live acceptance are checked independently of local results.
