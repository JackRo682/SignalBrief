import { describe, it, expect, vi, afterEach } from 'vitest';
import { internalNavigation } from '../src/lib/internal-navigation';
import { siteOrigin, startGoogleLogin } from '../src/lib/site-url';
import { PageDataCache } from '../src/lib/page-data-cache';

afterEach(() => vi.useRealTimers());
describe('OAuth origin', () => {
  it('uses the local origin from a nested account page while rejecting configured paths',()=>{
    expect(siteOrigin('http://localhost:3000/signup',undefined,false)).toBe('http://localhost:3000');
    expect(()=>siteOrigin('http://localhost:3000/signup','https://signalbrief.online/signup',true)).toThrow('invalid_site_url');
  });
  it('moves aliases before starting PKCE', async () => {
    const navigate = vi.fn(), login = vi.fn();
    await startGoogleLogin('https://alias.vercel.app/login', siteOrigin('https://alias.vercel.app', undefined, true), navigate, login);
    expect(navigate).toHaveBeenCalledWith('https://signalbrief.online/login');
    expect(login).not.toHaveBeenCalled();
  });
  it('uses the canonical callback once already on its origin', async () => {
    const login = vi.fn();
    await startGoogleLogin('https://signalbrief.online/login', 'https://signalbrief.online', vi.fn(), login);
    expect(login).toHaveBeenCalledWith('https://signalbrief.online/auth/callback');
    expect(siteOrigin('http://localhost:3000', undefined, false)).toBe('http://localhost:3000');
    expect(() => siteOrigin('https://app.test', 'https://app.test/other', true)).toThrow();
  });
});
describe('template links', () => {
  function click(href: string, init: MouseEventInit = {}, attrs = '') {
    const anchor = document.createElement('a'); anchor.href = href; anchor.innerHTML = '<span>open</span>';
    if (attrs) anchor.setAttribute(attrs, attrs === 'target' ? '_blank' : '');
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, ...init });
    let result: string | null = null;
    anchor.addEventListener('click', e => { result = internalNavigation(e, 'https://app.test/today'); e.preventDefault(); });
    anchor.firstElementChild!.dispatchEvent(event); return result;
  }
  it('routes nested internal links with their query and hash', () => expect(click('https://app.test/calendar?month=10#day')).toBe('/calendar?month=10#day'));
  it('preserves external, modified, download, new-tab and evidence clicks', () => {
    expect(click('https://outside.test')).toBeNull();
    expect(click('https://app.test/portfolio', { ctrlKey: true })).toBeNull();
    expect(click('https://app.test/portfolio', {}, 'download')).toBeNull();
    expect(click('https://app.test/portfolio', {}, 'target')).toBeNull();
    expect(click('https://app.test/today#evidence')).toBeNull();
  });
});
describe('page data cache', () => {
  it.each(['design_directory', 'source_overview', 'design_dashboard', 'saved_list', 'content_notifications'])('retains and deduplicates %s across tab visits', async action => {
    const cache = new PageDataCache(), key = 'workspace:' + JSON.stringify({action, p:{}});
    const load = vi.fn().mockResolvedValue({items:['confirmed']});
    await Promise.all([cache.request('a',key,'GET',load),cache.request('a',key,'GET',load)]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(cache.peek('a',key)).toEqual({items:['confirmed']});
    await cache.request('a',key,'GET',load);
    expect(load).toHaveBeenCalledTimes(1);
  });
  it.each(['preferences', 'security', 'account', 'export', 'tickets', 'saved_list'])('never retains sensitive %s reads', async action => {
    const cache = new PageDataCache(), key = 'workspace:' + JSON.stringify({action, p:{kind:'history'}});
    const load = vi.fn().mockResolvedValue({private:true});
    await cache.request('a',key,'GET',load);
    expect(cache.peek('a',key)).toBeUndefined();
    await cache.request('a',key,'GET',load);
    expect(load).toHaveBeenCalledTimes(2);
  });
  it('refreshes only the requested key and rejects its older pending response', async () => {
    const cache = new PageDataCache(), key = '/v1/watchlist';
    let finish!: (value:string)=>void;
    const pending=cache.request('a',key,'GET',()=>new Promise<string>(resolve=>{finish=resolve;}));
    await Promise.resolve();
    await cache.request('a','/v1/companies','GET',async()=>['cached directory']);
    cache.invalidate('a',key);
    await cache.request('a',key,'GET',async()=>'fresh');
    finish('obsolete'); await pending;
    expect(cache.peek('a',key)).toBe('fresh');
    expect(cache.isFresh('a','/v1/companies')).toBe(true);
    cache.invalidate('old-account',key);
    expect(cache.isFresh('a',key)).toBe(true);
  });
  it('keeps confirmed updates visible while sharing the following refresh', async () => {
    const cache = new PageDataCache(), key = 'workspace:' + JSON.stringify({action:'content_notifications',p:{}});
    await cache.request('a',key,'GET',async()=>({unread:1}));
    cache.update<{unread:number}>('a',key,value=>value?{unread:0}:undefined);
    expect(cache.peek('a',key)).toEqual({unread:0});
    expect(cache.isFresh('a',key)).toBe(false);
    const load=vi.fn().mockResolvedValue({unread:0});
    await Promise.all([cache.request('a',key,'GET',load),cache.request('a',key,'GET',load)]);
    expect(load).toHaveBeenCalledTimes(1);
    cache.reset('b');
    cache.update<{unread:number}>('a',key,()=>({unread:99}));
    expect(cache.peek('b',key)).toBeUndefined();
  });
  it('deduplicates loads and discards data on account changes and mutations', async () => {
    const cache = new PageDataCache(), load = vi.fn().mockResolvedValue({ items: [1] });
    await Promise.all([cache.request('alice', '/v1/watchlist', 'GET', load), cache.request('alice', '/v1/watchlist', 'GET', load)]);
    expect(load).toHaveBeenCalledTimes(1);
    await cache.request('bob', '/v1/watchlist', 'GET', load);
    expect(load).toHaveBeenCalledTimes(2);
    await cache.request('bob', '/v1/watchlist/1', 'PUT', async () => null);
    await cache.request('bob', '/v1/watchlist', 'GET', load);
    expect(load).toHaveBeenCalledTimes(3);
  });
  it('expires stale responses and never retains errors', async () => {
    vi.useFakeTimers(); const cache = new PageDataCache(), load = vi.fn().mockResolvedValue(1);
    await cache.request('a', '/v1/portfolio', 'GET', load);
    vi.advanceTimersByTime(60_001);
    expect(cache.peek('a','/v1/portfolio')).toBe(1);
    await cache.request('a', '/v1/portfolio', 'GET', load);
    expect(load).toHaveBeenCalledTimes(2);
    const fail = vi.fn().mockRejectedValue(new Error('failed'));
    await expect(cache.request('a', '/v1/feed', 'GET', fail)).rejects.toThrow();
    await expect(cache.request('a', '/v1/feed', 'GET', fail)).rejects.toThrow();
    expect(fail).toHaveBeenCalledTimes(2);
  });
  it('renders the last authorized collection instantly during a stale refresh', async () => {
    vi.useFakeTimers();
    const cache = new PageDataCache();
    const load = vi.fn().mockResolvedValueOnce({items:['A']}).mockResolvedValueOnce({items:['A','B']});
    expect(cache.peek('account-a','/v1/watchlist')).toBeUndefined();
    await cache.request('account-a','/v1/watchlist','GET',load);
    expect(cache.peek('account-a','/v1/watchlist')).toEqual({items:['A']});
    vi.advanceTimersByTime(60_001);
    const refreshing=cache.request('account-a','/v1/watchlist','GET',load);
    expect(cache.peek('account-a','/v1/watchlist')).toEqual({items:['A']});
    await refreshing;
    expect(cache.peek('account-a','/v1/watchlist')).toEqual({items:['A','B']});
    expect(load).toHaveBeenCalledTimes(2);
  });
  it('discards an old account response that arrives after a token switch', async () => {
    const cache = new PageDataCache();
    let finish!: (value:{owner:string})=>void;
    const pending=cache.request('account-a','/v1/watchlist','GET',
      ()=>new Promise<{owner:string}>(resolve=>{finish=resolve;}));
    await Promise.resolve(); // start the old request
    cache.reset('account-b');
    await cache.request('account-b','/v1/watchlist','GET',async()=>({owner:'account-b'}));
    finish({owner:'account-a'});
    await pending;
    expect(cache.peek('account-b','/v1/watchlist')).toEqual({owner:'account-b'});
    expect(cache.isCurrent('account-a')).toBe(false);
  });

});
