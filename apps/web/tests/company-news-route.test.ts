// @vitest-environment node
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {companyNewsQueries} from '../src/lib/news-contract';
const mocks=vi.hoisted(()=>({getUser:vi.fn(),rpc:vi.fn()}));
vi.mock('@supabase/supabase-js',()=>({createClient:()=>({auth:{getUser:mocks.getUser},rpc:mocks.rpc})}));
const id='22000000-0000-4000-8000-000000000001';
const auth={Authorization:'Bearer synthetic_valid_test_session_123456'};
beforeEach(()=>{
 vi.resetModules();vi.clearAllMocks();
 vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://synthetic.supabase.co');vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY','synthetic-public');
 vi.stubEnv('NAVER_NEWS_CLIENT_ID','synthetic-id');vi.stubEnv('NAVER_NEWS_CLIENT_SECRET','synthetic-secret');
 mocks.getUser.mockResolvedValue({data:{user:{id:'owner'}},error:null});
 mocks.rpc.mockResolvedValue({data:{id,kind:'company',ticker:'AAPL'},error:null});
 vi.stubGlobal('fetch',vi.fn().mockImplementation(async()=>Response.json({items:[]})));
});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
describe('authenticated company news resolution',()=>{
 it.each(Object.entries(companyNewsQueries))('resolves %s to its fixed company query %s',async(ticker,query)=>{
  mocks.rpc.mockResolvedValueOnce({data:{id,kind:'company',ticker},error:null});
  const {GET}=await import('../src/app/api/news/route');
  const response=await GET(new Request(`https://example.com/api/news?company_id=${id}`,{headers:auth}));
  expect(response.status).toBe(200);expect(await response.json()).toMatchObject({query,items:[]});
  expect(mocks.rpc).toHaveBeenCalledWith('sb_workspace',{action:'resource',p:{kind:'company',id}});
  expect(vi.mocked(fetch).mock.calls[0][0]).toBeInstanceOf(URL);
  expect((vi.mocked(fetch).mock.calls[0][0] as URL).searchParams.get('query')).toBe(query);
 });
 it('requires authentication before company lookup or provider access',async()=>{
  const {GET}=await import('../src/app/api/news/route');
  expect((await GET(new Request(`https://example.com/api/news?company_id=${id}`))).status).toBe(401);
  expect(mocks.rpc).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
 });
 it('rejects injected and duplicate query parameters',async()=>{
  const {GET}=await import('../src/app/api/news/route');
  for(const search of [`company_id=${id}&q=private`,`company_id=${id}&company_id=${id}`,'company_id=not-an-id'])expect((await GET(new Request(`https://example.com/api/news?${search}`,{headers:auth}))).status).toBe(400);
  expect(mocks.rpc).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
 });
 it('rejects identity mismatch and unsupported companies without arbitrary provider queries',async()=>{
  const {GET}=await import('../src/app/api/news/route');
  mocks.rpc.mockResolvedValueOnce({data:{id:'33000000-0000-4000-8000-000000000001',kind:'company',ticker:'AAPL'},error:null});
  expect((await GET(new Request(`https://example.com/api/news?company_id=${id}`,{headers:auth}))).status).toBe(404);
  mocks.rpc.mockResolvedValueOnce({data:{id,kind:'company',ticker:'UNSUPPORTED'},error:null});
  expect((await GET(new Request(`https://example.com/api/news?company_id=${id}`,{headers:auth}))).status).toBe(422);
  expect(fetch).not.toHaveBeenCalled();
 });
 it('preserves MFA denial and distinguishes provider failure from no matches',async()=>{
  const {GET}=await import('../src/app/api/news/route');
  mocks.rpc.mockResolvedValueOnce({data:null,error:{code:'PT403',message:'mfa_required'}});
  expect((await GET(new Request(`https://example.com/api/news?company_id=${id}`,{headers:auth}))).status).toBe(403);
  vi.mocked(fetch).mockResolvedValueOnce(new Response('',{status:500}));
  const failed=await GET(new Request(`https://example.com/api/news?company_id=${id}`,{headers:auth}));
  expect(failed.status).toBe(502);expect(await failed.json()).toEqual({error:{code:'news_provider_unavailable'}});
 });
});
