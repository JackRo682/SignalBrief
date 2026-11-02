import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CompanyProfile from '../src/components/company-profile';
import CompanyDetail from '../src/redesign/company';
import { CompanyProfileEvidence } from '../src/components/company-profile-evidence';
import { useOfficialCompanyProfile } from '../src/components/use-company-profile';
import { useCompanyFinancials } from '../src/components/use-company-financials';
import { CompanyFinancials, CompanyAnalysisStatus } from '../src/components/company-financials';
import { companyProfileSchema } from '../src/lib/company-profile-contract';
import { companyFinancialsSchema } from '../src/lib/company-financials-contract';
import { defaults } from '../src/workspace/contracts';
import { pageDataCache } from '../src/lib/page-data-cache';

const mocks = vi.hoisted(() => ({ token: 'synthetic-company-data-session', workspace: vi.fn(), coverage: vi.fn() }));
vi.mock('@/components/auth', () => ({ useAuth: () => ({ token: mocks.token }) }));
vi.mock('@/workspace/preferences', () => ({ usePrefs: () => ({ value: { ...defaults, locale: 'en' }, text: (_ko: string, en: string) => en, date: (value: string | null) => value ?? 'Not available' }) }));
vi.mock('@/workspace/client', () => ({ workspace: (...args: unknown[]) => mocks.workspace(...args) }));
vi.mock('@/lib/supabase', () => ({ initializeSupabase: async () => ({ rpc: () => ({ abortSignal: mocks.coverage }) }) }));
const id = '20000000-0000-4000-8000-000000000001', otherId = '20000000-0000-4000-8000-000000000002';
const sha = 'a'.repeat(64), timestamp = '2026-11-02T00:00:00Z';
const source = { id: 'official-annual', provider: 'SEC EDGAR', source_url: 'https://www.sec.gov/Archives/synthetic/annual.htm', source_sha256: sha,
  fetched_at: timestamp, published_on: '2026-10-01', publication_precision: 'date', report_period: '2026-09-30', form_type: '10-K', title: 'Synthetic annual report', normalization: 'profile-visible-text-v1' };
const evidence = { source_id: source.id, quote: 'Synthetic exact source statement.', location: { kind: 'normalized_text', start: 100, end: 133, section: 'Business' } };
const enrichment = { schema: 'signalbrief.company-profile.v1', company_id: id, status: 'ready', checked_at: timestamp, next_refresh_at: '2026-11-03T00:00:00Z',
  sources: [source], leadership: [{ name: 'Synthetic Leader', role: 'Chief Executive Officer', as_of: '2026-10-01', basis: 'filing', evidence }],
  formation: [{ kind: 'incorporated', date: '2007', precision: 'year', evidence }],
  business: [{ text: 'Synthetic company provides verified payment services.', evidence }],
  products: [{ name: 'Synthetic product', description: 'Source-backed product description.', evidence }],
  segments: [{ name: 'Synthetic reportable segment', description: null, evidence }], limitations: [], last_error: null };
const profile = { status: 'verified', provider: 'SEC EDGAR', fetched_at: timestamp, source_url: source.source_url,
  profile: { corp_code: '0000000001', ticker: 'TEST', name: 'Synthetic company', english_name: null, ceo: null,
    address: null, website: null, established_on: null, industry_code: '1234', fiscal_month: '09' }, enrichment };
const fact = { metric: 'revenue', taxonomy: 'us-gaap', concept: 'Revenues', label: 'Synthetic revenue', value_raw: '9007199254740993.120000', unit: 'USD',
  period_start: '2026-01-01', period_end: '2026-03-31', period_label: '2026-01-01 — 2026-03-31', period_kind: 'duration',
  fiscal_year: 2026, fiscal_period: 'Q1', form: '10-Q', accession: '0000000001-26-000001', filed_on: '2026-04-29',
  basis: 'reported', scope: 'entity', accounting_standard: 'US-GAAP', source_url: 'https://data.sec.gov/api/xbrl/companyfacts/CIK0000000001.json',
  source_quote: '{"val":9007199254740993.120000,"end":"2026-03-31"}', location: '/facts/us-gaap/Revenues/units/USD/0', raw_sha256: sha };
const financials = { company_id: id, provider: 'sec', status: 'ready', last_success_at: timestamp, error_code: null,
  source: { url: fact.source_url, raw_sha256: sha, fetched_at: timestamp }, items: [fact],
  analysis: { status: 'pending_review', approved: 0, pending_review: 1, error_code: null } };
const company = { id, kind: 'company', title: 'Synthetic company', summary: '', company_id: id, company_name: 'Synthetic company', ticker: 'TEST', market: 'NYSE',
  source_url: null, published_at: null, publication_precision: 'date', category: 'company', is_saved: false };
beforeEach(() => {
  mocks.token = 'synthetic-company-data-session'; vi.clearAllMocks(); pageDataCache.reset(); window.history.replaceState({}, '', '/');
  mocks.workspace.mockImplementation(async (_token, request) => request.action === 'company'
    ? { company, documents: [], analyses: [], events: [], facts: [], watching: false, holding: false }
    : { calendar: [], historical_calendar: [] });
  mocks.coverage.mockResolvedValue({ error: null, data: { registered_companies: 1, covered_companies: 1, pending_companies: 0,
    pending_company_ids: [], selected: { company_id: id, source_count: 1, last_success_at: timestamp, has_error: false, pending: false } } });
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => {
    if (url.startsWith('/api/company-profile')) return Response.json(profile);
    if (url.startsWith('/api/us/company-financials')) return Response.json(financials);
    throw new Error('unexpected_test_request');
  }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('source-bound company profile', () => {
  it('waits for a shared in-progress profile collection and stops after success', async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ ...profile, enrichment: { ...enrichment, status: 'unavailable', sources: [],
      leadership: [], formation: [], business: [], products: [], segments: [], last_error: 'profile_refresh_in_progress' } }));
    const { result } = renderHook(() => useOfficialCompanyProfile(id, 'TEST'));
    await act(async () => { await vi.advanceTimersByTimeAsync(1); }); expect(result.current.loading).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(result.current.data?.enrichment?.business).toHaveLength(1); expect(result.current.loading).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(20000); }); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('fills leadership with an as-of date and preserves year-only incorporation precision', async () => {
    render(<CompanyProfile id={id} ticker="TEST" />);
    expect(await screen.findByText('Synthetic Leader')).toBeVisible();
    expect(screen.getByText(/As of: 2026-10-01/)).toBeVisible();
    expect(screen.getByText('Incorporated: 2007')).toBeVisible();
    expect(screen.queryByText(/2007-01-01|Founded: 2007/)).toBeNull();
    expect(screen.queryByText('Not supplied by this source')).toBeNull();
  });
  it('rejects orphan citations and a precision that pads an unknown date', () => {
    expect(companyProfileSchema.safeParse({ ...profile, enrichment: { ...enrichment, sources: [] } }).success).toBe(false);
    expect(companyProfileSchema.safeParse({ ...profile, enrichment: { ...enrichment, formation: [{ ...enrichment.formation[0], date: '2007-01-01' }] } }).success).toBe(false);
  });
  it('requires the normalized DART archive hash and shows recovered-source limitations before expansion', () => {
    const dartSource = { ...source, provider: 'OpenDART', normalization: 'dart-periodic-recovered-text-v1' };
    expect(companyProfileSchema.safeParse({ ...profile, enrichment: { ...enrichment, sources: [dartSource] } }).success).toBe(false);
    const parsed = companyProfileSchema.parse({ ...profile, enrichment: { ...enrichment, sources: [{ ...dartSource, normalized_sha256: sha }] } });
    render(<CompanyProfileEvidence enrichment={parsed.enrichment!} evidence={parsed.enrichment!.business[0].evidence} />);
    expect(screen.getByText(/This excerpt was recovered from the original markup/)).toBeVisible();
    expect(screen.getByText(evidence.quote)).not.toBeVisible();
  });
  it('rejects enriched facts belonging to a different company', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ ...profile, enrichment: { ...enrichment, company_id: otherId } }));
    const { result } = renderHook(() => useOfficialCompanyProfile(id, 'TEST'));
    await waitFor(() => expect(result.current.error).toBe(true));
    expect(result.current.data).toBeNull();
  });
  it('does not fetch a second copy when the parent supplies the shared result', () => {
    render(<CompanyProfile id={id} ticker="TEST" remote={{ data: companyProfileSchema.parse(profile), error: false, loading: false, status: 200, retry: vi.fn() }} />);
    expect(screen.getByText('Synthetic Leader')).toBeVisible(); expect(fetch).not.toHaveBeenCalled();
  });
});

describe('reported financial values and collection lifecycle', () => {
  it('retains exact decimals, the older reported period and review status', () => {
    const remote = { data: companyFinancialsSchema.parse(financials), error: false, loading: false, polling: false, retry: vi.fn() };
    render(<><CompanyFinancials remote={remote} /><CompanyAnalysisStatus remote={remote} hasApproved={false} /></>);
    expect(screen.getByText('9,007,199,254,740,993.120000 USD')).toBeVisible();
    expect(screen.getByText(fact.period_label)).toBeVisible();
    expect(screen.getByText(/Filed: 2026-04-29/)).toBeVisible();
    expect(screen.getByText(/1 analyses are awaiting evidence review/)).toBeVisible();
    expect(screen.queryByText(/approved analysis|complete reports/i)).toBeNull();
  });
  it('rejects figures without the matching archived source', () => {
    expect(companyFinancialsSchema.safeParse({ ...financials, source: null }).success).toBe(false);
    expect(companyFinancialsSchema.safeParse({ ...financials, items: [{ ...fact, raw_sha256: 'b'.repeat(64) }] }).success).toBe(false);
  });
  it('activates once with the canonical id and then polls with GET only', async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ ...financials, status: 'pending', items: [], source: null,
      analysis: { ...financials.analysis, status: 'collecting', pending_review: 0 } }));
    const { result } = renderHook(() => useCompanyFinancials(id, true));
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(result.current.polling).toBe(true);
    expect(fetch).toHaveBeenCalledWith('/api/us/company-financials', expect.objectContaining({ method: 'POST', body: JSON.stringify({ company_id: id }), credentials: 'omit' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(fetch).toHaveBeenLastCalledWith(`/api/us/company-financials?company_id=${id}`, expect.objectContaining({ method: 'GET' }));
    expect(result.current.data?.items).toHaveLength(1); expect(result.current.polling).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); }); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('clears the previous account data immediately and aborts obsolete requests', async () => {
    const { result, rerender } = renderHook(() => useCompanyFinancials(id, true));
    await waitFor(() => expect(result.current.data?.items.length).toBe(1));
    const signal = vi.mocked(fetch).mock.calls[0][1]?.signal;
    mocks.token = 'different-synthetic-session'; vi.mocked(fetch).mockImplementationOnce(() => new Promise(() => {})); rerender();
    expect(result.current.data).toBeNull(); expect(signal?.aborted).toBe(true);
  });
  it('fails closed for a different issuer and exposes a recoverable error', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ ...financials, company_id: otherId }));
    const { result } = renderHook(() => useCompanyFinancials(id, true));
    await waitFor(() => expect(result.current.error).toBe(true)); expect(result.current.data).toBeNull();
    act(() => result.current.retry()); await waitFor(() => expect(result.current.data?.company_id).toBe(id));
  });
});

describe('company detail integration', () => {
  it('reloads an initially empty list when approval arrives instead of hiding both the list and status', async () => {
    vi.mocked(fetch).mockImplementation(async (url) => Response.json(String(url).startsWith('/api/company-profile') ? profile : {
      ...financials, analysis: { status: 'approved', approved: 1, pending_review: 0, error_code: null },
    }));
    window.history.replaceState({}, '', `/companies/${id}?tab=analyses`);
    render(<CompanyDetail id={id} />);
    expect(await screen.findByText('Loading the approved analysis list.')).toBeVisible();
    await waitFor(() => expect(mocks.workspace.mock.calls.filter(([, request]) => request.action === 'company')).toHaveLength(2));
  });
  it('fills every source-backed section for a company absent from the curated ticker dictionary', async () => {
    render(<CompanyDetail id={id} />);
    expect(await screen.findByText(enrichment.business[0].text)).toBeVisible();
    expect(screen.getByText(enrichment.products[0].name)).toBeVisible();
    expect(screen.getByText(enrichment.segments[0].name)).toBeVisible();
    expect(screen.getByText('Synthetic Leader')).toBeVisible();
    expect(screen.getByText('9,007,199,254,740,993.120000 USD')).toBeVisible();
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).startsWith('/api/company-profile'))).toHaveLength(1);
    fireEvent.click(screen.getByRole('tab', { name: 'Analyses' }));
    expect(screen.getByText(/awaiting evidence review/)).toBeVisible();
    expect(screen.queryByText(/not analyses of the complete reports/)).toBeNull();
  });
  it('refreshes company event lists when a pending official collection finishes', async () => {
    vi.useFakeTimers(); window.history.replaceState({}, '', `/companies/${id}?tab=events`);
    mocks.coverage.mockResolvedValueOnce({ error: null, data: { registered_companies: 1, covered_companies: 0, pending_companies: 1,
      pending_company_ids: [id], selected: { company_id: id, source_count: 1, last_success_at: null, has_error: false, pending: true } } });
    render(<CompanyDetail id={id} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(screen.getByText(/Collecting official events/)).toBeVisible();
    const before = mocks.workspace.mock.calls.filter(([, request]) => request.action === 'source_overview').length;
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(mocks.workspace.mock.calls.filter(([, request]) => request.action === 'source_overview').length).toBeGreaterThan(before);
    expect(screen.queryByText(/Collecting official events/)).toBeNull();
  });
});
