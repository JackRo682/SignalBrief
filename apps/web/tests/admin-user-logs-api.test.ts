// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({getUser:vi.fn(),rpc:vi.fn(),createClient:vi.fn()}));
vi.mock('@supabase/supabase-js',()=>({createClient:mocks.createClient}));
import {POST} from '../src/app/api/admin/user-logs/route';

const filters={from:'2026-11-01',to:'2026-11-05',user_id:'',event:'',screen:'',device:'',include_admin:false,cursor:null};
const response={items:[],next_cursor:null,has_more:false,summary:{events:0,users:0,sessions:0,active_ms:0},retention_days:90,timezone:'Asia/Seoul',consented_users:0,generated_at:'2026-11-05T01:00:00Z'};
function request(body:unknown=filters,headers:Record<string,string>={}){return new Request('https://signalbrief.test/api/admin/user-logs',{method:'POST',headers:{Authorization:'Bearer isolated-test-token-value','Content-Type':'application/json',...headers},body:JSON.stringify(body)});}
beforeEach(()=>{
 vi.clearAllMocks();
 vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://project.supabase.co');vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY','sb_publishable_test');
 mocks.createClient.mockReturnValue({auth:{getUser:mocks.getUser},rpc:mocks.rpc});
 mocks.getUser.mockResolvedValue({data:{user:{id:'admin-user',email_confirmed_at:'2026-01-01T00:00:00Z'}},error:null});
 mocks.rpc.mockImplementation(async(name:string)=>({data:name==='sb_is_admin'?true:response,error:null}));
});
afterEach(()=>vi.unstubAllEnvs());
describe('private user activity endpoint',()=>{
 it('rejects anonymous calls before touching private services',async()=>{const r=await POST(request(filters,{Authorization:''}));expect(r.status).toBe(401);expect(mocks.createClient).not.toHaveBeenCalled();});
 it('does not query logs for an ordinary verified account',async()=>{mocks.rpc.mockResolvedValue({data:false,error:null});const r=await POST(request());expect(r.status).toBe(403);expect(mocks.rpc).toHaveBeenCalledTimes(1);expect(await r.text()).not.toContain('admin-user');});
 it('validates the actual current user and rejects unverified accounts',async()=>{mocks.getUser.mockResolvedValue({data:{user:{id:'ordinary',email_confirmed_at:null}},error:null});expect((await POST(request())).status).toBe(403);expect(mocks.rpc).not.toHaveBeenCalled();});
 it('denies expired authentication without querying the allowlist',async()=>{mocks.getUser.mockResolvedValue({data:{user:null},error:{status:401,message:'secret'}});expect((await POST(request())).status).toBe(401);expect(mocks.rpc).not.toHaveBeenCalled();});
 it('distinguishes an auth outage from an expired session',async()=>{mocks.getUser.mockResolvedValue({data:{user:null},error:{status:503,name:'AuthRetryableFetchError',message:'secret'}});const r=await POST(request());expect(r.status).toBe(503);expect(await r.text()).not.toContain('secret');});
 it('preserves a temporary Auth rate limit without forcing reauthentication',async()=>{mocks.getUser.mockResolvedValue({data:{user:null},error:{status:429,message:'private'}});const r=await POST(request());expect(r.status).toBe(429);expect(r.headers.get('retry-after')).toBe('30');expect(mocks.rpc).not.toHaveBeenCalled();});
 it('recognizes expiry between Auth verification and permission lookup',async()=>{mocks.rpc.mockResolvedValue({data:null,error:{code:'PGRST301',message:'JWT expired'}});expect((await POST(request())).status).toBe(401);expect(mocks.rpc).toHaveBeenCalledTimes(1);});
 it('fails closed when permissions cannot be checked',async()=>{mocks.rpc.mockResolvedValue({data:true,error:{message:'private error'}});const r=await POST(request());expect(r.status).toBe(503);expect(mocks.rpc).toHaveBeenCalledTimes(1);});
 it.each(['PT401','PT403','PT422','PT429'])('preserves guarded database status %s without raw details',async(code)=>{mocks.rpc.mockImplementation(async(name:string)=>name==='sb_is_admin'?{data:true,error:null}:{data:null,error:{code,message:'PRIVATE SQL DETAIL'}});const r=await POST(request());expect(r.status).toBe(Number(code.slice(2)));expect(await r.text()).not.toContain('PRIVATE SQL');if(code==='PT429')expect(r.headers.get('retry-after')).toBe('30');});
 it('does not cache success or failure responses',async()=>{const r=await POST(request());expect(r.status).toBe(200);expect(await r.json()).toEqual(response);expect(r.headers.get('cache-control')).toContain('private, no-store');expect(r.headers.get('vary')).toBe('Authorization');expect(r.headers.get('x-request-id')).toBeTruthy();expect(mocks.rpc).toHaveBeenLastCalledWith('sb_admin_user_logs',{p:filters});});
 it('rejects unexpected database fields rather than leaking them',async()=>{mocks.rpc.mockImplementation(async(name:string)=>({data:name==='sb_is_admin'?true:{...response,secret:'DO NOT EXPOSE'},error:null}));const r=await POST(request());expect(r.status).toBe(502);expect(await r.text()).not.toContain('DO NOT EXPOSE');});
 it('rejects cross-origin calls and invalid input before service access',async()=>{expect((await POST(request(filters,{Origin:'https://evil.test'}))).status).toBe(403);expect((await POST(request({...filters,user_id:'invalid'}))).status).toBe(422);expect((await POST(request({...filters,role:'admin'}))).status).toBe(422);expect(mocks.createClient).not.toHaveBeenCalled();});
 it('bounds actual streamed bytes even without content-length',async()=>{expect((await POST(request({value:'x'.repeat(5000)}))).status).toBe(413);expect(mocks.createClient).not.toHaveBeenCalled();});
 it('never accepts a secret/service-role key as public configuration',async()=>{vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY','sb_secret_TEST');expect((await POST(request())).status).toBe(503);expect(mocks.createClient).not.toHaveBeenCalled();});
 it('uses only the caller bearer token and uncached bounded requests',async()=>{await POST(request());const options=mocks.createClient.mock.calls[0][2];expect(options.global.headers.Authorization).toBe('Bearer isolated-test-token-value');expect(options.auth.persistSession).toBe(false);expect(options.auth.autoRefreshToken).toBe(false);});
});
