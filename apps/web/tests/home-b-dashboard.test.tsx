import type { ComponentProps, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import HomeB from '@/redesign/home-b';
import { calendarEntrySchema, type CalendarEntry } from '@/redesign/calendar-utils';
import { resourceSchema, type Resource } from '@/workspace/contracts';

const state = vi.hoisted(() => ({
  saved: new Set<string>(), rejectSave: false, rejectRead: false, historyEnabled: false,
  documentError: '', watchlistLoading: false, calls: [] as { action: string; p: Record<string, unknown> }[],
  documents: [] as Resource[], analyses: [] as Resource[], events: [] as CalendarEntry[],
  notices: [] as { id: string; created_at: string; read_at: string | null; resource: Resource }[],
  coverageRevision: 1, calendarRead: vi.fn(),
  push: vi.fn(), reloadDocuments: vi.fn(), reloadSaved: vi.fn(),
  snapshotRead: vi.fn(), reloadSnapshot: vi.fn(),
  markRead: vi.fn(), save: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: ComponentProps<'a'> & { href: string; children: ReactNode }) =>
    <a href={href} {...props}>{children}</a>,
}));
vi.mock('next/image', () => ({ default: () => <span aria-hidden="true" /> }));
vi.mock('@/components/auth', () => ({ useAuth: () => ({ token: 'synthetic-account-token' }) }));
vi.mock('@/components/ui', () => ({
  useResource: () => ({ data: state.watchlistLoading ? null : { items: [] }, loading: state.watchlistLoading, error: null, reload: vi.fn() }),
}));
vi.mock('@/workspace/preferences', () => ({
  usePrefs: () => ({ loaded: true, value: { history_enabled: state.historyEnabled }, text: (ko: string) => ko }),
}));
vi.mock('@/workspace/market', () => ({ useQuotes: () => ({ quotes: [], loading: false }) }));
vi.mock('@/redesign/home-b-news', () => ({
  useHomeBNews: () => ({ data: { items: [] }, loading: false, error: '', reload: vi.fn() }),
}));
vi.mock('@/redesign/calendar-data', () => ({
  useCalendarData: (...args: unknown[]) => {
    state.calendarRead(...args);
    return { data: { items: state.events, truncated: false }, loading: false, error: '', reload: vi.fn() };
  },
  useCalendarCoverage: () => ({
    data: { registered_companies: 2, covered_companies: 1, pending_companies: 0, selected: null },
    collectionRevision: state.coverageRevision,
    loading: false, error: '', reload: vi.fn(),
  }),
}));
vi.mock('@/workspace/notification-state', () => ({
  useContentNotifications: () => ({
    data: { items: state.notices, unread_count: state.notices.filter(item => !item.read_at).length },
    loading: false, error: '', reload: vi.fn(),
  }),
  markContentNotificationRead: (...args: unknown[]) => state.markRead(...args),
}));
vi.mock('@/workspace/client', () => ({ workspace: (...args: unknown[]) => state.save(...args) }));
vi.mock('@/redesign/home-snapshot', async (original) => ({
  ...(await original<typeof import('@/redesign/home-snapshot')>()),
  useHomeSnapshot: (today: string) => {
    state.snapshotRead(today);
    const savedItem = (item: Resource) => ({ ...item, is_saved: state.saved.has(`${item.kind}:${item.id}`) });
    const catalog = (items: Resource[]) => ({ items: items.map(savedItem), total: items.length, counts: {}, markets: [], next_offset: null });
    const savedDocuments = state.documents.filter(item => state.saved.has(`${item.kind}:${item.id}`));
    const savedAnalyses = state.analyses.filter(item => state.saved.has(`${item.kind}:${item.id}`));
    return {
      data: state.watchlistLoading || state.documentError ? null : {
        today, as_of: '2026-10-06T08:00:00.000Z', watchlist: { items: [] }, directory: catalog([]),
        monitoring: state.documents.map(item => ({ company_id: item.company_id, latest_filing: item, latest_analysis: null,
          next_event: null, last_collected_at: null, filing_count: 1, analysis_count: 0 })),
        documents: catalog(state.documents), analyses: catalog(state.analyses),
        saved: { items: savedAnalyses.map(savedItem), counts: { document: savedDocuments.length, analysis: savedAnalyses.length, event: 0, history: 0 } },
      },
      loading: state.watchlistLoading, error: state.documentError ? 'Synthetic Home snapshot unavailable' : '',
      fallback: Boolean(state.documentError), reload: state.reloadSnapshot,
    };
  },
}));
vi.mock('@/workspace/ui', async () => {
  const actual = await vi.importActual<typeof import('@/workspace/ui')>('@/workspace/ui');
  const savedItem = (item: Resource) => ({ ...item, is_saved: state.saved.has(`${item.kind}:${item.id}`) });
  return {
    ...actual,
    useData: (request: null | { action: string; p: Record<string, unknown> }) => {
      const base = { loading: false, error: '', reload: vi.fn() };
      if (!request) return { ...base, data: null };
      state.calls.push(request);
      if (request.action === 'source_overview') {
        return { ...base, data: {
          companies: 1, filing_count: state.documents.length, published_count: 0,
          filings: state.documents, historical_events: [], calendar: [], analyses: [],
          scope: 'all', following_count: 0, fallback_to_all: true,
          monitoring: state.documents.map(item => ({
            company_id: item.company_id, latest_filing: item, latest_analysis: null,
            next_event: null, last_collected_at: null, filing_count: 1, analysis_count: 0,
          })),
        } };
      }
      if (request.action === 'catalog') {
        const kind = request.p.kind;
        const items = kind === 'document' ? state.documents : kind === 'analysis' ? state.analyses : [];
        return {
          ...base, data: { items: items.map(savedItem), total: items.length, counts: {}, markets: [], next_offset: null },
          error: kind === 'document' ? state.documentError : '',
          reload: kind === 'document' ? state.reloadDocuments : base.reload,
        };
      }
      if (request.action === 'saved_list') {
        const all = [...state.documents, ...state.analyses].filter(item => state.saved.has(`${item.kind}:${item.id}`));
        const documents = all.filter(item => ['filing', 'document'].includes(item.kind));
        const analyses = all.filter(item => ['us_analysis', 'dart_analysis'].includes(item.kind));
        const selected = request.p.kind === 'analysis' ? analyses : request.p.kind === 'document' ? documents : [];
        return {
          ...base, reload: state.reloadSaved,
          data: {
            items: selected.map(item => ({ ...savedItem(item), saved_at: '2026-10-06T08:00:00.000Z' })),
            counts: { document: documents.length, analysis: analyses.length, event: 0, history: 0 },
          },
        };
      }
      throw new Error(`Unexpected homepage action: ${request.action}`);
    },
  };
});

const document = resourceSchema.parse({
  id: '40000000-0000-4000-8000-000000000101', kind: 'filing',
  title: 'Synthetic source filing', summary: 'Synthetic document summary.',
  company_id: '20000000-0000-4000-8000-000000000001', company_name: 'Synthetic company',
  ticker: 'NVDA', market: 'NASDAQ', source_url: 'https://www.sec.gov/synthetic-source.htm',
  published_at: '2026-10-05T10:00:00.000Z', publication_precision: 'timestamp',
  category: '10-Q', is_saved: false, provider: 'sec',
});
const analysis = resourceSchema.parse({
  ...document, kind: 'us_analysis', filing_id: document.id, title: 'Synthetic approved excerpt',
  reviewed_at: '2026-10-06T07:00:00.000Z', coverage: 'excerpt',
});
const earnings = calendarEntrySchema.parse({
  id: '80000000-0000-4000-8000-000000000101', title: 'Synthetic earnings announcement',
  occurs_on: '2026-10-06', company_id: document.company_id, event_id: null,
  origin: 'official_ir', quote: 'Synthetic dated notice.', source_url: document.source_url,
  source_timezone: 'America/New_York', verified_at: '2026-10-06T07:00:00.000Z',
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-06T08:00:00.000Z'));
  state.saved.clear(); state.rejectSave = false; state.rejectRead = false;
  state.historyEnabled = false; state.documentError = ''; state.watchlistLoading = false; state.calls = [];
  state.documents = [document]; state.analyses = [analysis]; state.events = [earnings];
  state.notices = [{
    id: '80000000-0000-4000-8000-000000000201', created_at: '2026-10-06T08:00:00.000Z',
    read_at: null, resource: analysis,
  }];
  state.push.mockReset(); state.reloadDocuments.mockReset(); state.reloadSaved.mockReset();
  state.snapshotRead.mockReset(); state.reloadSnapshot.mockReset();
  state.coverageRevision = 1; state.calendarRead.mockReset();
  state.save.mockReset().mockImplementation(async (_token, request) => {
    if (request.action !== 'save') throw new Error(`Unexpected write: ${request.action}`);
    if (state.rejectSave) throw new Error('Synthetic save unavailable');
    const key = `${request.p.kind}:${request.p.id}`;
    if (request.p.saved) state.saved.add(key); else state.saved.delete(key);
    return { saved: request.p.saved };
  });
  state.markRead.mockReset().mockImplementation(async (_token, id) => {
    if (state.rejectRead) throw new Error('Synthetic notification write unavailable');
    const item = state.notices.find(notice => notice.id === id);
    if (item) item.read_at = '2026-10-06T08:00:00.000Z';
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('the real Home B dashboard with isolated service responses', () => {
  it('uses one pending snapshot and never displays all-company fallback as followed', () => {
    state.watchlistLoading = true;
    const view = render(<HomeB />);
    expect(state.snapshotRead).toHaveBeenCalledWith('2026-10-06');
    expect(state.calls).toEqual([]);
    const following = within(screen.getByRole('region', { name: '관심기업 업데이트' }));
    expect(following.queryByText(document.title)).toBeNull();
    state.watchlistLoading = false;
    view.rerender(<HomeB />);
    expect(following.queryByText(document.title)).toBeNull();
    expect(following.getByRole('link', { name: /관심 기업 추가/ })).toBeDefined();
  });

  it('renders the reference sections with canonical links and working category filters', () => {
    state.documents.push(resourceSchema.parse({
      ...document, kind: 'document', id: '40000000-0000-4000-8000-000000000102',
      title: 'Synthetic investor presentation', category: 'presentation',
    }));
    state.events.push(calendarEntrySchema.parse({
      ...earnings, id: '80000000-0000-4000-8000-000000000102',
      title: 'Synthetic investor day', occurs_on: '2026-10-08',
    }));
    const { container, rerender } = render(<HomeB />);
    expect(container.querySelector('[data-screen="redesign-home-b"]')).not.toBeNull();
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(8);
    const documents = within(screen.getByRole('region', { name: '최신 문서' }));
    expect(documents.getByRole('link', { name: /^NVDA .*Synthetic source filing$/ }).getAttribute('href'))
      .toBe(`/documents/${document.id}?kind=filing`);
    const analyses = within(screen.getByRole('region', { name: '승인된 분석' }));
    expect(analyses.getByRole('link', { name: /Synthetic approved excerpt/ }).getAttribute('href'))
      .toBe(`/documents/${document.id}?kind=filing&analysis=us`);
    fireEvent.click(documents.getByRole('button', { name: '프레젠테이션' }));
    expect(documents.queryByRole('link', { name: /^NVDA .*Synthetic source filing$/ })).toBeNull();
    expect(documents.getByRole('link', { name: /^NVDA .*Synthetic investor presentation$/ })).toBeDefined();
    const calendar = within(screen.getByRole('region', { name: '다가오는 일정' }));
    fireEvent.click(calendar.getByRole('button', { name: '실적 발표' }));
    expect(calendar.queryByRole('link', { name: /Synthetic investor day/ })).toBeNull();
    expect(calendar.getByRole('link', { name: /Synthetic earnings announcement/ }).getAttribute('href'))
      .toBe(`/events/${earnings.id}?kind=calendar`);
    expect(state.snapshotRead).toHaveBeenCalledWith('2026-10-06');
    expect(state.calls).toEqual([]);
    expect(state.calendarRead).toHaveBeenLastCalledWith({ from: '2026-10-06', until: '2026-10-12', includePersonal: false }, 1);
    state.coverageRevision = 2;
    rerender(<HomeB />);
    expect(state.calendarRead).toHaveBeenLastCalledWith({ from: '2026-10-06', until: '2026-10-12', includePersonal: false }, 2);
  });

  it('keeps a rejected bookmark unsaved, then confirms it and makes it available under Saved documents', async () => {
    state.rejectSave = true;
    render(<HomeB />);
    const documents = within(screen.getByRole('region', { name: '최신 문서' }));
    fireEvent.click(documents.getByRole('button', { name: `${document.title} 저장` }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Synthetic save unavailable'));
    expect(documents.getByRole('button', { name: `${document.title} 저장` }).getAttribute('aria-pressed')).toBe('false');
    expect(state.saved.size).toBe(0);
    expect(state.reloadSaved).not.toHaveBeenCalled();
    state.rejectSave = false;
    fireEvent.click(documents.getByRole('button', { name: `${document.title} 저장` }));
    await waitFor(() => expect(documents.getByRole('button', { name: `${document.title} 저장 취소` }).getAttribute('aria-pressed')).toBe('true'));
    expect(state.reloadSnapshot).toHaveBeenCalledTimes(1);
    expect(state.reloadSaved).not.toHaveBeenCalled();
    expect(state.reloadDocuments).not.toHaveBeenCalled();
    const saved = within(screen.getByRole('region', { name: '저장한 항목' }));
    fireEvent.click(saved.getByRole('button', { name: /^문서/ }));
    expect(saved.getByRole('link', { name: /Synthetic source filing/ }).getAttribute('href'))
      .toBe(`/documents/${document.id}?kind=filing`);
  });

  it('keeps a failed notification open unread and navigates only after its read is persisted', async () => {
    state.rejectRead = true;
    render(<HomeB />);
    const alerts = within(screen.getByRole('region', { name: '알림' }));
    fireEvent.click(alerts.getByRole('link', { name: /Synthetic approved excerpt/ }));
    await waitFor(() => expect(alerts.getByRole('alert').textContent).toContain('Synthetic notification write unavailable'));
    expect(state.push).not.toHaveBeenCalled();
    expect(state.notices[0].read_at).toBeNull();
    state.rejectRead = false;
    fireEvent.click(alerts.getByRole('link', { name: /Synthetic approved excerpt/ }));
    await waitFor(() => expect(state.push).toHaveBeenCalledWith(`/documents/${document.id}?kind=filing&analysis=us`));
    expect(state.markRead).toHaveBeenLastCalledWith('synthetic-account-token', state.notices[0].id);
    expect(state.notices[0].read_at).not.toBeNull();
  });

  it('honors disabled viewing history and shows a failed document count as unavailable rather than zero', () => {
    state.documentError = 'Synthetic document service unavailable';
    const { container } = render(<HomeB />);
    expect(container.querySelector('[data-home-snapshot-error]')?.textContent).toContain('Synthetic Home snapshot unavailable');
    expect(screen.getByRole('link', { name: '신규 문서 조회 불가' })).toBeDefined();
    expect(container.querySelectorAll('.hb-document')).toHaveLength(0);
    const saved = within(screen.getByRole('region', { name: '저장한 항목' }));
    fireEvent.click(saved.getByRole('button', { name: /^열람 기록/ }));
    expect(saved.getByText('열람 기록 저장이 꺼져 있습니다.')).toBeDefined();
    expect(state.calls.some(request => request.action === 'saved_list' && request.p.kind === 'history')).toBe(false);
    expect(state.save).not.toHaveBeenCalled();
  });
});
