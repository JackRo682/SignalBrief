# Operator commands

Run from repository root after installation; replace IDs with real database IDs, not tickers.

```bash
signalbrief check-config
alembic upgrade head
signalbrief sync-companies dart
signalbrief sync-companies sec
signalbrief companies --query Samsung
signalbrief ingest-company COMPANY_UUID --since 2026-01-01 --until 2026-03-31
signalbrief ingest-company COMPANY_UUID --since 2026-01-01 --until 2026-03-31 --refresh
signalbrief ingest-document COMPANY_UUID PROVIDER_EXTERNAL_DOCUMENT_ID
signalbrief schedule --lookback-days 7 --limit 500
signalbrief worker
signalbrief worker --once
signalbrief parse-document DOCUMENT_UUID --revision pipeline-v2-reviewed-rerun
signalbrief cleanup-rate-buckets
signalbrief eval
signalbrief eval --dataset evals/datasets/reviewed-real-gold.jsonl --live
signalbrief index-document DOCUMENT_UUID
signalbrief vector-search COMPANY_UUID "capital expenditure"
signalbrief compare-wording "previous exact text" "current exact text"
signalbrief delete-user USER_UUID --confirm-user-id USER_UUID
```

`reviewed-real-gold.jsonl` above is an operator-created dataset, **not a provided file**. Live eval/semantic/vector commands may
incur API charges. The synthetic default eval does not call OpenAI. Optional vectors require their SQL migration/model.
Delete-user deletes app personal records; separately revoke/delete the Auth account to prevent profile recreation.

Ops requires a trusted admin ID. It exposes review, failures, citation issues, duplicates, reports and audited actions with reasons.
Raw document downloads are attachments, never executable source HTML. Queue retry is for diagnosed failures, not evasion of quota.
Refresh downloads again to discover changed original bytes. Same-ID changed bytes are conflict candidates and do not silently replace
stored originals. SEC archive backfill is deliberate and provider throttles are shared through the database.

In-app alert rules notify future newly published events only; enabling a rule does not flood a user with all historical documents.
There is no email/FCM delivery hidden behind an enabled rule. Calendar dates are manually entered or explicitly extracted; they
are not algorithmically inferred earnings dates. Date-only publications remain marked date-only in Korea-aware displays.
