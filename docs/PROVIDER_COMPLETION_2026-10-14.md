# Provider completion — 2026-10-14

User approved an OpenAI reservation cap of $1 per UTC day. The existing 20-call daily ceiling remains. This is a maximum, not guaranteed spending. Human review remains mandatory before publishing AI claims.

## Deployed collection
- Supabase signalbrief-collector, authenticated with expiring single-use hashed tasks. A PostgreSQL advisory lock prevents concurrent scheduling; expired tasks become visible errors.
- PostgreSQL pg_cron every 15 minutes; one least-recently collected tracked SEC issuer and one DART issuer per run. Four tracked US issuers therefore refresh approximately hourly.
- SEC submissions archive in private Storage, SHA-256 provenance and idempotent metadata inserts. First production run stored 30 AAPL filings.
- OpenDART metadata collection code supports the previous seven Korean reception days, up to five pages per issuer, amendments, archived responses and identity checks. It rejects excessive/changed pagination rather than claiming complete results.
- One previously unanalyzed SEC filing in a bounded 90-day window may be analyzed per run. Citations and numeric checks run before storing the review draft.
- Existing /us page reads official SEC metadata. /api/us/dart-filings and the same page display DART metadata when collected. Korean document extraction is not implemented.

## External blockers
- OpenDART: install a valid DART_API_KEY in the project's Edge Function secrets, or Vault as signalbrief::DART_API_KEY.
- FMP: current key connectivity previously verified, but public display requires actual entitlement evidence with an unexpired license reference. Do not turn on the gate without that evidence.
- Korean quotes and indices: no KIS/KRX credentials or public redistribution approval. This release does not provide a live feed.
- NASDAQ/S&P 500: endpoint entitlement and publication rights remain unverified.
- GNews: production key/eligible plan and public display rights unverified.
- Resend: production API key, verified sending domain and delivery test required.

## Rollback
Set app_private.us_config scheduled_ingestion_enabled to false and cron.unschedule('signalbrief-official-filings'). Existing collected records remain intact. Set ai_daily_budget_usd to 0 to disable further paid calls.

Failed model drafts are recorded as blocked attempts; the schedule never retries the same filing automatically. A numeric-citation rejection was observed in production and was not bypassed.
