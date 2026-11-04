// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({getUser:vi.fn(),rpc:vi.fn(),createClient:vi.fn()}));
vi.mock('@supabase/supabase-js',()=>({createClient:mocks.createClient}));
import {GET} from '@/app/api/universe-coverage/route';
const valid={as_of:'2026-11-04T14:00:00Z',markets:[],sources:[],limits:{provider_daily_calls:500,model_daily_calls:20,model_daily_budget_usd:1,human_approval_required:true},usage:[]};
beforeEach(()=>{
 vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://synthetic-project.supabase.co');vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY','synthetic-public-key');
 mocks.getUser.mockResolvedValue({error:null,data:{user:{id:'synthetic'}}});mocks.rpc.mockResolvedValue({error:null,data:valid});mocks.createClient.mockReturnValue({auth:{getUser:mocks.getUser},rpc:mocks.rpc});
});
afterEach(()=>{vi.unstubAllEnvs();vi.clearAllMocks();});
const req=(token='a'.repeat(24),suffix='')=>new Request(`https://signalbrief.online/api/universe-coverage${suffix}`,{headers:{Authorization:`Bearer ${token}`}});
describe('authenticated universe coverage route',()=>{
 it('uses the public project key and caller JWT, returning only validated coverage',async()=>{
  const result=await GET(req());expect(result.status).toBe(200);expect(await result.json()).toEqual(valid);expect(result.headers.get('cache-control')).toBe('private, no-store');
  expect(mocks.createClient).toHaveBeenCalledWith('https://synthetic-project.supabase.co','synthetic-public-key',expect.objectContaining({global:expect.objectContaining({headers:{Authorization:`Bearer ${'a'.repeat(24)}`}})}));
  expect(mocks.rpc).toHaveBeenCalledWith('sb_universe_coverage');
 });
 it('rejects malformed or invalid sessions and unexpected query parameters',async()=>{
  expect((await GET(req('bad'))).status).toBe(401);expect((await GET(req('a'.repeat(24),'?admin=true'))).status).toBe(422);expect(mocks.createClient).not.toHaveBeenCalled();
  mocks.getUser.mockResolvedValueOnce({error:{message:'expired'},data:{user:null}});expect((await GET(req())).status).toBe(401);expect(mocks.rpc).not.toHaveBeenCalled();
 });
 it('preserves MFA errors and rejects malformed upstream coverage',async()=>{
  mocks.rpc.mockResolvedValueOnce({error:{code:'PT403',message:'mfa_required'},data:null});expect((await GET(req())).status).toBe(403);
  mocks.rpc.mockResolvedValueOnce({error:null,data:{...valid,limits:{...valid.limits,human_approval_required:false}}});expect((await GET(req())).status).toBe(502);
 });
});
