// @vitest-environment node
import {afterEach,describe,it,expect,vi} from 'vitest';
import {GET,POST} from '../src/app/api/company-discovery/route';
const auth='Bearer '+'a'.repeat(25),base='https://fixture.test/api/company-discovery';
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
function setup(){vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://fixture.supabase.co');vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY','public-key');vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({items:[],total:0,source_status:'ready'})));}
describe('company discovery proxy boundaries',()=>{
 it('denies unauthenticated and cross-origin calls before upstream access',async()=>{
  setup();expect((await GET(new Request(base+'?q=test'))).status).toBe(401);
  expect((await POST(new Request(base,{method:'POST',headers:{Authorization:auth,Origin:'https://evil.test'}}))).status).toBe(403);expect(fetch).not.toHaveBeenCalled();
 });
 it('forwards only the validated query and bearer, never browser cookies or arbitrary endpoints',async()=>{
  setup();const response=await GET(new Request(base+'?q=SK%20%ED%95%98%EC%9D%B4%EB%8B%89%EC%8A%A4&url=https://evil.test',{headers:{Authorization:auth,Cookie:'private'}}));
  expect(response.status).toBe(200);const [url,init]=vi.mocked(fetch).mock.calls[0];
  expect(String(url)).toBe('https://fixture.supabase.co/functions/v1/signalbrief-discovery?q=SK+%ED%95%98%EC%9D%B4%EB%8B%89%EC%8A%A4');
  expect(init?.headers).toEqual({apikey:'public-key',Authorization:auth});expect(response.headers.get('cache-control')).toBe('private, no-store');
 });
 it('rejects an invalid query or non-Supabase host and bounds request bodies',async()=>{
  setup();expect((await GET(new Request(base+'?q=!!!',{headers:{Authorization:auth}}))).status).toBe(422);
  expect((await POST(new Request(base,{method:'POST',headers:{Authorization:auth,'Content-Type':'application/json'},body:'x'.repeat(2049)}))).status).toBe(413);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://evil.test');expect((await GET(new Request(base+'?q=TEST',{headers:{Authorization:auth}}))).status).toBe(503);expect(fetch).not.toHaveBeenCalled();
 });
 it('keeps upstream failure distinct from a successful empty result',async()=>{
  setup();vi.mocked(fetch).mockResolvedValue(Response.json({error:{code:'directory_unavailable'}},{status:503}));
  const response=await GET(new Request(base+'?q=TEST',{headers:{Authorization:auth}}));expect(response.status).toBe(503);expect(await response.json()).toEqual({error:{code:'directory_unavailable'}});
 });
});
