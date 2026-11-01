// @vitest-environment node
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({rpc:vi.fn(),download:vi.fn()}));
vi.mock('@supabase/supabase-js',()=>({createClient:()=>({rpc:mocks.rpc})}));
vi.mock('../src/server/dart-relay',async original=>({...await original<typeof import('../src/server/dart-relay')>(),downloadDart:mocks.download}));
import {POST} from '../src/app/api/internal/dart/route';
import {relaySignature} from '../src/server/dart-relay';
import {directoryZip,listedXML,parsePayload,projectUrl,zipSha} from './dart-directory-fixture';

const secret='a'.repeat(64),bytes=directoryZip(listedXML()),payload=parsePayload(zipSha(bytes));
function request(value:unknown=payload,options:{unsigned?:boolean;stale?:boolean;signatureBody?:string}={}){
 const body=JSON.stringify(value),timestamp=String(Date.now()-(options.stale?60001:0));
 return new Request('https://fixture.test/api/internal/dart',{method:'POST',headers:{'Content-Type':'application/json','x-sb-timestamp':timestamp,'x-sb-signature':options.unsigned?'':relaySignature(options.signatureBody??body,timestamp,secret)},body});
}
beforeEach(()=>{
 vi.clearAllMocks();vi.stubEnv('DART_RELAY_SECRET',secret);vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL',projectUrl);vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY','synthetic-public-key');
 mocks.rpc.mockResolvedValue({data:true,error:null});vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(bytes)));
});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});

describe('private directory parse relay route',()=>{
 it.each([{unsigned:true},{stale:true},{signatureBody:JSON.stringify({...payload,sha:'0'.repeat(64)})}])('requires a current unmodified HMAC before any storage request (%j)',async options=>{
  expect((await POST(request(payload,options))).status).toBe(401);expect(mocks.rpc).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
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
 });
 it('keeps existing signed binary directory relay behavior intact',async()=>{
  const legacy={kind:'directory',key:'b'.repeat(40),nonce:'d'.repeat(64)};mocks.download.mockResolvedValue({bytes,type:'application/zip'});
  const response=await POST(request(legacy));expect(response.status).toBe(200);expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
  expect(mocks.download).toHaveBeenCalledWith(new URL(`https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key=${legacy.key}`),20_000_000);expect(fetch).not.toHaveBeenCalled();
 });
});
