// @vitest-environment node
import {randomUUID} from 'node:crypto';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({getUser:vi.fn(),rpc:vi.fn()}));
vi.mock('@supabase/supabase-js',()=>({createClient:()=>({auth:{getUser:mocks.getUser},rpc:mocks.rpc})}));
import {POST} from '../src/app/api/traffic/route';
import {journeyRequest,trafficRequest,trafficSessions,trafficSummary} from '../src/acquisition/contracts';

const query={action:'sessions',from:'2026-11-01',to:'2026-11-27'};
function request(body:unknown,token:string|null='synthetic-authenticated-token',origin='https://fixture.test'){
 return new Request('https://fixture.test/api/traffic',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});
}
beforeEach(()=>{
 vi.clearAllMocks();vi.stubEnv('VERCEL_ENV','production');vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://synthetic.supabase.co');vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY','synthetic-public');
 mocks.getUser.mockResolvedValue({data:{user:{id:randomUUID()}},error:null});
 mocks.rpc.mockResolvedValue({data:{generated_at:new Date().toISOString(),total:0,rows:[]},error:null});
});
afterEach(()=>vi.unstubAllEnvs());

describe('private session explorer transport',()=>{
 it('rejects unauthenticated and malformed sessions before consulting the database',async()=>{
  expect((await POST(request(query,null))).status).toBe(401);
  expect((await POST(request(query,'bad'))).status).toBe(401);
  expect(mocks.getUser).not.toHaveBeenCalled();expect(mocks.rpc).not.toHaveBeenCalled();
 });
 it('verifies bearer identity and preserves server administrator enforcement',async()=>{
  mocks.getUser.mockResolvedValueOnce({data:{user:null},error:{message:'expired'}});
  expect((await POST(request(query))).status).toBe(401);expect(mocks.rpc).not.toHaveBeenCalled();
  mocks.rpc.mockResolvedValueOnce({data:null,error:{code:'42501',message:'sensitive administrator information'}});
  const response=await POST(request(query));
  expect(response.status).toBe(403);expect(await response.json()).toEqual({error:'traffic_request_failed'});
 });
 it('forwards source and bounded pagination without caching the private result',async()=>{
  const body={...query,source:'kakao',offset:10000,limit:50};
  const response=await POST(request(body));
  expect(response.status).toBe(200);expect(mocks.getUser).toHaveBeenCalledOnce();
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('sb_traffic',{p:body});
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(trafficSessions.safeParse(await response.json()).success).toBe(true);
 });
 it.each([{offset:-1},{offset:10001},{offset:0.5},{limit:0},{limit:51},{limit:1.5},{source:''},{source:'email@example.com'},{session_id:randomUUID()},{user_agent:'private browser'},{from:'2026-02-30'}])('rejects unsupported session-query fields and bounds %j',async patch=>{
  expect((await POST(request({...query,...patch}))).status).toBe(422);expect(mocks.rpc).not.toHaveBeenCalled();
 });
 it('keeps origin and preview guards in front of private reads',async()=>{
  expect((await POST(request(query,'synthetic-authenticated-token','https://other.test'))).status).toBe(403);
  vi.stubEnv('VERCEL_ENV','preview');expect((await POST(request(query))).status).toBe(409);expect(mocks.rpc).not.toHaveBeenCalled();
 });
});

describe('tracking-version and reporting compatibility',()=>{
 const event={action:'prelogin',visitor_id:randomUUID(),secret:'a'.repeat(64),id:randomUUID(),session:randomUUID(),seq:1,page:'home',step:'view',source:'direct'};
 it('accepts old payloads without silently expanding their device consent',async()=>{
  const old={...event,consent_version:'2026-11-26.prelogin'};
  expect(journeyRequest.safeParse(old).success).toBe(true);
  expect(journeyRequest.safeParse({...old,device:'mobile'}).success).toBe(false);
  expect((await POST(request(old,null))).status).toBe(200);
  expect((await POST(request({...old,device:'mobile'},null))).status).toBe(422);
 });
 it.each(['mobile','tablet','desktop'])('accepts only the renewed coarse %s classification',device=>{
  const current={...event,consent_version:'2026-11-27.prelogin',device};
  expect(trafficRequest.safeParse(current).success).toBe(true);
  expect(trafficRequest.safeParse({...current,width:390}).success).toBe(false);
  expect(trafficRequest.safeParse({...current,user_agent:'synthetic-agent'}).success).toBe(false);
  expect(trafficRequest.safeParse({...current,device:'unknown'}).success).toBe(false);
 });
 it('retains old summaries and distinguishes missing measurement coverage from zero events',()=>{
  const count={visitors:0,pageviews:0,starts:0,requests:0,signups:0,onboarded:0};
  const old={generated_at:'2026-11-27T00:00:00Z',totals:count,daily:[],sources:[]};
  expect(trafficSummary.safeParse(old).success).toBe(true);
  expect(trafficSummary.parse({...old,measurement:{first_acquisition_at:null,first_journey_at:null,first_surface_at:null,retained_from:'2026-08-29T00:00:00Z'},journey_daily:[],journey_devices:[{device:'unknown',sessions:3}]}).measurement?.first_journey_at).toBeNull();
  expect(trafficSummary.safeParse({...old,journey_devices:[{device:'phone-model',sessions:3}]}).success).toBe(false);
 });
 it('validates a bounded anonymized journey, including explicit step truncation',()=>{
  const at='2026-11-27T00:00:00Z',step={seq:1,page:'home',step:'view',at};
  const row={session_id:randomUUID(),source:'kakao',device:'unknown',started_at:at,last_at:at,entry_page:'home',last_page:'home',last_step:'view',events:101,closed:true,any_auth_attempt:false,steps:[step],steps_truncated:true};
  const result={generated_at:at,total:1,rows:[row]};
  expect(trafficSessions.parse(result).rows[0].steps_truncated).toBe(true);
  expect(trafficSessions.safeParse({...result,rows:[{...row,steps:Array.from({length:101},(_,i)=>({...step,seq:i+1}))}]}).success).toBe(false);
  expect(trafficSessions.safeParse({...result,rows:Array(51).fill(row)}).success).toBe(false);
  expect(trafficSessions.safeParse({...result,rows:[{...row,steps:[{...step,page:'/login?email=private'}]}]}).success).toBe(false);
 });
});
