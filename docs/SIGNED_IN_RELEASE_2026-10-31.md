# Signed-in workspace release evidence — 31 October 2026

This record covers the authenticated customer workspace and its content pipeline.
Production observations below were confirmed by the release operator. The latest
completed local verification ended at **14:04:16 UTC**. Final publication totals
and production frontend completion are explicitly pending where indicated.

## Applied backend changes

| Item | Confirmed result |
| --- | --- |
| Supabase project | `xabzzhtdmqsaqdauthbu` |
| Content migration | `20261031125310_signed_in_content_workspace` applied |
| Email migration | `20261031132007_email_readiness_gate` applied |
| API Edge function | Version **19**, `ACTIVE` |
| Collector Edge function | Version **15**, `ACTIVE` |
| Notifications Edge function | Version **4**, `ACTIVE` |
| Delivery webhook | Existing deployment left unchanged |
| Existing collector dependencies | Live `dart-relay`, `us-handler`, and `market-core` preserved in the deployment bundle |
| Source inventory | **7 companies; 183 filings: 125 SEC and 58 DART**, preserved |

The customer publication projection, evidence boundaries, account isolation,
notification rules, and effective email preferences are specified in
[SIGNED_IN_CONTENT_CONTRACT.md](SIGNED_IN_CONTENT_CONTRACT.md).

## Recurring collection observed after deployment

The release operator checked these two completed collector runs after the Edge
deployment. Timestamps below are UTC on 31 October 2026.

| Started | Completed | Status and verified sources | Email result |
| --- | --- | --- | --- |
| `13:45:00.092609` | `13:45:05.152308` | `done`; SEC Apple **30 verified**, DART SK hynix **11 verified** | Summary blocked: `email_unavailable` |
| `14:00:00.318019` | `14:00:07.047321` | `done`; SEC Tesla **30 verified**, DART Hyundai **13 verified** | Summary blocked: `email_unavailable` |

These records establish recurring collector execution after this deployment.
They do not establish a continuously running Python ingestion-worker heartbeat.
The separate main parsing-job snapshot contained **2 succeeded** jobs. Earlier
collection observations and that distinction are recorded in
[SIGNED_IN_OPERATIONS_2026-10-31.md](SIGNED_IN_OPERATIONS_2026-10-31.md).

## Email readiness

The live shared readiness gate is **false specifically because
`dispatch_verified=false`**. Credential, sender, domain, webhook, and
`delivery_verified` checks are true. The unavailable state therefore must not be
described as missing credentials or an absence of existing delivery proof.

The two post-deployment collector email results above match this gate. This task
sent **no email** and did not change the delivery webhook. Readiness remains
unavailable until recurring dispatch has the required operational verification;
no verification flag was enabled merely to make a switch appear functional.

## Analysis review and publication

All **51 existing excerpt drafts** were reviewed. Review decisions preserve the
original filing date, quotation boundaries, uncertainty, units, reporting period,
and incomplete-document coverage. Excluded candidate claims remain excluded.

| Source | Reviewed | Eligible excerpts | Held for correction | Approved through existing audited UI at this snapshot |
| --- | ---: | ---: | ---: | ---: |
| SEC | 7 | 5 | 2 | 5 |
| DART | 44 | 23 | 21 | 19 |
| Total | **51** | **28** | **23** | **24** |

The **24 newly approved excerpts**, together with **2 previously published
analyses**, give **26 published analyses at this snapshot**.
**Final publication count: pending the release operator's final confirmation.**
Four eligible DART excerpts still awaited approval through the existing audited
review interface at this snapshot. Eligibility is not recorded here as completed
publication. Held analyses must remain unpublished until corrected and reviewed
again.

Per-filing decisions and source limitations are in
[SEC_DRAFT_REVIEW_2026-10-31.md](SEC_DRAFT_REVIEW_2026-10-31.md),
[DART_DRAFT_REVIEW_2026-10-31.md](DART_DRAFT_REVIEW_2026-10-31.md), and
[the structured DART review](reviews/dart-drafts-2026-10-31.json).
This record does not claim an independent SHA-256 rehash of archived original
bytes or complete-filing analysis.

## Completed local verification

| Gate | Result | Evidence |
| --- | --- | --- |
| Full repository verification | **All 8 stages passed**, completed `2026-10-31 14:04:16 UTC`; production build, TypeScript, and lint passed | `verification/checks.json` and corresponding verification logs |
| Frontend tests in the final full gate | **739 passed across 74 files** | `verification/frontend_unit_tests.log` |
| Backend tests in the final full gate | **357 passed; 121 environment-dependent skips** | `verification/backend_tests.log`, `verification/pytest.xml` |
| Separate native PostgreSQL replay | **71 passed; 0 failed; 0 skipped** | `verification/native-postgres-workspace.xml` |
| Current CI browser selection, run locally | **66/66 passed**, desktop and mobile | `verification/signed-in-release-browser.log` |
| Customer-workspace scope guard | **PASS**; **90 protected source hashes** and **17 preserved implementations** | `scripts/verify_workspace_scope.py`, `docs/signed-in-workspace-boundary.json` |

The native PostgreSQL gate replayed the content and email migrations and tested
role isolation, quiet hours, local-day alert caps, and email rollback/reapply.
The browser run used synthetic fixtures. These checks do not stand in for final
remote CI, production browser validation, or a live email dispatch test. The
backend suite's 121 skips remain reported as skips. See
[SIGNED_IN_RELEASE_CHECKS.md](SIGNED_IN_RELEASE_CHECKS.md) for the exact browser
coverage and preserved historical contracts.

## Frontend rollout status

[Pull request #39](https://github.com/JackRo682/SignalBrief/pull/39) has an initial
remote revision of `34fe8569dbe30d20a8eee43e146224c01f9a0156`; its preview deployment
was confirmed **READY**. That initial revision is not a claim about the final
release commit.

The production frontend rollout remains pending final remote CI and merge in
this snapshot. The release operator will append the final commit, CI result,
production deployment result, signed-in live checks, and final publication tally
after observing them. Backend deployment and a ready preview alone do not mark
the production frontend release complete.

## Rollback references

Restore the preceding web deployment first. If the customer-content database
projection also needs rollback, use
[`20261031125310_signed_in_content_workspace.sql`](../supabase/workspace-rollbacks/20261031125310_signed_in_content_workspace.sql).
It disables excerpt alert triggers, revokes the new customer RPC, and restores
the preceding event alert gate while retaining sources and user records. The
adjacent
[`20261031125310_signed_in_content_workspace.resume.sql`](../supabase/workspace-rollbacks/20261031125310_signed_in_content_workspace.resume.sql)
resumes the projection without reapproving content or backfilling alerts.

A customer-web rollback can retain the stricter email gate. If email-function
rollback is specifically required, use
[`20261031132007_email_readiness_gate.sql`](../supabase/workspace-rollbacks/20261031132007_email_readiness_gate.sql)
with the corresponding preceding delivery-function deployment; keep
`email_enabled=false` unless the restored older availability behavior is
intentionally desired. Preferences, outbox records, secrets, and source data are
retained. Reapplying the email-readiness migration restores its gate. These are
prepared rollback procedures, not rollback actions performed during this release.
