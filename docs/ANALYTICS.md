# SignalBrief Analytics

Version 1.1 • PostHog event taxonomy and metric contracts

## 1. Measurement principles

Explicit allowlisted events only; autocapture and session replay disabled for beta. Optional product analytics require consent. Essential first-party security/operational records are separate, minimized, and described in privacy policy. PostHog is a destination, not the transactional authority for publications, quotas, deletion or feedback.

Anonymous acquisition IDs can link to a pseudonymous authenticated UUID only after consent. Do not send email, exact portfolio weights, holdings lists, prompt/question text, feedback text, token/session credentials, full URLs/query strings, document bodies or source excerpts. Use safe route names, event/brief UUIDs and coarse count buckets. Company-specific interaction histories remain potentially sensitive even without email; protect access and honor deletion. Ops users/test fixtures are flagged and excluded from product metrics.

Common envelope: `event_uuid`, `event_name`, `schema_version=1`, `occurred_at`, `received_at`, `environment`, `distinct_id` (pseudonymous), `session_id?`, `actor_type:user|operator|system`, `consent_version?`, `app_version`, `source:client|server`, `trace_id?`. Event properties have a per-event schema. Future timestamps >5 minutes and old client events >24h are rejected/quarantined; authoritative state time comes from server events. Dedup by event_uuid.

Session: server-issued session_id, new after 30 minutes inactivity; activity heartbeats require visible foreground, not background polling. Weekly reporting timezone is Asia/Seoul, Monday 00:00–next Monday. User display/quota timezone does not alter historical reporting periods. Client capture uses a same-origin endpoint; server transitions create telemetry outbox rows, then export asynchronously. Analytics outage must not fail a user action.

PostHog export preserves the canonical event UUID, event name, original timestamp and distinct_id on retries. Local deduplication is authoritative for derived session metrics; downstream eventual deduplication can lag and must not inflate reports. No automatic `$current_url`, referrer query, IP or sensitive SDK properties are forwarded by the explicit exporter.

## 2. Canonical event taxonomy

“C” = client-observed interaction, “S” = server-authoritative transition. All user events below are exported only under consent. System events contain no user financial text.

| Category | Event | Producer and exact trigger | Specific allowed properties |
|---|---|---|---|
| Acquisition | landing_viewed | C, landing visible once/navigation | referrer_category, campaign_code allowlist |
| Acquisition | auth_started | S, valid OAuth start | provider=google, entry_route |
| Acquisition | signup_completed | S, first profile created, once/user | provider, signup_cohort |
| Acquisition | login_completed | S, successful returning login | provider |
| Activation | onboarding_started | C, first onboarding render/session | step |
| Activation | onboarding_completed | S, valid completion persisted | followed_count_bucket, timezone_region |
| Activation | watchlist_item_added | S, new unique item committed | supported_market, followed_count_bucket |
| Activation | watchlist_item_removed | S, removal committed | followed_count_bucket |
| Activation | coverage_requested | S, unsupported request stored | requested_market, no raw query |
| Activation | portfolio_created | S, first manual portfolio saved (P1) | positions_count_bucket |
| Activation | activation_completed | S-derived, first qualifying session within seven days + ≥1 saved supported company | first_qualified_session_id, seconds_since_signup, definition_version |
| Engagement | session_started | S, new session | entry_route, device_class |
| Engagement | brief_impression | C, ≥50% card visible ≥1s once/brief revision/session | event_id,brief_id,revision,rank_bucket,ranking_version |
| Engagement | brief_opened | C, successful detail visible, server revision validated | event_id,brief_id,revision,entry_surface |
| Engagement | brief_read_threshold_reached | C, cumulative ≥10 foreground seconds on same detail | brief_id,revision,visible_seconds_bucket |
| Engagement | company_timeline_opened | C, timeline visible | market,history_available:boolean |
| Engagement | followup_submitted | S, question job accepted (P1) | question_id,brief_id,revision |
| Engagement | followup_answer_viewed | C, completed validated answer visible | question_id,brief_id,answer_status |
| Engagement | calendar_opened | C, agenda visible (P1) | range_days,items_count_bucket |
| Trust | evidence_panel_opened | C, resolved evidence rendered | brief_id,claim_id,revision |
| Trust | source_opened | C, user clicked approved original link; open attempt only | brief_id,claim_id,source_tier,revision |
| Trust | event_rated | S, useful/not useful persisted | brief_id,revision,rating,from_alert:boolean |
| Trust | error_report_submitted | S, report persisted | brief_id,revision,reason_code,report_id |
| Trust | error_report_resolved | S/Ops, adjudication completed | report_id,confirmed_error,severity,resolution |
| Trust | correction_viewed | C, P0 accuracy notice rendered, optional consented product event | notice_id,accuracy_action_id,brief_id,prior_revision,current_revision? |
| Retention | session_qualified | S-derived once/session after criteria below | qualification_basis,definition_version,relevant_event_count_bucket |
| AI Quality | analysis_started | S, worker begins company pipeline | run_id,event_type,market,config_version |
| AI Quality | analysis_finished | S, terminal pipeline disposition | run_id,status,reason_code,latency_ms,cost_usd?,cost_complete,tokens? |
| AI Quality | validation_failed | S, blocking check | run_id,check_type,severity,reason_code |
| AI Quality | analysis_published | S, publication transaction committed | run_id,brief_id,revision,publication_mode |
| AI Quality | followup_finished | S, terminal question | question_id,status,reason_code,latency_ms,cost_usd?,cost_complete |
| Alert Quality | alert_opt_in_changed | S, preference saved | enabled,threshold_bucket |
| Alert Quality | alert_created | S, in-app notification committed | notification_id,brief_id,kind |
| Alert Quality | alert_impression | C, notification visible | notification_id,kind |
| Alert Quality | alert_opened | C, actual alert click | notification_id,brief_id,kind |
| Alert Quality | alert_muted | S, company mute saved | reason_code optional, no holding data |
| Reliability | source_poll_completed | S, complete provider poll committed | provider,success,lag_ms,discovered_count,gap_count |
| Reliability | document_processed | S, parse/skip/quarantine result | provider,form_class,status,reason_code,latency_ms |
| Reliability | api_request_completed | S aggregate, sampled safe metrics | route_template,status_class,duration_ms |
| Reliability | job_terminal | S, terminal job | job_type,state,attempts,queue_ms,execution_ms |
| Reliability | ui_error_shown | C, actionable error rendered | route_template,error_code,trace_id |
| Reliability | deletion_completed | S, completed privacy job | request_id,elapsed_ms; no deleted identity exported |

Do not emit a second server copy of a client interaction under the same event name. Store dedup IDs and the original producer. Renamed events require schema migration rather than silently switching dashboard meanings.

## 3. Qualification, activation and retention

An **evidence-backed qualified session** requires all of:

1. Authenticated, active, non-test user; consented measurement cohort.
2. At least one successfully displayed published event relevant to that user's watchlist/holdings at view time, with the exact brief revision recorded.
3. ≥10 cumulative foreground seconds on that event detail.
4. Within the same session and for that event, at least one: approved original source open attempt, a validated grounded follow-up answer actually viewed, or useful rating committed. A question submission that fails/abstains does not qualify. A negative rating alone does not qualify but remains valuable feedback.

Derive `session_qualified` once; use database unique(session_id,definition_version). Raw opening, alert preference changes and button clicks alone do not qualify. V1's vision included saves and alert creation; saves are deferred, and passive preference setup is excluded here to reduce metric inflation. This deliberate definition change is versioned, not silently mixed with the older concept.

Activation: qualification plus ≥1 saved supported company within seven days of signup. First-value time is signup→first qualified action time, not ingestion time. Report median/p75 for completers plus noncompletion count and time-to-event-availability separately. Do not remove users with no source events from the main denominator.

## 4. Metric → event mapping and denominators

| Metric | Numerator / denominator or aggregation | Events / source |
|---|---|---|
| Signup conversion | Distinct consented signup_completed users linked within 7d / consented landing visitors with mature 7d window | landing_viewed → signup_completed; unlinked/declined consent separately reported |
| OAuth completion | Successful signup/login starts completed / valid auth_started journeys | auth_started, signup_completed, login_completed; correlate auth journey ID internally |
| Activation rate | Activated users / signup cohort with full 7d observation | signup_completed, activation_completed |
| Watchlist funnel | Distinct signup → first item → onboarding → first brief → qualified session, each with counts/drop-off | Corresponding activation/engagement events |
| Time to value | Median/p75 seconds signup→first qualifying action among activated users, plus percent not activated | signup_completed, session_qualified |
| WEBS North Star | Count distinct qualified session IDs in report week | session_qualified |
| Breadth / concentration | Distinct qualifying users; median sessions/user; share from top 10% users | session_qualified |
| Brief open rate | Unique impressed brief/user/revision pairs later opened / unique impressed pairs, within same session | brief_impression, brief_opened |
| Weekly brief use | Distinct opened brief revisions per user/week, median and total | brief_opened |
| Source Open Rate | Distinct brief-opened pairs with source click / distinct brief-opened pairs | brief_opened,source_opened; clicks ≠ reading or trust |
| Evidence inspection rate | Opened brief pairs with rendered evidence panel / opened brief pairs | evidence_panel_opened,brief_opened |
| Useful rate | Useful current ratings / (useful + not useful current ratings) | event_rated; show response rate = rated/opened pairs |
| Confirmed fact error rate | Distinct viewed briefs with adjudicated factual error / distinct viewed briefs with sufficient review window | reports + resolved; report review coverage and unresolved count; user reports underdetect errors |
| D7 qualified retention | Activated users with qualifying return in [7d,8d) after activation / activated users with full 8d observation | activation_completed,session_qualified |
| W4 qualified retention | Activated users with qualifying return in [21d,28d) after activation / activated users with full 28d observation | Same; report calendar mature cohorts |
| Opportunity-adjusted retention | Same retention numerator restricted to users receiving ≥1 relevant eligible event in window / same eligible-event cohort | Server publication eligibility snapshot + retention events; diagnostic only |
| Alert open rate | Unique normal notifications opened / normal notifications shown, 7d mature window | alert_impression,alert_opened; created→open reported separately |
| Alert usefulness | Useful from-alert ratings / all from-alert ratings | event_rated,alert_opened join; response rate shown |
| Alert mute rate | Users muting within 7d of first normal alert / users shown a normal alert with mature window | alert_muted,alert_impression |
| AI failure rate | Failed or blocked runs / all terminal runs | analysis_finished,followup_finished; abstained/refused separate categories |
| Ten AI quality metrics | Versioned counts/aggregations for every AI_EVAL metric, by fixed evaluation scope | Authoritative ops.eval_metric_summaries/export contract in §4.1; never inferred from source clicks or optional telemetry |
| Cost per analysis / attempt / publication | Cohort-wide billable spend including retries/failures divided by completed eligible analyses / attempted analyses / published analyses, separately | Pinned ai_calls + ai_runs/publications joined through eval_results; §4.1 defines eligibility, completeness and zero-denominator handling |
| Ingestion delay | First_seen_at−upstream publication_at, where time precision supports it | source documents; date-only cases excluded from exact-hour stat with count shown |
| Processing delay | Published_at−first_seen_at | documents/runs/publications; queued/review backlog separately |
| API availability | Successful valid requests / eligible requests; 5xx and unexpected timeout are failures | api_request_completed; exclude intentional 4xx, show them separately |
| Event availability | New users with ≥1 relevant published event within 7d / all new users with mature window | Backend roster/subscription/publication join |

## 4.1 Authoritative evaluation summary and ten-metric export

AI_EVAL §3 owns formulas and gates. PostgreSQL `ops.eval_results` holds per-case scoring evidence; `ops.eval_metric_summaries` is the authoritative aggregate, not PostHog events. T35 writes an immutable schema-validated JSON report and summary rows in one completed evaluation transaction. T33 can implement readers against scoring fixtures first; a real quality result remains unavailable until T35. No optional analytics consent is needed for non-user gold evaluation data, and no production private questions/holdings enter this export.

Report envelope: `schema_version`, `evaluation_run_id`, `dataset_version`, `dataset_hash`, `split_hash`, `evaluation_protocol_version`, `metric_definition_version`, `pipeline_config_version`, `commit_sha`, `parser_versions[]`, `schema_versions[]`, `requested_and_returned_model_versions[]`, `prompt_versions_and_hashes[]`, `price_table_versions[]`, `scope`, `expected_case_count`, `result_case_count`, `no_output_count`, `failed_count`, `blocked_count`, `review_pending_count`, `excluded_count`, `exclusion_reasons`, `generated_at`, `metrics[]`, `gate_result`, `reviewer_signoff?`, `artifact_hash`. Pin exact parser artifact hashes per case in the underlying results. Absent model snapshots stay explicitly unknown; do not invent one.

Scope is `{dataset_version, subject_type:company_analysis/followup, split:dev/holdout/safety, market:all/KR/US, event_class:all/or supported enum, scenario:all/or registered scenario, output_scope:pre_gate/published, attempt_scope:all_attempts, cohort_cutoff}`. Store a stable hash of canonical scope JSON. The report artifact_hash is SHA-256 of the canonical UTF-8 report payload excluding only the artifact_hash field; keep generated_at fixed on replay. Reviewer signoff is part of the frozen report, so adding/changing it creates a new report/evaluation version rather than mutating a completed hash. Separate company analyses and P1 follow-up opportunities by `subject_type`; do not pool their latency/cost thresholds. No mixing releases, changing eligible cohorts after results, or averaging pre-gate and published percentages. Prederegister supported classes and label opportunities. Every expected case gets a result, including no output, timeout, abstention and failure; no-output is separately reported, never a perfect score.

Each metric record has `metric_id`, `definition_version`, `scope_hash`, `unit`, `numerator?`, `denominator?`, `value?`, `status:ok/not_applicable/incomplete`, `reason_code?`, `sample_count`, `excluded_count`, `components`, `interval?` and `source_result_ids[]` (or a hashed internal manifest for large reports). Ratios retain exact integer counts; monetary sums use decimal strings. Zero eligible denominator → null value, not_applicable, reason zero_denominator. Missing scoring, unresolved adjudication, missing usage or unknown pricing → null affected value, incomplete with reason and known subtotal/count, never zero or a passing gate. Unavailable required evidence blocks release evaluation; unsupported optional slices remain explicitly N/A.

| Metric ID / AI_EVAL name | Persisted numerator and denominator or aggregation | Authoritative counts and records |
|---|---|---|
| event_classification_f1 / Event Classification F1 | Per class 2×TP / (2×TP+FP+FN); macro is sum of defined supported-class F1 / preregistered gold-supported class count; micro uses summed TP/FP/FN | metric_counts.classification: gold_class, predicted_class or explicit no_prediction, TP/FP/FN by class and confusion matrix; absent prediction contributes FN; report all class support and excluded zero-support classes |
| fact_extraction_accuracy / Fact Extraction Accuracy | matched / (matched+spurious+missed_required); precision matched/(matched+spurious); recall matched/(matched+missed_required) | metric_counts.facts: matched, spurious, missed_required; source-linked one-to-one fact-match adjudication; duplicate predictions are spurious |
| change_detection_accuracy / Change Detection Accuracy | correct / (gold_labeled_opportunities+false_extra_opportunities) | metric_counts.changes: correct, gold_labeled_opportunities, false_extra_opportunities; missing predictions remain in gold denominator; unchanged/missing/conflict included |
| citation_coverage / Citation Coverage | material_claims_with_complete_resolvable_required_set / emitted_material_claims | metric_counts.citation_coverage by pre_gate/published; material atomic title/summary/body claims, both comparison sides and interpretation premises required |
| citation_correctness / Citation Correctness | supported_links / emitted_links; companion full_claim_support=fully_supported_cited_claims / cited_claims | metric_counts.citation_correctness plus immutable claim_evidence adjudication/version; unrelated resolvable spans fail; disputed/unadjudicated records are incomplete, not silently excluded |
| numeric_consistency / Numeric Consistency | correct_numeric_occurrences / emitted_numeric_occurrences | metric_counts.numeric by pre_gate/published; every repeated number/unit/context checked; unsupported occurrences incorrect; report omitted required numeric facts separately |
| hallucination_rate / Hallucination Rate | unsupported_or_contradicted_checkable_claims / emitted_checkable_claims | metric_counts.hallucination by pre_gate/published and material/nonmaterial; fixed atomic-claim adjudication; unsupported causal interpretations included |
| abstention_accuracy / Abstention Accuracy | (correct_abstain+correct_answer) / answerability_labeled_opportunities; precision correct_abstain/all_abstain; recall correct_abstain/should_abstain; answerable coverage answered_answerable/answerable | metric_counts.abstention with all named counts and answer_accuracy; missing output without valid reason is wrong; refusal is scored against its fixed opportunity label, never pooled as a correct abstention |
| latency / Latency | Nearest-rank p50/p95 over observed per-attempt durations; rank ceil(p×n), zero n → N/A; no ratio numerator/denominator | Pinned ai_runs/jobs/ai_calls timestamps: execution_ms, queue_to_terminal_ms, provider_ms, first_seen_to_publication_ms; separate completed/timeout/censored counts and observed lower bounds; terminal timeouts remain failures and their observed elapsed time participates, unresolved/censored durations are not fabricated |
| cost_per_analysis / Cost per analysis | Total billable spend for all admitted cohort attempts (including retries/failures) / completed eligible analysis count; companion cost_per_attempt / attempted count and cost_per_publication / published count | Pinned ai_calls with usage/price_table_version joined via eval_results.analysis_run_ids; record known_total_cost_usd, billable_call_count, complete_cost_call_count, incomplete_call_count, completed/attempted/published counts, mean plus p95_completed_cost_usd and p95_attempt_cost_usd |

An analysis attempt is one admitted root company-analysis job; all stage retries and call attempts belong to it and never increase the analysis denominator. An explicit replay is a new admitted attempt and its spend is counted. An eligible cohort is fixed before scoring from supported case/job admissions; rejected duplicates/unsupported source classes are reported as exclusions, never dropped after costly failure. Completed eligible analyses are those admitted eligible root runs reaching succeeded (including validated fact-only or documented abstained/rejected terminal dispositions), whether or not published. Failed, blocked and review-pending runs are excluded only from the completed denominator, retained in attempted counts and total spend. A zero-publication cohort yields cost_per_publication N/A. Any missing cost/price invalidates complete cost ratios/p95, while retaining known spend and completeness counts. P95 cost targets use the completed-attempt distribution; the all-attempt distribution is additionally mandatory so failed spend cannot disappear.

`GET /ops/evaluations/{id}` and its JSON export return this exact report to authorized operators; no private identity or raw prompt is included. Summary export is read-only and can be regenerated from pinned scoring inputs with the same artifact hash under canonical serialization. Any changed adjudication or definition creates a new versioned evaluation, not an in-place rewrite. If an optional downstream system receives aggregate summaries, it must use evaluation_run_id+metric_id+definition_version+scope_hash as the idempotent key, contain no evidence text/user identity, and never become release authority.

## 5. Dashboard and experiment policy

One product dashboard: cohort counts, activation funnel, WEBS breadth, time-to-value, retention, helpfulness with response rate and coverage. One quality/operations dashboard: gaps, failed/blocked/reviewed pipeline stages, validated error severity, cost, latency, backlog, and rollback configuration.

Early 20–30-user beta uses descriptive within-person task tests and weekly cohort review, not underpowered claims of randomized significance. A/B experiments require preregistered outcome, exposure event, sample-size calculation and guardrails before launch. Never optimize clicks by weakening citation validation or multiplying alerts. All D targets in PRD are hypotheses; report actual observations with uncertainty and denominator eligibility.

## 6. Instrumentation acceptance

Verify one browser journey generates exactly one signup and one activation, no qualification from background time, no source-open double count, no duplicate outbox export, no plaintext portfolio/question data, no nonconsented product export, and correct mature-window retention fixtures. Recompute all ten evaluation metric fixtures from per-case counts, verify F1/confusion components and cost denominator choices, zero denominators as N/A, incomplete usage as incomplete, pre-gate/published separation, failed/no-output inclusion and identical exports on replay. P0 accuracy notice persistence/delivery does not depend on consent or PostHog availability. User deletion purges identity-linked telemetry/provider identity; retained aggregate counts cannot identify the person. Consent withdrawal stops future export and follows disclosed deletion policy.
