import {
  adminOverviewRequestSchema, adminOverviewResponseSchema,
  type AdminOverviewResponse,
} from '../src/admin-logs/overview-contracts';
import { userLogsResponseSchema } from '../src/admin-logs/contracts';

// Synthetic responses for isolated browser tests only. These fixtures never reach
// the application database or a production analytics collector.
export function overviewFixture(input: unknown, populated = false, stamp = new Date().toISOString()): AdminOverviewResponse {
  const request = adminOverviewRequestSchema.parse(input);
  const first = new Date(`${request.from}T00:00:00+09:00`).toISOString();
  const last = new Date(Math.min(Date.parse(stamp), Date.parse(`${request.to}T00:00:00+09:00`) + 86_400_000)).toISOString();
  const matured = (day: 1 | 7) => populated && Date.parse(first) + (day + 1) * 86_400_000 <= Date.parse(stamp);
  return adminOverviewResponseSchema.parse({
    ...request,
    timezone: 'Asia/Seoul', retention_days: 90, generated_at: stamp,
    coverage: {
      product_scope: 'consented_signed_in_users', first_available_event_at: populated ? first : null,
      consented_users: populated ? 3 : 0, eligible_users: populated ? 3 : 0,
      retention_basis: 'first_observed_view_in_retained_history', retention_observed_until: stamp,
      signup_status: 'not_instrumented', session_timeout_minutes: 30,
    },
    summary: {
      visitors: populated ? 3 : 0, page_views: populated ? 8 : 0,
      active_users: populated ? 3 : 0, sessions: populated ? 4 : 0,
      active_ms: populated ? 120_000 : 0, average_active_ms: populated ? 30_000 : null,
      signup_conversion: null,
      activation: {
        completed: populated ? 2 : 0, eligible: populated ? 3 : 0,
        rate: populated ? 2 / 3 : null, basis: 'new_profiles_current_onboarding', as_of: stamp,
      },
      core_feature_users: populated ? 2 : 0, core_feature_rate: populated ? 2 / 3 : null,
      ended_sessions: populated ? 3 : 0,
    },
    retention: [
      { day: 1, returned: matured(1) ? 1 : 0, eligible: matured(1) ? 3 : 0, pending: populated && !matured(1) ? 3 : 0, rate: matured(1) ? 1 / 3 : null },
      { day: 7, returned: 0, eligible: matured(7) ? 3 : 0, pending: populated && !matured(7) ? 3 : 0, rate: matured(7) ? 0 : null },
    ],
    days: populated ? [{ day: request.from, visitors: 3, page_views: 8 }] : [],
    features: populated ? [
      { event: 'brief_opened', users: 2, events: 4, usage_rate: 2 / 3 },
      { event: 'evidence_opened', users: 1, events: 2, usage_rate: 1 / 3 },
    ] : [],
    pages: populated ? [
      { screen: 'today', views: 5, users: 3, sessions: 4, active_ms: 90_000, average_active_ms: 22_500, exits: 1, exit_rate: 0.25 },
      { screen: 'event', views: 3, users: 2, sessions: 2, active_ms: 30_000, average_active_ms: 15_000, exits: 2, exit_rate: 1 },
    ] : [],
    api: {
      scope: 'signalbrief_api_completed_requests', includes_admin: true, retention_days: 30,
      coverage_from: first, coverage_to: last,
      requests: populated ? 20 : 0, errors: populated ? 1 : 0,
      error_rate: populated ? 0.05 : null, mean_latency_ms: populated ? 250 : null,
      last_seen: populated ? stamp : null,
      recent_error_hours: populated ? [{ hour: first, requests: 10, errors: 1, error_rate: 0.1 }] : [],
    },
  });
}

export function emptyActivityFixture(stamp = new Date().toISOString()) {
  return userLogsResponseSchema.parse({
    items: [], next_cursor: null, has_more: false,
    summary: { events: 0, users: 0, sessions: 0, active_ms: 0 },
    retention_days: 90, timezone: 'Asia/Seoul', consented_users: 0,
    generated_at: stamp,
  });
}
