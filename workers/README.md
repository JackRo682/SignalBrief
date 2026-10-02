# Worker entry point

The implemented worker lives in `apps/api/signalbrief/worker.py` to share the same typed application package,
models, provider clients and transactional outbox. Run `python -m signalbrief.cli worker`.
This directory is documentation, not a second partially implemented worker.

API and worker must use the SAME database and raw storage. The scheduler only enqueues work.
PostgreSQL `SKIP LOCKED`, lease fencing and heartbeat renewal prevent a stale worker from acknowledging a new lease.
Retry-After, exponential backoff, permanent failure, maximum attempts and admin retry are explicit.
Do not horizontally scale SEC workers onto separate rate-limit databases.
