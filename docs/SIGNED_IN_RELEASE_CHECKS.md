# Signed-in MVP release checks — 2026-10-31

The user explicitly requested changes to the signed-in customer experience on
desktop and mobile. The requested product centers on disclosures, company
research, approved summaries, evidence, news, monitoring, and verified dates.
Market prices, market indices, portfolio valuation, brokerage links, unreliable
widgets, and unsupported filters must remain hidden until supported.

## Scope guard

`python scripts/verify_workspace_scope.py` is the current release boundary check.
It checks 90 public, administrative, and authentication source files against
commit `485ad4b8a4c2c18b0c370e27abca34254356704d`. Those files were compared with
that commit when the manifest was created; the manifest is not a snapshot that
silently blesses edits outside the request. It also checks the 17 retained legacy
implementations, the eight disabled release-flag declarations, structural feature
gate references, responsive shell order, and workspace CSS boundaries. The unit
and browser tests verify the resulting route behavior; textual source checks
alone do not establish access control or prove that a route is blocked.

The manifest is `docs/signed-in-workspace-boundary.json`. A future authorized
change to a protected area must explicitly update its scope and evidence. The
guard fails if an existing protected file changes or a new file appears under a
protected directory. Negative tests prove it rejects auth changes, deleted legacy
implementations, enabled market data, global CSS, missing shell guard calls, and
unreviewed administrative source files. CSS checks require a positive scope class
on the subject or an ancestor; a class inside `:not()`, an attribute string, or a
selector-list pseudo-class does not count as isolation.

The historical `scripts/verify_desktop_isolation.py` and
`docs/desktop-mobile-baseline.json` remain unchanged. Their original contract
required a desktop-only release to leave the mobile implementation unchanged.
Applying that contract to this user-requested mobile redesign produces failures
for intentional changes. It is not the scope contract for this release.

## Current browser gate

CI runs these suites on desktop and mobile with intercepted synthetic data:

| Suite | What it verifies |
| --- | --- |
| `research-workspace.spec.ts` | Home counts and newcomer fallback; search filters; all five company tabs; approved excerpt evidence; canonical save and reload; follow and unfollow persistence; calendar history; More navigation; disabled email states; disabled portfolio route; empty versus failed data; alert reads; auth return paths; absence of market, portfolio, and widget requests; responsive layout and runtime errors. |
| `auth-navigation.spec.ts` | Public destinations, signup/recovery outcomes, auth loading, expired-session redirect without protocol-error leakage. The expired-session fixture now rejects the current workspace RPC as well as REST endpoints. |
| `marketing-pages.spec.ts`, `ui-refinement.spec.ts`, `responsive-design.spec.ts` | Existing public and authentication page navigation, keyboard controls, responsive layouts, and form behavior. |
| `news.spec.ts` | Existing public Korean news search, exact source links, escaped content, failures, and retry. |
| `company-profile.spec.ts` | Official company-profile source data, missing fields, recovery, responsive layout, and no runtime errors. |
| `daily-digest.spec.ts` | Explicit consent and time persistence when the fixture reports delivery available; the research journey separately verifies the unavailable state cannot be enabled. |
| `career-analytics.spec.ts` | Evidence-detail engagement requires consent and excludes identifying or unapproved analytics properties. |
| `research.spec.ts` | Existing administrative pages, rejection of non-admin access, study consent and withdrawal, and consent-checked report export. |

The shared fixture explicitly validates and serves the new unified notification
contract. Unknown requests still fail. It does not create a catch-all success
response or permit a live provider or customer account connection.

## Preserved historical browser contracts

The former route specs remain in `apps/web/e2e`. They are not weakened or deleted.
Their price-, portfolio-, widget-, old-selector-, or old-menu assertions describe
the previously released interface. In particular, they require index cards and
market requests, a portfolio tab and holding editors, TradingView mounts, and
the old company tab layout. Executing those assertions against an MVP that must
hide those features tests the opposite of the requested behavior.

| Historical expectation | Current release coverage |
| --- | --- |
| Home fetches indices and portfolio values (`market-indices`, `performance`, old Home references). | Home shows persisted monitoring counts and disclosures; the new browser suite rejects every market/portfolio request. Data-cache behavior and retained legacy Home components remain covered by unit tests. |
| Company shows prices, chart permission messages, and widget lifecycle (`quote-permissions`, `company-connections`, parts of `completion`). | Five research tabs, official identity and source facts, company news, and evidence links are tested; widget and price controls are absent. Retained quote, widget, and provider modules remain in source and unit coverage. |
| Old Home/watchlist source panel layout (`source-visibility`). | Official metadata remains independently available; excerpt approval/date provenance, unavailable totals, empty results, and retry are exercised in the new journey. |
| Old desktop/mobile page selectors and portfolio/onboarding flows (`desktop-references`, `mobile-authenticated`, portions of `mobile-details`, `workspace-pages`). | New route navigation and persistence are tested on both viewports; unchanged account, security, consent, and preference behavior retains its unit coverage and applicable browser checks. |
| Returning from payment shows the old inactive label (`completion`). | Billing return tests require a pending state and no access until an authoritative server response confirms payment. The existing nonrenewing 30-day pass is retained. |

The independent `Reference application checks` job still renders and exercises
the retained reference controllers through its standalone harness. The
`Financial evidence benchmark` study-browser job still tests the standalone
study software. Neither job was replaced or relaxed.

## Required evidence

Run the scope guard, its negative tests, full repository checks, and the exact CI
browser selection before merging. Screenshots and logs use synthetic data and do
not establish live provider quality, email receipt, or production payment
verification. Production deployment and migration verification remain separate.

## Local execution for this revision

- Exact current CI browser selection: **66 passed**, desktop and mobile, in
  **2.5 minutes**. Evidence: `verification/signed-in-release-browser.log`.
- Workspace scope guard: **PASS**, with all 90 protected source hashes and all
  17 retained feature files intact.
- Guard and source-hash regressions: **19 passed** (17 current scope cases plus
  two retained source-digest tests).
- TypeScript, scoped ESLint, Ruff, CI YAML parsing, and changed-file whitespace
  checks: **passed**.
- The initial browser run found only the old calendar CTA fixture/selector
  mismatch on both viewports: 64 passed, two failed. That test was repaired to
  require the same authenticated destination and the current verified calendar
  content, followed by the complete green 66-case rerun. No application change
  was needed to make that test pass.
- The local fixture server exited successfully after testing; port 3000 refused
  a connection afterward. No production account or live provider was used.
