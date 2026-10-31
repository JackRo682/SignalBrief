import { describe, expect, it } from 'vitest';
import { operationalSnapshot } from '../../../supabase/functions/signalbrief-api/operational-readiness';

describe('measured operational readiness', () => {
  it('shows successful processing without claiming current worker or provider health', () => {
    const value = operationalSnapshot(true, { queued: 0, succeeded: 2 }, [{ kind: 'parse', finished_at: '2026-10-30T10:00:00Z' }], null, '2026-10-31T12:00:00Z');
    expect(value).toMatchObject({ database: true, worker: null, private_storage: null, sec: null, email: null, job_counts: { queued: 0, succeeded: 2 }, last_successful_run_at: '2026-10-30T10:00:00Z', oldest_waiting_job_age_seconds: null });
  });
  it('preserves unavailable measurements instead of turning query failures into zero', () => {
    expect(operationalSnapshot(null, { queued: null }, null, null, '2026-10-31T12:00:00Z')).toMatchObject({ database: null, job_counts: { queued: null }, recent_successful_runs: null });
  });
  it('measures waiting age from the original queue timestamp', () => {
    const value = operationalSnapshot(true, { queued: 1 }, [], { created_at: '2026-10-31T11:00:00Z' }, '2026-10-31T12:00:00Z');
    expect(value.oldest_waiting_job_age_seconds).toBe(3600);
    expect(value.last_successful_run_at).toBeNull();
  });
});
