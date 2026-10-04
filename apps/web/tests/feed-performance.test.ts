import { afterEach, describe, it, expect, vi } from 'vitest';
import { mountReference, type ReferenceContext } from '../src/reference/controller';
import { templates } from '../src/reference/templates';

const company = { id: 'company-1', name: 'Synthetic company', ticker: 'TEST', market: 'NASDAQ' };
const event = { id: 'event-1', company, headline: 'Verified change', what_happened: 'Summary', published_at: new Date().toISOString(),
  fact_summary: 'Persisted quote', change_summary: [{ field: 'revenue', previous_value: '10', current_value: '12' }],
  interpretation: 'Reviewed meaning', source_document: { id: 'doc-1', title: 'Original document', source_url: 'https://example.com/filing' }, ranking: {} };
let cleanup: (() => void) | undefined;
afterEach(() => { cleanup?.(); document.body.innerHTML = ''; });
function mount(screen: 'today' | 'timeline', api: ReferenceContext['api']) {
  const root = document.createElement('div'); document.body.append(root); root.innerHTML = templates[screen];
  cleanup = mountReference(root, screen, { user: { is_admin: false }, id: 'company-1', demo: true, api,
    rpc: vi.fn(), auth: vi.fn(), go: vi.fn(), download: vi.fn() });
  return root;
}
describe('primary content before secondary widgets', () => {
  it('renders Today without awaiting calendar, portfolio, market, or event-detail requests', async () => {
    let releaseMarket!: (value: unknown) => void;
    const market = new Promise(resolve => { releaseMarket = resolve; });
    const api = vi.fn((path: string) => {
      if (path.startsWith('/v1/feed')) return Promise.resolve({ items: [event], total: 1 });
      if (path.startsWith('/market')) return market;
      return new Promise(() => {});
    });
    const root = mount('today', api);
    await vi.waitFor(() => expect(root.querySelector('.todayItem')?.textContent).toContain('Persisted quote'));
    expect(root.querySelector('.todayItem')?.textContent).toContain('Reviewed meaning');
    expect(root.querySelector('.todayItem')?.textContent).toContain('10 → 12');
    expect(api.mock.calls.some(([path]) => path.startsWith('/v1/events/'))).toBe(false);
    releaseMarket({ quotes: [{ symbol: 'TEST', price: 25, currency: 'USD', history: [20, 25] }] });
    await vi.waitFor(() => expect(root.querySelector('[data-today-market]')?.textContent).toContain('25'));
  });
  it('renders Timeline and its source links before the market request finishes', async () => {
    const api = vi.fn((path: string) => {
      if (path.startsWith('/v1/companies?')) return Promise.resolve([company]);
      if (path.includes('/timeline?')) return Promise.resolve([event]);
      return new Promise(() => {});
    });
    const root = mount('timeline', api);
    await vi.waitFor(() => expect(root.querySelector('.tlItem')?.textContent).toContain('Reviewed meaning'));
    expect(root.querySelector('#reports')?.textContent).toContain('Original document');
    expect(api.mock.calls.some(([path]) => path.startsWith('/v1/events/'))).toBe(false);
  });
});
