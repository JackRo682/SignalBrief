// @vitest-environment node
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({rpc:vi.fn(),download:vi.fn()}));
vi.mock('@supabase/supabase-js',()=>({createClient:()=>({rpc:mocks.rpc})}));
vi.mock('../src/server/dart-relay',async original=>({...await original<typeof import('../src/server/dart-relay')>(),downloadDart:mocks.download}));
import {POST} from '../src/app/api/internal/dart/route';
import {relaySignature} from '../src/server/dart-relay';
import {directoryZip,listedXML,parsePayload,projectUrl,zipSha} from './dart-directory-fixture';
import {profileArchive,businessQuote} from './dart-profile-fixture';

const secret='a'.repeat(64),bytes=directoryZip(listedXML()),payload=parsePayload(zipSha(bytes));
function request(value:unknown=payload,options:{unsigned?:boolean;stale?:boolean;signatureBody?:string}={}){
 const body=JSON.stringify(value),timestamp=String(Date.now()-(options.stale?60001:0));
 return new Request('https://fixture.test/api/internal/dart',{method:'POST',headers:{'Content-Type':'application/json','x-sb-timestamp':timestamp,'x-sb-signature':options.unsigned?'':relaySignature(options.signatureBody??body,timestamp,secret)},body});
}
beforeEach(()=>{
 vi.clearAllMocks();vi.stubEnv('DART_RELAY_SECRET',secret);vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL',projectUrl);vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY','synthetic-public-key');
 vi.spyOn(console,'error').mockImplementation(()=>{});
 mocks.rpc.mockResolvedValue({data:true,error:null});vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(bytes)));
});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();vi.restoreAllMocks();});

describe('private directory parse relay route',()=>{
 it.each([{unsigned:true},{stale:true},{signatureBody:JSON.stringify({...payload,sha:'0'.repeat(64)})}])('requires a current unmodified HMAC before any storage request (%j)',async options=>{
  expect((await POST(request(payload,options))).status).toBe(401);expect(mocks.rpc).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
  expect(console.error).not.toHaveBeenCalled();
 });
 it.each([{data:false,error:null},{data:null,error:{message:'claim unavailable'}}])('fails closed on replay or nonce-store failure (%j)',async claim=>{
  mocks.rpc.mockResolvedValue(claim);expect((await POST(request())).status).toBe(401);expect(fetch).not.toHaveBeenCalled();expect(mocks.download).not.toHaveBeenCalled();
 });
 it('authenticates the exact source request, then returns only validated identities and their original hash',async()=>{
  const response=await POST(request());expect(response.status).toBe(200);const result=await response.json();
  expect(Object.keys(result)).toEqual(['source_sha256','items']);expect(result.source_sha256).toBe(payload.sha);expect(result.items).toHaveLength(100);
  expect(mocks.rpc).toHaveBeenCalledWith('sb_dart_relay_claim',expect.objectContaining({body_text:JSON.stringify(payload)}));
  expect(mocks.download).not.toHaveBeenCalled();expect(response.headers.get('cache-control')).toBe('no-store');
  const init=vi.mocked(fetch).mock.calls[0][1];expect(init?.headers).toBeUndefined();
 });
 it('denies signed arbitrary URLs and added credential fields without fetching',async()=>{
  for(const value of [{...payload,source_url:'https://attacker.test/file.zip'},{...payload,key:'b'.repeat(40)},{...payload,source_url:payload.source_url.replace('/directory/dart/','/private/')},{...payload,sha:'invalid'},{...payload,sha:[payload.sha]},{...payload,nonce:[payload.nonce]}])expect((await POST(request(value))).status).toBe(422);
  expect(fetch).not.toHaveBeenCalled();expect(mocks.rpc).not.toHaveBeenCalled();
 });
 it('reports corrupt or substituted source bytes as failure without exposing the signed URL',async()=>{
  vi.mocked(fetch).mockResolvedValue(new Response(directoryZip(listedXML(101))));
  const response=await POST(request());expect(response.status).toBe(502);expect(await response.json()).toEqual({error:'dart_relay_failed'});
  expect(console.error).toHaveBeenCalledExactlyOnceWith('DART_RELAY_FAILURE',{operation:'directory_parse',code:'directory_hash_mismatch'});
 });
 it('logs only an allowlisted diagnostic after authorization and never raw transport credentials',async()=>{
  const unsafe=`request failed: ${payload.source_url} key=${'b'.repeat(40)}`;
  vi.mocked(fetch).mockRejectedValue(new Error(unsafe));
  const response=await POST(request());expect(response.status).toBe(502);expect(await response.json()).toEqual({error:'dart_relay_failed'});
  expect(console.error).toHaveBeenCalledExactlyOnceWith('DART_RELAY_FAILURE',{operation:'directory_parse',code:'provider_unavailable'});
  expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(payload.source_url);
  expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('b'.repeat(40));
 });
 it('keeps existing signed binary directory relay behavior intact',async()=>{
  const legacy={kind:'directory',key:'b'.repeat(40),nonce:'d'.repeat(64)};mocks.download.mockResolvedValue({bytes,type:'application/zip'});
  const response=await POST(request(legacy));expect(response.status).toBe(200);expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
  expect(mocks.download).toHaveBeenCalledWith(new URL(`https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key=${legacy.key}`),20_000_000);expect(fetch).not.toHaveBeenCalled();
 });
 it('requires HMAC and replay protection for financial bytes and caps the fixed upstream at 2MB',async()=>{
  const financial={kind:'financials',key:'b'.repeat(40),nonce:'c'.repeat(64),corp_code:'12345678',bsns_year:'2025',reprt_code:'11011'};
  expect((await POST(request(financial,{unsigned:true}))).status).toBe(401);expect(mocks.download).not.toHaveBeenCalled();
  const source=Buffer.from('{"status":"013"}');mocks.download.mockResolvedValue({bytes:source,type:'application/json'});
  const response=await POST(request(financial));expect(response.status).toBe(200);expect(Buffer.from(await response.arrayBuffer())).toEqual(source);
  expect(mocks.rpc).toHaveBeenCalledWith('sb_dart_relay_claim',expect.objectContaining({body_text:JSON.stringify(financial)}));
  expect(mocks.download).toHaveBeenCalledWith(new URL(`https://opendart.fss.or.kr/api/fnlttSinglAcnt.json?corp_code=12345678&bsns_year=2025&reprt_code=11011&crtfc_key=${financial.key}`),2_000_000);
 });
 it('requires the same current HMAC and nonce claim for an exact issuer-bound profile archive',async()=>{
  const f=profileArchive();expect((await POST(request(f.payload,{unsigned:true}))).status).toBe(401);expect(fetch).not.toHaveBeenCalled();
  vi.mocked(fetch).mockResolvedValue(new Response(f.bytes));const response=await POST(request(f.payload));expect(response.status).toBe(200);
  expect((await response.json()).business[0].text).toBe(businessQuote);expect(mocks.rpc).toHaveBeenCalledWith('sb_dart_relay_claim',expect.objectContaining({body_text:JSON.stringify(f.payload)}));expect(mocks.download).not.toHaveBeenCalled();
 });
 it('rejects profile parse field injection, cross-bucket objects and wrong identity formats before any read',async()=>{
  const {payload:p}=profileArchive();
  for(const value of [{...p,key:'b'.repeat(40)},{...p,source_url:p.source_url.replace('/profiles/dart/','/private/')},{...p,corp_code:'evil.test'},{...p,receipt:'2026'},{...p,company_name:['Synthetic']},{...p,report_name:'arbitrary'}])expect((await POST(request(value))).status).toBe(422);
  expect(fetch).not.toHaveBeenCalled();expect(mocks.download).not.toHaveBeenCalled();expect(mocks.rpc).not.toHaveBeenCalled();
 });
 it('keeps periodic-list scope fixed to final official periodic filings for one issuer',async()=>{
  const periodic={kind:'periodic_list',key:'b'.repeat(40),nonce:'c'.repeat(64),corp_code:'12345678',bgn_de:'20250501',end_de:'20261102'};
  mocks.download.mockResolvedValue({bytes:Buffer.from('{"status":"013"}'),type:'application/json'});
  expect((await POST(request(periodic))).status).toBe(200);
  const url=mocks.download.mock.calls[0][0] as URL;expect(url.origin+url.pathname).toBe('https://opendart.fss.or.kr/api/list.json');
  expect(Object.fromEntries(url.searchParams)).toEqual({corp_code:'12345678',bgn_de:'20250501',end_de:'20261102',page_no:'1',page_count:'100',sort:'date',sort_mth:'desc',pblntf_ty:'A',last_reprt_at:'Y',crtfc_key:periodic.key});
  expect((await POST(request({...periodic,pblntf_ty:'B'}))).status).toBe(422);
 });
});
