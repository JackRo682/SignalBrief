# Backend performance maintenance — 2026-11-10

## Deployed scope

The two migrations were applied to the existing SignalBrief Supabase project on 2026-11-10 at 06:29 UTC. No frontend design, authentication policy, billing plan, worker count, or provider budget was changed.

- Workspace reads reuse the authoritative customer-resource projection within a single SQL request. Catalog calls drop from two evaluations to one; Saved from five to one; source-overview reuses the same projection for its saved/unread counts. Notifications also avoid repeated projection evaluation. This is NOT a shared cache: ownership, visibility, MFA, quotas and read-after-write behavior remain in force.
- Collector enqueue uses an active-lease partial index and a nonblocking advisory lock. The existing live-lease/replay gate remains. The same four scheduled runs per hour now begin at minutes 7/22/37/52 rather than 0/15/30/45, avoiding identical start times with the five-minute notification job. Other jobs and ingestion enablement are unchanged.

## Production database measurements

Three sequential executions per operation before and after the change, under the authenticated role for the existing account. The transaction was rolled back, including quota writes. These are DB-side observations, not browser timings or a load test.

| Operation | Before, ms | After, ms | Median reduction |
|---|---|---|---|
| Company catalog | 276.155 / 59.926 / 59.513 | 218.318 / 33.708 / 33.282 | 43.8% |
| Saved analyses | 113.433 / 114.335 / 103.988 | 33.101 / 28.635 / 28.448 | 74.8% |
| Following overview | 484.994 / 367.918 / 362.794 | 433.480 / 298.840 / 299.245 | 18.7% |

Every operation returned the same JSON MD5 before and after. Small samples and cold/warm planning effects prohibit treating these figures as an end-to-end P95 improvement or concurrency guarantee.

## Verification

- Disposable PostgreSQL 17.11: 459 workspace tests passed, including nine new request-reuse/collector regressions.
- Compared eleven read variants for each of two synthetic accounts, including filters, ordering, pagination and private content visibility.
- Verified immediate notification updates, cross-account separation and direct private-helper denial.
- Verified disabled ingestion, lease expiry, duplicate enqueue prevention, nonblocking lock contention and unchanged notification schedule.
- Live function ACLs, SECURITY DEFINER settings and fixed search paths match their pre-change state.
- Applied migration ledger and repository SQL SHA-256 match exactly:
  - `20261110062943_workspace_read_reuse.sql`: `e1867c40961dbfd7d9159b1951fa9fdd7b9ed8bf2a085184a32b9502697b27c0`
  - `20261110062950_collector_workload_smoothing.sql`: `ce19c03ae4160b20cb0a4d11c5b4893d8ad0a71245ac7d9449790f5621364e1a`

Full repository/CI checks are independent gates; consult their actual run results rather than inferring success from the focused tests above.

## Boundaries

The database remains shared by interactive and scheduled work. Staggering start times reduces avoidable collisions but is not hard resource isolation. Storage duplicate-object upload handling and Edge Function code are unchanged in this release. No production stress test or forced provider/AI collection was run. Existing homepage caching is retained.
