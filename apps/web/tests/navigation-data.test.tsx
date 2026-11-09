import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { pageDataCache } from '@/lib/page-data-cache';
import { prefetchNavigation } from '@/redesign/navigation-data';
import { useData } from '@/workspace/ui';
import { catalogSchema, sourceOverviewSchema } from '@/workspace/contracts';

const mocks = vi.hoisted(() => ({ token: 'account-a', workspace: vi.fn(), request: vi.fn(), calendar: vi.fn() }));
vi.mock('@/components/auth', () => ({ useAuth: () => ({ token: mocks.token }) }));
vi.mock('@/workspace/client', () => ({ workspace: (...args: unknown[]) => mocks.workspace(...args) }));
vi.mock('@/lib/api', async () => ({
  ...await vi.importActual<typeof import('@/lib/api')>('@/lib/api'),
  request: (...args: unknown[]) => mocks.request(...args),
}));
vi.mock('@/redesign/calendar-query', () => ({ loadCalendarData: (...args: unknown[]) => mocks.calendar(...args) }));
const options = { timezone: 'Asia/Seoul', homeVariant: 'B' as const, now: new Date('2026-11-09T00:30:00Z') };
const directory = { items: [], total: 17, counts: {}, markets: [], next_offset: null };
const overview = { companies: 17, filing_count: 0, published_count: 0, filings: [], historical_events: [], calendar: [], monitoring: [] };
const directoryRequest = { action: 'design_directory' as const, p: { market_group: 'all' as const, q: '', limit: 50, offset: 0 } };
beforeEach(() => {
  vi.clearAllMocks(); mocks.token = 'account-a'; pageDataCache.reset(mocks.token);
  mocks.workspace.mockImplementation(async (_token, input, schema) => schema.parse(
    input.action === 'source_overview' ? overview : input.action === 'saved_list'
      ? { items: [], counts: { event: 0, document: 0, analysis: 0, history: 0 } } : directory,
  ));
  mocks.request.mockResolvedValue({ items: [] });
  mocks.calendar.mockResolvedValue({ items: [], truncated: false });
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
    expect(mocks.workspace.mock.calls.every(([, input]) => ['saved_list','source_overview','catalog'].includes(input.action))).toBe(true);
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
