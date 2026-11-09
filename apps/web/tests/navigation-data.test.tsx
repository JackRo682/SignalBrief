import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { pageDataCache } from '@/lib/page-data-cache';
import { prefetchNavigation } from '@/redesign/navigation-data';
import { useData } from '@/workspace/ui';
import { catalogSchema, sourceOverviewSchema } from '@/workspace/contracts';
import { canFallbackFromHomeSnapshot, confirmHomeSnapshotReadiness, homeSnapshotKey, loadHomeSnapshot, useHomeSnapshot } from '@/redesign/home-snapshot';
import { homeSnapshotSchema } from '@/redesign/home-snapshot-contract';
import { rangeStart } from '@/redesign/dashboard-contract';

const mocks = vi.hoisted(() => ({ token: 'account-a', workspace: vi.fn(), request: vi.fn(), calendar: vi.fn(), coverage: vi.fn() }));
vi.mock('@/components/auth', () => ({ useAuth: () => ({ token: mocks.token }) }));
vi.mock('@/workspace/client', () => ({ workspace: (...args: unknown[]) => mocks.workspace(...args) }));
vi.mock('@/lib/api', async () => ({
  ...await vi.importActual<typeof import('@/lib/api')>('@/lib/api'),
  request: (...args: unknown[]) => mocks.request(...args),
}));
vi.mock('@/redesign/calendar-query', () => ({ loadCalendarData: (...args: unknown[]) => mocks.calendar(...args) }));
vi.mock('@/redesign/calendar-data', () => ({ loadCalendarCoverage: (...args: unknown[]) => mocks.coverage(...args) }));
const options = { timezone: 'Asia/Seoul', homeVariant: 'B' as const, now: new Date('2026-11-09T00:30:00Z') };
const directory = { items: [], total: 17, counts: {}, markets: [], categories: [], next_offset: null };
const overview = { companies: 17, filing_count: 0, published_count: 0, filings: [], historical_events: [], calendar: [], monitoring: [] };
const directoryRequest = { action: 'design_directory' as const, p: { market_group: 'all' as const, q: '', limit: 50, offset: 0 } };
function snapshot(today = '2026-11-09') {
  return homeSnapshotSchema.parse({
    as_of: '2026-11-09T00:30:00Z', today,
    watchlist: { id: 'synthetic-list', name: 'Watchlist', items: [] }, monitoring: [], directory,
    documents: { ...directory, total: 23 }, analyses: { ...directory, total: 4 },
    saved: { items: [], counts: { event: 0, document: 0, analysis: 0, history: 0 } },
    notifications: { items: [], unread_count: 0 },
    dashboard: { as_of: '2026-11-09T00:30:00Z', timezone: 'Asia/Seoul', start_date: rangeStart(today, 30), end_date: today,
      filing_count: 23, analysis_count: 4, event_count: 2, filings: [], analyses: [], events: [] },
  });
}
const failure = (status: number, code: string) => Object.assign(new Error(code), { status, code });
beforeEach(() => {
  vi.clearAllMocks(); mocks.token = 'account-a'; pageDataCache.reset(mocks.token);
  mocks.workspace.mockImplementation(async (_token, input, schema) => schema.parse(
    input.action === 'home_snapshot' ? snapshot(input.p.today) : input.action === 'source_overview' ? overview : input.action === 'saved_list'
      ? { items: [], counts: { event: 0, document: 0, analysis: 0, history: 0 } } : directory,
  ));
  mocks.request.mockResolvedValue({ items: [] });
  mocks.calendar.mockResolvedValue({ items: [], truncated: false });
  mocks.coverage.mockResolvedValue({ registered_companies: 17, covered_companies: 10, pending_companies: 0, selected: null });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('navigation data preparation', () => {
  it('renders a prepared company list immediately without a second API request', async () => {
    await prefetchNavigation(mocks.token, '/explore', options);
    expect(mocks.workspace).toHaveBeenCalledTimes(2);
    const { result } = renderHook(() => useData(directoryRequest, catalogSchema));
    expect(result.current.data?.total).toBe(17);
    expect(result.current.loading).toBe(false);
    await act(async () => {});
    expect(mocks.workspace).toHaveBeenCalledTimes(2);
  });
  it('refreshes expired data in the background while the previous result stays visible', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    await prefetchNavigation(mocks.token, '/explore', options);
    vi.setSystemTime(Date.now() + 60_001);
    let resolve!: (value: unknown) => void;
    mocks.workspace.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const { result } = renderHook(() => useData(directoryRequest, catalogSchema));
    expect(result.current.data?.total).toBe(17);
    expect(result.current.loading).toBe(false);
    await act(async () => {});
    await act(async () => resolve({ ...directory, total: 18 }));
    expect(result.current.data?.total).toBe(18);
  });
  it('targeted retry does not empty another tab or replace a known list with loading', async () => {
    await prefetchNavigation(mocks.token, '/explore', options);
    const { result } = renderHook(() => useData(directoryRequest, catalogSchema));
    await act(async () => {});
    await act(async () => result.current.reload());
    expect(result.current.data?.total).toBe(17);
    expect(pageDataCache.isFresh(mocks.token,'workspace:' + JSON.stringify({action:'source_overview',p:{scope:'all',days:0}}))).toBe(true);
    expect(mocks.workspace).toHaveBeenCalledTimes(3);
  });
  it('does not reuse another account or a different directory filter', async () => {
    await prefetchNavigation(mocks.token, '/explore', options);
    mocks.token = 'account-b'; pageDataCache.reset(mocks.token);
    mocks.workspace.mockImplementation(() => new Promise(() => {}));
    const { result } = renderHook(() => useData(directoryRequest, catalogSchema));
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(true);
  });
  it('does not fetch private history or perform writes during preparation', async () => {
    await prefetchNavigation(mocks.token, '/saved', options);
    await prefetchNavigation(mocks.token, '/today', options);
    expect(mocks.workspace.mock.calls.map(([, input]) => input.action)).toEqual(['saved_list', 'home_snapshot']);
    expect(mocks.workspace.mock.calls.some(([, input]) => input.p.kind === 'history')).toBe(false);
  });
  it('discards a pending old-account continuation before it requests calendar rows', async () => {
    let resolve!: (value: unknown) => void;
    mocks.request.mockImplementation(() => new Promise(done => { resolve = done; }));
    const pending = prefetchNavigation(mocks.token, '/watchlist', options);
    await act(async () => {});
    pageDataCache.reset('account-b');
    resolve({items:[]}); await pending;
    expect(mocks.calendar).not.toHaveBeenCalled();
    expect(pageDataCache.isCurrent('account-b')).toBe(true);
  });
  it('isolates failed speculation and retries through the destination error controls', async () => {
    mocks.workspace.mockRejectedValueOnce(new Error('temporary failure'));
    await expect(prefetchNavigation(mocks.token, '/explore', options)).resolves.toBeUndefined();
    const { result } = renderHook(() => useData(directoryRequest, catalogSchema));
    await waitFor(() => expect(result.current.data?.total).toBe(17));
    expect(mocks.workspace).toHaveBeenCalledTimes(3);
  });
  it('preserves raw source overview validation and only caches successful reads', async () => {
    mocks.workspace.mockImplementation(async (_token, _input, schema: z.ZodType) => schema.parse({ malformed: true }));
    await prefetchNavigation(mocks.token, '/explore', options);
    const key = 'workspace:' + JSON.stringify({action:'source_overview',p:{scope:'all',days:0}});
    expect(pageDataCache.peek(mocks.token,key)).toBeUndefined();
    expect(sourceOverviewSchema.safeParse({ malformed: true }).success).toBe(false);
  });
});

describe('shared Home snapshot preparation', () => {
  it('prepares both previews with one common read and their independent calendar scopes', async () => {
    await Promise.all([
      prefetchNavigation(mocks.token, '/today', { ...options, homeVariant: 'A' }),
      prefetchNavigation(mocks.token, '/today', options),
    ]);
    expect(mocks.workspace).toHaveBeenCalledTimes(1);
    expect(mocks.workspace.mock.calls[0][1]).toEqual({ action: 'home_snapshot', p: { today: '2026-11-09' } });
    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.calendar).toHaveBeenCalledWith(mocks.token, { from: '2026-11-09', until: '2026-12-09', includePersonal: false });
    expect(mocks.calendar).toHaveBeenCalledWith(mocks.token, { from: '2026-11-09', until: '2026-11-15', includePersonal: false });
    expect(mocks.coverage).toHaveBeenCalledExactlyOnceWith(mocks.token, null);
    const first = renderHook(() => useHomeSnapshot('2026-11-09'));
    expect(first.result.current.data?.documents.total).toBe(23);
    expect(first.result.current.data?.dashboard.filing_count).toBe(23);
    expect(first.result.current.loading).toBe(false);
    first.unmount();
    const next = renderHook(() => useHomeSnapshot('2026-11-09'));
    expect(next.result.current.data?.directory.total).toBe(17);
    expect(next.result.current.loading).toBe(false);
    await act(async () => {});
    expect(mocks.workspace).toHaveBeenCalledTimes(1);
  });

  it('retains a stale snapshot during refresh and targets retries without clearing another tab', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    await prefetchNavigation(mocks.token, '/explore', options);
    await loadHomeSnapshot(mocks.token, '2026-11-09');
    vi.setSystemTime(Date.now() + 30_001);
    let finish!: (value: ReturnType<typeof snapshot>) => void;
    mocks.workspace.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const { result } = renderHook(() => useHomeSnapshot('2026-11-09'));
    expect(result.current.data?.documents.total).toBe(23);
    expect(result.current.loading).toBe(false);
    await act(async () => {});
    await act(async () => finish({ ...snapshot(), documents: { ...directory, total: 24 } }));
    expect(result.current.data?.documents.total).toBe(24);
    await act(async () => result.current.reload());
    expect(pageDataCache.isFresh(mocks.token, 'workspace:' + JSON.stringify(directoryRequest))).toBe(true);
    expect(result.current.loading).toBe(false);
  });

  it.each([[401, 'authentication_required'], [403, 'mfa_required'], [403, 'onboarding_required'], [429, 'rate_limit'], [422, 'invalid_input']])(
    'fails closed for %s %s without enabling legacy fallback', async (status, code) => {
      mocks.workspace.mockRejectedValue(failure(Number(status), String(code)));
      const { result } = renderHook(() => useHomeSnapshot('2026-11-09'));
      await waitFor(() => expect(result.current.error).toBe(code));
      expect(result.current.fallback).toBe(false);
      expect(result.current.data).toBeNull();
      expect(mocks.workspace).toHaveBeenCalledTimes(1);
    },
  );

  it.each([failure(503, 'workspace_unavailable'), failure(404, 'unsupported_action'), new TypeError('Failed to fetch'),
    new DOMException('Timed out', 'TimeoutError'), new z.ZodError([])])('permits bounded fallback for a recoverable read failure', async error => {
    expect(canFallbackFromHomeSnapshot(error)).toBe(true);
    mocks.workspace.mockRejectedValue(error);
    const { result } = renderHook(() => useHomeSnapshot('2026-11-09'));
    await waitFor(() => expect(result.current.fallback).toBe(true));
    expect(mocks.workspace).toHaveBeenCalledTimes(1);
  });

  it('rejects a valid-shaped response for a different day', async () => {
    mocks.workspace.mockResolvedValue(snapshot('2026-11-08'));
    const { result } = renderHook(() => useHomeSnapshot('2026-11-09'));
    await waitFor(() => expect(result.current.fallback).toBe(true));
    expect(result.current.data).toBeNull();
    expect(pageDataCache.peek(mocks.token, homeSnapshotKey('2026-11-09'))).toBeUndefined();
  });

  it('discards a late previous-account snapshot and starts the new account independently', async () => {
    let finish!: (value: ReturnType<typeof snapshot>) => void;
    mocks.workspace.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const { result, rerender } = renderHook(() => useHomeSnapshot('2026-11-09'));
    await waitFor(() => expect(mocks.workspace).toHaveBeenCalledTimes(1));
    mocks.token = 'account-b'; pageDataCache.reset(mocks.token);
    rerender();
    expect(result.current.data).toBeNull();
    await waitFor(() => expect(result.current.data?.directory.total).toBe(17));
    await act(async () => finish({ ...snapshot(), directory: { ...directory, total: 999 } }));
    expect(result.current.data?.directory.total).toBe(17);
    expect(pageDataCache.isCurrent('account-b')).toBe(true);
  });

  it('retries only an early onboarding prerequisite failure after the profile is confirmed', async () => {
    mocks.token = 'early-profile'; pageDataCache.reset(mocks.token);
    let reject!: (reason: unknown) => void;
    mocks.workspace.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    const pending = loadHomeSnapshot(mocks.token, '2026-11-09', false);
    await act(async () => {});
    confirmHomeSnapshotReadiness(mocks.token, '2026-11-09');
    reject(failure(403, 'onboarding_required'));
    await expect(pending).resolves.toMatchObject({ today: '2026-11-09' });
    expect(mocks.workspace).toHaveBeenCalledTimes(2);
  });

  it('reloads after a confirmed mutation resets the cache without leaving the current Home pending', async () => {
    const { result } = renderHook(() => useHomeSnapshot('2026-11-09'));
    await waitFor(() => expect(result.current.data).not.toBeNull());
    mocks.workspace.mockResolvedValue({ ...snapshot(), documents: { ...directory, total: 25 } });
    await act(async () => { pageDataCache.reset(); result.current.reload(); });
    await waitFor(() => expect(result.current.data?.documents.total).toBe(25));
    expect(result.current.loading).toBe(false);
    expect(pageDataCache.isCurrent(mocks.token)).toBe(true);
  });
});
