# Real-user experiment protocol (not yet run)

Status: BLOCKED pending A/C outputs, independent financial review and real participants. Completed participants: **0**.

Question: Does a source-linked brief help an entry-level investor identify the right number and reporting period, locate its source, and recognize insufficient evidence? This is a usability question, not investment performance.

Recruit 6–8 consenting adults with mixed SEC-reading experience. Exclude builders and labelers from the main sample; record experience separately, without names in event data. Use two distinct, equally difficult AAPL development tasks, each with a reviewed quarter and comparison. Randomize condition order AB/BA. Each task appears under either condition across participants. Do not show the same filing twice to one participant. A facilitator keeps the assignment and task difficulty balanced. Small convenience samples support qualitative learning, not population or causal claims.

Conditions: A is an actual saved direct-LLM output, displayed as prose without evidence controls. C is the same scoped task's validated evidence-linked output. Both must use the same model version, source versions, factual scope and word-length band (target 80–120 Korean words). Record any rejected outputs and do not silently replace them with manually fabricated summaries. If A is incorrect, the reviewer may approve it as a deliberately incorrect test stimulus only with a debrief, never as a correct financial reference. Pause recruitment if either condition lacks traceable output.

Facilitator script: “자료를 읽고 매출 변화 방향과 비교 기간을 선택해 주세요. 근거를 확인할 수 있으면 확인해 주세요. 정확한 근거가 없으면 근거 부족을 선택해도 됩니다.” No hints about the expected direction. No holdings, trades, income or personal financial advice. Allow 3 minutes per task. A timeout is a noncompletion, never silently dropped. Debrief all errors after both tasks.

Primary outcome: proportion with both correct direction and period according to an independent signed answer sheet. Secondary: completion time (including failures), evidence-open count, correct rejection of an intentionally insufficient-evidence task in a later round, and confidence calibration. Report participant count, attempts, missing responses, median/IQR and paired individual differences. With n=6–8, emphasize uncertainty and observations; do not claim statistical significance or conversion lift. Facilitator notes remain separately consented and untracked by this harness.

## Local analytics implementation

Open `tools/usability-study.html`. It makes no network analytics calls. Import a reviewer-prepared JSON with this contract:

```json
{
  "version": "signalbrief-usability-v1",
  "human_review_status": "approved",
  "reviewer": "actual reviewer identifier",
  "review_date": "actual ISO date",
  "model_run_reference": "path/hash of actual A and C runs",
  "trials": [
    {"id":"T1","generic":"actual A output","evidence_first":"actual C output","task":"reviewed task","sources":[{"url":"actual SEC archive URL","label":"source label"}]},
    {"id":"T2","generic":"actual A output","evidence_first":"actual C output","task":"reviewed task","sources":[{"url":"actual SEC archive URL","label":"source label"}]}
  ]
}
```

This contract example is not a loadable real stimulus and is not evaluation evidence. The review fields are facilitator attestations, not cryptographic proof or automatic ground truth. The harness accepts text through `textContent`, restricts links to HTTPS SEC archives, assigns a random pseudonym/order, records trial starts/completions/evidence opens in memory, and exports JSON only after both tasks. Completion handlers reject duplicate submissions. Consent withdrawal clears memory and disables export; files previously exported require facilitator deletion. No free text, email, holdings, auth tokens or IP are collected by application code. Visiting SEC still uses the participant's browser network connection.

The facilitator stores exports in an approved private research folder, never Git. Score using the independent answer sheet after collection. Retain for 30 days, then delete unless the participant separately consents to longer retention. Do not include fabricated human rows in tests or result tables. Automated browser checks of this harness must be labeled software tests, not participant sessions. This local harness is not wired into the production analytics pipeline or live product.

Software-only UI regression: serve the repository on loopback port 8765, then run `SB_STUDY_TEST=1 npx playwright test usability-study.spec.ts` from `apps/web`. The dedicated financial-evaluation workflow does this on Linux. The ordinary product browser suite skips this separate harness because it does not start that server. Fixtures explicitly say they are synthetic software data, not real model outputs or human attestations.
