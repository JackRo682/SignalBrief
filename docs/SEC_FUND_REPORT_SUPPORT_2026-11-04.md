# SEC fund report support and KIO request procedure

This change admits only the exact EDGAR shareholder-report submission types
`N-CSR`, `N-CSRS`, `N-CSR/A`, and `N-CSRS/A` through the existing SEC pipeline.
The SEC distinguishes annual and semiannual submissions even though the
semiannual document's cover can say Form N-CSR. The original metadata form is
preserved. Reference: [SEC filing FAQ](https://www.sec.gov/info/edgar/certinvco.htm).
NPORT-P, notification forms, arbitrary lookalikes, and unsafe document paths
remain outside this addition.

## Behavior and boundaries

The registered non-demo issuer, CIK, ticker, official endpoint, source archive,
and document identifier checks remain in place. Ingestion still archives the
authoritative submissions response. Analysis still downloads and archives its
primary filing HTML at `us/sec/filings/<sha256>.html`, records the source URL and
exact normalized excerpt offsets, reserves the existing AI budget, validates
citations/numbers, and inserts only `needs_review`. No manually written analysis
or source snapshot is imported, and no approval or spending limit changes.

Unconsolidated fund statement headings are enabled only when the authoritative
filing form is one of the four fund forms. The default corporate-document
excerpt rules are unchanged. Both paths retain the declared 12,000-character
window and require semantic review.

Existing pending company-analysis requests receive collection priority while
their request is newer than the last successful SEC metadata ingestion and the
request is less than 15 minutes old. After that window, the unchanged watched /
held / oldest ordering resumes. A failing request therefore cannot permanently
monopolize the single SEC collection slot. The request stays durable, and its
analysis still waits for a successful refresh. A supported fund report receives
the same financial-report priority as 10-K/Q, ahead of a newer 8-K. The existing
550-day selection window, one analysis per collector execution, three-attempt
transient retry limit, and semantic-failure rejection remain unchanged. DART
ordering receives no new request priority.

Before claiming an analysis, the existing picker reads the current day's OpenAI
usage and configured budget. At 20 calls, a missing/disabled budget, or an
already exhausted dollar budget, it returns no filing and creates no attempt or
lease. Metadata refresh can still succeed and the request stays pending for
ordinary cron to resume on the next quota day. This preflight never changes
usage or limits. The later model reservation remains the final atomic check for
concurrent calls and the exact selected excerpt's cost.

## Deployment order

1. Complete exact-source CI, including the native PostgreSQL workspace replay.
2. Deploy the changed shared code through `signalbrief-collector`,
   `signalbrief-us`, and `signalbrief-discovery`. The collector imports the
   normal ingest/analyze handlers; discovery also uses `secSubmissions`.
   No new HTTP endpoint, Vault secret, or billable resource is required.
3. Apply `20261104124412_sec_fund_report_analysis.sql`. It only replaces existing
   queue-selection functions and reasserts their service-only permissions.
4. Once existing collector runs have finished or expired, execute the guarded
   [one-time KIO request](sql/request-kio-fund-analysis.sql) through the existing
   privileged database operator channel. Do not run it from a public client.

A read-only live permission check on November 4 confirmed that the connected SQL
operator uses the `postgres` database/session role, has no `auth.uid()`, and
already has the request-function and private-request-table permissions. The
request function is a service operation and requires no fabricated JWT, user ID,
or admin claim. The private request table has no actor/requester field. The
procedure does not set session claims, switch roles, or attribute a system
request to a human.

The request transaction takes the existing dispatch and analysis-picker locks,
checks the exact registered KIO identity and unchanged **$1 daily AI cap**, and
requires no existing KIO analysis, active KIO lease, or recently selected KIO
attempt. It also refuses to race a previously launched collector, which could
retain the old parser. An in-progress error means wait and inspect; it does not
authorize canceling another job or deleting attempts.

A read-only check on November 4 found 20 OpenAI calls already used, with about
$0.135 reserved. The call allowance was therefore exhausted even though the
$1 cap was not. After deploying the preflight, the guarded request can refresh
real metadata now and remain pending until ordinary cron finds the next day's
allowance. No user needs to re-request it tomorrow. Never reset usage counters,
raise limits, or label a local draft as an executed model result to get around
the gate.

The existing `sb_company_financial_admin('request', ...)` operation creates a
durable request but uses `ON CONFLICT DO NOTHING` for an existing analysis
request. The script therefore records a real new request time for this one
previously omitted issuer. It never changes an ingestion timestamp to pretend a
refresh happened. The existing one-use collector task supplies all runtime
credentials internally, and `pg_net` dispatch begins after transaction commit.

## Verification after requesting

Inspect the collector's recorded summary, the KIO filing metadata, and its
analysis status. The expected semiannual source is EDGAR accession
`0001628280-26-045418`, filed **2026-06-25**, report period **2026-04-30**, actual
form **N-CSRS**, with [this primary SEC document](https://www.sec.gov/Archives/edgar/data/1515940/000162828026045418/ck0001515940-20260430.htm).
Newer authoritative reports, if present on refresh, take normal precedence.
This report must never be relabeled as an 8-K or a newly filed November report.

Verify that the original object exists at the analysis's computed source hash
and that the normalized excerpt includes its period and units. Keep the new
analysis in `needs_review`. The actual KIO window includes a preceding
money-market investment footnote: its seven-day yield is not the fund's own
distribution yield. Review period, units, scope, and numeric meaning before any
separate human approval.

## Tests

Synthetic SEC-format regressions cover the four accepted forms, unsupported
lookalikes, unsafe paths, wrong CIK, future dates, exact fund excerpts, unchanged
non-fund selection, numeric rejection, and mandatory human review. Embedded
PostgreSQL executes the exact migration locally; native PostgreSQL workspace
tests independently cover request-refresh ordering, older fund report versus
newer 8-K, expiring collection priority, DART isolation, service-only execution,
unchanged budget/review function definitions, and bounded retries.
Quota regressions confirm an exhausted-day request remains unchanged without an
attempt or lease, then becomes eligible with the prior day's usage preserved.

Local results and any unavailable release gates must be reported separately
from CI and production acceptance. This document does not claim deployment.
