# Licensed stock-price gateway

The authenticated browser requests `/api/market?symbols=AAPL,005930&period=6m`.
The Next.js server proxies this to the Supabase `signalbrief-us/quotes` function.
Provider credentials stay in Edge Function secrets or the existing private Vault configuration.
The browser batches up to eight normalized, unique symbols per request.

A response contains `quotes`, `unavailable: [{symbol, reason}]`, `available`, and an optional aggregate `reason`.
Keep successfully returned quotes during partial outages. Preserve each missing symbol's reason.
The UI distinguishes display approval, missing credentials, provider plan access, quota, unsupported companies,
and an unavailable provider. Unknown error messages are never displayed verbatim.

Every usable quote has a positive finite price, currency, provider identity, and a provider timestamp or trading date.
History contains dated `{date, close}` records. Null prices are unavailable, never zero.

## FMP feed selection

The existing snapshot route remains the default. An operator may select `fmp_quote_mode: "eod"` in the private
`sb_us_config()` configuration only after confirming that the actual display agreement covers EOD data and the chosen
endpoint. EOD selection uses `/stable/historical-price-eod/light`; it never falls back to `/stable/quote`.
Cache keys include the selected mode so a previously fetched snapshot cannot be returned as EOD.
EOD output uses `source: "FMP EOD"`, `price_kind: "end_of_day_close"`, `timestamp_kind: "provider_date"`, and a date-only
`as_of`. The company page renders this as a trading date without inventing a clock time. Daily percentage change
remains null until its adjustment basis is confirmed.

Both modes require `fmp_display_enabled=true`, a real `fmp_license_reference`, and a future `fmp_license_until`.
The handler rechecks permission before reading cached quotes. A working key or an EOD endpoint does not establish
permission to redistribute data. Index rights remain separate; this stock-price change does not enable indices.

Korean quotes require the existing KIS credentials and verified Korean display rights. Neither provider's display
flags are enabled by this change. Cache TTL, source attribution and retention must be reconciled with the final
agreement before activation. Live EOD requests and public display remain unverified pending that agreement.

Official endpoint reference: https://site.financialmodelingprep.com/developer/docs/stable/historical-price-eod-light
