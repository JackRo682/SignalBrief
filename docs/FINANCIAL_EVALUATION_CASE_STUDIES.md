# SignalBrief evidence and release review, 2026-10-10

## 1. Citation mismatch: a correct number can still support the wrong claim

The Today card could show an operating-income or older-period excerpt under a revenue headline. The underlying filing and calculation could be correct while the presentation attached the first available fact rather than the fact actually supporting the headline. PR #13 binds the headline's metric, direction and percentage to the current fact, restricts fallback to the latest comparable quarter, and withholds ambiguous/stale/unsupported evidence.

Reference branch: `codex/live-disclosure-completion-20261008`, commit `8ddd1e89ed4f9a0baea847d53981a6ad64faab56`. Main remained `f680feab8bee13996e71210c566e2cc4da3d2339`. [PR #13](https://github.com/JackRo682/SignalBrief/pull/13) is still draft. Both Python and Edge selectors have existing regression tests. This work reran the backend tests and original SEC-byte replay; it did not alter original extraction, approval records or production data.

The preserved Apple pilot compares FY2026 Q2 and Q3 **quarter over quarter**. Original sources: [March 28 filing](https://www.sec.gov/Archives/edgar/data/320193/000032019326000013/aapl-20260328.htm) and [June 27 filing](https://www.sec.gov/Archives/edgar/data/320193/000032019326000020/aapl-20260627.htm). Quarterly revenue in USD million is 111,184 and 109,417, yielding −1,767 / −1.5893%. Operating income is 35,885 and 35,695, yielding −190 / −0.5295%. Six-month and nine-month cumulative figures are not comparable quarters. Tests replay 16 preserved values with source hash, unit and exact fiscal period. The June original also has 94,036 and 28,202 for the prior-year quarter, which must not be substituted as the current fact.

Evidence: `tests/test_card_evidence.py`, `tests/test_sec_tables.py`, `tests/test_sec_table_pipeline.py`, `apps/web/tests/card-evidence.test.ts`, `verification/financial-20261010/backend-delivery.xml`. The fixture references are agent-transcribed/automatically checked. Separate human numerical verification remains pending. A human worksheet is not a human attestation.

Product decision: source correctness and **claim-to-source binding** are separate acceptance criteria. Missing evidence is safer than a plausible but mismatched excerpt. No claim that production Today is fixed is made: the API change still requires release clearance and an explicitly approved deployment.

## 2. A/B/C financial evaluation: measured coverage before an accuracy claim

Built a frozen 30-pair corpus from 48 original SEC filings: development AAPL 4/MSFT 3/NVDA 3, held-out AAPL 7/MSFT 7/NVDA 6. The new benchmark uses quarterly year-over-year comparisons. Accession numbers, URLs, report dates, raw hashes, fiscal intervals, concepts, contexts and scale are recorded in the manifest, development report and review worksheet. Held-out values remain sealed for independent labeling after the protocol is frozen.

| Method | Development attempted | Completed | Numeric/citation candidate agreement | Human-verified accuracy | Actual new paid calls |
|---|---:|---:|---|---|---:|
| A: direct LLM on full originals | 0 | Not run | Not measured | Not measured | 0 |
| B: structured extraction + Decimal | 10 | 4 | 16/40 required fact slots, 16/16 returned facts | Not measured | 0 |
| C: B + AI interpretation + validation | 0 | Not run | Not measured | Not measured | 0 |

B comparison agreement is 8/20 required comparisons and 8/8 returned comparisons. Useful completion is 4/10 (40%). All completions are AAPL. Six abstentions are explicit: three MSFT pairs exceed the existing parser byte cap, three NVDA pairs fail its HTML/XBRL period-header check. The adapter resolved identical repeated Apple totals without relaxing conflicting-value rejection. Initial and subsequent development runs are preserved, making this development tuning visible.

Final measured local offline latency: median approximately **538 ms**, nearest-rank p95 **927 ms**, over 10 attempted pairs. It includes parse/calculation/validation and excludes source download and reference construction. It is not production response latency. Unsupported emitted claims were 0/24 under the narrow machine-reference validator; this is not a measured LLM hallucination rate. Safe-abstention accuracy and human-verified accuracy are null because answerability and financial labels lack human adjudication.

There were zero new paid AI requests and therefore no paid A/C cost or latency observations. B's API cost is $0. No invoice-reconciled cost per AI brief was measured. The older PR's $0.009216 figure is a historical token-rate estimate for a different Apple experiment, not a result of this A/B/C comparison. The new harness stores response usage and a separately labeled price-based estimate; actual billed cost remains null until reconciliation.

Product decision: the measured improvement is reproducibility, explicit failure accounting and evaluation readiness. **No evidence yet supports “C is more accurate than A.”** The 20 held-out pairs have not been scored or used to tune the parser. Shared filings within each split reduce effective sample independence. Historical public filings may exist in model training data.

## 3. Reliability and security: controlled tests with explicit environment limits

The 40-case executable adversarial manifest includes 24 mutations of real-source candidate claims and 16 controlled system cases. It exercises values/units/periods/issuer identity/citations/omission, missing filings, timeouts/rate limits, dead letters, duplicate jobs, lease fencing, user isolation, privilege escalation and publication without sufficient evidence. **40/40 passed** locally. Controlled fault injection and synthetic identities are software regression evidence, not live LLM quality or real-user authentication evidence.

The full local backend suite after implementation passed **332 tests**, with **37 PostgreSQL-dependent tests skipped**. It includes the prior Apple API/approval/feed tests and new benchmark guards. A first attempt failed because pytest could not create its default sandbox temporary directory; rerunning with a repository-local temporary directory resolved the environment errors. Those errors are not counted as product regressions or hidden as initial passes.

The local full verification command passed Python compile, OpenAPI generation, lint and web type/lint checks, but Windows native `realpath`/SWC access errors blocked web unit/build execution. Browser installation encountered the same path restriction. These local failures are recorded as execution failures with environment-blocked interpretation. Fresh Linux CI results must be inspected separately; historical PR #13 CI is not substituted for the new branch's results.

Eight production **read-only** health/auth/config checks passed. The checks use the existing public browser key, not a server secret; no accounts or records were created. Interactive Google sign-in and actual two-account isolation remain untested here. Disposable PostgreSQL tests were executed locally: 2 core/hosted checks passed and 35 workspace isolation checks passed in a separate run. An initial combined run hit cluster-wide duplicate test roles, so the workspace run used a cleaned disposable cluster. These role tests do not prove external OAuth or hosted session isolation.

Fresh npm audit: production dependencies have **0 vulnerabilities**; full dependencies retain **5 high findings**, traced through braces/micromatch/fast-glob/Next lint tooling. The [upstream advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) lists the affected range through 3.0.3. No unsafe major downgrade, advisory suppression or undocumented risk acceptance was performed. The first local Python audit was blocked because the embedded interpreter lacks `venv`. A separate complete Python audit environment then audited the actual application site-packages: no known vulnerabilities were found. The original failure and successful workaround are distinct.

Release decision: **BLOCKED for merge/release approval and production deployment**. Remaining gates include independent financial review, actual isolated two-user authentication/access checks, development dependency remediation or explicit accountable risk acceptance, a final review of branch status and a deployment approval. This PR does not merge PR #13 or deploy the Edge API.

## 4. Experiment status table

| Experiment/check | Actual n | Status | Interpretation |
|---|---:|---|---|
| Official corpus download + frozen hashes | 48 originals / 30 pairs | PASS | Data provenance, not financial accuracy |
| Existing Apple original-byte replay | 2 documents / 16 values | PASS | Automated original/fixture consistency; human review pending |
| B development useful completion | 4/10 pairs | FAIL against full-coverage goal | 6 documented parser abstentions |
| B numeric/citation agreement | 16/40 required slots | PASS for 16 returned slots only | No human accuracy claim |
| B comparisons | 8/20 required | PASS for 8 returned comparisons only | Missing outputs remain in denominator |
| A/C real model comparison | 0 attempts | BLOCKED | No approved paid budget/configuration |
| Held-out evaluation | 20 prepared / 0 run | BLOCKED | Sealed, labels and frozen protocol required |
| Adversarial regression | 40 | PASS | Software fault injection, not model evaluation |
| Local backend | 332 passed / 37 skipped | PASS with exclusions | Database exclusions explicit |
| Disposable PostgreSQL | 2 core/hosted + 35 workspace | PASS in separate runs | Synthetic auth/session scaffolding, real SQL |
| Live read-only checks | 8 | PASS | No interactive login or two-account proof |
| Local web lint/type | 2 commands | PASS | Does not establish rendering correctness |
| Local web unit/build/browser | 0 successfully completed suites | BLOCKED | Windows native-path permissions |
| npm production audit | 0 findings | PASS | Production dependency tree |
| npm full audit | 5 high findings | FAIL | Development toolchain risk remains |
| Python dependency audit | Installed application packages | PASS | No known vulnerabilities found |
| Real usability participants | 0 | BLOCKED | Protocol/harness ready; real stimuli/review/recruitment pending |

Machine-readable results and per-case outcomes live in `verification/financial-20261010/`. CI results and any later amendments must retain their exact commit references. Screenshots of automated fixture sessions, if available, must be identified as such.

## 5. Fresh Linux verification on PR #15

[Draft PR #15](https://github.com/JackRo682/SignalBrief/pull/15) is stacked on PR #13. All four workflows passed for code commit `3017318019c906d4e8cd2f1e5e7c92bbef0eaea8` (tree `bdf1960e8a5ffdf17e8d72e792100c071b600408`). A subsequent evidence-only commit adds these results and screenshots without changing executable code.

The [full verification workflow](https://github.com/JackRo682/SignalBrief/actions/runs/38014203354) passed Python checks, 332 backend tests (37 database exclusions), 363 web unit tests across 30 files, type/lint checks, the production build, and 76 desktop/mobile product browser tests. Sixteen desktop instances of dedicated mobile reference tests were intentionally skipped; their mobile cases ran. These are controlled local CI sessions, not real production users or OAuth proof. The earlier Windows failures remain preserved.

The [financial workflow](https://github.com/JackRo682/SignalBrief/actions/runs/38014203363) passed the 40-case adversarial replay and all four consent/withdrawal study browser checks. B reproduced 4/10 completions and 16/40 required fact/citation agreement. Its CI run is preserved separately from the local latency report. [Hosted schema replay](https://github.com/JackRo682/SignalBrief/actions/runs/38014203343) and [workspace security replay](https://github.com/JackRo682/SignalBrief/actions/runs/38014203329) also passed.

| Additional actual experiment | n | Status |
|---|---:|---|
| Linux web unit regression | 363 tests / 30 files | PASS |
| Linux product browser suite | 76 passed / 16 intentional project skips | PASS with exclusions |
| Linux study browser suite | 4 software tests / 0 people | PASS |
| Linux B reproduction | 10 attempted / 4 complete | PASS for reproducibility, coverage still 40% |

Evidence: `verification/financial-20261010/remote-status.json`, `ci-checks.json`, `ci-frontend_unit_tests.log`, `ci-frontend_build.log`, `development-B-ci.json`, `adversarial-ci.json`. Screenshots `usability-study-desktop.png` and `usability-study-mobile.png` capture the consent screen before any participant input in automated software sessions. No real participant results are implied. CI success does not resolve the human-label, real-account, dependency or production-approval gates.
