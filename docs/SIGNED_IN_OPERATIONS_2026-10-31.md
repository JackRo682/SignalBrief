# Signed-in evidence retrieval and operational status

## Changes

The hosted question endpoint explicitly recognizes requests for the original
document, source, citation, or evidence, including Korean equivalents. These
requests use the selected document's stored, supported quotations and original
URLs even if the word “source” does not occur in the quotation. Topic-bearing
source requests retain evidence matching: asking for revenue evidence does not
select unrelated risk quotations, and absent topics abstain. Source/request
words are excluded from topical matching. Comparison-source requests preserve
current and previous evidence for the existing server pair checks. Empty or
unsupported evidence, credential-bearing URLs, malformed URLs, and unsafe URL
schemes are excluded. Answers still
pass through `sb_save_answer`, which independently validates publication, supported
facts, event membership, and comparison pairs and saves the user's history.

The internal readiness endpoint now reads exact queue-state counts, recent
successful-job timestamps, and the oldest queued/retry job timestamp. A recorded
successful job does not establish a live worker or recurring execution.
Uninstrumented worker heartbeat, private-storage access, provider readiness, and
email receipt are reported as `null`, not invented success or failure states.
The endpoint remains administrator-only; no administrator screen changed.

## Verification

`npm test -- --run tests/question-evidence.test.ts tests/operational-readiness.test.ts`
passed all 32 tests on 31 October 2026. Cases cover explicit source retrieval,
unsupported/empty/unsafe evidence, topical source matching, substantive-question
abstention, comparison and
policy paths, deduplication, the six-fact contract limit, unknown readiness,
queue-age measurement, and the distinction between recorded success and worker health.

The final native PostgreSQL release gate passed all 71 tests in `tests/workspace`,
`tests/test_hosted_schema.py`, `tests/test_migrations.py`, and
`tests/test_email_readiness_sql.py`, with no skips or failures (6.29 seconds).
It used PostgreSQL 16.2 in an unprivileged process bound only to loopback, with
three fresh disposable databases ending in `_test` and the provider fixture's
temporary databases. The real `pgcrypto` extension was loaded from the matching
official Ubuntu PostgreSQL 16.2 package after the initial bundled runtime lacked
that extension; no cryptographic or security behavior was stubbed. Tests include
SQL migration replay, role/ownership isolation, approved-only excerpt visibility,
saved-item isolation, quiet-hours and local-day notification limits, email
readiness and consent, and forward/rollback/reapply behavior. The server version
differs from production PostgreSQL 17.11. Machine-readable results are in
`verification/native-postgres-workspace.xml`.

Production Supabase identity was confirmed as `xabzzhtdmqsaqdauthbu` (SignalBrief,
PostgreSQL 17.11). Separate read-only production verification during this release
measured 1,691 completed collector runs. The three sampled consecutive cycles on
31 October 2026 at 12:45, 13:00, and 13:15 UTC (21:45, 22:00, and 22:15 KST)
each recorded verified SEC and DART collection. Both main parse jobs were marked
`succeeded`. These records establish recurring collector execution and recorded
parse completion; they do not establish a continuously running Python worker or
its missing heartbeat. The seven SEC and 44 DART excerpt analyses remained in
`needs_review` at that check. No analysis was approved and no email was sent by
this change.

Deploy `signalbrief-api/index.ts` together with `question-evidence.ts` and
`operational-readiness.ts`; no database migration is needed for these changes.
