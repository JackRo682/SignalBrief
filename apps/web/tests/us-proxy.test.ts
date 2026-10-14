// @vitest-environment node
import {describe,it,expect,vi,afterEach} from 'vitest';
import {proxyUS} from '../src/server/us-proxy';
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
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
