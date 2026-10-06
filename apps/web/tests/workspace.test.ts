// @vitest-environment node
import {describe,it,expect,vi,beforeEach,afterEach} from 'vitest';
import {workspaceRequest,preferenceValue,defaults,chartPoints,safeSource,resourceHref,resourceSchema,documentDetailSchema} from '../src/workspace/contracts';
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
 it('bounds exact document-detail reads and rejects caller identity and invalid pagination',()=>{
  expect(workspaceRequest.parse({action:'document_detail',p:{id,kind:'document',section_offset:12}}).p).toEqual({id,kind:'document',section_offset:12});
  for(const patch of [{id:'not-an-id'},{kind:'company'},{section_offset:-1},{section_offset:1.5},{section_offset:2147483601},{section_offset:'12'},{user_id:id}])expect(workspaceRequest.safeParse({action:'document_detail',p:{id,kind:'filing',...patch}}).success).toBe(false);
 });
 it('keeps unknown source metadata null and exact financial values as strings',()=>{
  const source={id,kind:'filing',title:'Synthetic source',summary:'',company_id:id,company_name:'Synthetic',ticker:'TEST',market:'NASDAQ',source_url:'https://www.sec.gov/test.htm',published_at:null,publication_precision:'date',category:'10-K',is_saved:false};
  const data={document:source,metadata:{mime_type:null,size_bytes:null,page_count:null,provider:'sec',publication_timezone:null,ingested_at:null,raw_sha256:null},summaries:[],facts:[{id,field:'revenue',value_raw:'999999999999.12345678',unit:'USD',period:null,basis:'reported',quote:'Synthetic cited quote',event_id:id,origin_event_id:id,source_url:source.source_url,location:'Synthetic section'}],sections:[],sections_total:0,next_section_offset:null,events:[],related:[],counts:{summaries:0,facts:1,events:0,related:0}};
  expect(documentDetailSchema.parse(data).facts[0].value_raw).toBe('999999999999.12345678');
  expect(documentDetailSchema.safeParse({...data,metadata:{...data.metadata,page_count:0}}).success).toBe(false);
 });
 it('supports search-only deletion and rejects caller identity or broad payloads',()=>{
  expect(workspaceRequest.parse({action:'search_delete',p:{query:' TEST '}})).toEqual({action:'search_delete',p:{query:'TEST'}});
  expect(workspaceRequest.parse({action:'searches_clear',p:{}}).action).toBe('searches_clear');
  for(const p of [{query:''},{query:'x'.repeat(101)},{query:'TEST',user_id:id}])expect(workspaceRequest.safeParse({action:'search_delete',p}).success).toBe(false);
  expect(workspaceRequest.safeParse({action:'searches_clear',p:{history:true}}).success).toBe(false);
 });
 it('accepts bounded onboarding deltas and an empty skip without replacing lists',()=>{
  const empty={company_ids:[],removed_company_ids:[],positions:[]};
  expect(workspaceRequest.parse({action:'onboarding_complete',p:empty}).p).toEqual(empty);
  const p={...empty,company_ids:[id],positions:[{company_id:id,quantity:'1000.00000001',average_cost:'99.50000001',currency:'EUR'}],analytics_consent:false};
  expect(workspaceRequest.parse({action:'onboarding_complete',p}).p).toEqual(p);
 });
 it('rejects unbounded, malformed or caller-owned onboarding fields',()=>{
  const empty={company_ids:[],removed_company_ids:[],positions:[]};
  for(const p of [{...empty,user_id:id},{...empty,company_ids:Array(11).fill(id)},{...empty,removed_company_ids:Array(51).fill(id)},{...empty,analytics_consent:'false'},{company_ids:[],positions:[]}])expect(workspaceRequest.safeParse({action:'onboarding_complete',p}).success).toBe(false);
  for(const patch of [{quantity:'0'},{quantity:'0.00000000'},{quantity:'1e3'},{quantity:'-1'},{quantity:'1.000000001'},{quantity:1},{average_cost:'NaN'},{average_cost:'-1'},{average_cost:'1.000000001'},{currency:'BTC'},{user_id:id}]){
   const row={company_id:id,quantity:'1.5',average_cost:null,currency:'USD',...patch};
   expect(workspaceRequest.safeParse({action:'onboarding_complete',p:{...empty,positions:[row]}}).success).toBe(false);
  }
 });
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
 it.each([{action:'search_delete',p:{query:'TEST'}},{action:'searches_clear',p:{}}])('dispatches $action only to the scoped search RPC',async value=>{
  mock.rpc.mockResolvedValue({data:{cleared:true,deleted:1},error:null});
  const r=await POST(req(value));expect(r.status).toBe(200);expect(mock.rpc).toHaveBeenCalledWith('sb_workspace_searches',value);
  expect(mock.rpc).not.toHaveBeenCalledWith('sb_workspace',expect.objectContaining({action:'history_clear'}));
 });
 it('dispatches onboarding completion to the delta RPC with the exact validated payload',async()=>{
  const p={company_ids:[id],removed_company_ids:[],positions:[],analytics_consent:false};
  mock.rpc.mockResolvedValue({data:{id,onboarding_completed:true},error:null});
  const r=await POST(req({action:'onboarding_complete',p}));
  expect(r.status).toBe(200);expect(await r.json()).toEqual({id,onboarding_completed:true});
  expect(mock.rpc).toHaveBeenCalledExactlyOnceWith('sb_mobile_onboarding',{p});
 });
 it('dispatches document-detail reads only to their reviewed projection RPC',async()=>{
  const p={id,kind:'document',section_offset:12};mock.rpc.mockResolvedValue({data:{sections:[],sections_total:12,next_section_offset:null},error:null});
  const r=await POST(req({action:'document_detail',p}));expect(r.status).toBe(200);expect(mock.rpc).toHaveBeenCalledExactlyOnceWith('sb_document_detail',{p});expect(r.headers.get('Cache-Control')).toContain('private, no-store');
 });
 it('preserves hidden-document denial without exposing provider metadata',async()=>{
  mock.rpc.mockResolvedValue({data:null,error:{code:'PT404',message:'resource_not_available',details:'private provider content'}});
  const r=await POST(req({action:'document_detail',p:{id,kind:'document'}}));expect(r.status).toBe(404);expect(await r.json()).toEqual({error:{code:'resource_not_available'}});
 });
 it('returns onboarding persistence errors without reporting completion',async()=>{
  mock.rpc.mockResolvedValue({data:null,error:{code:'PT422',message:'watchlist_limit_50'}});
  const r=await POST(req({action:'onboarding_complete',p:{company_ids:[],removed_company_ids:[],positions:[]}}));
  expect(r.status).toBe(422);expect(await r.json()).toEqual({error:{code:'watchlist_limit_50'}});
 });
 it.each([['PT409',409],['PT403',403],['PT404',404],['PT429',429],['PGRST202',503]])('preserves safe actionable status %s',async(code,status)=>{mock.rpc.mockResolvedValueOnce({data:null,error:{code,message:'request_failed'}});expect((await POST(req({action:'preferences',p:{}}))).status).toBe(status);});
 it('does not leak database detail in errors',async()=>{mock.rpc.mockResolvedValueOnce({data:null,error:{code:'42501',message:'sensitive table row details'}});const r=await POST(req({action:'preferences',p:{}}));expect(await r.text()).not.toContain('sensitive');});
 it('fails closed when configuration is missing or not Supabase HTTPS',async()=>{vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','http://127.0.0.1/internal');expect((await POST(req({action:'preferences',p:{}}))).status).toBe(503);expect(mock.createClient).not.toHaveBeenCalled();});
});
