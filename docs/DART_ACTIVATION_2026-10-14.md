# Official filing activation — 2026-10-14

## Live evidence

The OpenDART key was already installed. The Supabase runtime received a TLS HandshakeFailure before API authentication. A private relay on the existing Vercel application uses Node/OpenSSL, HTTPS, certificate and hostname verification, fixed official upstream endpoints, bounded bodies and responses, a 60-second HMAC validity window and database-backed nonce rejection.

Live collection returned eight Korean filings across the tracked companies. Two original ZIPs and full normalized documents were stored with SHA-256 provenance. A Korean filing produced a cited AI review draft; a real Tesla SEC filing also produced a draft using server-resolved passages. These are measured production results, not fixture results. Coverage remains the configured recent reception window, not all historical Korean filings.

Some official DART files contain misnested tags and unescaped quotation marks in translation attributes. Strict XML parsing remains the first choice. The fallback extracts display text with pinned htmlparser2, excludes attributes and scripts as evidence, rejects DTD/entities, preserves original bytes, and labels recovered markup as requiring review. No arbitrary upstream host or insecure TLS fallback is accepted.

AI selects a passage ID rather than copying a quote. The server resolves exact quotes and character offsets, then validates each claim. Numeric mismatches are omitted and their counts/reasons recorded explicitly; no unsupported number is repaired or published. If every candidate fails, the attempt fails. Cited completed acquisitions/disposals are distinguished from trading recommendations. Every surviving draft still requires semantic review.

Parsed documents remain parsed if a later AI request fails. Failed parsing can be queued explicitly by an authenticated administrator, at most twice, with the original failure preserved in a private retry history. Retrying a saved document is refused. Requests are serialized by the existing database lease.

## Operator review

The filings page shows claims, original quotations, omitted-candidate notices and the official source link. An administrator must enter a review reason and affirm comparison of source figures, periods, units and conditions before publishing. Ordinary users have no review controls; the server independently enforces admin access and validated-evidence requirements.

Existing SEC drafts were compared with their official filings:
- NVIDIA 0001045810-26-000078: describes a definitive acquisition agreement, approximate purchase consideration and retention program, and conditional expected closing in 2027. Keep the closing conditions and forward-looking limitations visible.
- NVIDIA 0001045810-26-000069: describes residual-value guaranties. The $105 billion figure is a cumulative initial contingent cap; readiness conditions, tenant default triggers, recovery offsets and indemnification matter. A human should review those qualifications before publication.

Source links:
https://www.sec.gov/Archives/edgar/data/1045810/000104581026000078/nvda-20260902.htm
https://www.sec.gov/Archives/edgar/data/1045810/000104581026000069/nvda-20260817.htm

No draft was automatically approved. Approval of a filing analysis does not assert that the metric-comparison pipeline produced a new event. Email delivery requires an actual published event, a corresponding app notification and explicit user email opt-in.

## Verification and remaining activation

PR #23 passed 251 local backend tests, 496 frontend tests, production build/type/lint checks, 45 disposable PostgreSQL tests and 95 browser regressions. The follow-up parser/review/retry changes have their own fixture tests and release checks. Production Google sign-in and saved dashboard data were verified in the cloud browser. The earlier authorized Resend queue test has a delivered record and signed delivery callback; no users were opted in automatically.

Remaining external steps:
- KIS credentials and an agreement covering SignalBrief's Korean equity and KOSPI/KOSDAQ display use. Personal API access alone does not establish partner-app/exchange display rights.
- FMP's Data Display and Licensing Agreement, with endpoint entitlement for equities, daily history, NASDAQ Composite and S&P 500. A functioning quote key alone is insufficient.
- GNews production key and eligible paid plan. Essential is listed at EUR 49.99/month before applicable taxes; third-party publisher content rights remain distinct from API subscription rights. The application limits its feed to titles, attribution, publication time and source links.

Official provider pages:
https://apiportal.koreainvestment.com/about-open-api
https://site.financialmodelingprep.com/pricing-plans
https://gnews.io/pricing
https://gnews.io/legal/terms-of-service

Full market-price/portfolio/news production tests remain blocked until those credentials and rights are established. Existing public-display gates remain in force.

## Deployment and rollback

The relay runs at https://signalbrief.online/api/internal/dart and rejects unsigned requests. The collector and US Edge functions preserve their existing custom authentication. DART_RELAY_SECRET is server-only and shared through the existing secret stores. Never put it in a public environment variable or repository.

Remove the relay secret from the collector's secret lookup to return to direct DART transport; the direct Supabase TLS incompatibility would then remain. Stop collection through the existing scheduled-ingestion switch if rollback is necessary. Original archives and retry histories are retained.
