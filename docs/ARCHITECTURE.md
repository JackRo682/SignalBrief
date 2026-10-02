# Architecture

```text
Browser / Next.js  -- Google PKCE --> Supabase Auth
       | verified bearer JWT
       v
FastAPI -- explicit owner checks --> PostgreSQL tables + RLS for Supabase client roles
       |                                  |
       | admin ingest / scheduler         | jobs / transactional outbox
       v                                  v
  OpenDART / SEC <-- shared provider quota -- Worker (leases + heartbeat + fencing)
       |                                     |
       v                                     v
Content-addressed raw storage --> Parser --> strict extraction --> citation checks
       |                        normalized chunks        |
 private Supabase bucket                               Decimal change comparison
       |                                               |
immutable source URL / hash / timestamps <------- evidence-linked brief --> review --> publish
                                                                               |
                                                            ranking / alerts / timeline / follow-up
```

The same Python package owns API and worker logic. CLI enqueues or performs explicit operator actions.
Provider adapters return normalized immutable descriptors with no embedded credentials. Metadata insert and parse enqueue
commit together; raw bytes are stored by SHA-256 before the transaction. Failed transactions may leave an orphan content blob,
not a lost original source. An existing provider/document identity with different bytes triggers a conflict audit and stores
the candidate separately instead of overwriting the original. Normal re-ingestion avoids downloading unchanged metadata unless refresh is requested.

Jobs have kind/payload/idempotency identity/status/attempt/available time/lease token. PostgreSQL row locking and `SKIP LOCKED`
allow concurrent workers. Expired lease tokens cannot complete another worker's claim. Failed retryable requests respect
backoff and Retry-After; permanent failures enter the dead-letter queue. Scheduler selects watched/held companies and looks back
seven days by default; historical backfill is an explicit operator action. No promise of all issuers/all filings continuous coverage.

API writes use a trusted backend DB connection and explicit owner predicates. RLS additionally limits direct Supabase client
reads; it does not automatically protect an over-privileged application query. Public data and Ops remain behind API policy.
JWT keys are retrieved from the configured Supabase issuer JWKS, not user-supplied URLs. Only asymmetric auth tokens are accepted.

Live analyses default to review. A stable pipeline revision is idempotent; a deliberate rerun uses a new revision and preserves
history. Rejection propagates to briefs depending on rejected historical evidence. Former approved revisions retain source data.
No arbitrary user document URL or HTML is rendered into a browser; raw content is admin attachment-only.

Optional pgvector indexing is implemented separately with a 1536-dimensional validated vector and model-specific index identity.
The default follow-up uses bounded event evidence and does not require embeddings. Enabling vectors is an operator decision.

Deployment boundaries: Vercel web; Render API, worker and cron; Supabase PostgreSQL/Auth/private Storage. All server processes
must share a DB and storage configuration. A single initial API process/worker is a conservative beta start, not a tested scale limit.
