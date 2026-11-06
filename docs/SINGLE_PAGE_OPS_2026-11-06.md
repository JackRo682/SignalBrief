# Complete single-page operations workspace — November 6, 2026

## Requested outcome and baseline

The user identified the six-destination administrator sidebar as the remaining
problem after PR #55. They requested exactly one operations page containing all
of those areas. This change starts from production commit
`bd2d4a9274c29a9de62d98313c3f4da4ff6afb3e` in `JackRo682/SignalBrief`.

## Behavior

`/ops` is the single administrator workspace. The numbered sidebar is removed
and the page uses the full available width. The existing usage overview,
activity logs, collection and AI processing, review queues, document/run lists,
user directory and audit records remain on that page. Experiments, AI
evaluations, quality review, reliability and reports are visible sections below
them. The section links scroll within the page; they do not hide the other
sections or switch to separate overview screens.

Experiment, dataset, evaluation, original-document and AI-run details open in an
inline panel. Existing creation and review actions use the existing APIs. A
validated `detail` and `id` query on `/ops` preserves selection across refreshes
and browser history. Closing the panel returns focus to the invoking control
when it still exists. Legacy section routes redirect to their section anchors;
legacy detail routes redirect to the corresponding validated selection. Login
return uses a validated legacy detail path and its redirect to preserve the
selected record without broadening the authentication return-path allowlist.

One main refresh action refreshes all data sources. Research mutations also
refresh related summaries and reports. Filters and current forms are retained
when reading another record. Period labels remain explicit: research reads show
current state, reliability retains its own 24-hour/latest-record scopes, and the
date filter applies to the existing dated usage and pipeline sources.

The page has one main heading. Research sections and nested panels use
subordinate headings. Report CSV/JSON exports fetch fresh data. The report PDF
action prints only the report section and excludes the surrounding user logs,
operational records and controls.

## Access and existing services

The existing administrator shell, server checks, Supabase authorization and MFA
remain authoritative. Research and inline-detail authorization failures hide
the combined private content. A temporary source failure remains local. Known
action-policy rejections, such as attempting to review one's own case, remain
local errors rather than implying that the administrator session ended.

Reads and mutations discard stale results after account changes. Closing an
original-document detail or changing identity aborts an in-flight raw download.
Opening this page does not execute a model, start an experiment, collect a
source or change a budget. Those existing controls still require an explicit
action. No database migration, new account, service, API key or paid resource
is introduced.

## Verification and release status

The unchanged source-boundary verifier is retained; the manifest records the
user-authorized administrator revisions and their hashes.

Local backend verification passed 1,219 tests against disposable PostgreSQL
databases. The full frontend unit suite passed all 2,117 tests in 138 files with
two isolated workers; the unrestricted worker run exited two workers before
their PGlite tests completed. Python compilation, API export, Ruff, ESLint,
TypeScript and the production build also passed. The formal full-suite rerun
uses `VITEST_MAX_WORKERS=2` without changing any test assertion or dependency.
The source-boundary verifier passes with 110 protected files, 17 retained
implementations and two verified customer entry points.

Exact-source desktop/mobile browser CI is required before merge. The cloud
browser reached the real `/ops` administrator sign-in gate; it was not an
authenticated visual acceptance run.

Production acceptance requires the Vercel deployment to reach READY and the
public `/api/release` to identify the merged source. No deployment is claimed
until those checks complete.
