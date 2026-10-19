-- Deploy signalbrief-calendar and signalbrief-api, run one successful refresh,
-- and inspect calendar_runs before activating this migration. pg_cron uses UTC.
SELECT cron.schedule('signalbrief-official-calendar','17 */6 * * *','select app_private.enqueue_calendar();');
