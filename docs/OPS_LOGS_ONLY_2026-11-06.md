# Operations: one menu, existing logs first

## Authorized change

The November 6 screenshot still contained six administrator destinations and a second row of ten jump links. The user requested only **운영 현황**, showing the logging functions already implemented in the site.

## Scope

- Keep one administrator navigation entry pointing to `/ops`. Remove the experiment, evaluation, quality, reliability and report entries from the menu, without deleting their underlying implementations or records.
- Remove the page jump-link menu on canonical `/ops` instead of restyling it as another set of tabs. Retain compatibility for the standalone legacy component; old user-log and analytics routes already redirect to canonical `/ops`.
- Put the existing activity log and its real data, date range, filters, pagination and expandable row details before the aggregate panels. Continue the existing statistics, error, collection, processing, review, source, user and audit sections below on the same page.
- Preserve every data client and API. No new database, tracking provider, experiment, sample data, role grant or consent change. Empty data remains an explicit empty state; a request error is not converted into a zero.
- Preserve old direct detail routes and the existing `/ops/user-logs` and `/ops/analytics` redirects for compatibility. This task does not deploy the broader pending PR #56.

## Verification scope

The unit regressions assert exactly one administrator menu entry, no jump navigation and the activity log before the metrics. Existing desktop/mobile browser coverage continues to exercise the real client code against explicitly synthetic test-only fixtures. Existing test suites are retained without removing assertions; the audit shortcut remains an inline same-page reference, not a menu. The protected-source manifest changes only the two authorized source checksums; the verifier is unchanged. Test results are reported separately and are not asserted by this document.
