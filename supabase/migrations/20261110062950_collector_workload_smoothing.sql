-- Keep the existing 15-minute ingestion cadence and all spending/lease gates.
-- Scan only active leases and skip contention instead of occupying a DB connection.
SET LOCAL lock_timeout='2s';
CREATE INDEX IF NOT EXISTS collector_runs_active_expiry
 ON app_private.collector_runs(expires_at) WHERE state IN ('pending','running');
DO $migration$
DECLARE definition text:=pg_get_functiondef('app_private.enqueue_collector()'::regprocedure);
 old_lock constant text:='PERFORM pg_catalog.pg_advisory_xact_lock(20261014,1);';
 job bigint;
BEGIN
 IF strpos(definition,old_lock)=0 THEN RAISE EXCEPTION 'collector_enqueue_source_changed'; END IF;
 EXECUTE replace(definition,old_lock,
  'IF NOT pg_catalog.pg_try_advisory_xact_lock(20261014,1) THEN RETURN NULL; END IF;');
 SELECT jobid INTO STRICT job FROM cron.job WHERE jobname='signalbrief-official-filings';
 PERFORM cron.alter_job(job,schedule:='7,22,37,52 * * * *');
END $migration$;
-- No worker count, provider budget, authentication, or ingestion-enabled change.
