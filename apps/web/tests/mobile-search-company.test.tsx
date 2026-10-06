import {cleanup, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {defaults, type Resource} from '../src/workspace/contracts';
import MobileExplore, {MobileSearchResults} from '../src/mobile/search';
import MobileCompany from '../src/mobile/company';

// These synthetic responses are isolated UI regressions, never production data.
const mocks = vi.hoisted(() => ({workspace: vi.fn(), request: vi.fn(), push: vi.fn()}));
vi.mock('next/navigation', () => ({useRouter: () => ({push: mocks.push})}));
vi.mock('@/components/auth', () => ({useAuth: () => ({token: 'isolated-fixture-token'})}));
vi.mock('@/workspace/client', async importOriginal => ({...await importOriginal<typeof import('../src/workspace/client')>(), workspace: mocks.workspace}));
vi.mock('@/lib/api', async importOriginal => ({...await importOriginal<typeof import('../src/lib/api')>(), request: mocks.request}));
vi.mock('@/workspace/market', () => ({useQuotes: () => ({quotes: [], loading: false, reason: 'fixture_unavailable'})}));
vi.mock('@/workspace/preferences', () => ({usePrefs: () => ({value: {...defaults, history_enabled: true}, text: (ko: string) => ko, date: (value: string | null) => value ?? '확인 전'})}));

const companyId = '20000000-0000-4000-8000-000000000001';
const eventId = '30000000-0000-4000-8000-000000000001';
const filingId = '40000000-0000-4000-8000-000000000001';
const company: Resource = {id: companyId, kind: 'company', title: 'Synthetic Corporation', summary: '', company_id: companyId, company_name: 'Synthetic Corporation', ticker: 'TEST', market: 'NASDAQ', source_url: null, published_at: null, publication_precision: 'timestamp', category: 'company', is_saved: false};
const event: Resource = {...company, id: eventId, kind: 'event', title: 'Synthetic reviewed event', summary: 'Synthetic evidence summary', published_at: '2026-10-01T00:00:00Z', category: 'earnings'};
const filing: Resource = {...company, id: filingId, kind: 'filing', title: 'Synthetic original filing', category: '10-K', published_at: '2026-10-01T00:00:00Z', publication_precision: 'date', source_url: 'https://www.sec.gov/Archives/synthetic-fixture.htm'};
let searches = [{query: 'TEST', searched_at: '2026-10-01T00:00:00Z'}, {query: '10-K', searched_at: '2026-10-01T00:00:00Z'}];
let eventSaved = false;

beforeEach(() => {
  vi.clearAllMocks();
  searches = [{query: 'TEST', searched_at: '2026-10-01T00:00:00Z'}, {query: '10-K', searched_at: '2026-10-01T00:00:00Z'}];
  eventSaved = false;
  mocks.workspace.mockImplementation(async (_token, req) => {
    if (req.action === 'catalog') {
      const items = [company, {...event, is_saved: eventSaved}, filing].filter(item => !req.p.kind || item.kind === req.p.kind || req.p.kind === 'document' && item.kind === 'filing');
      return {items: items.slice(0, req.p.limit), total: items.length, counts: {company: 1, event: 1, filing: 1}, markets: ['NASDAQ'], next_offset: null};
    }
    if (req.action === 'company') return {company, events: [{...event, is_saved: eventSaved}], documents: [filing], facts: [], watching: true, holding: true};
    if (req.action === 'searches') return [...searches];
    if (req.action === 'search_delete') {searches = searches.filter(item => item.query !== req.p.query); return {deleted: true};}
    if (req.action === 'searches_clear') {searches = []; return {cleared: true};}
    if (req.action === 'save') {eventSaved = req.p.saved; return {saved: eventSaved};}
    return {recorded: true};
  });
  mocks.request.mockImplementation(async (path, _token, _schema, options) => {
    if (path === '/v1/portfolio') return {positions: [{company: {id: companyId}, quantity: '1E+3', average_cost: '1.234567890123456789E+19', currency: 'JPY'}]};
    if (options?.method === 'PUT') return undefined;
    throw new Error('unexpected_fixture_request');
  });
  HTMLDialogElement.prototype.showModal = function () {this.setAttribute('open', '');};
});
afterEach(cleanup);

describe('mobile exploration and search connections', () => {
  it('deletes one recent search and clears searches without deleting visits', async () => {
    render(<MobileExplore/>);
    fireEvent.click(await screen.findByRole('button', {name: 'TEST 검색 기록 삭제'}));
    await waitFor(() => expect(screen.queryByRole('button', {name: 'TEST 검색 기록 삭제'})).toBeNull());
    expect(mocks.workspace).toHaveBeenCalledWith('isolated-fixture-token', {action: 'search_delete', p: {query: 'TEST'}}, expect.anything());
    fireEvent.click(screen.getByRole('button', {name: '전체 삭제'}));
    await screen.findByText('최근 검색어가 없습니다');
    expect(mocks.workspace.mock.calls.some(([, req]) => req.action === 'searches_clear')).toBe(true);
    expect(mocks.workspace.mock.calls.some(([, req]) => req.action === 'history_clear')).toBe(false);
  });

  it('shows each result category even when the overall first result is a company', async () => {
    render(<MobileSearchResults initial="TEST" initialKind="" initialDays={30}/>);
    expect((await screen.findByRole('link', {name: /Synthetic reviewed event/})).getAttribute('href')).toBe(`/events/${eventId}`);
    expect(screen.getByRole('link', {name: /Synthetic original filing/}).getAttribute('href')).toBe(`/documents/${filingId}?kind=filing`);
    const tabs = screen.getByRole('navigation', {name: '검색 결과 유형'});
    fireEvent.click(within(tabs).getByRole('button', {name: '문서'}));
    const params = new URL(mocks.push.mock.calls.at(-1)?.[0], 'https://signalbrief.example').searchParams;
    expect(params.get('q')).toBe('TEST');
    expect(params.get('kind')).toBe('document');
    expect(params.get('days')).toBe('30');
    fireEvent.change(screen.getByLabelText('시장 필터'), {target: {value: 'NASDAQ'}});
    const filtered = new URL(mocks.push.mock.calls.at(-1)?.[0], 'https://signalbrief.example').searchParams;
    expect(filtered.get('market')).toBe('NASDAQ');
    expect(filtered.get('q')).toBe('TEST');
  });
});

describe('mobile company persisted actions', () => {
  it('prefills an existing holding without losing decimal precision or changing currency', async () => {
    render(<MobileCompany id={companyId}/>);
    fireEvent.click(await screen.findByRole('button', {name: '보유 정보 수정'}));
    const quantity = await screen.findByLabelText('보유 수량') as HTMLInputElement;
    expect(quantity.value).toBe('1000');
    expect((screen.getByLabelText('평균 단가 (선택)') as HTMLInputElement).value).toBe('12345678901234567890');
    expect((screen.getByLabelText('취득가 통화') as HTMLSelectElement).value).toBe('JPY');
    fireEvent.click(screen.getByRole('button', {name: '저장'}));
    await waitFor(() => expect(mocks.request.mock.calls.some(([path, , , options]) => path.endsWith(`/positions/${companyId}`) && options?.method === 'PUT')).toBe(true));
    const saved = mocks.request.mock.calls.find(([path, , , options]) => path.endsWith(`/positions/${companyId}`) && options?.method === 'PUT');
    expect(JSON.parse(saved?.[3].body)).toEqual({quantity: '1000', average_cost: '12345678901234567890', currency: 'JPY'});
  });

  it('blocks saving when existing holdings cannot be loaded, and retries the read', async () => {
    mocks.request.mockRejectedValueOnce(new Error('보유 정보를 불러오지 못했습니다.'));
    render(<MobileCompany id={companyId}/>);
    fireEvent.click(await screen.findByRole('button', {name: '보유 정보 수정'}));
    await screen.findByRole('alert');
    expect(screen.queryByLabelText('보유 수량')).toBeNull();
    fireEvent.click(screen.getByRole('button', {name: '다시 시도'}));
    await screen.findByLabelText('보유 수량');
    expect(mocks.request.mock.calls.filter(([path]) => path === '/v1/portfolio')).toHaveLength(2);
  });

  it('persists monitoring checkboxes as source-event bookmarks', async () => {
    render(<MobileCompany id={companyId}/>);
    const checkbox = await screen.findByRole('checkbox', {name: 'Synthetic reviewed event 저장'});
    expect(checkbox.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(checkbox);
    await waitFor(() => expect(checkbox.getAttribute('aria-checked')).toBe('true'));
    expect(mocks.workspace).toHaveBeenCalledWith('isolated-fixture-token', {action: 'save', p: {kind: 'event', id: eventId, saved: true}}, expect.anything());
    fireEvent.click(checkbox);
    await waitFor(() => expect(checkbox.getAttribute('aria-checked')).toBe('false'));
  });
});
