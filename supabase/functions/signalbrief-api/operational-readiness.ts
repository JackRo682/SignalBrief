type Row = Record<string, unknown>;
const text = (value: unknown): string | null => typeof value === "string" && value ? value : null;

export function operationalSnapshot(database: boolean | null, counts: Record<string, number | null>, succeeded: Row[] | null, waiting: Row | null, checkedAt: string) {
  const oldest = text(waiting?.created_at);
  const age = oldest ? (Date.parse(checkedAt) - Date.parse(oldest)) / 1000 : NaN;
  return {
    database,
    web_api: true,
    // Completed jobs do not establish a running worker, recurring schedule,
    // private-object access, provider credentials, or successful email delivery.
    private_storage: null,
    worker: null,
    dart: null,
    sec: null,
    openai: null,
    email: null,
    checked_at: checkedAt,
    worker_heartbeat_at: null,
    job_counts: counts,
    last_successful_run_at: succeeded?.length ? text(succeeded[0].finished_at) : null,
    recent_successful_runs: succeeded?.map(job => ({ kind: text(job.kind), finished_at: text(job.finished_at) })) ?? null,
    oldest_waiting_job_at: oldest,
    oldest_waiting_job_age_seconds: Number.isFinite(age) ? Math.max(0, Math.floor(age)) : null,
    note: "Job counts and timestamps are measured from the database. Worker heartbeat and recurring execution are not instrumented here; provider and delivery readiness remain unverified.",
  };
}
