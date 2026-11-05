// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), rpc: vi.fn(), createClient: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }));
import { POST } from '../src/app/api/admin/overview/route';
import type { AdminOverviewResponse } from '../src/admin-logs/overview-contracts';

const stamp = '2026-11-05T01:00:00Z';
const filters = { from: '2026-11-01', to: '2026-11-05', include_admin: false };
const empty: AdminOverviewResponse = {
  ...filters, timezone: 'Asia/Seoul', retention_days: 90, generated_at: stamp,
  coverage: { product_scope: 'consented_signed_in_users', first_available_event_at: null,
    consented_users: 0, eligible_users: 0, retention_basis: 'first_observed_view_in_retained_history',
    retention_observed_until: stamp, signup_status: 'not_instrumented', session_timeout_minutes: 30 },
  summary: { visitors: 0, page_views: 0, active_users: 0, sessions: 0, active_ms: 0,
    average_active_ms: null, signup_conversion: null,
    activation: { completed: 0, eligible: 0, rate: null, basis: 'new_profiles_current_onboarding', as_of: stamp },
    core_feature_users: 0, core_feature_rate: null, ended_sessions: 0 },
  retention: [{ day: 1, returned: 0, eligible: 0, pending: 0, rate: null },
    { day: 7, returned: 0, eligible: 0, pending: 0, rate: null }],
  days: [], features: [], pages: [],
  api: { scope: 'signalbrief_api_completed_requests', includes_admin: true, retention_days: 30,
    coverage_from: '2026-10-31T15:00:00Z', coverage_to: stamp, requests: 0, errors: 0,
    error_rate: null, mean_latency_ms: null, last_seen: null, recent_error_hours: [] },
};

function rawRequest(body: string, headers: Record<string, string> = {}) {
  return new Request('https://signalbrief.test/api/admin/overview', { method: 'POST',
    headers: { Authorization: 'Bearer isolated-test-token-value', 'Content-Type': 'application/json', ...headers }, body });
}
function request(body: unknown = filters, headers: Record<string, string> = {}) {
  return rawRequest(JSON.stringify(body), headers);
}
async function expectFailure(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('pragma')).toBe('no-cache');
  expect(response.headers.get('vary')).toBe('Authorization');
  const body = await response.json();
  expect(body).toEqual({ error: { code }, request_id: expect.any(String) });
  expect(body.request_id).toBe(response.headers.get('x-request-id'));
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'sb_publishable_test');
  mocks.createClient.mockReturnValue({ auth: { getUser: mocks.getUser }, rpc: mocks.rpc });
  mocks.getUser.mockResolvedValue({ data: { user: { id: 'admin-user', email_confirmed_at: '2026-01-01T00:00:00Z' } }, error: null });
  mocks.rpc.mockImplementation(async (name: string) => ({ data: name === 'sb_is_admin' ? true : empty, error: null }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('POST /api/admin/overview', () => {
  it('returns validated empty data with safe uncached headers and permission checks', async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(empty);
    expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('pragma')).toBe('no-cache');
    expect(response.headers.get('vary')).toBe('Authorization');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('x-request-id')).toBeTruthy();
    expect(mocks.getUser).toHaveBeenCalledOnce();
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual(['sb_is_admin', 'sb_admin_overview']);
    expect(mocks.rpc).toHaveBeenLastCalledWith('sb_admin_overview', { p: filters });
  });
  it.each(['', 'Basic isolated-test-token-value', 'Bearer short', 'Bearer valid-looking-token with spaces', `Bearer ${'a'.repeat(8193)}`])(
    'rejects malformed authorization before network %s', async (authorization) => {
      await expectFailure(await POST(request(filters, { Authorization: authorization })), 401, 'authentication_required');
      expect(mocks.createClient).not.toHaveBeenCalled();
    });
  it('checks exact origin', async () => {
    await expectFailure(await POST(request(filters, { Origin: 'https://other.test' })), 403, 'origin_not_allowed');
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect((await POST(request(filters, { Origin: 'https://signalbrief.test' }))).status).toBe(200);
  });
  it.each([false, null, 1, 'true'])('requires literal true admin permission %s', async (allowed) => {
    mocks.rpc.mockResolvedValueOnce({ data: allowed, error: null });
    await expectFailure(await POST(request()), 403, 'admin_required');
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it('denies unverified accounts', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'unverified' } }, error: null });
    await expectFailure(await POST(request()), 403, 'verified_account_required');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([{ data: { user: null }, error: null }, { data: { user: null }, error: { status: 401, message: 'private expired token details' } }])(
    'rejects missing and expired sessions', async (result) => {
      mocks.getUser.mockResolvedValue(result);
      await expectFailure(await POST(request()), 401, 'invalid_or_expired_session');
      expect(mocks.rpc).not.toHaveBeenCalled();
    });
  it.each([
    [{ status: 503, message: 'private auth outage' }, 503, 'authentication_unavailable'],
    [{ status: 400, name: 'AuthRetryableFetchError', message: 'private connection details' }, 503, 'authentication_unavailable'],
    [{ status: 429, message: 'private quota details' }, 429, 'rate_limit_exceeded'],
  ] as const)('maps authentication errors safely', async (error, status, code) => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error });
    const response = await POST(request());
    if (status === 429) expect(response.headers.get('retry-after')).toBe('30');
    await expectFailure(response, status, code);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([
    [{ code: 'PT403', message: 'mfa_required' }, 403, 'mfa_required'],
    [{ code: 'PGRST301', message: 'private expired JWT' }, 401, 'invalid_or_expired_session'],
    [{ code: 'PGRST303', message: 'private expired JWT' }, 401, 'invalid_or_expired_session'],
    [{ code: 'PT401', message: 'private revoked session' }, 401, 'invalid_or_expired_session'],
    [{ code: 'PT429', message: 'private rate limit' }, 429, 'rate_limit_exceeded'],
    [{ code: 'XX000', message: 'private database details' }, 503, 'permission_check_unavailable'],
  ] as const)('denies safely when permission RPC fails', async (error, status, code) => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error });
    await expectFailure(await POST(request()), status, code);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it.each([
    [{ code: 'PT401', message: 'session_revoked' }, 401, 'session_revoked'],
    [{ code: 'PT403', message: 'mfa_required' }, 403, 'mfa_required'],
    [{ code: 'PT422', message: 'invalid_date_range' }, 422, 'invalid_date_range'],
    [{ code: 'PT429', message: 'rate_limit_exceeded' }, 429, 'rate_limit_exceeded'],
    [{ code: '42501', message: 'secret table ownership details' }, 403, 'admin_required'],
    [{ code: 'PGRST303', message: 'private JWT error' }, 401, 'invalid_or_expired_session'],
    [{ code: 'PT422', message: 'private rejected payload' }, 422, 'invalid_input'],
    [{ code: 'XX000', message: 'secret SQL and internal trace', details: 'private payload', hint: 'private hostname' }, 503, 'overview_unavailable'],
  ] as const)('scrubs aggregate RPC failures', async (error, status, code) => {
    mocks.rpc.mockResolvedValueOnce({ data: true, error: null }).mockResolvedValueOnce({ data: null, error });
    const response = await POST(request());
    if (status === 429) expect(response.headers.get('retry-after')).toBe('30');
    await expectFailure(response, status, code);
  });
  it.each([
    { ...filters, from: '2026-02-30' }, { ...filters, to: 'not-a-date' },
    { ...filters, from: '2026-11-06' }, { ...filters, from: '2026-08-07' },
    { from: filters.from, to: filters.to }, { ...filters, include_admin: 'false' },
    { ...filters, user_id: 'private-user' }, { ...filters, screen: 'settings' },
    { ...filters, event: 'brief_opened' }, { ...filters, device: 'mobile' }, { ...filters, role: 'admin' },
  ])('rejects invalid ranges and unknown filters before network', async (body) => {
    await expectFailure(await POST(request(body)), 422, 'invalid_input');
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
  it('accepts inclusive 90 days and product admin choice', async () => {
    const boundary = { from: '2026-08-08', to: '2026-11-05', include_admin: true };
    mocks.rpc.mockResolvedValueOnce({ data: true, error: null }).mockResolvedValueOnce({ data: { ...empty, ...boundary }, error: null });
    expect((await POST(request(boundary))).status).toBe(200);
    expect(mocks.rpc).toHaveBeenLastCalledWith('sb_admin_overview', { p: boundary });
  });
  it('rejects invalid JSON and non-JSON media types', async () => {
    await expectFailure(await POST(rawRequest('{"from":')), 422, 'invalid_input');
    await expectFailure(await POST(request(filters, { 'Content-Type': 'text/plain' })), 415, 'json_required');
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
  it('enforces declared and actual UTF-8 byte limits', async () => {
    await expectFailure(await POST(request(filters, { 'Content-Length': '4097' })), 413, 'body_too_large');
    await expectFailure(await POST(rawRequest(JSON.stringify({ ...filters, text: '가'.repeat(1500) }))), 413, 'body_too_large');
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
  it.each(['', 'http://project.supabase.co', 'https://project.supabase.co.evil.test',
    'https://project.supabase.co/rest/v1', 'https://project.supabase.co?secret=value',
    'https://project.supabase.co#fragment', 'https://user:password@project.supabase.co', 'https://project.supabase.co:8443'])(
    'rejects unsafe or missing public Supabase URL %s', async (url) => {
      vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', url);
      await expectFailure(await POST(request()), 503, 'overview_configuration_missing');
      expect(mocks.createClient).not.toHaveBeenCalled();
    });
  it.each(['', 'sb_secret_sensitive', 'arbitrary-key',
    `header.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.signature`])(
    'refuses secret/service/missing keys', async (key) => {
      vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', key);
      await expectFailure(await POST(request()), 503, 'overview_configuration_missing');
      expect(mocks.createClient).not.toHaveBeenCalled();
    });
  it('uses public anon key, caller bearer, and shared bounded uncached transport', async () => {
    const anonKey = `header.${Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url')}.signature`;
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', anonKey);
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    expect((await POST(request())).status).toBe(200);
    const [url, key, options] = mocks.createClient.mock.calls[0];
    expect(url).toBe('https://project.supabase.co');
    expect(key).toBe(anonKey);
    expect(options.auth).toEqual({ persistSession: false, autoRefreshToken: false });
    expect(options.global.headers.Authorization).toBe('Bearer isolated-test-token-value');
    expect(timeoutSpy).toHaveBeenCalledWith(20_000);
    await options.global.fetch('https://project.supabase.co/auth/v1/user', { method: 'GET', cache: 'force-cache', redirect: 'follow' });
    await options.global.fetch('https://project.supabase.co/rest/v1/rpc/sb_admin_overview', { method: 'POST' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [, transportOptions] of fetchMock.mock.calls) {
      expect(transportOptions).toMatchObject({ cache: 'no-store', redirect: 'error' });
      expect(transportOptions.signal).toBeInstanceOf(AbortSignal);
    }
    expect(fetchMock.mock.calls[0][1].signal).toBe(fetchMock.mock.calls[1][1].signal);
  });
  it.each([
    { ...empty, private_payload: 'private text' },
    { ...empty, summary: { ...empty.summary, email: 'private@example.test' } },
    { ...empty, api: { ...empty.api, recent_error_hours: [{ hour: stamp, requests: 1, errors: 1, error_rate: 1, message: 'private message' }] } },
    { ...empty, api: { ...empty.api, requests: 10, errors: 2, error_rate: 0.9 } },
    { ...empty, retention: [empty.retention[0], empty.retention[0]] },
    { ...empty, summary: { ...empty.summary, activation: { ...empty.summary.activation, as_of: '2026-11-04T01:00:00Z' } } },
    null,
  ])('fails closed on malformed/overbroad response without leaks', async (data) => {
    mocks.rpc.mockResolvedValueOnce({ data: true, error: null }).mockResolvedValueOnce({ data, error: null });
    await expectFailure(await POST(request()), 502, 'invalid_overview_response');
  });
  it('scrubs unexpected thrown failures', async () => {
    mocks.getUser.mockRejectedValue(new Error('secret environment values and raw user text'));
    await expectFailure(await POST(request()), 503, 'overview_unavailable');
  });
});
