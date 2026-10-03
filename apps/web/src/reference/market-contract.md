# Optional licensed market gateway

`SIGNALBRIEF_MARKET_API_URL` is a trusted server-configured HTTPS endpoint, not a URL accepted from visitors. `SIGNALBRIEF_MARKET_API_KEY` remains server-only. No provider is enabled by this release and no paid quote calls were made.

GET query: `symbols=AAPL,005930&period=6m`. Response:
```
{"quotes":[{"symbol":"AAPL","price":123.45,"currency":"USD","change_pct":null,"as_of":"2026-10-03T00:00:00Z","source":"your licensed provider","history":[120,121,123.45]}]}
```
The numbers above document the schema, not current market data. Every response requires provider identity and a timestamp. The server rejects malformed payloads and never replaces missing market data with mock prices. Users must be authenticated to query the gateway. Portfolio valuation and FX are still not inferred from partial quotes.
