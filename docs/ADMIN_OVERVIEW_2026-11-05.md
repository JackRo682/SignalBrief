# One-page administrator overview — November 5, 2026

## Requested outcome

Keep the eight important operational measurements and activity/error records on one administrator page. The canonical route is `/ops/user-logs`, titled **운영 현황 · 사용자 로그**. `/ops/analytics` redirects there, and the administrator navigation offers one combined entry. All details, filters, pagination and disclosure rows remain on that page.

The page uses existing Supabase records. No third-party analytics account, new identifier, anonymous tracking, consent change, administrator grant or user-content collection is introduced.

## Layout and interaction

The shared header contains Today, Last 7 days, Last 30 days, custom dates, administrator inclusion and manual refresh. All dates use Asia/Seoul. Eight cards appear in a four-column desktop grid and two-column mobile grid. Supporting sections show daily visitors, onboarding completion, feature use, D1/D7 retention, page usage/estimated exits, API error hours, and the existing activity table.

Activity type, screen, device and internal user UUID filters apply only to the detailed activity records. Their label states this explicitly; changing them does not silently change metric denominators. Date changes and manual refresh load both sections. Activity pagination uses the existing 50-row keyset cursor.

## Definitions and current limits

| Card | Definition and limit |
|---|---|
| Visitors | Distinct currently consenting signed-in users with a recorded view in the selected interval. Anonymous visits are not measured. |
| Signup conversion | Uninstrumented; displayed as **미측정**, never zero. The existing app has no anonymous signup-start denominator. |
| Activation | Explicit onboarding proxy: current onboarding completion among consenting profiles created in the selected interval. It is a snapshot at the response time, not historical completion timing or a seven-day core-action activation metric. |
| D1/D7 | Exact next/seventh local calendar day return among users first observed in the selected cohort interval. Only fully elapsed return days enter the denominator; observation continues through query time. First observation is within retained history, not necessarily signup. |
| Core feature use | Distinct users with a recognized core event divided by users with recognized screen/product activity in the interval. Feature rows separately show counts and user rates. |
| Active time | Recorded foreground/non-idle heartbeat milliseconds per inferred session. Existing stored session IDs are split at 30-minute inactivity gaps. |
| Exit points | Final recorded screen of a session with at least 30 minutes of inactivity. Lookahead beyond the selected end avoids falsely treating a continuing session as an exit at midnight. Exit rate uses sessions observed on that screen. |
| Errors | Existing completed authenticated API 5xx responses divided by recorded requests. Hourly buckets retain at most 30 days and include administrator traffic. This is not the full-site/browser/vendor error rate or a raw exception log. |

Zero counts, null denominators, immature cohorts, uninstrumented metrics and service failures have distinct states. No sample records are inserted into production. The first available retained event and actual API coverage are shown. Before this revision, a read-only production check found no consented users or retained usage/product events; existing API telemetry was present.

## Access and privacy

`POST /api/admin/overview` accepts only from/to/include_admin. The API verifies the real bearer identity, confirmed account and server-owned administrator membership. The private SQL implementation independently verifies account status, live unrevoked session, membership, enrolled MFA, and rate limits before aggregating. The public wrapper uses invoker permissions and anonymous execution is revoked. No service key is used by the endpoint.

Both endpoints use private/no-store responses. The browser keeps no persistent metrics or log cache, aborts superseded requests and removes old data immediately on identity, token or permission changes. An access denial from either endpoint suppresses both data sections. A temporary failure in one section leaves the independently authorized other section usable.

The response contains allowlisted event/screen names, counts and bounded timestamps, with no email, search text, questions, document content, raw exception messages or credentials. The read is recorded in the existing private audit table using only the requested dates and administrator-inclusion setting.

## Source and verification

Baseline: `fd7d643` from `JackRo682/SignalBrief/main`. The requested administrator consolidation authorizes the changed admin page, navigation, API, guarded SQL aggregate and corresponding tests. The existing workspace scope guard remains unchanged; its manifest records the reviewed before/after hashes.

The actual Zod request and response contract is exported with `node scripts/export_admin_overview_contract.cjs` to `packages/shared/admin-overview.openapi.json`. Tests cover UI definitions, no-data states, request cancellation, consent/admin exclusions, ratio denominators, date boundaries, session segmentation, mature cohorts, direct RPC denial and authentication failures. Browser fixtures are synthetic and isolated; screenshots from those tests are not live operational data.

### Verified release source

The full local verifier passed all eight stages at `2026-11-05T05:13:15Z`, including 2,021 frontend tests in 132 files and a production build. The backend run passed 364 tests with 855 database-dependent local skips; native database coverage was checked independently in CI. Initial local concurrency-related timeouts were resolved by running the unchanged suite with `VITEST_MAX_WORKERS=1`, without changing assertions or time limits.

[CI run 41971982689](https://github.com/JackRo682/SignalBrief/actions/runs/41971982689) passed on source `34db8f6bf9b050c2d8ce8fddcb61997319361dc0`. Its browser suite passed 115 tests, with three intentional mobile exclusions for desktop-only layout cases and no failures. Both desktop and mobile consolidated-page cases passed. [Workspace PostgreSQL run 41971982641](https://github.com/JackRo682/SignalBrief/actions/runs/41971982641) passed 424 tests with no skips, including all four new overview cases.

The production migration ledger records `20261105050950_admin_overview`. The repository filename and the two test loaders were aligned to that ledger after application; application source and SQL bytes are unchanged from the verified source. SQL SHA-256 is `786d7a45a3261fdea725073dc405a8876678e4ee699c3c7cab3333394d2f1281`, matching the applied migration. Anonymous execution is revoked and the security-advisor findings are unchanged.

Production deployment and signed-in browser acceptance are recorded separately on [pull request 53](https://github.com/JackRo682/SignalBrief/pull/53). A local build or applied database migration alone does not establish that the frontend is live.
