// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({rpc:vi.fn(),download:vi.fn()}));
vi.mock('@supabase/supabase-js',()=>({createClient:()=>({rpc:mocks.rpc})}));
vi.mock('../src/server/calendar-source',async original=>({...await original<typeof import('../src/server/calendar-source')>(),downloadCalendarSource:mocks.download}));
import {POST} from '../src/app/api/internal/calendar-source/route';
import {relaySignature} from '../src/server/dart-relay';
const secret='c'.repeat(64),payload={kind:'calendar_source',url:'https://investors.synthetic-corp.com/events/',nonce:'d'.repeat(64)};
function request(value:unknown=payload,options:{unsigned?:boolean;stale?:boolean;tamper?:boolean}={}){
 const body=JSON.stringify(value),timestamp=String(Date.now()-(options.stale?60_001:0));
 return new Request('https://fixture.test/api/internal/calendar-source',{method:'POST',headers:{'Content-Type':'application/json','x-sb-timestamp':timestamp,
  'x-sb-signature':options.unsigned?'':relaySignature(options.tamper?body+' ':body,timestamp,secret)},body});
}
beforeEach(()=>{
 vi.clearAllMocks();vi.stubEnv('DART_RELAY_SECRET',secret);vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://synthetic.supabase.co');vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY','synthetic-public');
 mocks.rpc.mockResolvedValue({data:true,error:null});mocks.download.mockResolvedValue({bytes:Buffer.from('<html>Original bytes</html>'),type:'text/html; charset=utf-8'});
 vi.spyOn(console,'error').mockImplementation(()=>{});
});
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();});
describe('private calendar source relay',()=>{
 it.each([{unsigned:true},{stale:true},{tamper:true}])('requires current unmodified HMAC before nonce/DNS/network (%j)',async options=>{
  expect((await POST(request(payload,options))).status).toBe(401);expect(mocks.rpc).not.toHaveBeenCalled();expect(mocks.download).not.toHaveBeenCalled();expect(console.error).not.toHaveBeenCalled();
 });
 it.each([{data:false,error:null},{data:null,error:{message:'nonce database unavailable'}}])('denies replay and failed nonce claims before any provider request (%j)',async result=>{
  mocks.rpc.mockResolvedValue(result);expect((await POST(request())).status).toBe(401);expect(mocks.download).not.toHaveBeenCalled();
 });
 it('claims the exact body once, returns original bytes and omits cookies/authorization',async()=>{
  const response=await POST(request());expect(response.status).toBe(200);expect(await response.text()).toBe('<html>Original bytes</html>');
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('sb_dart_relay_claim',expect.objectContaining({body_text:JSON.stringify(payload)}));
  expect(mocks.download).toHaveBeenCalledExactlyOnceWith(payload.url,{signal:expect.any(AbortSignal)});
  expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');expect(response.headers.get('cache-control')).toBe('no-store');expect(response.headers.get('set-cookie')).toBeNull();
 });
 it('rejects arbitrary method, credential/header fields and unsafe signed URL syntax without a claim',async()=>{
  for(const value of [{...payload,method:'POST'},{...payload,key:secret},{...payload,headers:{Authorization:'Bearer private'}},{...payload,url:'https://127.0.0.1/'},{...payload,nonce:[payload.nonce]}])
   expect((await POST(request(value))).status).toBe(422);
  expect(mocks.rpc).not.toHaveBeenCalled();expect(mocks.download).not.toHaveBeenCalled();
 });
 it('caps bodies before verification or network',async()=>{
  expect((await POST(request({...payload,padding:'x'.repeat(4096)}))).status).toBe(413);expect(mocks.rpc).not.toHaveBeenCalled();expect(mocks.download).not.toHaveBeenCalled();
 });
 it('logs only a fixed failure code after authorization, never exception URL/token/credentials',async()=>{
  mocks.download.mockRejectedValue(new Error('upstream https://private.example/?token=private-value '+secret));
  const response=await POST(request());expect(response.status).toBe(502);expect(await response.json()).toEqual({error:'calendar_source_failed'});
  expect(console.error).toHaveBeenCalledExactlyOnceWith('CALENDAR_SOURCE_FAILURE',{operation:'calendar_source',code:'source_unavailable'});
  expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toMatch(/private-value|private\.example/);expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(secret);
 });
 it('retains an allowlisted useful diagnostic while keeping the public failure generic',async()=>{
  mocks.download.mockRejectedValue(new Error('source_non_public_address'));const response=await POST(request());expect(await response.json()).toEqual({error:'calendar_source_failed'});
  expect(console.error).toHaveBeenCalledExactlyOnceWith('CALENDAR_SOURCE_FAILURE',{operation:'calendar_source',code:'source_non_public_address'});
 });
});
