# UI-preview detour

## Context
User-authorized separate UI-preview after T02, before resuming T03. Branch codex/ui-preview in SignalBrief-UI started at da976eb7; aligns with parent-approved T02 main merge a522f33162805a5a28941021bb6a5d5b2ea59ae3. Read AGENTS/PLANS, UX_SPEC, MVP_SCOPE, API/AI contracts and existing web/test setup. Original BUILD_PLAN and instructions remain intact. T02 PR is untouched.

## Goal
Thirteen coherent Korean-first responsive preview screens, safe synthetic interactions and explicit disconnected states; independently runnable without API/DB/auth/LLM. Draft PR and verified CI, plus browser evidence for the parent to assess existing Vercel preview.

## Non-goals
No real login, data storage, financial facts/holdings, provider/model/DB connections, admin assurance, hosting-setting changes, new project, paid service, deployment/redeploy or main merge. Existing Vercel success is parent-reported foundation rendering, not UI-preview acceptance.

## Current state
Next16.3.8/React19.3.0 scaffold and pinned Node/npm. Existing T02 preserved. Browser skill inspected; its required node_repl runtime is unavailable in this toolset, so no Windows desktop automation is used. Actual browser validation uses official Playwright and installed Edge locally; isolated Chromium in CI. Versioned dev dependencies are locked.

## Implementation
1. Complete: shared desktop/mobile navigation, permanent Korean preview markers, all13 screens and fictional fixtures.
2. Complete: in-memory interactions and disconnected feedback, eight explicit state fixtures, persistent Today accuracy notices.
3. Complete: semantic responsive/container-query reflow, reduced motion and focus behavior. Browser contrast issues and 200% cramped settings layout corrected.
4. Complete locally: 15unit tests, 19Edge browser tests, mobile axe checks, 51screenshots, lint/types/build/audit; CI and draft PR verification in progress.
5. Complete: README and UI_PREVIEW guide with repository-derived monorepo setup; existing Vercel settings untouched.

## DB/API changes
None. View-only fixtures are presentation models, not competing transport DTOs. No network fetches, service calls, session tokens or durable user storage. State is in memory and labeled as this-tab-only; reload resets it. No sensitive free-text inputs.

## Risk
Demo data mistaken for reality: persistent preview marker and every fictional issuer labeled. Simulated actions mistaken for success: explicit no connection/no storage messages and no auth claims. Hidden P0 notices: Today accuracy notices remain discoverable independently of optional alerts and empty state. Public Ops preview conveys no role assurance; every mutation is a labeled simulation. No price charts, trading signals or advice. Browser checks do not establish WCAG certification or full product gates.

## Tests
AC-19 preview portion: 13 routes at360/768/1280, keyboard/visible focus, 200% layout, reduced motion, accessible labels; loading/empty/error/stale/conflict/correction/withdrawal/unauthorized fixtures; search/add/remove, unknown weight, evidence navigation/back, preset question/repeated clicks, preferences and simulated account/Ops actions. No external requests/browser errors; automated axe plus visual screenshot review. Lint/typecheck/unit/build and T02 generated contract checks stay enabled. CI repeats browser journeys.

## Verification
Local verification passed: lint, web/browser TypeScript, format, 15unit tests, production build, 19actual Edge browser tests, zero mobile axe violations, 51screenshots and npm audit (zero vulnerabilities). Selected desktop/mobile/state/zoom images visually reviewed. Generated-contract check initially detected only Windows checkout CRLF; normalizing the unchanged generated file to LF restores exact comparison without changing its Git content. Final CI verification remains pending. Screenshots/results saved outside repository under task UI evidence directory. Official Playwright webServer and Vercel monorepo docs consulted. Existing hosting settings are not read or changed; parent owns deployment gate.

## Rollback
Revert only UI-preview commit(s); T02 contracts/data retained. No persisted state or migration. No force push. Vercel configuration untouched.

## Acceptance criteria
All13 screens navigable, unmistakably fictional/disconnected, required interaction/state/accessibility checks run with evidence, build and exact-head draft PR CI verified. Report remaining hosting/production gates. Then return to original T03 onward sequence.
