# SignalBrief UI preview

Separate preview of the 13 UX_SPEC screens. All companies, dates, quotations and numbers are synthetic. A permanent Korean notice identifies authentication, storage, AI and administrator privileges as disconnected. This does not complete T03, P1 or production acceptance gates. Resume the original BUILD_PLAN order after preview review.

## Local commands

From repository root using Node 24.19.0 and npm 11.6.2:

```sh
npm ci --ignore-scripts
npm run dev
```

Open `http://127.0.0.1:3000`. No secrets, API, database, worker or provider account is needed. Production-mode local preview: `npm run build`, then `npm run start --workspace @signalbrief/web`. Choices exist only in memory and reset on reload.

## Routes

| Screen | Route |
| --- | --- |
| Today | `/today`, also `/` |
| Login preview | `/login` |
| Onboarding | `/onboarding` |
| Watchlist | `/watchlist` |
| Portfolio preview, P1 | `/portfolio` |
| Event detail | `/events/moabit-review` |
| Evidence | `/events/moabit-review/evidence` |
| Timeline | `/companies/moabit/timeline` |
| Preset questions, P1 | `/events/moabit-review/question` |
| Calendar preview, P1 | `/calendar` |
| Alerts preview, P1 | `/alerts` |
| Settings | `/settings` |
| Ops preview | `/ops` |

The state selector exposes loading, empty, failure/retry, stale, correction, conflict, withdrawal and denied-access fixtures. Today accuracy notices remain visible when optional alerts are off or the feed is empty/failed. Missing baselines never produce percentage changes. Facts, interpretation and unknowns remain separate.

Search covers fictional companies only. Portfolio fields accept optional illustrative weights, not real holdings. Questions are preset-only and read-only. Login, original-source viewing, export, deletion, notifications and Ops actions explicitly report disconnected or simulated results. No corresponding service is called; `/ops` grants no administrator rights.

## Validation and evidence

```sh
npm run format:check
npm run lint
npm run typecheck
npm run typecheck:ui
npm run contracts:check
npm run contracts:typecheck
npm test
npm run build
npm run test:ui
npm audit --audit-level=high
```

Playwright manages a built Next server at loopback port 3117. Windows uses installed Edge; Linux CI installs Chromium via `npx playwright install --with-deps chromium`. Dependencies are pinned in the root lockfile.

Nineteen browser tests cover all 13 routes at 360/768/1280 widths, headings/labels, overflow, mobile axe WCAG A/AA scans, zero external requests/page exceptions on these routes, eight states, navigation/back/repeated actions, watchlist reload reset, portfolio validation, preset questions, alert opt-in, blocked Ops actions, keyboard skip and modal Escape/focus return. Four key screens also use 200% CSS layout zoom; width container queries preserve reflow. These checks are not accessibility certification or a full assistive-technology audit.

Set `PREVIEW_EVIDENCE_DIR` to preserve 51 full-page PNGs outside the checkout (39 viewport, eight state, four zoom images). Default output: `test-results/ui-evidence`; JSON report: `test-results/ui-results.json`. Generated files are Git-ignored and contain only synthetic data.

## Existing Vercel project handoff

Use the existing `signalbrief` project. This change does not create projects, change hosting settings or request deployment/redeployment. The parent must inspect current Dashboard values before any authorized hosting action.

| Setting | Repository-derived value to compare |
| --- | --- |
| Framework | Next.js |
| Root Directory | `apps/web` |
| Runtime | Node 24.19.0 / npm 11.6.2, matching foundation CI |
| Install | npm workspaces and repository-root lockfile; root `npm ci --ignore-scripts` |
| Build | `npm run build` in `apps/web`, equivalent to root `npm run build --workspace @signalbrief/web` |
| Output | Next.js framework-managed; local `.next`, no static `public` export |
| Monorepo inputs | Root manifest/lockfile and shared packages available outside application root |
| Environment | No real credentials needed for preview |

`next.config.ts` does not enable static export; example routes use Next server rendering. Do not apply a generic static-site `public` output override. See the official [Vercel monorepo guide](https://vercel.com/docs/monorepos). Foundation hosting success does not prove this branch's UI was deployed or accepted.

Rollback: revert preview commits only. No migrations, durable data or provider settings require undoing.
