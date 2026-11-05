import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OverviewPanels, formatOverviewRate } from '../src/admin-logs/overview';
import { fetchAdminOverview, useAdminOverview } from '../src/admin-logs/overview-client';
import { defaultOverviewFilters } from '../src/admin-logs/overview-contracts';
import { overviewFixture } from '../e2e/admin-overview-fixture';

const mock = vi.hoisted(() => ({
  token: 'synthetic-admin-token-a' as string | null,
  id: '10000000-0000-4000-8000-000000000001',
  admin: true, loading: false, error: null as string | null, fetch: vi.fn(),
}));
vi.mock('@/components/auth', () => ({ useAuth: () => ({
  token: mock.token, me: mock.token ? { id: mock.id, is_admin: mock.admin } : null,
  loading: mock.loading, error: mock.error,
}) }));
const query = () => defaultOverviewFilters(new Date('2026-11-05T01:00:00Z'));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-05T01:00:00Z'));
  vi.clearAllMocks(); mock.fetch.mockReset();
  mock.token = 'synthetic-admin-token-a'; mock.admin = true; mock.loading = false; mock.error = null;
  mock.id = '10000000-0000-4000-8000-000000000001';
  mock.fetch.mockImplementation(async () => Response.json(overviewFixture(query(), true)));
  vi.stubGlobal('fetch', mock.fetch);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('single-page operational metrics', () => {
  it('displays eight cards and all supporting information without linking to other analytics pages', () => {
    const data = overviewFixture(query(), true);
    render(<OverviewPanels data={data}/>);
    const metrics = screen.getByRole('region', { name: '핵심 지표' });
    expect(within(metrics).getAllByRole('article')).toHaveLength(8);
    expect(within(screen.getByRole('article', { name: '방문자 수' })).getByText('3')).toBeVisible();
    expect(within(screen.getByRole('article', { name: '회원가입 전환율' })).getByText('미측정')).toBeVisible();
    expect(within(screen.getByRole('article', { name: '핵심 기능 이용률' })).getByText('66.7%')).toBeVisible();
    expect(within(screen.getByRole('article', { name: '오류 발생률' })).getByText('5%')).toBeVisible();
    expect(screen.getByRole('heading', { name: '화면별 이용·이탈' })).toBeVisible();
    expect(screen.getByRole('region', { name: '최근 오류가 기록된 시간대' })).toBeVisible();
    expect(screen.getByText(/관리자 요청도 포함/)).toBeVisible();
    expect(screen.getByText(/정확히 1일·7일 뒤/)).toBeVisible();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('distinguishes zero counts, missing denominators, pending retention and uninstrumented signup', () => {
    render(<OverviewPanels data={overviewFixture(query())}/>);
    expect(within(screen.getByRole('article', { name: '방문자 수' })).getByText('0')).toBeVisible();
    expect(within(screen.getByRole('article', { name: '방문자 수' })).getByText('수집 대기')).toBeVisible();
    expect(within(screen.getByRole('article', { name: '오류 발생률' })).getByText('—')).toBeVisible();
    expect(within(screen.getByRole('article', { name: '주요 이탈 화면' })).getByText('집계 대기')).toBeVisible();
    expect(screen.queryByText('0%')).toBeNull();
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('아직 리텐션을 계산할 수 있는 표본이 없습니다.')).toBeVisible();
    expect(screen.getByText(/조회 가능한 범위에 API 요청 기록이 없어/)).toBeVisible();
  });

  it('does not report missing error instrumentation as zero errors and labels current-state activation', () => {
    const data = overviewFixture(query(), true);
    data.api.requests = 20; data.api.errors = 0; data.api.error_rate = 0; data.api.recent_error_hours = [];
    render(<OverviewPanels data={data}/>);
    expect(within(screen.getByRole('article', { name: '오류 발생률' })).getByText('0%')).toBeVisible();
    expect(screen.getByText(/가입 후 7일 내 핵심 기능 완료율과는 다릅니다/)).toBeVisible();
    expect(screen.getByText('조회 가능한 범위에 기록된 API 5xx 오류가 없습니다.')).toBeVisible();
    expect(formatOverviewRate(null)).toBe('—'); expect(formatOverviewRate(0)).toBe('0%');
  });
});

describe('private overview request lifecycle', () => {
  it('validates responses and sends only shared range settings to the admin endpoint', async () => {
    await fetchAdminOverview(mock.token!, query());
    expect(mock.fetch).toHaveBeenCalledWith('/api/admin/overview', expect.objectContaining({
      method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store',
      body: JSON.stringify(query()),
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer synthetic-admin-token-a' },
    }));
    mock.fetch.mockResolvedValueOnce(Response.json({ ...overviewFixture(query()), email: 'private@example.invalid' }));
    await expect(fetchAdminOverview(mock.token!, query())).rejects.toMatchObject({ code: 'invalid_overview_response' });
  });

  it('deduplicates Strict Mode reads and immediately hides prior metrics on permission loss', async () => {
    const view = renderHook(() => useAdminOverview(query()), { wrapper: StrictMode });
    await waitFor(() => expect(view.result.current.data?.summary.visitors).toBe(3));
    expect(mock.fetch).toHaveBeenCalledTimes(1);
    mock.admin = false; view.rerender();
    expect(view.result.current.data).toBeNull();
    expect(mock.fetch).toHaveBeenCalledTimes(1);
  });

  it.each(['missing-token', 'non-admin', 'auth-error', 'loading'])('does not fetch with %s', async state => {
    if (state === 'missing-token') mock.token = null;
    if (state === 'non-admin') mock.admin = false;
    if (state === 'auth-error') mock.error = 'Cannot verify';
    if (state === 'loading') mock.loading = true;
    const view = renderHook(() => useAdminOverview(query()));
    await act(async () => { await Promise.resolve(); });
    expect(mock.fetch).not.toHaveBeenCalled(); expect(view.result.current.data).toBeNull();
  });

  it('clears stale results on date changes and ignores an abandoned response', async () => {
    let finish!: (response: Response) => void;
    mock.fetch.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
    const view = renderHook(({ from }) => useAdminOverview({ ...query(), from }), { initialProps: { from: '2026-10-30' } });
    await waitFor(() => expect(mock.fetch).toHaveBeenCalledTimes(1));
    mock.fetch.mockResolvedValue(Response.json(overviewFixture({ ...query(), from: '2026-11-01' })));
    view.rerender({ from: '2026-11-01' });
    expect(view.result.current.data).toBeNull();
    await waitFor(() => expect(view.result.current.data?.summary.visitors).toBe(0));
    await act(async () => { finish(Response.json(overviewFixture(query(), true))); });
    expect(view.result.current.data?.from).toBe('2026-11-01');
    expect(view.result.current.data?.summary.visitors).toBe(0);
    expect(mock.fetch.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it('uses a bounded retry cooldown across filter changes', async () => {
    mock.fetch.mockResolvedValue(Response.json({ error: { code: 'rate_limit_exceeded' } }, { status: 429, headers: { 'Retry-After': '30' } }));
    const view = renderHook(({ include_admin }) => useAdminOverview({ ...query(), include_admin }), { initialProps: { include_admin: false } });
    await waitFor(() => expect(view.result.current.error?.status).toBe(429));
    view.rerender({ include_admin: true });
    act(() => view.result.current.reload());
    expect(mock.fetch).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date('2026-11-05T01:00:31Z'));
    mock.fetch.mockResolvedValue(Response.json(overviewFixture({ ...query(), include_admin: true })));
    act(() => view.result.current.reload());
    await waitFor(() => expect(view.result.current.data?.include_admin).toBe(true));
  });
});
