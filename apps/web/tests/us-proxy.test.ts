// @vitest-environment node
import {describe,it,expect,vi,afterEach} from 'vitest';
import {proxyUS} from '../src/server/us-proxy';
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});

describe('homepage indices proxy boundary',()=>{
 it('requires a bearer session before querying indices',async()=>{
  const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
  const result=await proxyUS(new Request('https://signalbrief.test/api/us/indices'),'indices');
  expect(result.status).toBe(401);expect(fetcher).not.toHaveBeenCalled();
 });
 it('forwards an authenticated GET to the fixed US indices endpoint without caching',async()=>{
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://synthetic-project.supabase.co');vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY','synthetic-publishable-key');
  const payload={available:false,indices:[],unavailable:[{symbol:'KOSPI',reason:'kis_display_license_unverified'}]};
  const fetcher=vi.fn().mockResolvedValue(Response.json(payload));vi.stubGlobal('fetch',fetcher);
  const result=await proxyUS(new Request('https://signalbrief.test/api/us/indices',{headers:{Authorization:'Bearer synthetic-user-token'}}),'indices');
  expect(result.status).toBe(200);expect(await result.json()).toEqual(payload);expect(result.headers.get('cache-control')).toBe('private, no-store');
  const [url,init]=fetcher.mock.calls[0];expect(url.href).toBe('https://synthetic-project.supabase.co/functions/v1/signalbrief-us/indices');
  expect(init.method).toBe('GET');expect(init.headers.Authorization).toBe('Bearer synthetic-user-token');expect(init.cache).toBe('no-store');
 });
});
describe('DART retry proxy boundary',()=>{
 it('requires authentication before forwarding a retry',async()=>{
  const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
  const response=await proxyUS(new Request('https://signalbrief.test/api/us/dart-retry',{method:'POST'}),'dart-retry');
  expect(response.status).toBe(401);expect(fetcher).not.toHaveBeenCalled();
 });
 it('forwards only an authenticated bounded POST to the fixed Edge route',async()=>{
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://synthetic-project.supabase.co');vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY','synthetic-publishable-key');
  const fetcher=vi.fn().mockResolvedValue(Response.json({status:'queued'}));vi.stubGlobal('fetch',fetcher);
  const body=JSON.stringify({filing_id:'00000000-0000-4000-8000-000000000001'});
  const result=await proxyUS(new Request('https://signalbrief.test/api/us/dart-retry',{method:'POST',headers:{Authorization:'Bearer synthetic-user-token','Content-Type':'application/json',Cookie:'private-cookie'},body}),'dart-retry');
  expect(result.status).toBe(200);expect(await result.json()).toEqual({status:'queued'});
  const [url,init]=fetcher.mock.calls[0];expect(url.href).toBe('https://synthetic-project.supabase.co/functions/v1/signalbrief-us/dart-retry');
  expect(init.body).toBe(body);expect(init.headers.Authorization).toBe('Bearer synthetic-user-token');expect(init.headers.Cookie).toBeUndefined();expect(init.redirect).toBe('error');
 });
 it('rejects an unsupported read method without forwarding',async()=>{
  const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
  expect((await proxyUS(new Request('https://signalbrief.test/api/us/dart-retry'),'dart-retry')).status).toBe(404);expect(fetcher).not.toHaveBeenCalled();
 });
});

describe('company financials proxy boundary',()=>{
 const id='20000000-0000-4000-8000-000000000001';
 const headers={Authorization:'Bearer synthetic-token','Content-Type':'application/json',Cookie:'private-cookie'};
 const setup=()=>{
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://synthetic-project.supabase.co');vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY','synthetic-public');
  const fetcher=vi.fn().mockResolvedValue(Response.json({company_id:id}));vi.stubGlobal('fetch',fetcher);return fetcher;
 };
 it.each(['GET','POST'])('accepts only the canonical company id for %s',async(method)=>{
  const fn=setup(),suffix=method==='GET'?`?company_id=${id}`:'';
  const response=await proxyUS(new Request(`https://signalbrief.test/api/us/company-financials${suffix}`,{method,headers,...(method==='POST'?{body:JSON.stringify({company_id:id})}:{})}),'company-financials');
  expect(response.status).toBe(200);
  const [url,init]=fn.mock.calls[0];expect(url.href).toBe(`https://synthetic-project.supabase.co/functions/v1/signalbrief-us/company-financials${suffix}`);
  expect(init.headers.Cookie).toBeUndefined();expect(init.redirect).toBe('error');expect(init.cache).toBe('no-store');
 });
 it('rejects anonymous, duplicate, arbitrary-target, malformed and cross-origin requests before forwarding',async()=>{
  const fn=setup();
  const cases:[Request,number][]=[
   [new Request(`https://signalbrief.test/api/us/company-financials?company_id=${id}`),401],
   [new Request(`https://signalbrief.test/api/us/company-financials?company_id=${id}&company_id=${id}`,{headers}),400],
   [new Request(`https://signalbrief.test/api/us/company-financials?company_id=${id}&url=https://attacker.test`,{headers}),400],
   [new Request('https://signalbrief.test/api/us/company-financials',{method:'POST',headers,body:JSON.stringify({company_id:id,ticker:'OTHER'})}),400],
   [new Request('https://signalbrief.test/api/us/company-financials',{method:'POST',headers:{...headers,Origin:'https://attacker.test'},body:JSON.stringify({company_id:id})}),403],
  ];
  for(const [request,status] of cases)expect((await proxyUS(request,'company-financials')).status).toBe(status);
  expect(fn).not.toHaveBeenCalled();
 });
});
