# New execution results — 2026-10-02

This report covers only the newly supplied independent SignalBrief source. No prior project, repository, deployment, credential store or Codex memory was consulted. The user supplied an extracted local folder after the required Library download helper failed on Windows (`os.setxattr` unavailable). The original Library ZIP signature could not be checked; the authorized local source superseded that transfer blocker. The local folder was copied without modifying the original, and all 165 entries of its supplied SHA-256 manifest matched.

Input Library ZIP: `libfile_31888751ae40819186dd7da902a53c6d`, file `file_000000007db481fd98e71ea01611d377`, version 0, authorized name `signalbrief.zip` (280244 bytes). Four supporting attachments were resolved and read through Library: `libfile_275656466cb48191b4331f32c7a7442d`, `libfile_1f30275e99d48191a07edb86ed7280d1`, `libfile_979202cad2688191a8563ba9f9b6056b`, `libfile_243d22cd25d481918ef8265186f0c776`; preparation recorded version 0 for each. Their names and supplier claims agree with the source-root handoffs.

Supplier logs are retained in `verification/supplier/`. They record 210 pytest passes, one PostgreSQL skip, 79.84% statement coverage, a syntax-only TypeScript check and 120 synthetic evaluation cases. Those records are historical; current results below come from new execution.

Runtime: Python 3.12.10, Node 22.22.0, npm 10.9.4 initially and task-local npm 11.21.0 for the dependency upgrade, PostgreSQL 17.11. Python and PostgreSQL portable binaries and Node were installed within the isolated task directory. The Python MSI failed; the official Python NuGet distribution successfully created `.venv`. Source dependencies were installed with editable dev extras and npm install; genuine `apps/web/package-lock.json` is included. `verification/python-dependencies.txt` records exact Python dependencies.

| Check | Result | Evidence |
|---|---|---|
| Original folder SHA-256 manifest | PASS, 165/165 | `verification/source-provenance.json` |
| Dependency installation / Python dependency consistency | PASS | real lockfile and `verification/python-dependency-check.log` |
| Python compile / OpenAPI export / Ruff | PASS | `verification/checks.json`, corresponding logs |
| Backend pytest including SQLite round trip and PostgreSQL | PASS, 238 tests, zero skips | `verification/backend_tests.log`, `pytest.xml` |
| Disposable PostgreSQL migrations / RLS | PASS | New cluster at loopback port 55439; new database `signalbrief_verification_20261002`; upgrade/downgrade; actual authenticated sessions see only their own users, portfolios and positions; missing identity sees none; anon position reads, authenticated cross-user position mutation, user/admin mutation and selected sensitive-table reads fail with SQLSTATE 42501. This is selected operation coverage, not comprehensive deployed Supabase RLS validation |
| ESLint / TypeScript / Vitest / Next build | PASS | `verification/checks.json`; 19 frontend unit tests |
| Desktop Playwright | PASS, 3 tests | `verification/browser-desktop.log` |
| Mobile Playwright | PASS, 3 tests | `verification/browser-mobile.log` |
| Synthetic CLI evaluation | PASS, 120 cases | `verification/synthetic-eval.log`, `evals/reports/` |
| npm security audit | PASS, zero vulnerabilities | `verification/npm-audit.json`; Vitest/@vitest/mocker 4.1.11, Vite 7.3.6; detailed advisory and exposure assessment in `docs/DEPENDENCY_SECURITY_2026-10-02.md` |
| Live OAuth, private raw bucket, DART/SEC, OpenAI, hosting | BLOCKED | Required settings and permissions in `docs/CURRENT_SETUP_AND_BLOCKERS.md` |
| Docker/Compose | BLOCKED | Docker unavailable in executor; no image/Compose validation claimed |
| Actual human financial gold validation | BLOCKED | No real labelled dataset or human review supplied |

Desktop and mobile were rerun against the final period-binding source using separate newly initialized local demo databases. Both covered login/onboarding, watchlist, today's changes, detail, nonempty prior/current evidence, question response, alert creation/deletion, repeated/partly interrupted navigation, regular-user Ops denial, admin dashboard and logout. Running API tests also proved a second synthetic identity sees no other user's positions and cannot delete the owner's position. This is local demo authorization validation, not real Supabase OAuth verification.

Fixes: explicit UTF-8 reads for JSON fixtures/evaluation/ranking; Windows npm launch support in verification/dev scripts; Ruff import/format violations; stable tracking-effect dependencies; logout moved into the header because its sidebar footer was hidden on mobile. E2E selectors now target the actual visible headings/evidence rather than hidden mobile elements or an incorrect exact FACT label. Added browser coverage and PostgreSQL owner-isolation/mutation assertions. Twenty-seven evidence/lineage regression cases enforce conservative metric/period/unit binding (including quarter-only and spelled-out quarters bound to the same metric/value clause; detached and unrecognized periods abstain), normalized scale conflicts, fresh evidence revalidation and rejection propagation through every revision (including superseded intermediates); cycles and rejected ancestors block publication. Targeted evidence/regression tests passed 86 cases in `verification/quarter-regressions.log`; `verification/adversarial-tests.log` preserves the earlier 75-case run. Auto publish remains false; adversarial tests explicitly exercise enabled auto publish without approving invalid evidence. No tests or assertions were removed to hide a defect; lint rules and thresholds are unchanged. The complete file-level change list is `verification/changed-files.json`.

Commands actually executed from the isolated source (the runtime executables were addressed by their full task-local paths):

```powershell
python -m venv .venv
python -m pip install -e '.[dev]'
# in apps/web with Node 22 on PATH
npm install
npm audit --json
# explicit compatible upgrade using task-local npm 11; no --force
npm install --save-dev --save-exact vitest@4.1.11 vite@7
npm run lint
npm run typecheck
npm test
npm run build
npx playwright install chromium
# source root, with the new throwaway SB_TEST_POSTGRES_URL
python scripts/verify.py --full
python -m ruff check apps/api tests scripts --fix
python -m ruff format apps/api tests scripts
python -m pytest tests/test_migrations.py -q --basetemp='../pytest-pg-run'
python scripts/dev.py
python -m signalbrief.cli eval
python -m pip freeze
python -m pip check
# in apps/web, against private loopback demo only
npm run test:e2e -- --project=desktop
npm run test:e2e -- --project=mobile
```

The final full rerun adds pytest coverage through `PYTEST_ADDOPTS` and saves fresh `verification/coverage.json`; the backend log contains its measured statement coverage. Coverage is not a completion percentage or financial-accuracy measurement. The initial failures and their fixes are recorded in this report; final PASS statements refer to reruns. The 120 cases use the synthetic deterministic parser and do not imply actual financial accuracy, live model quality or human gold validation.

The demo was actually reachable at `http://127.0.0.1:3000` (API `http://127.0.0.1:8000`) during browser execution. It is private/local, not an externally deployed URL. No Vercel, Render or Supabase deployment was performed, no paid resource was created, and nothing was pushed or merged. Demo processes and the disposable PostgreSQL server are stopped after verification. Auto publish remains false.

P0 release blockers and the single grouped setup list are in `docs/CURRENT_SETUP_AND_BLOCKERS.md`. P1 includes finalized privacy/retention/contact information and realistic load/outage/backup checks. PDF/OCR, oversized long documents, unrestricted free-form semantic inference and the real financial gold dataset remain unfinished. No unsupported, conflicting or numerically mismatched evidence was forcibly approved.
