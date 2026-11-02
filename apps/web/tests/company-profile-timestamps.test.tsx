import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useOfficialCompanyProfile } from '../src/components/use-company-profile';
import { companyProfileSchema } from '../src/lib/company-profile-contract';

vi.mock('@/components/auth', () => ({ useAuth: () => ({ token: 'synthetic-profile-timestamp-session' }) }));
const id = '20000000-0000-4000-8000-000000000001';
const utc = '2026-11-02T05:21:48.272366Z';
const sqlOffset = '2026-11-02T05:21:48.272366+00:00';
const sha = 'a'.repeat(64);
function response(timestamp = sqlOffset) {
  const quote = 'Synthetic company provides payment services.';
  const evidence = { source_id: sha, quote,
    location: { kind: 'normalized_text', start: 0, end: quote.length, section: 'Business' } };
  return { status: 'verified', provider: 'SEC EDGAR', fetched_at: utc,
    profile: { corp_code: '0000000001', ticker: 'TEST', name: 'Synthetic company', english_name: null,
      ceo: null, address: null, website: null, established_on: null, industry_code: null, fiscal_month: null },
    enrichment: { schema: 'signalbrief.company-profile.v1', company_id: id, status: 'partial',
      checked_at: timestamp, next_refresh_at: timestamp,
      sources: [{ id: sha, provider: 'SEC EDGAR', source_url: 'https://www.sec.gov/Archives/synthetic/report.htm',
        source_sha256: sha, fetched_at: timestamp, published_on: '2026-10-01', publication_precision: 'date',
        report_period: '2026-09-30', form_type: '10-K', title: 'Synthetic filing', normalization: 'profile-visible-text-v1' }],
      leadership: [], formation: [], business: [{ text: evidence.quote, evidence }], products: [], segments: [],
      limitations: [], last_error: null as string | null } };
}
beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('fetch', vi.fn()); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('profile timestamps from PostgreSQL and Edge', () => {
  it.each([utc, sqlOffset, '2026-11-02T14:21:48.272366+09:00', '2026-11-01T23:51:48.272366-05:30'])(
    'accepts an explicit ISO8601 timezone without changing its value: %s', timestamp => {
      const parsed = companyProfileSchema.parse(response(timestamp));
      expect(parsed.enrichment?.checked_at).toBe(timestamp);
      expect(parsed.enrichment?.next_refresh_at).toBe(timestamp);
      expect(parsed.enrichment?.sources[0].fetched_at).toBe(timestamp);
    });

  it.each(['2026-11-02T05:21:48.272366', '2026-11-02', '2026-02-30T05:21:48+00:00',
    '2026-11-02T25:21:48+00:00', '2026-11-02T05:21:48+25:00', '2026-11-02T05:21:48+00:60',
    'not-a-date'])(
    'rejects invalid or timezone-free timestamps in every previously strict field: %s', timestamp => {
      for (const field of ['checked_at', 'next_refresh_at', 'source.fetched_at'] as const) {
        const value = response(utc);
        if (field === 'source.fetched_at') value.enrichment.sources[0].fetched_at = timestamp;
        else value.enrichment[field] = timestamp;
        expect(companyProfileSchema.safeParse(value).success, field).toBe(false);
      }
    });

  it('retains cached evidence with a SQL offset while polling the active refresh, then stops on success', async () => {
    const cached = response(utc);
    cached.enrichment.next_refresh_at = sqlOffset;
    cached.enrichment.last_error = 'profile_refresh_in_progress';
    const fresh = response('2026-11-03T05:21:48.272Z');
    fresh.enrichment.status = 'ready';
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(cached)).mockResolvedValueOnce(Response.json(fresh));
    const { result } = renderHook(() => useOfficialCompanyProfile(id, 'TEST'));
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(result.current.error).toBe(false);
    expect(result.current.data?.enrichment?.business).toHaveLength(1);
    expect(result.current.data?.enrichment?.next_refresh_at).toBe(sqlOffset);
    expect(result.current.loading).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(result.current.data?.enrichment?.status).toBe('ready');
    expect(result.current.status).toBe(200);
    expect(result.current.error).toBe(false);
    expect(result.current.loading).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('accepts the SQL failure snapshot as source-unavailable data, not a failed HTTP profile load', async () => {
    const failed = response();
    failed.enrichment.status = 'unavailable';
    failed.enrichment.sources = [];
    failed.enrichment.business = [];
    failed.enrichment.last_error = 'profile_source_unavailable';
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(failed));
    const { result } = renderHook(() => useOfficialCompanyProfile(id, 'TEST'));
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(result.current.error).toBe(false);
    expect(result.current.status).toBe(200);
    expect(result.current.data?.enrichment?.status).toBe('unavailable');
    expect(result.current.data?.enrichment?.last_error).toBe('profile_source_unavailable');
    expect(result.current.loading).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('still rejects a different company after accepting offset timestamps', async () => {
    const wrong = response();
    wrong.enrichment.company_id = '20000000-0000-4000-8000-000000000002';
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(wrong));
    const { result } = renderHook(() => useOfficialCompanyProfile(id, 'TEST'));
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(result.current.error).toBe(true);
    expect(result.current.data).toBeNull();
  });

  it('keeps orphan-evidence and unsafe-source URL checks for offset-bearing profiles', () => {
    const orphan = response(); orphan.enrichment.sources = [];
    expect(companyProfileSchema.safeParse(orphan).success).toBe(false);
    const unsafe = response(); unsafe.enrichment.sources[0].source_url = 'https://user:secret@example.test/report';
    expect(companyProfileSchema.safeParse(unsafe).success).toBe(false);
  });
});
