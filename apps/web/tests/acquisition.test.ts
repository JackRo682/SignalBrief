import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {trafficPage,trafficSource,trafficRequest} from '../src/acquisition/contracts';
import {CONSENT_KEY,readConsent,chooseConsent,recordAcquisition,erasePending} from '../src/acquisition/client';
import {publicMetadata,publicPages} from '../src/lib/public-seo';
import robots from '../src/app/robots';import sitemap from '../src/app/sitemap';
beforeEach(()=>{localStorage.clear();vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({ok:true}),{status:200})));});
afterEach(()=>vi.unstubAllGlobals());
describe('public discovery',()=>{
 it('exposes only canonical public marketing URLs',()=>{for(const path of Object.keys(publicPages)){expect(publicMetadata(path as keyof typeof publicPages).robots).toEqual({index:true,follow:true});}expect(sitemap().every(row=>row.url.startsWith('https://signalbrief.online/'))).toBe(true);expect(sitemap().some(row=>row.url.includes('/ops'))).toBe(false);expect(robots().sitemap).toBe('https://signalbrief.online/sitemap.xml');});
 it('disables preview indexing',()=>{vi.stubEnv('VERCEL_ENV','preview');expect(publicMetadata('/').robots).toEqual({index:false,follow:false});expect(sitemap()).toEqual([]);vi.unstubAllEnvs();});
});
describe('acquisition data minimization and consent',()=>{
 it.each(['/search?q=secret','/company/123','/ops','/today','/auth/callback'])('does not send private routes %s',path=>expect(trafficPage(path)).toBeNull());
 it('classifies known sources without returning raw queries or hosts',()=>{expect(trafficSource('https://signalbrief.online/?utm_source=geeknews&email=private','')).toBe('geeknews');expect(trafficSource('https://signalbrief.online/','https://news.hada.io/topic?id=123')).toBe('geeknews');expect(trafficSource('https://signalbrief.online/','https://private.example/user')).toBe('other');expect(trafficSource('https://signalbrief.online/','https://google.com.evil.example/')).toBe('other');expect(trafficSource('https://signalbrief.online/?utm_source=person@email.com','')).toBe('other');});
 it('collects nothing before consent or after declining',async()=>{expect(readConsent()).toBeNull();await recordAcquisition('page_view','home');expect(fetch).not.toHaveBeenCalled();chooseConsent(false);await recordAcquisition('page_view','home');expect(fetch).not.toHaveBeenCalled();});
 it('records only validated bounded events after opt-in',async()=>{expect(chooseConsent(true)).toBe(true);await recordAcquisition('page_view','home');const call=vi.mocked(fetch).mock.calls[0];const body=JSON.parse(String(call[1]?.body));expect(trafficRequest.safeParse(body).success).toBe(true);expect(body).not.toHaveProperty('url');expect(body).not.toHaveProperty('email');});
 it('honors browser tracking protection',async()=>{Object.defineProperty(navigator,'doNotTrack',{configurable:true,value:'1'});expect(chooseConsent(true)).toBe(false);await recordAcquisition('page_view','home');expect(fetch).not.toHaveBeenCalled();Object.defineProperty(navigator,'doNotTrack',{configurable:true,value:undefined});});
 it('does not break signup when analytics is unreachable',async()=>{chooseConsent(true);vi.mocked(fetch).mockRejectedValue(new Error('offline'));await expect(recordAcquisition('signup_start','signup')).resolves.toBe(false);});
 it('withdraws and retries a failed erasure without collecting more',async()=>{chooseConsent(true);vi.mocked(fetch).mockRejectedValue(new Error('offline'));chooseConsent(false);await erasePending();expect(readConsent()).toMatchObject({choice:'no',erase:expect.any(Object)});vi.mocked(fetch).mockResolvedValue(new Response('{}'));await erasePending();expect(readConsent()).toEqual({choice:'no',at:expect.any(Number)});});
 it('expires consent and ignores corrupt storage',()=>{localStorage.setItem(CONSENT_KEY,'{');expect(readConsent()).toBeNull();localStorage.setItem(CONSENT_KEY,JSON.stringify({choice:'no',at:Date.now()-91*86400000}));expect(readConsent()).toBeNull();});
});
