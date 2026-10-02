# SignalBrief V1.1 Review Corrections

Prepared 2 October 2026. This handoff closes concrete implementation gaps identified in the V1 specification and adds repository engineering instructions. It does not implement the application, create migrations, run a model evaluation, deploy services or change the product's research conclusions.

## Source preservation

The baseline consists of README, fifteen requested specification documents and FIRST_10_TASKS. The original specification remains unchanged in Library. The working Markdown baseline was reconstructed from complete authorized Library text reads; every reconstructed file's UTF-8 byte count matched its Library metadata. Original source identities and reconstructed-file hashes are retained separately from this repository handoff. The original ZIP download was unavailable; these are complete text-source reconstructions, not a claimed ZIP byte-for-byte extraction.

USER_RESEARCH.md is byte-identical to the reconstructed baseline. The aggregate 105-person survey, n=49 branch, lack of cross-tabs and unproven adoption/retention remain unchanged. Added engineering requirements are design corrections, not newly observed research.

## Corrections

### Immutable parser provenance

DATA_MODEL now separates immutable raw documents from immutable parsed_artifacts and artifact-linked spans. Same bytes with a new parser/config/schema retain the raw identity and append a new parsed output. Historical span IDs and offsets never move. AI_SYSTEM and API evidence shapes expose artifact/parser/text-hash identity. T02/T03/T11/T12, AC-05/07 and migration guidance require two-parser-version and historic-locator preservation tests.

AI_SYSTEM also names the previously implicit fetch receipt, parser diagnostics, publication decision and final disposition shapes plus a version-pinned stage input envelope. Executable discriminated stage payload schemas remain T02 deliverables; this document does not claim they have been implemented or validated in runtime code.

### Persistent canonical duplicates

Events now persist canonical_event_id independently of amendments. The contract requires same issuer/context, no self-link, canonical root targets, no chains/cycles and serialized re-rooting of existing aliases. Duplicate narrative is suppressed; canonical feed/timeline entries appear once; direct links expose only safe authorized metadata. API mutation requires version/idempotency controls. T14/T23 and AC-09 cover cross-issuer, incompatible, concurrent-cycle and visibility cases.

### P0 correction and withdrawal notices

Persistent app.accuracy_notices plus immutable content.accuracy_actions and outbox fanout are P0, independent of P1 normal alerts, mute/caps and optional analytics consent. The minimal exposure registry records content served conservatively and subsequent render confirmation without claiming proof of reading. Transaction/reconciliation rules cover withdrawal/view races and crash/retry gaps.

API_SPEC adds own-only list/acknowledgement routes. Today includes an accessible banner/list and Event Detail preserves safe revision status. No fourteenth screen, outbound channel or opt-in marketing feature is introduced. P1 Alert Center reuses these records. Security, scope, UX, user flows, T22/T27/T28/T45 and AC-09/15 agree on the release boundary.

### Ten reproducible evaluation metrics

ANALYTICS §4.1 maps all ten AI_EVAL formulas to versioned per-case counts or distributions and authoritative ops.eval_metric_summaries exports. Reports pin dataset/split/protocol/config/model/prompt/parser/schema/pricing/commit, distinguish pre-gate versus published outputs, include failures/no-output and use explicit N/A/incomplete handling.

Cost per completed analysis, attempted analysis and publication have separate denominators; all relevant billable retries/failures remain in spend. Unknown usage is incomplete, not zero. T33 may build fixture readers first; T35 produces the real report/export, with read-only authorized Ops routes. AC-18/23 require reproducibility and completeness. PostHog is not evaluation or release authority.

## Engineering handoff

AGENTS.md establishes mission, architecture boundaries, conventions, schema/migration/test/security requirements, traceable evidence and numeric/model provenance, plus a documented definition of done. .agent/PLANS.md requires Context, Goal, Non-goals, Current state, Implementation, DB/API changes, Risk, Tests, Verification, Rollback and Acceptance criteria, with a bounded initial T01 outline.

BUILD_PLAN retains the original fifty-task dependency order and FIRST_10_TASKS still points to T01–T10. No application code or provider provisioning is included. The next implementation task starts by inspecting the actual repository and completing T01's foundation checks before T02 schema encoding.

## Document verification

The preparation checks cover twenty Markdown files, relative links/heading anchors, balanced fences/table columns, all fifty unique tasks in dependency order, first-ten alignment, twenty-four defined acceptance IDs, thirteen UX screens with all eight required fields, ten explicit evaluation mappings, stale-contract removal, unchanged research text, and a Markdown-only repository payload without source-transfer IDs/paths or recognizable credential patterns.

These are document consistency checks. Application builds, migration execution, RLS tests, live source/Auth flows, browser flows, CI and evaluation gates are not run by this handoff and remain implementation evidence requirements. Automated pattern scanning is not a complete security certification.
