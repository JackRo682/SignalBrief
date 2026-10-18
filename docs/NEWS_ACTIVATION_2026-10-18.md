# Korean news search activation — 2026-10-18

The account restriction was removed after the account holder registered a payment
method. The account holder completed API HUB terms/third-party consent. A single
`SignalBrief-News` application was registered with **News only**, showing limits of
25,000 requests/day and 775,000/month. Both credentials are server-only Vercel
Production Secrets (`NAVER_NEWS_CLIENT_ID`, `NAVER_NEWS_CLIENT_SECRET`).

## Behavior and API contract

`/news` and Today expose an explicit Korean news search action. No automatic
polling or request occurs on opening either screen. The user selects a public
topic; personal holdings and arbitrary user text are not sent to NAVER.

`GET /api/news?q=<topic>` accepts exactly one `q`: 증시, 삼성전자, SK하이닉스,
현대자동차, 네이버, 카카오, LG에너지솔루션. It calls
`https://naverapihub.apigw.ntruss.com/search/v1/news` with `query`, `display=10`,
`start=1`, `sort=date`, and `X-NCP-APIGW-API-KEY-ID` / `X-NCP-APIGW-API-KEY`.

The Zod contract is in `apps/web/src/lib/news-contract.ts`. Success returns
`{provider:"NAVER", query, retrievedAt, items:[{title,link,originalLink,publishedAt}]}`.
Dates use ISO UTC in transport and explicit Asia/Seoul labels on screen.
`publishedAt` represents NAVER's `pubDate` (time supplied to NAVER, not a guarantee
of the publisher's original publication time). Provider order is preserved; title
highlight markup and character references are rendered as safe plain text.

Invalid queries: 400. Cross-site browser consumption: 403. Instance bursts above
30/min or provider quota: 429. Missing configuration: 503. Provider timeout,
authentication failure, unsafe URL, invalid dates or malformed response: 502.
Errors never contain upstream bodies or credentials. Requests and responses use
`no-store`; redirects from the upstream are refused, with a 10-second timeout.
The instance burst guard is best-effort, not a distributed quota guarantee.

## Display conditions reviewed before enabling

Reviewed current API HUB terms effective **2026-10-07**, including General 7 and
Search API Special Conditions 1.1–1.4:
https://console.ncloud.com/pdf-viewer/last-provision?code=NVHUB&domainCode=PUB

Search results must remain independent, with provider order/content, original
source and navigation. Restrictions include advertising/monetizing search results,
redistribution, and using results for AI input/training/improvement/evaluation.
Only narrow temporary-caching exceptions are listed. This integration uses no
server cache, database history, article scraping, translation, AI ingestion or
advertising on the search page. Results remain transient in the browser until a
new query or navigation. The existing paid-analysis product must keep news search
free of charges or other consideration for the API service.

Text attribution and trademark attribution follow the published BI guide:
https://guide.ncloud-docs.com/docs/apihub-brandguide

Pricing is temporarily free; a paid transition will be announced separately:
https://guide.ncloud-docs.com/docs/apihub-overview
Recheck conditions before introducing paid news access, ads, AI usage or storage.

## Validation

- Official News API live request: HTTP 200, real Korean records.
- Local browser: 10 results, 10 dates, original links, no error state.
- `python scripts/verify.py --full`: all eight checks PASS; frontend 530 tests in
  45 files, backend 251 passed / 91 skipped (environment-gated integrations).
- Disposable loopback PostgreSQL migration/RLS: 1 passed, 7 deselected.
- News desktop/mobile E2E: 2 passed, covering explicit load, source URL, time,
  escaped markup, overflow, topic reset, provider failure and retry.
- Lint: no errors, five pre-existing internal-navigation warnings.

Production deployment verification is recorded after release. This supersedes
the account/key blocker in `NEWS_INTEGRATION_2026-10-16.md`.
