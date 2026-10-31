# Completion release — 2026-10-31

PR #35 was reviewed against its seven successful CI workflows, including real PostgreSQL and desktop/mobile browser checks. Its rollback function matched the live production function exactly. Applied the additive `source_visibility` migration, deployed `signalbrief-api` version 16, and merged #35 at `b31fe9d6b46fd7877f2201d5f8315b03b86d2261`. Vercel production `dpl_mmK9GmU69N9BDH35YHS3MUrTGNKR` reached READY at https://signalbrief.online.

A real signed-in browser reload confirmed the source panel with 63 filings for that account's two watched/held companies, historical reviewed analyses, original source links, and the December 8 official date. The complete database contains 125 SEC + 58 DART filings. The 7 US + 44 DART `needs_review` analyses were not approved or published. Browser navigation to search was subsequently blocked by the user's Cold Turkey extension; this restriction was not changed or bypassed. Local Chromium download also failed. CI browser checks are separate from production browser observations.

## Additional implementation

- Desktop/mobile company timelines now include a clearly separate official source-history section. It uses existing authenticated company data, displays at most the latest 20 connected records, preserves original dates and links, and links to paginated full search. This is not a claim of exhaustive historical coverage.
- Desktop timeline date filters also constrain the source-history section. Mobile source history is an independently labeled latest-records section, while its existing period controls govern reviewed events.
- Company overview timeline previews incorporate original records. Existing SEC/OpenDART company-profile retrieval remains first choice.
- Optional English TradingView company profile, fundamentals and symbol-news embeds use the existing symbol mapping. Unsupported/unverified KRX coverage is not fabricated. Widgets load on request, retain attribution, and expose retry/fallback links. An iframe appearing does not prove data coverage. No iframe data is extracted, stored or used in portfolio calculations.
- Calendar defaults to all authorized watched/held dates and resolves official-date market filters from the registered company catalog, including dates with no analysis event. It has 30/90/365-day controls, bounded authenticated API requests and genuine empty/error states. Existing dates and user ownership remain unchanged. No new collectors, paid data feeds or synthetic dates were added.
- `/billing` and `/api/billing/{checkout,status,webhook,export}` implement a single nonrenewing 30-day source-export pass. Existing beta functions remain free. Export is a new, explicitly limited CSV convenience for up to 20 source records per company; it does not promise additional analysis, quote coverage or a subscription.
- Server checkout reservations serialize on the user row, reuse pending URLs, block repurchase of an active pass, expire after 15 minutes and cap reservations at five per account per day. A provider timeout does not create another checkout for the same reservation on retry.
- Webhooks verify HMAC-SHA256 over exact bytes, then fetch both the provider order and its order item. Store, variant, configured amount/currency, quantity, settlement status and test/live mode must agree before a service-only SQL function records access. Payload size is bounded; SQL ledger events and provider order IDs are unique. Return URL parameters never grant access.
- Access expires from the provider order's timestamp after 30 days. Full or partial refunds revoke the corresponding pass; refund state is terminal under out-of-order/replayed paid events. Test grants never authorize the production CSV endpoint. Unauthorized access, formula injection, MFA and other-user isolation have regression coverage.

## Merchant setup: required before provider testing or live sales

No payment credentials were found among Vercel environment-variable names. No credentials were read, added, replaced or printed. No merchant account was opened, terms accepted, provider checkout created, card charged, or actual refund issued.

Lemon Squeezy is the implemented hosted-checkout candidate because it provides checkout sessions, signed webhooks and test mode without building a card UI. Actual product eligibility, business-country/payout support, merchant approval, pricing, provider fees and refund/customer-support terms must be confirmed with the provider. This product's category may require additional review. If it is declined, this adapter must be replaced before sales; no approval is assumed.

Required server-only Vercel environment variables:

| Variable | Meaning |
|---|---|
| `LEMONSQUEEZY_MODE` | `disabled` (default), `test`, or `live` |
| `LEMONSQUEEZY_API_KEY` | API key for the selected test/live account mode |
| `LEMONSQUEEZY_WEBHOOK_SECRET` | Strong random signing secret of at least 16 characters |
| `LEMONSQUEEZY_STORE_ID` | Approved store ID |
| `LEMONSQUEEZY_VARIANT_ID` | One fixed-price, non-subscription, non-PWYW pass variant |
| `LEMONSQUEEZY_PASS_AMOUNT` | Exact expected order subtotal in the provider API's integer units |
| `LEMONSQUEEZY_PASS_CURRENCY` | Exact ISO currency from the provider order |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only ledger confirmation; never a NEXT_PUBLIC variable |
| `LEMONSQUEEZY_LIVE_APPROVED` | Must explicitly be `true` for live mode, after all setup/tests and merchant approval |

Retain existing public Supabase configuration. Configure the provider webhook at `https://signalbrief.online/api/billing/webhook` for `order_created` and `order_refunded`, with the matching secret and mode. Disable store-wide automatic discounts and quantity editing for this pass; the app hides the discount field and rejects discounted or multi-quantity orders. Confirm taxes/currency behavior using actual provider test orders. Final price is shown in hosted checkout. Do not enable live sales until the published product/support/refund terms are ready and the following provider tests succeed.

Provider acceptance checks still required: test checkout → signed webhook → test entitlement; real provider refund → revocation; invalid signature → denial; repeated delivery → same expiry; test order → no production export; provider-mode mismatch → denial; timeout/retry and late-event reconciliation. Current tests use synthetic provider responses and a disposable PostgreSQL engine, not actual card purchases.

The ledger prevents duplicate grants and routine duplicate checkout creation. It cannot guarantee that a provider will never charge twice. Unexpected paid orders, delivery outages and payments made while earlier webhooks are delayed require merchant reconciliation/refund in the provider dashboard. A failed webhook returns non-2xx for provider retry; no background reconciliation worker is claimed. Refunds are initiated by an operator in the provider dashboard and processed by signed webhooks, not an unauthenticated browser refund action.

## Deployment and rollback

Apply `supabase/workspace-migrations/20261031103225_hosted_checkout_pass.sql` before deploying the new frontend. It creates only ledger tables/functions and explicitly restricts grants; all existing users, holdings, source records, Auth settings, secrets and RLS remain intact. No payment Edge Function is required; the existing API v16 serves the company/calendar reads and Next.js serves billing routes.

Deploy only the reviewed commit after CI. With no payment env configured, checkout stays 503 and the UI reports preparation status. Test mode grants are isolated; do not manufacture a production payment to test export. For rollback, deploy the prior frontend and leave ledger data in place for audit and refund handling. Disable checkout using `LEMONSQUEEZY_MODE=disabled`; do not drop financial ledger tables after real payments exist.

## Verification boundaries

The release gate is `python scripts/verify.py --full`. New payment unit/route/SQL tests and desktop/mobile completion E2E were added. `tests/workspace/test_billing.py` checks the real PostgreSQL role restrictions through the existing disposable CI replay. `docs/desktop-mobile-baseline.json` records the user-requested additive mobile edits, with previous/new hashes; existing shell, routes and ownership controls remain.

Source documentation used:
- https://docs.lemonsqueezy.com/api/checkouts/create-checkout
- https://docs.lemonsqueezy.com/help/webhooks/signing-requests
- https://docs.lemonsqueezy.com/api/orders/the-order-object
- https://docs.lemonsqueezy.com/api/order-items/the-order-item-object
- https://www.tradingview.com/widget-docs/widgets/symbol-details/fundamental-data
- https://www.tradingview.com/widget-docs/tutorials/iframe/build-page/dynamic-symbols/
- https://supabase.com/docs/guides/api/securing-your-api

Local execution: all eight full-release-gate checks passed; 650 frontend tests and 340 backend tests passed, with 108 environment/PostgreSQL skips. Lint has zero errors and five pre-existing navigation warnings. TypeScript, production build and mobile-isolation checks passed. Provider transport remains synthetic, and new CI browser/PostgreSQL checks must pass before the follow-up release. Keep the configured pass variant, amount and currency stable while corresponding orders/refunds are outstanding; changing product identity needs an explicit ledger migration/reconciliation.
