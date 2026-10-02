# SignalBrief User Research and Source Audit

Version 1.0 • 2 October 2026 • English interpretation of supplied Korean sources

## 1. Source inventory and access boundary

All six source files listed in the current `/SignalBrief` project folder were inspected or verified byte-identical to the documents already read. There are two unique documents and four byte-identical copies. The latest `(2)` attachments were checked after the repeated task request and contain no changes. The supplied project instructions were also read. No respondent-level export, full free-text responses, interview transcript, existing application, or measured beta results were provided.

| ID | Source | Extent and identity | Use |
|---|---|---|---|
| V1 | Attached `붙여넣은 텍스트(1)(1).txt` | 1,446 lines; 29,690 bytes; SHA-256 `831df217fb1d6d23c50fcf136ec13e7f7a7358602f581361606b26446b669865` | Treated as the supplied Product Vision; original filename is generic, not literally “Product Vision” |
| V1-copy | Project `붙여넣은 텍스트(1).txt` | Same complete byte hash as V1 | No additional evidence |
| V1-latest-copy | Latest attached `붙여넣은 텍스트(1)(2).txt` | Same complete byte hash as V1 | Reaffirmed source; no additional evidence |
| S1 | Attached Dataspace investment-information survey, filename ending `RESULT_202610021400(1).pdf` | All 17 pages, Q1–Q25; 1,252,355 bytes; SHA-256 `1344ddae32f9b04628d1147286c0c550b837a6070fe81703167064724af4dee3` | Quantitative aggregate evidence |
| S1-copy | Project survey ending `RESULT_202610021400.pdf` | Same complete byte hash as S1 | No additional respondents or study |
| S1-latest-copy | Latest attached survey ending `RESULT_202610021400(2).pdf` | Same complete byte hash as S1 | Reaffirmed source; still 105 respondents |
| I1 | SignalBrief project instructions and current ten-phase request | Provided in conversation | Binding requirements, scope, engineering principles, requested outputs |

V1's SK hynix CAPEX wording, portfolio weights, valuation/price examples, hypothetical 31-person beta, 42% onboarding loss, and improved conversion examples are illustrations. They are **not** verified company events or actual product results. Career advice and claims about employers are not product-discovery evidence and are not reused as facts. The previous interview and eight-week-plan suggestions are proposals; no interviews or committed schedule are inferred.

## 2. Source audit: A / B / C / D

| Area | A: explicit in V1/I1 | B: survey evidence | C: reasonable inference | D: remains unvalidated |
|---|---|---|---|---|
| Mission | Important company changes with original evidence; no recommendations (V1 final definition, §§3–4) | Overload 49/105; delayed awareness top-two 50/105 (Q13/Q12) | Filtering and comparison are credible discovery directions | Service will save meaningful time and become habitual |
| Target | KR/US investors tracking 5–30 names (§2) | Median 4; KR 84/105, US 54/105; both overlapping (Q4–5) | Start with small watchlists and Korean-language UX | This persona is most willing to adopt/pay |
| JTBD | What happened, what changed, relevance, evidence, next checks (§4) | Cause prioritization frequent 47/105; change summary useful 36/105 (Q11/Q23) | Make a comparison understandable and verifiable | Comparison beats a concise sourced summary in use |
| Pain | Information overload, hard-to-read filings (§2) | Overload leads; jargon and promotional content 28/105 each (Q13) | Reduce selection and comprehension effort | Integration across many apps is the dominant pain |
| Existing behavior | Uses apps/news; cannot read all filings (§2) | News 28/49 and brokerage app 24/49 in recalled event; AI first 0/49 (Q8–9) | Enter through an event feed within existing habits | Users will replace their news/brokerage workflow |
| Product hypothesis | Source-grounded changes reduce search costs (§26) | Concept top-two 60/105, top-box 10/105 (Q22) | Worth an instrumented pilot | Adoption, willingness to pay, retention or causality validated |
| Feature hypothesis | Change engine, timeline, Q&A, alerts, Ops (§§5,14,24) | Price-linked timeline 47, monitoring 43, easy explanations 38, changes 36, citations 32, alerts 12 of 105 (Q23) | Plain explanations deserve early work; alerts lower urgency | Generic timeline fully satisfies price-linked timeline demand |
| Trust | Source tiers, abstention, conflicting evidence (§§10,16) | Evidence 44; freshness 43; fact/opinion separation 42 of 105 (Q24) | Evidence must be usable and fresh, not a decorative link | Citation presence alone generates trust |
| AI risks | Hallucination, bad numbers, unsafe recommendations (§§8,16) | Hallucination 48; bias 38; opaque evidence and selection 31 each (Q21) | Validate interpretation as well as factual extraction | A model confidence score is calibrated reliability |
| MVP | Seven feature groups in V1 §5; expanded named surfaces in I1 | No full MVP tested; relative feature preferences only | Stage P0 core loop, then P1 beta surfaces | All eleven named capabilities are necessary to first value |
| Exclusions | Trading, account linking, screener, recommendations, target prices, crypto, etc. (§§5,26) | Q24 non-inducement 26/105; Q4 ETF 60/105 | Preserve safety boundary; ETF exclusion leaves unmet demand | Excluded features are unwanted by the whole market |

## 3. Survey methodology and data quality

S1 p1 reports 105 valid responses, 25 variables, zero excess/cleaned responses, a filter applied, Opensurvey mobile-panel collection, and conditional use of simple or stratified random sampling depending on allocation. Fieldwork: **2 October 2026, 12:14:48–13:51:16 KST** (about 96 minutes). The exact frame, allocations, weights, invitation counts, demographic distribution, and filter logic are absent. A panel methodology statement does not establish representativeness of all Korean investors.

Q8–Q10 have **n=49**, restricted to people recalling a specific recent ≥~5% daily move. All other displayed questions have **n=105**. Do not silently use 105 for the branch or generalize its rates to all investors.

The report labels a ±6.26 percentage-point error at **80%**, not 95%, confidence. A simple worst-case calculation, 1.2816 × sqrt(0.25/105), gives approximately ±6.25 points. This checks the scale, not the sampling assumptions. A 95% Wilson interval for 60/105 is approximately **47.6%–66.2%** under an independent binomial model; it is illustrative and cannot correct panel/selection bias. The data do not establish population majority support at that confidence level.

Q5 has a non-integer sum of **732.2** for a count of names, median 4, mode 3, mean 6.97, SD 12.2491, min 0, max 100. Fractional responses or data processing require inspection of raw rows. Prefer the reported median descriptively; do not silently clean or infer the exact number holding 5–30 names. Histogram boundaries are ambiguous. Q6 mean 40.20 minutes, median/mode 30, SD 47.2394, min 0, max 300. Means are sensitive to the long tail. Neither distribution permits exact ≥60-minute cohort membership from rounded aggregates alone.

## 4. Discovery conclusions

### Strongest pain

**Selection overload** is the leading Q13 pain: 49/105 (46.7%), versus promotional content 28, jargon 28, weak summaries 27, and poor issue/price connection 24. Fragmented sources receive only 18/105, and personal filtering 17/105. This weakens the idea that a universal aggregator is the primary answer. It supports a small prioritized feed with plain explanations [C]. It does not prove any specific ranking algorithm.

Late awareness is also material: Q12 ratings 4–5 are 50/105 (47.6%); cause prioritization in Q11 is 47/105 (44.8%). These differently worded questions cannot be pooled into one “pain score.”

### Existing information workflow

Observed pieces, not a tracked sequential funnel:

1. A substantial group experienced a large move: 49 recall a case, 38 recall no specific case, 10 report none, 8 do not remember (Q7). Experience categories total 87/105 (82.9%).
2. Among the 49 recalling a case, the first action is no action 11, news 10, price/chart 9, community 7, brokerage information 6, filings 3, social/video 2, trading 1, AI 0 (Q8).
3. Sources used at some point include news 28/49, brokerage apps 24, communities 20, video/social 18, research 12, filings 10, IR 7, AI 7, other 2 (Q9, multiple selection). These show multi-source use, not its order or individual transitions.
4. Time to perceived understanding: ≤10 min 15/49; 10–30 min 10; 30–60 min 4; 1–3 h 1; within day 10; days later 2; never confident 7 (Q10). The within-day answer is not a precise duration. 25/49 report ≤30 minutes; 9/49 report days later or unresolved. No objective understanding test was administered.

Proposed journey: notice an event → scan easy-to-reach sources → reconcile explanations → optionally check originals. Only the first action and source use are observed; the reconciliation sequence is an inference.

### Source hierarchy: use, trust, and product authority differ

| Source | Used during recalled event, n=49 (Q9) | Trust ratings 4–5, n=105 | Mean trust / 5 | Implication |
|---|---:|---:|---:|---|
| Official filing/company original | 10 (20.4%) | 46 (43.8%), Q14 | 3.38 | Most trusted surveyed category; low usage does not imply low value |
| Issuer IR | 7 (14.3%) | 42 (40.0%), Q15 | 3.34 | Primary evidence with promotional/context limits |
| Brokerage research | 12 (24.5%) | 28 (26.7%), Q16 | 3.15 | Useful interpretation, not a primary-fact override |
| News/portals | 28 (57.1%) | 18 (17.1%), Q17 | 2.95 | Common entry point despite limited high trust |
| Community | 20 (40.8%) | 15 (14.3%), Q18 | 2.78 | Discovery behavior is not authority |
| Video/social | 18 (36.7%) | 10 (9.5%), Q19 | 2.50 | High usage and low trust coexist in aggregates |
| Generative AI | 7 (14.3%) | 18 (17.1%), Q20 | 2.98 | Not an established first-response habit here |
| Brokerage app/HTS information | 24 (49.0%) | Not separately measured | — | Do not substitute research trust for app trust |

Q14 combines filings and company announcements; it does not validate a regulatory-vs-issuer tier distinction. Product tiers remain an A requirement. Small mean differences are not significant-ranking evidence; paired respondent data are missing. Neutral ratings dominate several categories. AI distrust is 18/105 and neutrality 69/105, so “most respondents distrust AI” would be false.

### AI trust barriers and requirements

Q21's leading concerns are hallucination 48/105 (45.7%), biased interpretation 38 (36.2%), unclear sources 31 (29.5%), opaque selection 31 (29.5%), and overconfident wording 27 (25.7%). Numeric misinterpretation receives 13, but its consequence still warrants a hard numeric gate. Concern selection is not failure incidence.

Q24 trust requirements: inspectable originals 44/105 (41.9%); freshness 43 (41.0%); fact/opinion separation 42 (40.0%); uncertainty 34 (32.4%); omissions 31 (29.5%); selection transparency 28 (26.7%); privacy 27 (25.7%); no trade inducement 26 (24.8%). This supports provenance, freshness indicators, separate interpretation, and explicit limitations together.

### Concept and feature evidence

Q22 response counts 1→5: **1, 0, 44, 50, 10**. Top-two 60/105 = 57.1%; neutral 44/105 = 41.9%; top-box 10/105 = 9.5%; mean 383/105 = 3.65. Interpretation: **moderate stated usefulness** of a positively described concept. It is neither measured adoption nor PMF, and no payment, switching, signup, or repeat-use behavior is tested.

| Q23 feature (maximum three selections) | Count / 105 | Product response |
|---|---:|---|
| Possible-issue timeline linked to price moves | 47 / 44.8% | Highest stated preference; separately test safe, licensed price context later |
| Automatic monitoring of followed companies | 43 / 41.0% | P0 core source loop |
| Easy explanations of terms/sentences | 38 / 36.2% | P0 plain language and contextual glossary |
| Comparison with previous announcements | 36 / 34.3% | P0 differentiator, still requires behavioral validation |
| Original links, excerpts, locations | 32 / 30.5% | P0 trust gate regardless of rank |
| Personal issue filtering | 30 / 28.6% | P0 simple eligibility/ranking; advanced model deferred |
| Numeric-change highlights | 28 / 26.7% | P0 when comparable, never invented |
| Configurable/summary alerts | 12 / 11.4% | P1 minimal in-app alerts; outbound push/email deferred |

The leading two features differ by four selections. Without paired answers, do not claim their preference gap is statistically reliable. The strongest survey-supported feature is the **price-linked possible-factor timeline**; automatic monitoring is the strongest directly implementable core feature without new market-data rights. These are preferences, not demonstrated feature efficacy.

### Unexpected results and vision tensions

- Small watchlists dominate the typical respondent; mandatory 5–30-name setup is unsupported.
- Plain-language help outranks change summaries slightly; do not equate “simple” with “only beginners.” No cross-tab supports that attribution.
- Alerts are low relative to other options despite the vision's retention emphasis.
- News/social are frequently used despite weaker trust; primary-source delivery must be convenient, not merely authoritative.
- No one in the n=49 branch used AI first, though seven used it sometime; defaulting to a chatbot is weakly supported.
- ETF interest is 60/105, but issuer filings do not deliver ETF look-through. State the exclusion and measure lost onboarding demand.

Lower early investment in complex portfolio weights, notification channels, separate beginner/advanced modes, news aggregation, automated calendar breadth, and open-ended chat. Do not remove evidence, safety, or accessibility because selection rates are lower.

## 5. Segments: what is and is not possible

| Requested segment | Available evidence | Permitted analysis | Not supported |
|---|---|---|---|
| Experience | <6 months 16; 6–12 months 20; 1–3 years 17; 3–5 years 25; ≥5 years 27 (Q3, p3) | <1 year 36/105; ≥3 years 52/105 | Experience × trust/pain/adoption/feature comparisons |
| Korea vs US | KR 84; US 54, multi-select (Q4, p3) | Both intersection between 33 and 54 by bounds; exact overlap unknown | KR-only/US-only/both counts or preferences |
| High search time | Q6 median 30; P70 60; histogram | Report skew and proposed future ≥60 min/day definition | Cohort size, demographics, feature demand |
| Large-move experience | Q7 total experienced 87; specific recall 49 | Describe Q8–10 within recall group | Recall vs no-recall differences in Q11–24 |

Raw export request: anonymous respondent ID, Q1–Q25 answers, selection arrays, routing/missingness, timestamps/duration, weights and quotas, codebook, exclusion rules, full verbatim Q25, and any consent restrictions. Do not request identity or contact details. Define segments before analyzing; retain overlap, report counts, avoid tiny-cell claims, and treat multiple comparisons as exploratory. For future small segments use descriptive estimates with uncertainty; do not infer causal differences.

## 6. Survey design limits

1. Small mobile panel, unknown coverage/weights/quotas, and unknown applied filter limit generalization. Rapid fieldwork does not itself prove low quality.
2. Six-month recall and self-estimated time are noisy; Q10 mixes a recent event with “usually” and coarse duration categories.
3. The specific-recall branch excludes 56 people; recall availability can be associated with engagement. The branch is not a random subsample.
4. Q8 allows no immediate action; Q9's visible list has no explicit “none.” This may create response pressure, though later searches could be legitimate.
5. Positive concept framing and preceding problem/AI questions may prime usefulness. No competing product, cost, switching friction, or neutral-control presentation.
6. Maximum-three choices measure relative salience and suppress secondary needs; feature selections are not independent observations or mutually exclusive segments.
7. Aggregate PDF prevents paired tests, cross-tabs, correlations, respondent quality review, and exact cohort calculations.
8. Q25 is only a word cloud/keyword list. “None” variants cannot be added as unique people; token counts are not coded response counts. No user quotes or themes beyond the displayed words are invented.
9. Q5's fractional total needs raw-data checking; no cleaned estimates are manufactured.
10. Self-reported cause understanding is not factual accuracy, and stated trust is not verified source-checking behavior.

## 7. Next validation plan

These are D test plans, compatible with remote surveys and unmoderated tasks; live interviews are not required.

| Test | Sample and method | Decision evidence | Limitation |
|---|---|---|---|
| Value of comparison | 8–12 consenting testers; randomized order of matched sourced-summary vs sourced-change tasks | Completion, correct factual answers, time, evidence use, preference | Within-person learning; descriptive pilot only |
| Watchlist friction | P0 invited cohort; observe add-one → first event; collect exit reason | Unsupported-name rate and activation/time-to-value | Company coverage and UI both affect result |
| Price-context gap | After using timeline, ask what remains unexplained; compare labeled temporal-context prototype when licensed data available | Residual demand and causal misunderstanding | Static preference is not retention |
| Trust comprehension | Ask users to identify fact vs interpretation and source date; include a conflict example | Correct distinction, appropriate abstention understanding | Small sample; no safety-rate certification |
| Retention | 20–30 testers, 4–6 weeks; qualified sessions by eligible-event exposure | W1/W4 cohorts, reasons for non-return, usefulness | Event supply and earnings season confound results |
| Commercial demand | Only after actual use: ask trade-offs, concrete price choices, then a real opt-in test | Measured conversion separately from survey intent | Payment/commercial launch not in V1 |

## 8. Verification performed

All questions were read from extracted text; concept/feature, count-distribution, and pain charts were rendered for visual checks. Original/copy SHA-256 equality establishes duplicate status. Top-two percentages, Q22 mean, sample-size margins, and overlap bounds were independently calculated. Remaining uncertainties above are preserved rather than filled with invented respondents or quotes.
