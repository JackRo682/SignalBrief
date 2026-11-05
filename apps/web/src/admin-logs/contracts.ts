import { z } from 'zod';

export const userLogEvents = [
  'view', 'click', 'heartbeat', 'conversion', 'sign_up', 'login',
  'onboarding_started', 'watchlist_added', 'onboarding_completed',
  'brief_impression', 'brief_opened', 'evidence_opened', 'followup_asked',
  'alert_created', 'feedback_submitted',
] as const;

export const userLogScreens = [
  'today', 'explore', 'search', 'watchlist', 'portfolio', 'timeline',
  'questions', 'calendar', 'alerts', 'saved', 'settings', 'onboarding',
  'company', 'event', 'document', 'help',
] as const;

const timestamp = z.string().datetime({ offset: true });
const recordId = z.string().min(1).max(200).regex(/^(usage|product):[A-Za-z0-9_-]+$/);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const userLogCursorSchema = z.object({
  created_at: timestamp,
  id: recordId,
}).strict();

export const userLogsRequestSchema = z.object({
  from: z.string().date(),
  to: z.string().date(),
  user_id: z.union([z.literal(''), z.string().uuid()]),
  event: z.union([z.literal(''), z.enum(userLogEvents)]),
  screen: z.union([z.literal(''), z.enum(userLogScreens)]),
  device: z.enum(['', 'desktop', 'mobile']),
  include_admin: z.boolean(),
  cursor: userLogCursorSchema.nullable(),
}).strict().superRefine((value, context) => {
  const days = (Date.parse(`${value.to}T00:00:00Z`) - Date.parse(`${value.from}T00:00:00Z`)) / 86_400_000;
  if (days < 0 || days >= 90) {
    context.addIssue({ code: 'custom', path: ['from'], message: '조회 기간은 시작일부터 종료일까지 최대 90일로 설정해 주세요.' });
  }
});

export const userLogSchema = z.object({
  id: recordId,
  created_at: timestamp,
  user_id: z.string().uuid(),
  event: z.enum(userLogEvents),
  screen: z.enum(userLogScreens).nullable(),
  device: z.enum(['desktop', 'mobile', 'unknown']).nullable(),
  session_id: z.string().uuid().nullable(),
  page_id: z.string().uuid().nullable(),
  active_ms: count.nullable(),
  source: z.enum(['usage', 'product']),
  is_admin: z.boolean(),
}).strict();

export const userLogsResponseSchema = z.object({
  items: z.array(userLogSchema).max(50),
  next_cursor: userLogCursorSchema.nullable(),
  has_more: z.boolean(),
  summary: z.object({ events: count, users: count, sessions: count, active_ms: count }).strict(),
  retention_days: z.literal(90),
  timezone: z.literal('Asia/Seoul'),
  consented_users: count,
  generated_at: timestamp,
}).strict().superRefine((value, context) => {
  if (value.has_more !== (value.next_cursor !== null)) {
    context.addIssue({ code: 'custom', path: ['next_cursor'], message: 'Invalid pagination response' });
  }
});

export type UserLogCursor = z.infer<typeof userLogCursorSchema>;
export type UserLogsRequest = z.infer<typeof userLogsRequestSchema>;
export type UserLogsFilters = Omit<UserLogsRequest, 'cursor'>;
export type UserLog = z.infer<typeof userLogSchema>;
export type UserLogsResponse = z.infer<typeof userLogsResponseSchema>;

export function koreanDate(now = new Date()): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1_000).toISOString().slice(0, 10);
}

export function recentLogDates(days: 7 | 30 = 7, now = new Date()): { from: string; to: string } {
  const to = koreanDate(now);
  const from = new Date(Date.parse(`${to}T00:00:00Z`) - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  return { from, to };
}

export function defaultLogFilters(now = new Date()): UserLogsFilters {
  return { ...recentLogDates(7, now), user_id: '', event: '', screen: '', device: '', include_admin: false };
}
