# Homepage A/B presentation rollout — 2026-11-06

## Scope

The authenticated `/today` homepage now selects one layout per account. The existing
`src/redesign/home.tsx` and `home.css` are unchanged. A mounts the original Home directly;
B mounts that same data/state renderer once inside a namespaced presentation wrapper.
There are no new APIs, tables, auth providers, packages, external services or paid resources.
Existing navigation, API validation, consent settings, news integration, empty/error/retry
states, company/date filters, activity tabs and calendar scopes remain authoritative.
No sample records or fabricated values are included in production components.

## Assignment

`home-variant.ts` uses a versioned deterministic 32-bit hash of the existing account ID.
Buckets 0–49 receive A and 50–99 receive B. This is approximately 50/50 across accounts,
not an exact quota for small samples, page views or devices. A signed-in account keeps
its layout across refreshes, visits and devices while this version remains unchanged.
Authentication/onboarding must resolve before rendering either layout. No cookies,
localStorage, email addresses, access tokens or additional persistent identifiers are used.
This allocation function does not grant permissions and is not a cryptographic primitive.

Experiment identity: `home-layout-20261106-v1`. Do not change the identity/hash constants
mid-experiment. A new layout experiment must use a new identity and reporting cohort.

## B presentation

- White background/shared top navigation retained; restrained teal and dark-ink accents.
- Editorial masthead with working Recent/Saved shortcuts; full-width search on desktop.
- Large illustrated gradient briefing replaced by a compact horizontal summary/CTA.
- Four metrics become a flat horizontal strip rather than nested cards.
- Narrow company/calendar column beside a larger latest-activity reading area.
- Activity table is visually presented as readable story rows, retaining explicit table,
  row, cell and column-header semantics and the existing actual navigation targets.
- At tablet/mobile widths the panels stack in source/keyboard order. Metrics become 2×2
  on mobile; the real filter controls, keyboard tabs and error messages remain available.
- All design overrides are scoped to `.sb-home-b`; A and other routes are not restyled.

## Preview and rollback

Verified administrators see an inline comparison bar on the same homepage. Ordinary
users never see the bar and cannot override their layout using the query string.

- `/today?home_preview=A`: administrator-only A preview.
- `/today?home_preview=B`: administrator-only B preview.
- `/today`: automatic assignment; preview does not alter the deterministic cohort.

`NEXT_PUBLIC_HOME_AB_MODE` is optional and contains no secret. Absent/`split` enables
50/50 allocation. `A` forces A; `B` forces B. Invalid values fail closed to A. Forced
modes take precedence over administrator previews. Next.js inlines this value at build
time: changing it requires a fresh deployment, not only a browser refresh.
A code-only rollback can also restore the `/today` route to importing the original Home.

## Measurement boundary

This change implements the requested display split, NOT a completed conversion-reporting
system. Existing consent-aware usage tracking continues unchanged. Hidden DOM metadata
contains only experiment/variant/preview flags; it does not send exposure events.
Do not interpret those attributes, the hash distribution test, or existing unsegmented
`/ops` counts as real A/B performance results. No unsupported events are sent to the
current strict analytics endpoint. A later measurement change must version the validated
server/client contracts together, log actual exposure with deduplication, join subsequent
outcomes, honor consent, and exclude administrator previews.

## Verification and release gates

Added `tests/home-variant.test.ts` (immutable fixtures, 10,000 synthetic allocations,
non-admin override denial, preview and forced modes) and `tests/home-experiment.test.tsx`
(single mounted renderer, direct A root, B links, loading/onboarding, repeat rendering,
account switches/logout, query preservation, and forced-mode preview disablement).
The deterministic synthetic cohort contains 5,026 A and 4,974 B accounts; these are NOT
production traffic counts. The pure assignment module passes standalone strict TypeScript
compilation and Node assertions in the authoring environment. Full application verification
must be read from the exact commit's CI results, not inferred from those isolated checks.

Before production release, require the repository's standard full verifier and browser
regression gates. Confirm the source release identity and administrator A/B previews in
production independently. A PR or successful build alone is not a live deployment claim.

`e2e/home-ab-layout.spec.ts` adds isolated desktop/mobile browser checks for sticky A,
non-admin override denial, administrator A/B navigation, unchanged real controls,
viewport fit down to 320px, and empty/error/retry states. The comparison scenario attaches
A and B screenshots to the Playwright report. Its fixtures are test-only; no production
records or authentication settings are changed.
