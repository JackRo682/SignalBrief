# Market display decision — 2026-10-14

## Official evidence checked in Work Cloud Browser

The current pricing page was opened and Commercial Use selected:
https://site.financialmodelingprep.com/developer/docs/pricing

It shows Enterprise for display and redistribution with a quote/contact form,
not a published price. Personal subscriptions are not a display agreement.
Neither a successful AAPL request nor a free public portfolio proves rights.
No account session, account plan or signed agreement was inspected. No login
to FMP, contact submission, contract acceptance or purchase was performed.

Independent official references:
- https://site.financialmodelingprep.com/terms-of-service
- https://site.financialmodelingprep.com/faqs
- https://site.financialmodelingprep.com/insights/platform/can-you-use-fmp-data-in-a-public-app-website-or-client-dashboard

The FAQ puts commercial licensing terms in the quote. The public-app guidance
also requires checking derived outputs (returns, rankings, alerts and summaries).
No universal attribution text or guaranteed delay was established for this
account. A timestamp alone is not evidence of real-time or a 15-minute delay.

## Concrete scope to request from FMP (prepared, not sent)

SignalBrief is an evidence-first financial information website at
https://signalbrief.online. Request a written quotation and display agreement
covering signed-in and public visitors, US equity quotes, daily price charts,
NASDAQ Composite and S&P 500 index values/history, and portfolio market values,
weights and unrealized returns derived from those feeds. Ask whether South
Korean equity/KOSPI/KOSDAQ coverage is available and separately licensed; do
not infer it from the phrase global coverage.

Confirm exact endpoint entitlements, each exchange/index owner's fees,
real-time versus delayed versus end-of-day timing, timestamp timezone,
mandatory attribution, cache/retention, export/API restrictions, audience and
territory, request/bandwidth limits, monthly and annual minimums, taxes,
renewal/cancellation and agreement duration. Audience estimates are not yet
verified and must not be invented in a submitted form.

No cost can be approved from the published personal prices: the requested
commercial quote has no public amount. Obtain the actual quote before any
paid approval request. Sending this request to FMP needs explicit authorization
to contact them; preparation itself does not authorize sending it.

## Execution boundaries

- Keep `fmp_display_enabled`, agreement reference and expiry unchanged.
- Existing stock quote and daily-history adapters remain behind the gate.
- NASDAQ/S&P index adapter is not implemented; `usSymbol` rejects caret symbols
  and quotes require a supported SEC company. Do not route index identifiers
  through that stock-only path.
- KIS/OpenDART credentials are outstanding per the user; no new key request
  or account creation was made. KIS personal access does not establish rights
  for a multi-user site. SEC metadata success is not recurring ingestion.
- API-provided license denial now has distinct public messages in desktop
  Today/watchlist and mobile portfolio. Missing values remain unknown.
- Current Work Cloud Browser could open FMP but the production health URL
  returned `ERR_BLOCKED_BY_CLIENT`. This is a browser/client limitation,
  not proof of outage or bot detection. Live production QA remains unverified
  in this execution environment.

These changes prepare the next release; they do not complete live market
display, Korean feeds, index feeds, scheduled ingestion or AI publication.
