# SignalBrief AI Evaluation

Version 1.1 • Evaluation design, not measured model performance

## 1. Gold dataset design

Target **120 case bundles**, within the requested 100–150. Each bundle includes an original document/version, relevant prior document(s) or an explicit missing-baseline condition, as-of cutoff, issuer/period/basis, atomic expected facts, expected comparison outcomes, permitted interpretations, prohibited claims, correct source locations, and answerability labels. A bundle is an evaluation opportunity, not necessarily a positive changed event.

Proposed coverage: 60 KR and 60 US. Primary event strata: 18 each across the six supported classes (108) and 12 `other/unsupported` (120 total). Scenario strata: 60 ordinary comparable changes; 15 genuinely unchanged; 15 missing/incompatible baseline; 10 source conflicts; 10 amendments/restatements; 10 corrupt/insufficient/untrusted evidence. Scenario assignment is mutually exclusive for quota bookkeeping; secondary tags can overlap. At least 20 cases include tables, 20 multilingual/translation issues, and 15 zero/negative/percentage/range traps, overlapping the primary strata.

Allocate approximately 80 development / 40 locked holdout bundles using connected source families as grouping units: same document, excerpt, event, prior/current pair and amendment chain must stay in one split. Grouping takes precedence over exact counts; record realized counts and class support. Prefer issuer diversity; report any issuer overlap and do not claim unseen-company generalization if present. A retrieval index used during evaluation contains only evidence available at each case cutoff, not gold answers or later revisions. No tuning on holdout; a breached holdout must be retired/replaced.

No gold dataset is delivered or claimed to exist in this specification. Build tasks create it using real accessible sources with recorded rights/hashes and labeling. Synthetic adversarial mutations are a separate safety suite, never relabeled as real events.

## 2. Labeling and reproducibility

Case schema: `case_id, dataset_version, group_id, split, market, event_type, scenario, source_hashes, cutoff, expected_facts[], expected_changes[], supported_claims[], forbidden_claims[], valid_spans[], should_abstain_by_question[], materiality_label, ambiguity_notes, annotator, adjudicator, status`.

Use a written rubric before labeling. Separate factual truth from permitted conditional interpretation. Annotator identifies every required fact and acceptable metric alias/unit normalization. A second qualified reviewer independently labels all holdout cases and at least 25% of development cases; disagreements are adjudicated before freeze. If only one reviewer is available, label results provisional and keep human review of all beta publications; do not claim independent validation. LLM suggestions may accelerate annotation but never become authoritative without source inspection.

Store raw source hashes, parsed artifact IDs/hashes and parser/config versions, retrieval snapshot, model/prompt/config versions, commit SHA, seed where supported, and per-case predictions/metric counts. Rerun deterministic scoring exactly. Model nondeterminism is measured by three runs of the same fixed 20 development cases before choosing a candidate; count extra cost. Final holdout is evaluated once per release candidate after development changes are frozen, with repeats only for documented infrastructure failure or a new fully versioned candidate.

## 3. Metric formulas

Every denominator and exclusion count appears in the evaluation report. Undefined ratios (zero eligible observations) are N/A, never 100%. Report micro totals and market/class/scenario slices with n; no unsupported subgroup performance claims from tiny cells.

| Metric | Calculation and scoring unit | Initial gate / interpretation |
|---|---|---|
| Event Classification F1 | One primary class/case. For class c, precision=TPc/(TPc+FPc), recall=TPc/(TPc+FNc), F1c=2TPc/(2TPc+FPc+FNc). Macro F1=mean over preregistered classes with gold support. Report micro F1 and full confusion matrix; abstention on class with gold label is an error. | Macro ≥.90 and each supported class ≥.80; separately report `other` false-positive publication rate |
| Fact Extraction Accuracy | Strict set accuracy = matched facts/(matched facts + spurious facts + missed required facts). Match requires issuer, metric, value, unit/scale, period, basis, qualifiers and supporting span. Use one-to-one matching; duplicates count as spurious. Also report extraction precision and recall separately. | ≥.95 overall; material numeric facts 100% exact on publishable subset; missing required facts still count |
| Change Detection Accuracy | Correct outcomes / all labeled comparison opportunities. Outcome must match prior fact identity, comparability, change kind and correct deltas where applicable. Missing predicted opportunity counts wrong. False extra comparisons counted as extra incorrect opportunities in denominator. Include unchanged/missing/conflict outcomes. | ≥.95; 0 wrong-issuer or incompatible-period numeric comparisons published |
| Citation Coverage | Material atomic claims with ≥1 resolvable required citation set / all emitted material atomic claims. Comparisons require both sides; interpretations require grounded premises. Titles/summaries count. Count pre-gate and published outputs separately. | 100% published; no-output runs also reported, cannot inflate coverage |
| Citation Correctness | Supported claim–citation links / all emitted claim–citation links, judged against original context. A resolvable unrelated passage is wrong. Also report claim-level full support: claims whose entire required citation set supports every clause / cited claims. | ≥.98 link precision; 100% material-claim full support in published holdout outputs |
| Numeric Consistency | Correct numeric occurrences / all emitted numeric occurrences in factual/comparison claims. Each occurrence matches sourced value/unit/period or reproducible derivation, including title/body repetition. Unsupported numbers count incorrect. Exact decimal/source-rounding rules apply. | 100% published; report pre-gate rate and omitted numeric facts separately |
| Hallucination Rate | Unsupported or contradicted externally checkable atomic claims / all emitted externally checkable claims. Invented comparisons, false dates/units and unsupported causal interpretations count. Human/independent adjudication defines support, not the generating model alone. | ≤1% pre-gate development target; **0 observed material hallucinations** in published holdout and safety suite; not a proof of zero real-world risk |
| Abstention Accuracy | For each fixed question/opportunity: (correct abstain + correct answer)/(all answerability-labeled opportunities). Correct abstain declines the unsupported conclusion while allowing supported facts. An empty answer without reason is not correct abstention. Also report abstention precision=correct abstain/all abstain; recall=correct abstain/all should-abstain; answer accuracy on answerable cases. | Accuracy ≥.90; abstention recall ≥.95; answerable-case answer coverage ≥.80 to prevent abstain-everything gaming |
| Latency | Per attempted job: end−start execution time; also enqueue→end, provider-call duration, first-seen→safe publication. Sort observed values and use nearest-rank p50/p95. Include timeouts as failures and report censored/timeout count, not just successful-job latency. | Analysis execution p95 ≤120s target, hard 180s deadline; follow-up p95 ≤20s target, hard 60s execution deadline; queue delay separate |
| Cost per analysis | Sum actual billable usage across extraction, generation, validation, retries and failures / number of completed eligible analyses. Also cost/attempt = same cost/all attempts; cost/publication = same cost/published analyses; show total spend and no-publication N/A. | Proposed mean ≤$0.05 per completed company analysis, p95 ≤$0.15; Q&A mean ≤$0.03. Targets depend on measured model/provider pricing, not quoted prices |

Cost per call: `(uncached_input_tokens × input_rate + cached_input_tokens × cached_rate + output_tokens × output_rate)/1,000,000 + separately_billable_tool_or_usage_cost`. Use the provider's actual usage semantics; do not double-count reasoning tokens already included in output billing. Units and rates are stored with a dated price table. Missing usage makes cost incomplete, not zero. Infrastructure/data/annotation expense is reported separately as total service economics.

## 4. Additional anti-gaming guardrails

- Event recall: gold material events extracted / all gold material events; target ≥.90. Wrong events and duplicate emission reported separately. This catches omission hidden by high precision.
- Publication yield: published eligible cases / all eligible cases, with blocked/reviewed reasons; do not improve safety metrics by silently dropping difficult classes.
- Ingestion coverage: discovered eligible upstream documents / audited eligible upstream documents; parser success and analyzed fraction separately. Audit a sample directly against provider listings.
- Forbidden-advice escape rate: prohibited requests producing prohibited actionable content / prohibited requests; zero escapes in safety suite.
- Numeric error severity: count material errors, not just weighted averages. One wrong unit that changes magnitude is a release blocker.
- Judge disagreement: deterministic vs semantic vs human disagreements, plus final resolution. A second prompt on the same model is not fully independent evidence.
- Cost completeness: calls with complete usage and mapped pricing / billable calls; target 100% before economic claims.

## 5. Uncertainty and sample limits

Use Wilson intervals for simple proportion diagnostics and report numerator/denominator. Use case-level bootstrap for aggregate F1/claim metrics because multiple claims from one document are correlated. Do not treat hundreds of claims from 40 holdout bundles as hundreds of independent cases. Zero observed case failures in 40 holdout cases still corresponds to roughly a 7.5% one-sided upper bound under the rule of three; zero in 120 roughly 2.5%. Therefore this gold set cannot certify a <1% real-world error rate. Point thresholds are engineering gates combined with review and monitoring, not statistical safety guarantees.

## 6. Release gates and workflow

1. Unit/contract tests for decimal math, fiscal periods, source locators, issuer identity, revision and RLS pass.
2. Development gold report meets target; failure categories fixed without editing labels to match output.
3. Locked holdout report passes published-content safety gates and quality targets. Publish full coverage/yield/abstention denominators, including failed cases.
4. Adversarial suite passes: forged source IDs, prompt injection, hidden instructions, unsupported causal statements, buy/sell euphemisms, exfiltration, malicious URLs, zero/negative units, stale evidence and amendments.
5. First 100 beta publication candidates human reviewed; class-specific automatic publication requires operator enablement plus gates. Every conflict/amendment/uncertain parse remains reviewed.
6. Weekly review sample: all reported material errors and at least 10 randomly selected published events, plus 5 blocked/abstained cases. Low volume: review all available, report n. Audit source omissions, not only generated text.
7. Material error or forbidden advice → withdraw/pause affected class, open incident, add a regression case to development, evaluate fix, then resume. Never add the incident to holdout and immediately claim unbiased improvement.

## 7. Evaluation report output

The authoritative persistence, all ten count mappings, strict scope/version/N/A and cost-denominator/export contract is [ANALYTICS.md §4.1](ANALYTICS.md#41-authoritative-evaluation-summary-and-ten-metric-export). Export missing required metric records is an incomplete evaluation, not a gate pass.

Required report fields: run/config/commit; dataset and split hashes; counts by class/market/scenario; all metric numerators/denominators; intervals and N/A; publication yield; refusals/abstentions/timeouts; cost completeness; top failure examples with safe evidence; comparison with prior approved version; gate decision; reviewer signoff. This report is an implementation artifact to be generated later, not fabricated in this package.
