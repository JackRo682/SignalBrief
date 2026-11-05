import { z } from 'zod';
import { recentLogDates, userLogScreens } from './contracts';

const timestamp = z.string().datetime({ offset: true });
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const measurement = z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER);
const ratio = z.number().finite().min(0).max(1).nullable();

export const overviewFeatureEvents = [
  'watchlist_added', 'brief_opened', 'evidence_opened',
  'followup_asked', 'alert_created', 'feedback_submitted',
] as const;

export const adminOverviewRequestSchema = z.object({
  from: z.string().date(),
  to: z.string().date(),
  include_admin: z.boolean(),
}).strict().superRefine((value, context) => {
  const days = (Date.parse(`${value.to}T00:00:00Z`) - Date.parse(`${value.from}T00:00:00Z`)) / 86_400_000;
  if (days < 0 || days >= 90) {
    context.addIssue({ code: 'custom', path: ['from'], message: '조회 기간은 시작일부터 종료일까지 최대 90일로 설정해 주세요.' });
  }
});

const activation = z.object({
  completed: count,
  eligible: count,
  rate: ratio,
  basis: z.literal('new_profiles_current_onboarding'),
  as_of: timestamp,
}).strict();

const retention = z.object({
  day: z.union([z.literal(1), z.literal(7)]),
  returned: count,
  eligible: count,
  pending: count,
  rate: ratio,
}).strict();

export const adminOverviewResponseSchema = z.object({
  from: z.string().date(),
  to: z.string().date(),
  include_admin: z.boolean(),
  timezone: z.literal('Asia/Seoul'),
  retention_days: z.literal(90),
  generated_at: timestamp,
  coverage: z.object({
    product_scope: z.literal('consented_signed_in_users'),
    first_available_event_at: timestamp.nullable(),
    consented_users: count,
    eligible_users: count,
    retention_basis: z.literal('first_observed_view_in_retained_history'),
    retention_observed_until: timestamp,
    signup_status: z.literal('not_instrumented'),
    session_timeout_minutes: z.literal(30),
  }).strict(),
  summary: z.object({
    visitors: count,
    page_views: count,
    active_users: count,
    sessions: count,
    active_ms: count,
    average_active_ms: measurement.nullable(),
    signup_conversion: z.null(),
    activation,
    core_feature_users: count,
    core_feature_rate: ratio,
    ended_sessions: count,
  }).strict(),
  retention: z.array(retention).length(2),
  days: z.array(z.object({ day: z.string().date(), visitors: count, page_views: count }).strict()).max(90),
  features: z.array(z.object({
    event: z.enum(overviewFeatureEvents), users: count, events: count, usage_rate: ratio,
  }).strict()).max(overviewFeatureEvents.length),
  pages: z.array(z.object({
    screen: z.enum(userLogScreens),
    views: count, users: count, sessions: count,
    active_ms: count, average_active_ms: measurement.nullable(),
    exits: count, exit_rate: ratio,
  }).strict()).max(userLogScreens.length),
  api: z.object({
    scope: z.literal('signalbrief_api_completed_requests'),
    includes_admin: z.literal(true),
    retention_days: z.literal(30),
    coverage_from: timestamp.nullable(),
    coverage_to: timestamp.nullable(),
    requests: count,
    errors: count,
    error_rate: ratio,
    mean_latency_ms: measurement.nullable(),
    last_seen: timestamp.nullable(),
    recent_error_hours: z.array(z.object({
      hour: timestamp, requests: count, errors: count, error_rate: ratio,
    }).strict()).max(20),
  }).strict(),
}).strict().superRefine((value, context) => {
  const checkRatio = (numerator: number, denominator: number, result: number | null, path: (string | number)[]) => {
    if (numerator > denominator || (denominator === 0 ? result !== null :
      result === null || Math.abs(result - numerator / denominator) > 0.000001)) {
      context.addIssue({ code: 'custom', path, message: 'Invalid metric denominator or rate' });
    }
  };
  const { summary, api } = value;
  checkRatio(summary.activation.completed, summary.activation.eligible, summary.activation.rate, ['summary', 'activation']);
  checkRatio(summary.core_feature_users, summary.active_users, summary.core_feature_rate, ['summary', 'core_feature_rate']);
  checkRatio(api.errors, api.requests, api.error_rate, ['api', 'error_rate']);
  value.retention.forEach((row, index) => checkRatio(row.returned, row.eligible, row.rate, ['retention', index]));
  value.features.forEach((row, index) => checkRatio(row.users, summary.active_users, row.usage_rate, ['features', index]));
  value.pages.forEach((row, index) => checkRatio(row.exits, row.sessions, row.exit_rate, ['pages', index]));
  api.recent_error_hours.forEach((row, index) => checkRatio(row.errors, row.requests, row.error_rate, ['api', 'recent_error_hours', index]));
  if (new Set(value.retention.map(row => row.day)).size !== 2 ||
      new Set(value.features.map(row => row.event)).size !== value.features.length ||
      new Set(value.pages.map(row => row.screen)).size !== value.pages.length ||
      new Set(value.days.map(row => row.day)).size !== value.days.length) {
    context.addIssue({ code: 'custom', path: [], message: 'Duplicate overview rows' });
  }
  if (summary.visitors > summary.active_users || summary.ended_sessions > summary.sessions ||
      value.coverage.eligible_users > value.coverage.consented_users ||
      summary.activation.as_of !== value.generated_at ||
      (api.coverage_from === null) !== (api.coverage_to === null) ||
      (api.coverage_from !== null && api.coverage_to !== null && Date.parse(api.coverage_from) >= Date.parse(api.coverage_to))) {
    context.addIssue({ code: 'custom', path: [], message: 'Invalid overview coverage' });
  }
});

export type AdminOverviewRequest = z.infer<typeof adminOverviewRequestSchema>;
export type AdminOverviewResponse = z.infer<typeof adminOverviewResponseSchema>;

export function defaultOverviewFilters(now = new Date()): AdminOverviewRequest {
  return { ...recentLogDates(7, now), include_admin: false };
}
