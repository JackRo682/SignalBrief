// @vitest-environment node
import {describe,it,expect,vi,beforeEach,afterEach} from 'vitest';
import {workspaceRequest,preferenceValue,defaults,chartPoints,safeSource,resourceHref,resourceSchema} from '../src/workspace/contracts';
import {searchHelp,helpArticles as articles} from '../src/workspace/help-content';
import {POST} from '../src/app/api/workspace/route';
const mock=vi.hoisted(()=>({getUser:vi.fn(),rpc:vi.fn(),createClient:vi.fn()}));
vi.mock('@supabase/supabase-js',()=>({createClient:mock.createClient}));
const id='20000000-0000-4000-8000-000000000001';
function req(value:unknown,headers:Record<string,string>={}){return new Request('https://app.example/api/workspace',{method:'POST',headers:{authorization:'Bearer isolated_fixture_token_0123456789','content-type':'application/json',...headers},body:typeof value==='string'?value:JSON.stringify(value)});}
beforeEach(()=>{vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://fixture.supabase.co');vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY','sb_publishable_test_only');mock.createClient.mockReturnValue({auth:{getUser:mock.getUser},rpc:mock.rpc});mock.getUser.mockResolvedValue({data:{user:{id}},error:null});mock.rpc.mockResolvedValue({data:{value:defaults,version:0},error:null});});
afterEach(()=>{vi.clearAllMocks();vi.unstubAllEnvs();});
describe('workspace contracts and deterministic presentation',()=>{
 it('validates the actual default preferences',()=>expect(preferenceValue.parse(defaults)).toEqual(defaults));
 it.each([{daily_cap:0},{daily_cap:101},{daily_cap:1.5},{font_scale:4},{quiet_start:'24:00'},{quiet_end:'2:4'},{locale:'xx'},{history_enabled:'true'},{muted_companies:['wrong']},{bio:'x'.repeat(161)}])('rejects invalid preference %j',patch=>expect(preferenceValue.safeParse({...defaults,...patch}).success).toBe(false));
 it.each([{user_id:id},{admin:true},{service_key:'not-a-secret'}])('rejects caller-selected identity in a preferences payload %j',p=>expect(workspaceRequest.safeParse({action:'preferences',p}).success).toBe(false));
 it('rejects arbitrary actions',()=>expect(workspaceRequest.safeParse({action:'execute_sql',p:{}}).success).toBe(false));
 it('bounds search and pagination',()=>{for(const p of [{q:'x'.repeat(101)},{offset:1001},{limit:51},{days:-1},{sort:'random'}])expect(workspaceRequest.safeParse({action:'catalog',p}).success).toBe(false);});
 it('has exact source lookup distinct from paginated catalog',()=>expect(workspaceRequest.parse({action:'resource',p:{id,kind:'filing'}}).action).toBe('resource'));
 it('supports durable notification settings but not imaginary delivery toggles',()=>{expect(workspaceRequest.safeParse({action:'notification_save',p:{realtime_enabled:true,notify_min_score:.8}}).success).toBe(true);expect(workspaceRequest.safeParse({action:'notification_save',p:{email_enabled:true}}).success).toBe(false);});
 it.each(['javascript:alert(1)','data:text/html,test','http://unsafe.example','https://name:password@example.com','not-a-url'])('rejects unsafe source link %s',url=>expect(safeSource(url)).toBeUndefined());
 it('does not fabricate a chart from missing, single or non-finite values',()=>{expect(chartPoints([])).toBeNull();expect(chartPoints([1])).toBeNull();expect(chartPoints([1,NaN])).toBeNull();expect(chartPoints([4,4])).toBe('0,32 200,32');});
 it('links source resources to their exact details',()=>{const r=resourceSchema.parse({id,kind:'filing',title:'Fixture source',summary:'',company_id:id,company_name:'Fixture',ticker:'TEST',market:'NASDAQ',source_url:null,published_at:null,publication_precision:'date',category:'10-K',is_saved:true});expect(resourceHref(r)).toBe(`/documents/${id}?kind=filing`);});
 it('searches authored help articles without fabricated result counts',()=>{expect(articles.length).toBeGreaterThan(0);expect(searchHelp('zzzz-nomatch','')).toHaveLength(0);expect(searchHelp('','')).toHaveLength(articles.length);});
});
describe('authenticated workspace BFF',()=>{
 it('denies absent bearer credentials before any database call',async()=>{expect((await POST(req({action:'preferences',p:{}},{authorization:''}))).status).toBe(401);expect(mock.createClient).not.toHaveBeenCalled();});
 it('rejects cross-origin mutation requests',async()=>expect((await POST(req({action:'preferences',p:{}},{origin:'https://other.example'}))).status).toBe(403));
 it('rejects non-JSON and malformed JSON',async()=>{expect((await POST(req('{}',{'content-type':'text/plain'}))).status).toBe(415);expect((await POST(req('{'))).status).toBe(422);});
 it('bounds streamed bodies without trusting Content-Length',async()=>expect((await POST(req('"'+'x'.repeat(32769)+'"'))).status).toBe(413));
 it('rejects unknown root fields and ownership injection',async()=>{for(const v of [{action:'preferences',p:{},user_id:id},{action:'preferences',p:{user_id:id}}])expect((await POST(req(v))).status).toBe(422);expect(mock.rpc).not.toHaveBeenCalled();});
 it('checks Auth.getUser and does not merely decode an unverified token',async()=>{mock.getUser.mockResolvedValueOnce({data:{user:null},error:{message:'bad'}});expect((await POST(req({action:'preferences',p:{}}))).status).toBe(401);expect(mock.rpc).not.toHaveBeenCalled();});
 it('uses caller JWT, public project key, private no-store response and server ownership',async()=>{const r=await POST(req({action:'preferences',p:{}}));expect(r.status).toBe(200);expect(r.headers.get('Cache-Control')).toContain('private, no-store');expect(mock.rpc).toHaveBeenCalledWith('sb_workspace',{action:'preferences',p:{}});expect(mock.createClient.mock.calls[0][2].global.headers.Authorization).toContain('isolated_fixture_token');});
 it.each([['PT409',409],['PT403',403],['PT404',404],['PT429',429],['PGRST202',503]])('preserves safe actionable status %s',async(code,status)=>{mock.rpc.mockResolvedValueOnce({data:null,error:{code,message:'request_failed'}});expect((await POST(req({action:'preferences',p:{}}))).status).toBe(status);});
 it('does not leak database detail in errors',async()=>{mock.rpc.mockResolvedValueOnce({data:null,error:{code:'42501',message:'sensitive table row details'}});const r=await POST(req({action:'preferences',p:{}}));expect(await r.text()).not.toContain('sensitive');});
 it('fails closed when configuration is missing or not Supabase HTTPS',async()=>{vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','http://127.0.0.1/internal');expect((await POST(req({action:'preferences',p:{}}))).status).toBe(503);expect(mock.createClient).not.toHaveBeenCalled();});
});
