// @vitest-environment node
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {ProviderError,obj,str} from '../../../supabase/functions/signalbrief-api/us-core';
import {dartRelay} from '../../../supabase/functions/signalbrief-collector/dart-relay';
import {DiscoveryError,parseSecDirectory,parseDartDirectoryResult,type DirectoryEntry} from '../../../supabase/functions/signalbrief-discovery/core';
import {directoryZip,largeDirectoryFixture,listedXML,projectUrl,zipSha} from './dart-directory-fixture';

const external=vi.hoisted(()=>({nonceRpc:vi.fn(),download:vi.fn()}));
vi.mock('@supabase/supabase-js',()=>({createClient:()=>({rpc:external.nonceRpc})}));
vi.mock('../src/server/dart-relay',async original=>({...await original<typeof import('../src/server/dart-relay')>(),downloadDart:external.download}));
import {POST} from '../src/app/api/internal/dart/route';

type Row=Record<string,unknown>;
type Snapshot={provider:string;lease:string;sha:string;object_key:string;items:DirectoryEntry[]};
const secret='a'.repeat(64),providerKey='b'.repeat(40),relayUrl='https://signalbrief.online/api/internal/dart';
const serviceUrl=new URL('../../../supabase/functions/signalbrief-discovery/service.ts',import.meta.url);

/** Keep the real Edge orchestration, HMAC client, Node route and parser together.
 * Only official HTTP bytes, private object storage and database RPCs are synthetic. */
function integration(bytes:Buffer,substitutedRead?:Buffer){
 vi.clearAllMocks();
 vi.stubEnv('DART_RELAY_SECRET',secret);
 vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL',projectUrl);
 vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY','synthetic-public-key');
 const order:string[]=[],objects=new Map<string,Buffer>(),nonces=new Set<string>();
 const relayBodies:Row[]=[],snapshots:Snapshot[]=[],failures:Row[]=[];
 const nodeCalls:{kind:string;wallMs:number;cpuMs:number;responseBytes:number}[]=[];
 external.nonceRpc.mockImplementation(async(name:string,args:Row)=>{
  expect(name).toBe('sb_dart_relay_claim');
  const payload=JSON.parse(String(args.body_text)) as Row,nonce=String(payload.nonce);
  expect(nonce).toMatch(/^[a-f0-9]{64}$/);
  const fresh=!nonces.has(nonce);nonces.add(nonce);
  return {data:fresh,error:null};
 });
 external.download.mockImplementation(async(url:URL,maxBytes:number)=>{
  expect(url.href).toBe(`https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key=${providerKey}`);
  expect(maxBytes).toBe(20_000_000);order.push('directory_download');
  return {bytes,type:'application/zip'};
 });
 const storage={
  upload:vi.fn(async(path:string,value:Uint8Array,options:Row)=>{
   expect(options).toEqual({contentType:'application/zip',upsert:false});
   expect(path).toBe(`directory/dart/${zipSha(bytes)}.zip`);
   expect(Buffer.from(value).equals(bytes)).toBe(true);
   expect(objects.has(path)).toBe(false);objects.set(path,Buffer.from(value));order.push('archive');
   return {error:null};
  }),
  createSignedUrl:vi.fn(async(path:string,ttl:number)=>{
   expect(objects.has(path)).toBe(true);expect(ttl).toBe(60);order.push('signed:60');
   return {data:{signedUrl:`${projectUrl}/storage/v1/object/sign/signalbrief-raw/${path}?token=synthetic.signed.token`},error:null};
  }),
 };
 const db={
  storage:{from:(bucket:string)=>{expect(bucket).toBe('signalbrief-raw');return storage;}},
  rpc:vi.fn(async(name:string,args:Row)=>{
   if(name==='sb_us_reserve'){expect(args).toEqual({p:'dart',amount:0,smoke:false});return {data:true,error:null};}
   expect(name).toBe('sb_discovery_admin');const p=obj(args.p);
   expect(p.provider).toBe('dart');expect(String(p.lease)).toMatch(/^[a-f0-9-]{36}$/);
   if(args.op==='claim')return {data:true,error:null};
   if(args.op==='save'){snapshots.push(p as Snapshot);order.push('save');return {data:{count:(p.items as unknown[]).length},error:null};}
   if(args.op==='fail'){failures.push(p);order.push('fail');return {data:{},error:null};}
   throw new Error(`Unexpected database operation: ${String(args.op)}`);
  }),
 };
 const fetcher=vi.fn<typeof fetch>(async(input,init)=>{
  const url=String(input);
  if(url===relayUrl){
   expect(init).toMatchObject({method:'POST',redirect:'error'});
   expect(init?.signal).toBeInstanceOf(AbortSignal);
   const payload=JSON.parse(String(init?.body)) as Row;relayBodies.push(payload);
   if(payload.kind==='directory_parse')order.push('directory_parse');
   const cpu=process.cpuUsage(),start=performance.now();
   const response=await POST(new Request(url,init));
   const used=process.cpuUsage(cpu),wallMs=performance.now()-start;
   const responseBytes=(await response.clone().arrayBuffer()).byteLength;
   nodeCalls.push({kind:String(payload.kind),wallMs,cpuMs:(used.user+used.system)/1000,responseBytes});
   return response;
  }
  const expectedPrefix=`${projectUrl}/storage/v1/object/sign/signalbrief-raw/`;
  if(url.startsWith(expectedPrefix)){
   expect(init).toMatchObject({method:'GET',cache:'no-store',redirect:'error'});
   expect(init?.headers).toBeUndefined();expect(init?.signal).toBeInstanceOf(AbortSignal);
   const parsed=new URL(url);expect(parsed.search).toBe('?token=synthetic.signed.token');
   const path=parsed.pathname.slice('/storage/v1/object/sign/signalbrief-raw/'.length),original=objects.get(path);
   expect(original).toBeDefined();order.push('storage_read');
   return new Response(new Uint8Array(substitutedRead??original!));
  }
  throw new Error(`Unexpected external request: ${url}`);
 });
 vi.stubGlobal('fetch',fetcher);
 const source=ts.transpileModule(readFileSync(serviceUrl,'utf8').replace(/^import .*\r?\n/gm,'').replace(/^export /gm,''),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
 const refreshDirectory=runInNewContext(source+'\nrefreshDirectory;',{
  obj,str,ProviderError,DiscoveryError,parseSecDirectory,parseDartDirectoryResult,dartRelay,
  crypto,Uint8Array,TextEncoder,TextDecoder,Date,URL,
  fetch:fetcher,Deno:{env:{get:()=>''}},
 }) as (db:unknown,secrets:Row,provider:'dart')=>Promise<Row>;
 return {run:()=>refreshDirectory(db,{DART_API_KEY:providerKey,DART_RELAY_SECRET:secret},'dart'),order,objects,storage,relayBodies,snapshots,failures,nodeCalls};
}

afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});

describe('DART full-registry Edge to Node integration',()=>{
 it('archives and authenticates a complete large registry before publishing hash-bound listed identities',async()=>{
  const workload=largeDirectoryFixture(),digest=zipSha(workload.bytes);
  expect(workload.expandedBytes).toBeGreaterThan(50_000_000);
  expect(workload.expandedBytes).toBeLessThanOrEqual(80_000_000);
  expect(workload.bytes.length).toBeLessThanOrEqual(20_000_000);
  const f=integration(workload.bytes),start=performance.now();
  expect(await f.run()).toEqual({provider:'dart',status:'ready',count:workload.listedCount});
  const totalWallMs=performance.now()-start;
  expect(f.order).toEqual(['directory_download','archive','signed:60','directory_parse','storage_read','save']);
  expect(f.failures).toEqual([]);expect(f.snapshots).toHaveLength(1);
  const saved=f.snapshots[0];
  expect(saved.sha).toBe(digest);expect(saved.object_key).toBe(`directory/dart/${digest}.zip`);
  expect(zipSha(f.objects.get(saved.object_key)!)).toBe(digest);
  expect(saved.items).toHaveLength(4000);
  expect(saved.items[0]).toEqual({provider_company_id:'00100000',ticker:'100000',name:'Synthetic Company 0',official_english_name:'Synthetic Research 0',market:'KR'});
  expect(saved.items.at(-1)).toEqual({provider_company_id:'00103999',ticker:'103999',name:'Synthetic Company 3999',official_english_name:'Synthetic Research 3999',market:'KR'});
  expect(saved.items.some(item=>item.name.includes('unlisted'))).toBe(false);
  expect(f.relayBodies).toHaveLength(2);expect(external.nonceRpc).toHaveBeenCalledTimes(2);
  const parseBody=f.relayBodies[1];
  expect(Object.keys(parseBody).sort()).toEqual(['kind','nonce','sha','source_url']);
  expect(parseBody).toMatchObject({kind:'directory_parse',sha:digest,source_url:`${projectUrl}/storage/v1/object/sign/signalbrief-raw/${saved.object_key}?token=synthetic.signed.token`});
  expect(f.relayBodies[0].nonce).not.toBe(parseBody.nonce);
  const parsed=f.nodeCalls.find(call=>call.kind==='directory_parse')!;
  expect(parsed.responseBytes).toBeLessThanOrEqual(4_000_000);
  expect(parsed.wallMs).toBeLessThan(15000);
  console.info('DART_DIRECTORY_BENCHMARK',JSON.stringify({synthetic:true,listed:workload.listedCount,unlisted:workload.unlistedCount,expanded_bytes:workload.expandedBytes,archive_bytes:workload.bytes.length,response_bytes:parsed.responseBytes,node_parse_wall_ms:Math.round(parsed.wallMs*100)/100,node_parse_cpu_ms:Math.round(parsed.cpuMs*100)/100,total_refresh_wall_ms:Math.round(totalWallMs*100)/100}));
 },25000);

 it('does not publish a snapshot when the signed storage read substitutes different original bytes',async()=>{
  const bytes=directoryZip(listedXML()),f=integration(bytes,directoryZip(listedXML(101)));
  expect(await f.run()).toEqual({provider:'dart',status:'unavailable',code:'relay_upstream_failed'});
  expect(f.snapshots).toEqual([]);expect(f.failures).toHaveLength(1);
  expect(f.order).toEqual(['directory_download','archive','signed:60','directory_parse','storage_read','fail']);
  expect(zipSha([...f.objects.values()][0])).toBe(zipSha(bytes));
  expect(f.failures[0].code).toBe('relay_upstream_failed');
  expect(JSON.stringify(f.failures)).not.toContain('synthetic.signed.token');
 });

 it('keeps ZIP inflation and full XML parsing dependencies outside the discovery Edge import graph',()=>{
  const visited=new Set<string>(),imports:string[]=[];
  function visit(url:URL){
   if(visited.has(url.href))return;visited.add(url.href);
   const source=ts.createSourceFile(url.pathname,readFileSync(url,'utf8'),ts.ScriptTarget.Latest,true);
   for(const statement of source.statements){
    if(!ts.isImportDeclaration(statement)||statement.importClause?.isTypeOnly||!ts.isStringLiteral(statement.moduleSpecifier))continue;
    const target=statement.moduleSpecifier.text;imports.push(target);
    if(target.startsWith('.'))visit(new URL(target,url));
   }
  }
  visit(new URL('../../../supabase/functions/signalbrief-discovery/index.ts',import.meta.url));
  expect(visited.has(serviceUrl.href)).toBe(true);
  expect(imports.join('\n')).not.toMatch(/(?:saxes|fflate|node:zlib|dart-document|dart-parser|server\/dart-directory)/);
 });
});
