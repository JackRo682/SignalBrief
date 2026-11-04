# Signed-in MVP release checks — 2026-10-31

The user explicitly requested changes to the signed-in customer experience on
desktop and mobile. The requested product centers on disclosures, company
research, approved summaries, evidence, news, monitoring, and verified dates.
Market prices, market indices, portfolio valuation, brokerage links, unreliable
widgets, and unsupported filters must remain hidden until supported.

## Scope guard

`python scripts/verify_workspace_scope.py` is the current release boundary check.
It checks 90 public, administrative, and authentication source files against
their recorded hashes. The original baseline is commit
`485ad4b8a4c2c18b0c370e27abca34254356704d`; the narrowly authorized November 4
public stylesheet revision is recorded separately below with before/after hashes.
Those files were compared with the original commit when the manifest was created;
the manifest is not a snapshot that silently blesses edits outside the request.
It also checks the 17 retained legacy
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

### November 4 public-only desktop presentation revision

On November 4, 2026 (Asia/Seoul), the user clarified that the requested alignment
and readability fixes concern the public/pre-login pages only and that the
signed-in interface must remain unchanged. The earlier signed-in styling proposal
in [PR #47](https://github.com/JackRo682/SignalBrief/pull/47) was closed without
merging; GitHub reports `state: closed`, `merged: false`. This revision starts from
the unchanged production commit `0d25f2b2c15a818873285524713efe7b469ac63b`.

The sole reviewed application source change is
`apps/web/src/components/marketing/screenshot-design.css`. It appends desktop
rules under media queries beginning at 901px, with every added selector positively
scoped to `.v-public-design` or `.reference-auth.v-account`. The original stylesheet
is retained as an unchanged prefix. The changes address public content widths,
header alignment, typography, card spacing and pre-login form presentation; they
do not change authentication, route destinations, API calls or stored data.

The manifest records this authorization in
`reviewed_public_presentation_revisions` and replaces only the reviewed
stylesheet's protected digest. All 90 protected entries and all protected paths
remain present. The other 89 protected hashes, 17 retained-feature hashes,
verified customer-entry hashes, disabled-feature declarations and feature gates
remain unchanged. `scripts/verify_workspace_scope.py`, its existing negative
tests and the CI gate remain unchanged.

| Reviewed source | Normalized SHA-256 |
| --- | --- |
| Production stylesheet before this revision | `f422f98b7881846d975faafc7ebb4cfdbaa5946b335106836ccfa6d147663d44` |
| Reviewed public desktop stylesheet | `49b3e20f813e456253dde9f272a6307472ee43cf00daf9ef820f2f779e60953a` |

Normalization converts CRLF to LF, exactly as the scope guard does. The before
hash was computed from the production Git object, not from an earlier working
copy. A byte-for-byte comparison of all **318 tracked `apps/web/src` files** found
**317 unchanged**, the one reviewed stylesheet changed, and no source additions
or deletions. This includes the complete signed-in route/source trees, shared
globals/root layout, AuthProvider, clients and administrative sources. The
repository diff allowlist for this revision contains only the public stylesheet,
this scope document, the scope manifest, and focused public tests in the already
included `marketing-pages.spec.ts` and `responsive-design.spec.ts` suites.

Validation status for this public-only revision:

- Source preservation against production: **PASS**, as described above.
- Public CSS isolation audit: **PASS**. A PostCSS parse of the appended rules
  found three desktop media queries, 123 rules and 240 selectors, all under the
  two public roots. The production stylesheet remains an identical prefix.
- Unchanged workspace scope guard: **PASS**, preserving all 90 protected files,
  17 retained implementations and two verified customer entry points.
- Existing scope regression suite (`python -m pytest -q
  tests/test_workspace_scope.py`): **24 passed**, with two existing dependency
  deprecation warnings. Its negative assertions were not edited.
- Full local repository verifier: **all eight stages PASS** at November 4,
  2026, 21:32:55 KST (12:32:55 UTC), after the reviewed stylesheet hash was
  recorded. Backend: **364 passed, 740 PostgreSQL-dependent skips**, with two
  existing dependency warnings. Frontend: **1,720 passed across 120 files**;
  compilation, OpenAPI export, Ruff, ESLint, TypeScript and production build
  passed. ESLint retains five existing navigation warnings and zero errors.
  PostgreSQL skips are not database passes. The initial public-only run failed
  only the guard-dependent backend assertion while the hash still referenced
  production; other stages passed. Earlier signed-in-branch results are not
  results for this public stylesheet.
- Public desktop/mobile browser checks and public-to-workspace CSS isolation:
  **pending**. Existing navigation, authentication and mobile assertions remain.
- Preview visual acceptance: landing, features, sources, pricing, login and signup
  inspected in an anonymous browser. A measured 17px public logo inset was then
  removed and added to the desktop geometry regression; public footnotes are now
  13px. The final exact-commit CI reruns all release and browser checks.
- Exact-commit CI and production deployment: **pending / not deployed**.

The relevant existing browser suites are `marketing-pages.spec.ts`,
`ui-refinement.spec.ts`, `responsive-design.spec.ts` and `auth-navigation.spec.ts`.
New focused assertions must verify the actual public desktop alignment/readability
and ensure that loading public styles does not alter the signed-in screen after
client navigation. Screenshots and geometry checks use isolated test data; they
do not assert provider coverage or live account operations.

### November 1 calendar and notification route reconciliation

The already-deployed redesign at commit
`7e9f0d665bdfca69c2f96a9b45e905a91a1a343a` mounts the calendar and notification
screens directly inside the existing authenticated workspace layout. Those two
route files are unchanged by the reliability repair. Their former manifest
entries still required a `workspaceFeatures.portfolio` reference, even though
these working screens are independent of the disabled portfolio feature.

The guard now compares these two route files with their exact SHA-256 hashes
from that audited commit under `verified_customer_entry_points`. It rejects
changes or deletion of either route. No public/admin/auth hash, retained source
hash, disabled feature flag, portfolio/onboarding feature gate, or authenticated
shell check is removed or changed. Negative regressions also verify that enabling
portfolio or removing the portfolio route's gate still fails. The existing
desktop/mobile browser cases independently exercise the calendar and notification
behavior; the hash checks protect the route definitions rather than replacing
those runtime checks.

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
