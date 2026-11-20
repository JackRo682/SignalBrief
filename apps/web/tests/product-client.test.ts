import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {act, cleanup, renderHook} from '@testing-library/react';
import {chooseConsent, recordAcquisition} from '../src/acquisition/client';
import {productRecord} from '../src/acquisition/contracts';
import {PRODUCT_CONSENT_KEY, productConsentChoice, recordProductAction, setProductConsent, syncProductAccount} from '../src/acquisition/product-client';
import {enqueueTraffic} from '../src/acquisition/queue';
import {useProductAnalytics} from '../src/lib/use-product-analytics';

const hookAuth = vi.hoisted(() => ({
  token: 'synthetic-token-only' as string | null,
  me: {analytics_consent: true, is_admin: false, demo_mode: false},
}));
vi.mock('@/components/auth', () => ({useAuth: () => hookAuth}));

const account = {token: 'synthetic-token-only', analyticsConsent: true, isAdmin: false, isDemo: false};
beforeEach(() => {
  localStorage.clear();
  syncProductAccount(account);
  hookAuth.token=account.token; hookAuth.me={analytics_consent:true,is_admin:false,demo_mode:false};
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ok: true, recorded: true}))));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const optIn = () => { expect(chooseConsent(true)).toBe(true); expect(setProductConsent(true)).toBe(true); };

describe('first-party product consent and transport', () => {
  it('does not expand an old visitor grant into product measurement', async () => {
    chooseConsent(true);
    await recordProductAction('search_used', {screen: 'search'}, account);
    expect(fetch).not.toHaveBeenCalled();
    expect(productConsentChoice()).toBeNull();
  });
  it('requires both browser and account consent, plus a real non-admin account', async () => {
    optIn();
    for (const patch of [{token: null}, {analyticsConsent: false}, {isAdmin: true}, {isDemo: true}]) {
      expect(await recordProductAction('search_used', {screen: 'search'}, {...account, ...patch})).toBe(false);
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it('sends only the bounded contract to the same-origin collection endpoint', async () => {
    optIn();
    expect(await recordProductAction('filter_used', {screen: 'search', filter_type: 'source'}, account)).toBe(true);
    const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe('/api/traffic');
    expect(options?.headers).toEqual({'Content-Type': 'application/json', Authorization: 'Bearer synthetic-token-only'});
    const payload = JSON.parse(String(options?.body));
    expect(productRecord.safeParse(payload).success).toBe(true);
    expect(payload).toMatchObject({kind: 'filter_used', page: 'search', filter_type: 'source', product_consent_version: '2026-11-20'});
    expect(Object.keys(payload).sort()).toEqual(['action', 'filter_type', 'id', 'kind', 'page', 'product_consent_version', 'secret', 'source', 'visitor_id']);
    expect(JSON.stringify(payload)).not.toMatch(/synthetic-token|search_term|user_id|email|https?:/);
  });
  it('rejects invalid event combinations before starting transport', async () => {
    optIn();
    await recordProductAction('filter_used', {screen: 'search'}, account);
    await recordProductAction('event_detail_view', {screen: 'calendar', event_kind: 'calendar'}, account);
    await recordProductAction('search_used', {screen: '/search?q=PRIVATE' as 'search'}, account);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('maps app home separately from the public landing page', async () => {
    optIn();
    await recordProductAction('search_used', {screen: 'home'}, account);
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body)).page).toBe('app_home');
  });
  it('rechecks consent immediately before sending a queued event', async () => {
    optIn();
    const pending = recordProductAction('search_used', {screen: 'search'}, account);
    setProductConsent(false);
    expect(await pending).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('never revives a pending event when product consent is withdrawn and granted again', async () => {
    optIn();
    const pending=recordProductAction('search_used',{screen:'search'},account);
    setProductConsent(false); setProductConsent(true);
    expect(productConsentChoice()).toBe('granted');
    expect(await pending).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    expect(await recordProductAction('search_used',{screen:'search'},account)).toBe(true);
  });
  it('recognizes a new consent grant written by another browser tab', async () => {
    optIn();
    const pending=recordProductAction('search_used',{screen:'search'},account);
    const stored=JSON.parse(localStorage.getItem(PRODUCT_CONSENT_KEY)!);
    localStorage.setItem(PRODUCT_CONSENT_KEY,JSON.stringify({...stored,grant_id:crypto.randomUUID()}));
    expect(productConsentChoice()).toBe('granted');
    expect(await pending).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('stops collection immediately when withdrawal cannot be saved', async () => {
    optIn();
    const pending=recordProductAction('search_used',{screen:'search'},account);
    vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('storage unavailable');});
    expect(setProductConsent(false)).toBe(false);
    expect(productConsentChoice()).toBe('denied');
    expect(await pending).toBe(false);
    expect(await recordProductAction('search_used',{screen:'search'},account)).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('preserves landing-before-search order when the public request is slow', async () => {
    optIn();
    let finish!: (response: Response)=>void;
    vi.mocked(fetch).mockImplementationOnce(()=>new Promise<Response>(resolve=>{finish=resolve;}));
    const landing=recordAcquisition('page_view','home');
    const search=recordProductAction('search_used',{screen:'search'},account);
    await vi.waitFor(()=>expect(fetch).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body)).kind).toBe('page_view');
    finish(new Response(JSON.stringify({ok:true,recorded:true})));
    expect(await landing).toBe(true);
    expect(await search).toBe(true);
    expect(vi.mocked(fetch).mock.calls.map(([,options])=>JSON.parse(String(options?.body)).kind)).toEqual(['page_view','search_used']);
  });
  it('rechecks a live account getter when queued work reaches the transport', async () => {
    optIn();
    let current={...account};
    const pending=recordProductAction('search_used',{screen:'search'},()=>current);
    current={...account,analyticsConsent:false};
    expect(await pending).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('drops work from an old page after global logout, even if the same account returns', async () => {
    optIn();
    const frozen={...account};
    const pending=recordProductAction('search_used',{screen:'search'},()=>frozen);
    syncProductAccount({...account,token:null});
    syncProductAccount(account);
    expect(await pending).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('does not reuse a previous browser identity grant after withdrawal and reconsent', async () => {
    optIn();
    chooseConsent(false);
    chooseConsent(true);
    expect(productConsentChoice()).toBeNull();
    vi.mocked(fetch).mockClear();
    expect(await recordProductAction('search_used', {screen: 'search'}, account)).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('honors browser privacy signals and inaccessible storage', async () => {
    optIn();
    vi.stubGlobal('navigator', {globalPrivacyControl: true});
    expect(await recordProductAction('search_used', {screen: 'search'}, account)).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(productConsentChoice()).toBeNull();
  });
  it('rejects expired and corrupt product consent without affecting product actions', () => {
    optIn();
    const stored = JSON.parse(localStorage.getItem(PRODUCT_CONSENT_KEY)!);
    localStorage.setItem(PRODUCT_CONSENT_KEY, JSON.stringify({...stored, at: Date.now() - 91 * 86400000}));
    expect(productConsentChoice()).toBeNull();
    localStorage.setItem(PRODUCT_CONSENT_KEY, '{');
    expect(productConsentChoice()).toBeNull();
  });
  it('fails quietly if collection is blocked, offline or rejected', async () => {
    optIn();
    vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'));
    expect(await recordProductAction('search_used', {screen: 'search'}, account)).toBe(false);
    vi.mocked(fetch).mockResolvedValueOnce(new Response('{}', {status: 403}));
    expect(await recordProductAction('search_used', {screen: 'search'}, account)).toBe(false);
  });
});

describe('product hook lifecycle',()=>{
  it('keeps the callback stable while rechecking changed account consent',async()=>{
    optIn();
    const hook=renderHook(()=>useProductAnalytics()),original=hook.result.current;
    act(()=>hook.result.current('search_used',{screen:'search'}));
    hookAuth.me={...hookAuth.me,analytics_consent:false};
    hook.rerender();
    expect(hook.result.current).toBe(original);
    await enqueueTraffic(async()=>undefined);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('preserves a legitimate click when its page unmounts during navigation',async()=>{
    optIn();
    const hook=renderHook(()=>useProductAnalytics());
    act(()=>hook.result.current('event_detail_click',{screen:'search',event_kind:'published'}));
    hook.unmount();
    await enqueueTraffic(async()=>undefined);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body)).kind).toBe('event_detail_click');
  });
});
