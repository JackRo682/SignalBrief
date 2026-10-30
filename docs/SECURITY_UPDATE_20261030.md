# Dependency remediation — 2026-10-30

Release QA found critical Next.js and high Zod/Vite advisories in the existing dependency set. No audit threshold or assertion was lowered.

Pinned Next.js and eslint-config-next 16.4.3, Zod 4.6.6, Vite 7.3.7 and Vitest 4.1.12. The scoped tinyglobby override is retained for the matching Next lint plugin. Zod record schemas now declare string keys explicitly; existing API fields and data ownership are unchanged.

Validation: TypeScript passed; frontend 637 passed on Vitest 4.1.12; npm audit reports zero known vulnerabilities in the full dependency graph. Lint/build/browser results are recorded with the final integration audit. Historical reports stating earlier versions were clean are historical, not the current advisory state.

Sources:
- https://github.com/advisories/GHSA-2464-fhr4-w9xw
- https://github.com/advisories/GHSA-mrhx-c7xc-m3w5
- https://zod.dev/v4/changelog
