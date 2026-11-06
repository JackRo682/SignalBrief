import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import UserActivityLogs, { formatActiveTime, formatLogTime } from '../src/admin-logs/page';
import { fetchUserLogs, useUserLogs } from '../src/admin-logs/client';
import { defaultLogFilters, koreanDate, recentLogDates, userLogsRequestSchema, userLogsResponseSchema, type UserLog, type UserLogsResponse } from '../src/admin-logs/contracts';

// All activity rows and auth identities below are synthetic. Production is never queried by this suite.
const mock = vi.hoisted(() => ({
  token: 'synthetic-admin-token-a' as string | null,
  id: '10000000-0000-4000-8000-000000000001',
  admin: true,
  loading: false,
  authError: null as string | null,
  fetch: vi.fn(), logout: vi.fn(), replace: vi.fn(),
}));
vi.mock('@/components/auth', () => ({ useAuth: () => ({
  token: mock.token,
  me: mock.token ? { id: mock.id, is_admin: mock.admin, display_name: 'Synthetic administrator' } : null,
  loading: mock.loading, error: mock.authError, logout: mock.logout,
}) }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(window.location.search), useRouter: () => ({ replace: mock.replace }) }));
// Overview behavior has independent coverage; these tests isolate the existing log lifecycle.
vi.mock('../src/admin-logs/overview-client', () => ({ useAdminOverview: () => ({ data: null, error: null, loading: false, reload: () => undefined }) }));

const userId = '20000000-0000-4000-8000-000000000001';
const otherUser = '20000000-0000-4000-8000-000000000002';
const usage: UserLog = {
  id: 'usage:30000000-0000-4000-8000-000000000001',
  created_at: '2026-11-04T15:02:03.123456+00:00',
  user_id: userId, event: 'heartbeat', screen: 'calendar', device: 'desktop',
  session_id: '40000000-0000-4000-8000-000000000001',
  page_id: '50000000-0000-4000-8000-000000000001',
  active_ms: 15_000, source: 'usage', is_admin: false,
};
const product: UserLog = {
  ...usage, id: 'product:30000000-0000-4000-8000-000000000002',
  event: 'watchlist_added', created_at: '2026-11-04T14:00:00Z',
  screen: null, device: null, session_id: null, page_id: null, active_ms: null, source: 'product',
};
const makeResponse = (patch: Partial<UserLogsResponse> = {}): UserLogsResponse => ({
  items: [usage, product], next_cursor: null, has_more: false,
  summary: { events: 2, users: 1, sessions: 1, active_ms: 15_000 },
  retention_days: 90, timezone: 'Asia/Seoul', consented_users: 1,
  generated_at: '2026-11-05T01:00:00Z', ...patch,
});
const query = () => ({ ...defaultLogFilters(new Date('2026-11-05T01:00:00Z')), cursor: null });
const payloadAt = (index: number) => JSON.parse(mock.fetch.mock.calls[index][1].body as string);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-05T01:00:00Z'));
  vi.clearAllMocks();
  mock.fetch.mockReset();
  mock.token = 'synthetic-admin-token-a';
  mock.id = '10000000-0000-4000-8000-000000000001';
  mock.admin = true; mock.loading = false; mock.authError = null;
  mock.fetch.mockImplementation(async () => Response.json(makeResponse()));
  mock.logout.mockResolvedValue(undefined);
  vi.stubGlobal('fetch', mock.fetch);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('user-log contracts and Korean dates', () => {
  it('uses the Korean calendar day rather than the UTC date for seven inclusive days', () => {
    const date = new Date('2026-11-04T15:00:01Z');
    expect(koreanDate(date)).toBe('2026-11-05');
    expect(recentLogDates(7, date)).toEqual({ from: '2026-10-30', to: '2026-11-05' });
    expect(defaultLogFilters(date).include_admin).toBe(false);
  });
  it('rejects inverted or over-90-day dates, unexpected fields and non-UUID user identities', () => {
    expect(userLogsRequestSchema.safeParse({ ...query(), from: '2026-11-06' }).success).toBe(false);
    expect(userLogsRequestSchema.safeParse({ ...query(), from: '2026-08-07' }).success).toBe(false);
    expect(userLogsRequestSchema.safeParse({ ...query(), from: '2026-08-08' }).success).toBe(true);
    expect(userLogsRequestSchema.safeParse({ ...query(), user_id: 'person@example.com' }).success).toBe(false);
    expect(userLogsRequestSchema.safeParse({ ...query(), email: 'private@example.com' }).success).toBe(false);
    expect(userLogsRequestSchema.safeParse({ ...query(), screen: '/questions/private-text' }).success).toBe(false);
    expect(userLogsRequestSchema.safeParse({ ...query(), event: 'arbitrary_payload' }).success).toBe(false);
  });
  it('refuses extra personal data, malformed timestamps and inconsistent pagination in responses', () => {
    expect(userLogsResponseSchema.safeParse(makeResponse()).success).toBe(true);
    expect(userLogsResponseSchema.safeParse(makeResponse({ items: [{ ...usage, email: 'private@example.com' } as UserLog] })).success).toBe(false);
    expect(userLogsResponseSchema.safeParse(makeResponse({ items: [{ ...usage, created_at: 'not-a-time' }] })).success).toBe(false);
    expect(userLogsResponseSchema.safeParse(makeResponse({ has_more: true })).success).toBe(false);
    expect(userLogsResponseSchema.safeParse(makeResponse({ items: Array.from({ length: 51 }, () => usage) })).success).toBe(false);
  });
  it('distinguishes unmeasured time from zero and formats Korean timestamps including seconds', () => {
    expect(formatActiveTime(null)).toBe('미측정');
    expect(formatActiveTime(0)).toBe('0초');
    expect(formatActiveTime(15_000)).toBe('15초');
    expect(formatLogTime(usage.created_at)).toContain('2026. 11. 05.');
    expect(formatLogTime(usage.created_at)).toContain('00:02:03');
  });
});

describe('private user-log transport and request lifecycle', () => {
  it('sends only strict filters and a bearer token to the same-origin, uncached endpoint', async () => {
    await fetchUserLogs(mock.token!, query());
    expect(mock.fetch).toHaveBeenCalledWith('/api/admin/user-logs', expect.objectContaining({
      method: 'POST', cache: 'no-store', credentials: 'omit', redirect: 'error',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer synthetic-admin-token-a' },
    }));
    expect(payloadAt(0)).toEqual(query());
  });
  it('rejects malformed data and never returns raw error details', async () => {
    mock.fetch.mockResolvedValueOnce(Response.json({ ...makeResponse(), secret: 'sensitive-provider-message' }));
    await expect(fetchUserLogs(mock.token!, query())).rejects.toMatchObject({ status: 502, code: 'invalid_user_logs_response' });
    mock.fetch.mockResolvedValueOnce(Response.json({ error: { code: 'select secrets from users', message: 'raw-provider-detail' } }, { status: 503 }));
    await expect(fetchUserLogs(mock.token!, query())).rejects.toMatchObject({ status: 503, code: 'user_logs_request_failed' });
  });
  it('enforces a 25-second timeout without leaving an indefinite spinner', async () => {
    vi.useFakeTimers();
    mock.fetch.mockImplementation((_url, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    const pending = fetchUserLogs(mock.token!, query());
    const assertion = expect(pending).rejects.toMatchObject({ code: 'request_timeout' });
    await vi.advanceTimersByTimeAsync(25_000);
    await assertion;
  });
  it('makes one request under Strict Mode and hides results synchronously on permission loss', async () => {
    const view = renderHook(() => useUserLogs(query()), { wrapper: StrictMode });
    await waitFor(() => expect(view.result.current.data?.items).toHaveLength(2));
    expect(mock.fetch).toHaveBeenCalledTimes(1);
    mock.admin = false;
    view.rerender();
    expect(view.result.current.data).toBeNull();
    expect(mock.fetch).toHaveBeenCalledTimes(1);
  });
  it('hides old-token data and ignores a late response after the active identity changes', async () => {
    let finishFirst!: (response: Response) => void;
    mock.fetch.mockImplementation((_url: string, init: RequestInit) => (init.headers as Record<string, string>).Authorization.endsWith('token-a')
      ? new Promise<Response>(resolve => { finishFirst = resolve; })
      : Promise.resolve(Response.json(makeResponse({ items: [{ ...usage, user_id: otherUser }] }))));
    const view = renderHook(() => useUserLogs(query()));
    await waitFor(() => expect(mock.fetch).toHaveBeenCalledTimes(1));
    mock.token = 'synthetic-admin-token-b';
    mock.id = '10000000-0000-4000-8000-000000000002';
    view.rerender();
    expect(view.result.current.data).toBeNull();
    await waitFor(() => expect(view.result.current.data?.items[0].user_id).toBe(otherUser));
    await act(async () => { finishFirst(Response.json(makeResponse())); });
    expect(view.result.current.data?.items[0].user_id).toBe(otherUser);
    expect(mock.fetch.mock.calls[0][1].signal.aborted).toBe(true);
  });
  it('clears loaded rows immediately when filters change and aborts on unmount', async () => {
    const view = renderHook(({ event }) => useUserLogs({ ...query(), event }), { initialProps: { event: '' as '' | 'click' } });
    await waitFor(() => expect(view.result.current.data).not.toBeNull());
    mock.fetch.mockImplementation(() => new Promise(() => {}));
    view.rerender({ event: 'click' });
    expect(view.result.current.data).toBeNull();
    expect(view.result.current.loading).toBe(true);
    await waitFor(() => expect(mock.fetch).toHaveBeenCalledTimes(2));
    view.unmount();
    expect(mock.fetch.mock.calls[1][1].signal.aborted).toBe(true);
  });
  it('honors a rate-limit cooldown even if filters change', async () => {
    mock.fetch.mockResolvedValue(Response.json({ error: { code: 'rate_limited' } }, { status: 429, headers: { 'Retry-After': '30' } }));
    const view = renderHook(({ event }) => useUserLogs({ ...query(), event }), { initialProps: { event: '' as '' | 'click' } });
    await waitFor(() => expect(view.result.current.error?.status).toBe(429));
    act(() => view.result.current.reload());
    view.rerender({ event: 'click' });
    await waitFor(() => expect(view.result.current.error?.status).toBe(429));
    expect(mock.fetch).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date('2026-11-05T01:00:31Z'));
    mock.fetch.mockResolvedValue(Response.json(makeResponse()));
    act(() => view.result.current.reload());
    await waitFor(() => expect(view.result.current.data).not.toBeNull());
    expect(mock.fetch).toHaveBeenCalledTimes(2);
  });
});

describe('administrator user activity page', () => {
  it('never fetches or shows records for a non-administrator', async () => {
    mock.admin = false;
    render(<UserActivityLogs/>);
    expect(screen.getByRole('heading', { name: '관리자 인증이 필요합니다' })).toBeInTheDocument();
    await act(async () => { await Promise.resolve(); });
    expect(mock.fetch).not.toHaveBeenCalled();
    expect(screen.queryByRole('table')).toBeNull();
  });
  it('shows real response rows, Korean dates, and only allowlisted expandable details', async () => {
    render(<UserActivityLogs/>);
    const table = await screen.findByRole('table');
    expect(within(table).getByText('활성시간 기록')).toBeInTheDocument();
    expect(within(table).getByText('관심 기업 추가')).toBeInTheDocument();
    expect(within(table).getByText('미측정')).toBeInTheDocument();
    expect(screen.getByLabelText('시작일')).toHaveValue('2026-10-30');
    expect(screen.getByLabelText('관리자 이용 기록 포함')).not.toBeChecked();
    fireEvent.click(within(table).getByRole('button', { name: /활성시간 기록 상세/ }));
    expect(within(table).getByText(usage.session_id!)).toBeInTheDocument();
    expect(within(table).getByText(usage.page_id!)).toBeInTheDocument();
    expect(within(table).getByText(userId)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '사용자 행동 분석' })).toBeNull();
    expect(screen.getByRole('link', { name: '활동 로그' })).toHaveAttribute('href', '#activity-logs');
  });
  it('filters by the selected complete user ID and resets pagination', async () => {
    render(<UserActivityLogs/>);
    const controls = await screen.findAllByRole('button', { name: `사용자 ${userId}로 필터` });
    fireEvent.click(controls[0]);
    await waitFor(() => expect(mock.fetch).toHaveBeenCalledTimes(2));
    expect(payloadAt(1)).toMatchObject({ user_id: userId, cursor: null });
    expect(screen.getByLabelText('사용자 ID')).toHaveValue(userId);
  });
  it('rejects invalid user filters without issuing a request and keeps the entered value', async () => {
    render(<UserActivityLogs/>);
    await screen.findByRole('table');
    fireEvent.change(screen.getByLabelText('사용자 ID'), { target: { value: 'not-a-uuid' } });
    fireEvent.click(screen.getByRole('button', { name: '조회하기' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('전체 UUID');
    expect(mock.fetch).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('사용자 ID')).toHaveValue('not-a-uuid');
  });
  it('does not query an inverted shared date range', async () => {
    render(<UserActivityLogs/>);
    await screen.findByRole('table');
    fireEvent.change(screen.getByLabelText('시작일'), { target: { value: '2026-11-06' } });
    fireEvent.click(screen.getByRole('button', { name: '기간 적용' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('시작일과 종료일');
    expect(mock.fetch).toHaveBeenCalledTimes(1);
  });
  it('uses the returned keyset cursor for next and returns to the first page without storing raw logs', async () => {
    const next = { created_at: usage.created_at, id: usage.id };
    mock.fetch.mockResolvedValueOnce(Response.json(makeResponse({ items: [usage], next_cursor: next, has_more: true })))
      .mockResolvedValueOnce(Response.json(makeResponse({ items: [product] })))
      .mockResolvedValueOnce(Response.json(makeResponse({ items: [usage], next_cursor: next, has_more: true })));
    render(<UserActivityLogs/>);
    await screen.findByRole('table');
    fireEvent.click(screen.getByRole('button', { name: '다음' }));
    await waitFor(() => expect(mock.fetch).toHaveBeenCalledTimes(2));
    expect(payloadAt(1).cursor).toEqual(next);
    expect(await screen.findByText('2페이지 · 1개 표시')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '이전' }));
    await waitFor(() => expect(mock.fetch).toHaveBeenCalledTimes(3));
    expect(payloadAt(2).cursor).toBeNull();
    expect(await screen.findByText('1페이지 · 1개 표시')).toBeInTheDocument();
  });
  it('has an honest empty state when no user consented, without fabricated log rows', async () => {
    mock.fetch.mockResolvedValue(Response.json(makeResponse({ items: [], consented_users: 0, summary: { events: 0, users: 0, sessions: 0, active_ms: 0 } })));
    render(<UserActivityLogs/>);
    expect(await screen.findByRole('heading', { name: '조회할 기록이 없습니다' })).toBeInTheDocument();
    expect(screen.getByText(/현재 선택적 이용 통계에 동의한 사용자가 없습니다/)).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByRole('button', { name: '다음' })).toBeDisabled();
  });
  it.each([401, 403])('clears previously loaded logs on HTTP %s and offers local signout with a return path', async status => {
    render(<UserActivityLogs/>);
    await screen.findByRole('table');
    mock.fetch.mockResolvedValue(Response.json({ error: { code: status === 401 ? 'invalid_or_expired_session' : 'admin_required' } }, { status }));
    fireEvent.click(screen.getByRole('button', { name: '새로고침' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(status === 401 ? '로그인이 만료되었습니다' : '접근할 수 없습니다');
    expect(screen.queryByRole('table')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: status === 401 ? '다시 로그인' : '다른 계정으로 로그인' }));
    await waitFor(() => expect(mock.logout).toHaveBeenCalledTimes(1));
    expect(mock.replace).toHaveBeenCalledWith('/login?next=%2Fops');
  });
  it('keeps filters and retries a temporary failure without displaying raw error details', async () => {
    render(<UserActivityLogs/>);
    await screen.findByRole('table');
    fireEvent.change(screen.getByLabelText('화면', { exact: true }), { target: { value: 'calendar' } });
    mock.fetch.mockResolvedValueOnce(Response.json({ error: { code: 'database_unavailable', message: 'sensitive database host' } }, { status: 503 }));
    fireEvent.click(screen.getByRole('button', { name: '조회하기' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('로그를 불러오지 못했습니다');
    expect(screen.queryByText('sensitive database host')).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByLabelText('화면', { exact: true })).toHaveValue('calendar');
    mock.fetch.mockResolvedValue(Response.json(makeResponse()));
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    await screen.findByRole('table');
    expect(payloadAt(2).screen).toBe('calendar');
  });
  it('disables rate-limited retries and never navigates if signout fails', async () => {
    mock.fetch.mockResolvedValueOnce(Response.json({ error: { code: 'rate_limited' } }, { status: 429, headers: { 'Retry-After': '30' } }));
    const view = render(<UserActivityLogs/>);
    expect(await screen.findByRole('button', { name: '30초 후 다시 시도' })).toBeDisabled();
    view.unmount();
    mock.fetch.mockResolvedValue(Response.json({ error: { code: 'admin_required' } }, { status: 403 }));
    mock.logout.mockRejectedValue(new Error('raw signout error'));
    render(<UserActivityLogs/>);
    fireEvent.click(await screen.findByRole('button', { name: '다른 계정으로 로그인' }));
    expect(await screen.findByText(/로그아웃을 완료하지 못했습니다/)).toBeInTheDocument();
    expect(mock.replace).not.toHaveBeenCalled();
    expect(screen.queryByText('raw signout error')).toBeNull();
  });
  it('requests the existing MFA challenge for a step-up denial', async () => {
    mock.fetch.mockResolvedValue(Response.json({ error: { code: 'mfa_required' } }, { status: 403 }));
    const challenge = vi.fn();
    window.addEventListener('signalbrief:mfa-required', challenge);
    render(<UserActivityLogs/>);
    fireEvent.click(await screen.findByRole('button', { name: '추가 인증하기' }));
    expect(challenge).toHaveBeenCalledTimes(1);
    window.removeEventListener('signalbrief:mfa-required', challenge);
  });
});
