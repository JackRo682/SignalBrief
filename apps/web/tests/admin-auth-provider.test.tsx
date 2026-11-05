import '@testing-library/jest-dom/vitest';
import {act, cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {useEffect} from 'react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {AuthProvider, useAuth} from '../src/components/auth';
import {APIError, emptySchema} from '../src/lib/api';
import type {Me} from '../src/lib/contracts';
import {pageDataCache} from '../src/lib/page-data-cache';

const mock = vi.hoisted(() => ({
  runtime: vi.fn(), initialize: vi.fn(), getSession: vi.fn(), onAuthStateChange: vi.fn(),
  signOut: vi.fn(), signInWithOAuth: vi.fn(), unsubscribe: vi.fn(), request: vi.fn(),
}));
vi.mock('../src/lib/runtime-config', () => ({runtimeConfig: mock.runtime}));
vi.mock('../src/lib/supabase', () => ({
  initializeSupabase: mock.initialize,
  getSupabase: () => ({auth: {signOut: mock.signOut}}),
  resolvedPublicAuth: () => ({url: 'https://synthetic.supabase.co', key: 'sb_publishable_synthetic'}),
}));
vi.mock('../src/lib/api', async original => ({
  ...await original<typeof import('../src/lib/api')>(), API_URL: '/api', request: mock.request,
}));
vi.mock('../src/components/mfa-challenge', () => ({default: () => <p role="alert">MFA verification required</p>}));

const ADMIN_TOKEN = 'synthetic-admin-token';
const READER_TOKEN = 'synthetic-reader-token';
const admin: Me = {
  id: '10000000-0000-4000-8000-000000000001', display_name: 'Synthetic administrator',
  density: 'beginner', onboarding_completed: true, analytics_consent: false,
  is_admin: true, demo_mode: false,
};
const reader: Me = {...admin, id: '10000000-0000-4000-8000-000000000002', display_name: 'Synthetic reader', is_admin: false};
type AuthState = ReturnType<typeof useAuth>;
let current: AuthState;
let authListener: (event: string, session: {access_token: string} | null) => void;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((ok, fail) => {resolve = ok; reject = fail;});
  return {promise, resolve, reject};
}

function Probe() {
  const auth = useAuth();
  useEffect(() => {current = auth;}, [auth]);
  return <>
    <output aria-label="Auth state">{JSON.stringify({token: auth.token, me: auth.me, loading: auth.loading, error: auth.error})}</output>
    <button onClick={() => void auth.refresh().catch(() => {})}>Refresh identity</button>
    <button onClick={() => void auth.logout().catch(() => {})}>Sign out locally</button>
  </>;
}
function mount() {return render(<AuthProvider><Probe/></AuthProvider>);}
async function readyAdmin() {
  mount();
  await waitFor(() => expect(current.me).toEqual(admin));
  expect(current.loading).toBe(false);
}
async function emit(token: string | null, event = token ? 'SIGNED_IN' : 'SIGNED_OUT') {
  await act(async () => {authListener(event, token ? {access_token: token} : null);});
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  mock.runtime.mockResolvedValue({auth_mode: 'supabase', demo_mode: false, demo_admin_enabled: false});
  mock.getSession.mockResolvedValue({data: {session: {access_token: ADMIN_TOKEN}}, error: null});
  mock.onAuthStateChange.mockImplementation(listener => {
    authListener = listener;
    return {data: {subscription: {unsubscribe: mock.unsubscribe}}};
  });
  mock.initialize.mockResolvedValue({auth: {onAuthStateChange: mock.onAuthStateChange, getSession: mock.getSession, signOut: mock.signOut, signInWithOAuth: mock.signInWithOAuth}});
  mock.signOut.mockResolvedValue({error: null});
  mock.signInWithOAuth.mockResolvedValue({error: null});
  mock.request.mockImplementation(async (_path: string, token: string) => token === READER_TOKEN ? reader : admin);
});
afterEach(() => {cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs();});

describe('administrator authentication concurrency and recovery', () => {
  it.each(['/ops/user-logs', '/today'])('preserves the Google return path and offers account selection for administrator recovery: %s', async next => {
    vi.stubGlobal('location', {href: `https://signalbrief.online/login?next=${encodeURIComponent(next)}`, origin: 'https://signalbrief.online', hostname: 'signalbrief.online', assign: vi.fn()});
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://signalbrief.online');
    await readyAdmin();
    await act(async () => current.googleLogin());
    const adminReturn = next.startsWith('/ops/');
    expect(mock.signInWithOAuth).toHaveBeenCalledExactlyOnceWith({
      provider: 'google',
      options: {
        redirectTo: `https://signalbrief.online/auth/callback${adminReturn ? `?next=${encodeURIComponent(next)}` : ''}`,
        ...(adminReturn ? {queryParams: {prompt: 'select_account'}} : {}),
      },
    });
  });

  it('keeps loading active until the initial identity has been verified', async () => {
    const profile = deferred<Me>();
    mock.request.mockReturnValue(profile.promise);
    mount();
    await waitFor(() => expect(mock.request).toHaveBeenCalled());
    expect(current).toMatchObject({token: ADMIN_TOKEN, me: null, loading: true});
    await act(async () => profile.resolve(admin));
    expect(current).toMatchObject({me: admin, loading: false, error: null});
  });

  it('immediately removes the prior administrator identity when another account signs in', async () => {
    await readyAdmin();
    const next = deferred<Me>();
    mock.request.mockReturnValueOnce(next.promise);
    await emit(READER_TOKEN);
    expect(current).toMatchObject({token: READER_TOKEN, me: null, loading: true});
    expect(screen.getByLabelText('Auth state')).not.toHaveTextContent(admin.display_name);
    await act(async () => next.resolve(reader));
    expect(current).toMatchObject({token: READER_TOKEN, me: reader, loading: false});
  });

  it('does not apply a late administrator response after an account switch', async () => {
    const previous = deferred<Me>();
    mock.request.mockReturnValueOnce(previous.promise);
    mount();
    await waitFor(() => expect(mock.request).toHaveBeenCalled());
    await emit(READER_TOKEN);
    await waitFor(() => expect(current.me).toEqual(reader));
    await act(async () => previous.resolve(admin));
    expect(current).toMatchObject({token: READER_TOKEN, me: reader, loading: false, error: null});
  });

  it('does not apply a late error from the previous account to the new account', async () => {
    const previous = deferred<Me>();
    mock.request.mockReturnValueOnce(previous.promise);
    mount();
    await waitFor(() => expect(mock.request).toHaveBeenCalled());
    await emit(READER_TOKEN);
    await waitFor(() => expect(current.me).toEqual(reader));
    await act(async () => previous.reject(new APIError(503, 'synthetic_old_request_failure')));
    expect(current).toMatchObject({token: READER_TOKEN, me: reader, loading: false, error: null});
  });

  it('does not restore an administrator after sign-out when an earlier read completes', async () => {
    const previous = deferred<Me>();
    mock.request.mockReturnValueOnce(previous.promise);
    mount();
    await waitFor(() => expect(mock.request).toHaveBeenCalled());
    await emit(null);
    expect(current).toMatchObject({token: null, me: null, loading: false});
    await act(async () => previous.resolve(admin));
    expect(current).toMatchObject({token: null, me: null, loading: false, error: null});
  });

  it('does not overwrite a newer sign-in with the initial session snapshot', async () => {
    const initial = deferred<{data: {session: {access_token: string}}; error: null}>();
    mock.getSession.mockReturnValue(initial.promise);
    mount();
    await waitFor(() => expect(mock.getSession).toHaveBeenCalled());
    await emit(READER_TOKEN);
    await waitFor(() => expect(current.me).toEqual(reader));
    await act(async () => initial.resolve({data: {session: {access_token: ADMIN_TOKEN}}, error: null}));
    expect(current).toMatchObject({token: READER_TOKEN, me: reader, loading: false, error: null});
    expect(mock.request.mock.calls.map(call => call[1])).not.toContain(ADMIN_TOKEN);
  });

  it('does not resurrect the initial session after a newer sign-out event', async () => {
    const initial = deferred<{data: {session: {access_token: string}}; error: null}>();
    mock.getSession.mockReturnValue(initial.promise);
    mount();
    await waitFor(() => expect(mock.getSession).toHaveBeenCalled());
    await emit(null);
    await act(async () => initial.resolve({data: {session: {access_token: ADMIN_TOKEN}}, error: null}));
    expect(current).toMatchObject({token: null, me: null, loading: false, error: null});
    expect(mock.request).not.toHaveBeenCalled();
  });

  it('keeps a newer revoked admin permission when an older manual refresh completes later', async () => {
    await readyAdmin();
    const previous = deferred<Me>(), latest = deferred<Me>();
    mock.request.mockReturnValueOnce(previous.promise).mockReturnValueOnce(latest.promise);
    fireEvent.click(screen.getByRole('button', {name: 'Refresh identity'}));
    fireEvent.click(screen.getByRole('button', {name: 'Refresh identity'}));
    const revoked = {...admin, is_admin: false};
    await act(async () => latest.resolve(revoked));
    expect(current.me).toEqual(revoked);
    await act(async () => previous.resolve(admin));
    expect(current).toMatchObject({me: revoked, loading: false, error: null});
  });

  it('keeps a newer permission result when the initial profile read completes later', async () => {
    const initial = deferred<Me>(), latest = deferred<Me>();
    mock.request.mockReturnValueOnce(initial.promise).mockReturnValueOnce(latest.promise);
    mount();
    await waitFor(() => expect(mock.request).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', {name: 'Refresh identity'}));
    const revoked = {...admin, is_admin: false};
    await act(async () => latest.resolve(revoked));
    await act(async () => initial.resolve(admin));
    expect(current).toMatchObject({me: revoked, loading: false, error: null});
  });

  it('does not let a stale failure end loading or overwrite the newest successful refresh', async () => {
    await readyAdmin();
    const previous = deferred<Me>(), latest = deferred<Me>();
    mock.request.mockReturnValueOnce(previous.promise).mockReturnValueOnce(latest.promise);
    fireEvent.click(screen.getByRole('button', {name: 'Refresh identity'}));
    fireEvent.click(screen.getByRole('button', {name: 'Refresh identity'}));
    await act(async () => previous.reject(new APIError(503, 'synthetic_stale_failure')));
    expect(current.loading).toBe(true);
    expect(current.error).toBeNull();
    await act(async () => latest.resolve(admin));
    expect(current).toMatchObject({me: admin, loading: false, error: null});
  });

  it('ignores an old account refresh callback invoked after a new account has begun loading', async () => {
    await readyAdmin();
    const oldRefresh = current.refresh;
    const next = deferred<Me>();
    mock.request.mockReturnValueOnce(next.promise);
    await emit(READER_TOKEN);
    await act(async () => {await oldRefresh();});
    await act(async () => next.resolve(reader));
    expect(current).toMatchObject({token: READER_TOKEN, me: reader, loading: false, error: null});
    expect(mock.request.mock.calls.map(call => call[1])).toEqual([ADMIN_TOKEN, READER_TOKEN]);
  });

  it('does not let a profile response dismiss a newer MFA gate', async () => {
    await readyAdmin();
    const pending = deferred<Me>();
    mock.request.mockReturnValueOnce(pending.promise);
    fireEvent.click(screen.getByRole('button', {name: 'Refresh identity'}));
    await act(async () => window.dispatchEvent(new Event('signalbrief:mfa-required')));
    expect(screen.getByRole('alert')).toHaveTextContent('MFA verification required');
    expect(screen.queryByLabelText('Auth state')).not.toBeInTheDocument();
    await act(async () => pending.resolve(admin));
    expect(screen.getByRole('alert')).toHaveTextContent('MFA verification required');
    expect(screen.queryByLabelText('Auth state')).not.toBeInTheDocument();
  });

  it('clears privileged identity and in-memory cache scope on an unauthorized response', async () => {
    await readyAdmin();
    await act(async () => window.dispatchEvent(new Event('signalbrief:unauthorized')));
    expect(current).toMatchObject({token: null, me: null, loading: false, error: null});
    expect(pageDataCache.isCurrent(null)).toBe(true);
  });

  it('still handles a current-session 401 after a failed local sign-out', async () => {
    await readyAdmin();
    mock.signOut.mockResolvedValueOnce({error: new Error('Synthetic sign-out unavailable')});
    fireEvent.click(screen.getByRole('button', {name: 'Sign out locally'}));
    await waitFor(() => expect(mock.signOut).toHaveBeenCalledWith({scope: 'local'}));
    expect(current.me).toEqual(admin);
    const actualApi = await vi.importActual<typeof import('../src/lib/api')>('../src/lib/api');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({error: {code: 'session_expired'}}, {status: 401})));
    await act(async () => {
      await expect(actualApi.request('/v1/private', ADMIN_TOKEN, emptySchema)).rejects.toMatchObject({status: 401});
    });
    expect(current).toMatchObject({token: null, me: null, loading: false});
  });

  it('finishes initialization with an actionable error when authentication configuration is unavailable', async () => {
    mock.runtime.mockRejectedValueOnce(new Error('Synthetic runtime unavailable'));
    mount();
    await waitFor(() => expect(current.loading).toBe(false));
    expect(current.error).toBeTruthy();
    expect(current.me).toBeNull();
    expect(mock.getSession).not.toHaveBeenCalled();
  });

  it('removes the auth listener on unmount', async () => {
    const mounted = mount();
    await waitFor(() => expect(current.me).toEqual(admin));
    mounted.unmount();
    expect(mock.unsubscribe).toHaveBeenCalledTimes(1);
  });
});
