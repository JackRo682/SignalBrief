# Provider connection preparation — 2026-10-14

Credential presence does not establish that a key is valid or that its plan
covers an endpoint. The Edge runtime supports both environment variables and
Vault, so absence from one store alone does not prove the deployed application
has no key. Use the public readiness response locally to determine next actions;
do not publish operational configuration snapshots in issues or pull requests.

## Changes

The existing admin-only `POST /api/us/verify` accepts an optional `providers`
array. `{"providers":["fmp"]}` calls only FMP, and never OpenAI, SEC, Resend,
GNews or FX. Invalid and empty plans return 422 before provider calls. Omitting
the field preserves the previous all-provider behavior. Missing FMP keys no
longer consume a reservation. Session verification, admin authorization,
request quotas and the display-license gate remain required.

`GET /api/us/health` exposes `selective_verification: true` when this version is
deployed. The CLI refuses to run a targeted test on the old deployed version.

Run with Node 24 or later, from the repository root:

```sh
node scripts/provider-readiness.mjs
node --test scripts/provider-readiness.test.mjs
```

The first command reads only public status. Exit 2 means setup or verification
is outstanding; exit 1 means an error. It does not read or print provider keys,
request quotes, send emails, perform ingestion, or spend an AI budget.

After deploying both the web proxy and the Edge Function, an operator with an
existing admin session can set `SB_ADMIN_ACCESS_TOKEN` in the process environment
and explicitly run:

```sh
node scripts/provider-readiness.mjs --verify-fmp
```

This performs one AAPL quote check using the server-held FMP key and existing
daily request limit. It returns readiness metadata rather than a price. No
provider API key or admin session token belongs in Git, a CLI argument, a public
environment variable, a support message or a saved log. Clear the session env
variable after use. A check older than 24 hours is not considered current.

## Remaining provider decisions

FMP website display requires a Data Display and Licensing Agreement:
https://site.financialmodelingprep.com/pricing-plans?planType=commercial
https://site.financialmodelingprep.com/enterprise-contact

Ask the provider to cover US equity quotes, daily historical charts and the
specific Nasdaq/S&P index feeds, displayed timestamps/delay, cache retention,
public versus signed-in access, portfolio valuation and resulting derived
information. Confirm the endpoint entitlements and fees. This change does not
add index feeds or claim real-time access.

KIS partnership guidance states that exchange information-use agreements are
needed for partner applications:
https://apiportal.koreainvestment.com/provider

No display flag, signed agreement reference, expiry date, budget or recurring
ingestion has been enabled by this preparation. Actual quotes, market UI,
interactive login, KIS, OpenDART and automated workers remain unverified.

## Validation boundary

Eleven Node regression tests passed. All 422 frontend tests passed, including 48 provider/OAuth/proxy tests.
Type checking, production web build and lint passed (five existing navigation warnings).
The full repository verification command was attempted; the local Python 3.10
does not meet the project's Python >=3.12 requirement and lacks pytest and
backend dependencies. These backend checks are not passed. Browser E2E and a
disposable PostgreSQL release test have not been run. This is preparation for
review, not a production release or a completed live market-data connection.
