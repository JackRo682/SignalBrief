# Homepage market indices repair

The desktop and mobile Today screens now request `/api/us/indices` with the signed-in user's bearer token instead of hard-coding index placeholders. Both show KOSPI, KOSDAQ, NASDAQ and S&P 500; the desktop daily USD/KRW reference remains separate.

The shared client contract validates finite positive index values, nullable percentage changes, timezone-qualified timestamps, and the expected KIS/FMP metadata. Invalid, duplicate, conflicting, missing, future-dated (>5 minutes) and stale (>7 days) records never become displayed prices. A rejected record does not hide another valid index. The seven-day freshness bound permits weekends and market holidays; displayed values always retain their actual timestamp.

Valid cards show the value, daily percentage change when available, provider and timestamp in the user's selected timezone. KIS timestamps are labelled retrieval times for REST snapshots, not exchange quote times. FMP timestamps are labelled quote times. The cards link to the existing provider information screen.

Unavailable cards distinguish display authorization, credentials, provider access, response validation, missing coverage, stale data and HTTP/network failures. Requests time out after 55 seconds, offer manual refresh, and are cancelled on unmount or session change. Old-session results cannot replace current-session data.

## Data flow and authorization

`Today → shared indices hook → authenticated Next US proxy → signalbrief-us/indices → existing permission checks / provider cache → validated cards`.

No provider display flags, credentials, grants, database records or server endpoints are changed. Real values require the existing KIS/FMP credentials and applicable display authorization. Otherwise the UI reports the reason returned by the existing API. Synthetic test prices are confined to test fixtures.

Read-only production status on 2026-10-19 (`/api/us/status`) reported `kis_display=false`, `fmp_display=false`, and `indices_enabled=false`. `/api/release` reported main commit `395451dcb9a98efc779264b115bc9a46f40751c3`. This fix therefore enables the data path and explicit authorization-pending UI; it does not by itself enable live numerical quotes.

## Regression coverage

- Client contract and display tests cover valid and partial results, invalid values/timestamps/metadata, stale/duplicate/conflicting records, missing coverage, HTTP errors, malformed JSON, network failures, timeout/retry, authentication and session transitions.
- Proxy tests verify authenticated GET forwarding to the fixed Edge endpoint and private/no-store behavior.
- Desktop dashboard regression verifies authorization-pending cards alongside the existing portfolio and notification data.
- Chromium desktop/mobile browser regression verifies API failure → refresh → partial authorized coverage, source/timestamp labels, no runtime errors and no horizontal overflow. Added to CI's explicit E2E command.
- The mobile source baseline is updated only for the intentionally changed Today screen and its indices fixture; other frozen dependencies and route expressions remain checked.

These are synthetic isolated browser/provider tests. They do not certify live provider authorization or production deployment.
