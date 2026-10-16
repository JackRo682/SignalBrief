# News integration — 2026-10-16

## Shipped scope

TradingView Top Stories is embedded with `locale: kr` on desktop/mobile Today and `/news`.
The provider owns article availability and language; this setting is not a promise
that all titles will be Korean. Attribution and direct source navigation remain visible.
External news is separate from reviewed filing evidence. No scraping, translation,
article storage or new GNews subscription is introduced.

CSP permits only the timeline embed script and TradingView's widget frame origin.
The iframe retains its own provider security policy. Existing authentication and
frame-ancestor protections remain enabled. No API key is needed for this embed.

## Registration dependencies — not activated

### Korean news: NAVER API HUB

The old Developers registration route is outdated for new Search API applications.
Naver's 2026-06-29 notice says new applications moved to API HUB after 2026-07-31:
https://developers.naver.com/notice/article/32530

Current product: https://www.ncloud.com/product/applicationService/naverApiHub
API: https://api.ncloud-docs.com/docs/naver-api-hub-search-news

The new endpoint is `https://naverapihub.apigw.ntruss.com/search/v1/news`, using
`X-NCP-APIGW-API-KEY-ID` and `X-NCP-APIGW-API-KEY`. Do not copy the legacy
`openapi.naver.com` endpoint or credentials into a new integration.

API HUB is temporarily free, with a future paid policy announced separately.
Current application-specific display terms must be reviewed before activation;
the legacy FAQ is insufficient to establish API HUB commercial rights.
Cloud console sign-in is required to register the requested application.
No application or key has been issued by this change.

### Korean company profiles: FSC public data

https://www.data.go.kr/data/15043184/openapi.do

The catalog lists free access, automatic approval, no license-scope restriction,
and 10,000 development requests. The descriptive update schedule is daily with
business-day lag; do not describe this as real-time company information despite
the generic metadata label. This is company profile information, not prices.

The live Swagger UI identifies:
`https://apis.data.go.kr/1160100/service/GetCorpBasicInfoService_V2/getCorpOutline_V2`.
Registration requires public-data portal sign-in. No key was issued, no secret
was saved, and no live company profile API success is claimed.

After authentication and approval, wire the actual issued keys server-side,
validate real provider responses, and only then activate news/profile UI.
Never use `NEXT_PUBLIC_` for secrets or commit keys to Git.
