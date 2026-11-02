// @vitest-environment node
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {describe,it,expect,vi} from 'vitest';
import {ProfileError} from '../../../supabase/functions/signalbrief-profiles/core';
import {dartProfileFilings,dartPublicSource,validateDartProfileResult} from '../../../supabase/functions/signalbrief-profiles/enrichment-dart-core';
import {emptyEnrichment} from '../../../supabase/functions/signalbrief-profiles/enrichment-service';
import type {ProfileEnrichmentSnapshot} from '../../../supabase/functions/signalbrief-profiles/enrichment-types';
import {koreaDate} from '../../../supabase/functions/signalbrief-collector/core';
import {parseDartProfileArchive,type ProfileParsePayload} from '../src/server/dart-profile-archive';
import {businessQuote,dartProfileCompany,dartProfileName,periodicList,profileArchive,profileXML} from './dart-profile-fixture';

function fixture(xml=profileXML()){
 const raw=profileArchive(xml),order:string[]=[],state={list:periodicList(),archiveFailed:false,signedFailed:false,wrongResult:false,listingFailed:false};
 const secret='a'.repeat(64),now=new Date('2026-11-02T01:00:00Z'),filingId='50000000-0000-4000-8000-000000000008';
 const uploads:{path:string;bytes:Uint8Array;type:string}[]=[];
 const archive=vi.fn(async(path:string,bytes:Uint8Array,type:string)=>{order.push('archive:'+path.split('/').slice(0,2).join('/'));if(state.archiveFailed)throw new ProfileError('profile_archive_failed');uploads.push({path,bytes,type});});
 const signed=vi.fn(async(path:string,seconds:number)=>{order.push('signed');expect(seconds).toBe(60);expect(uploads.some(item=>item.path===path)).toBe(true);return {data:{signedUrl:raw.payload.source_url},error:state.signedFailed?{message:'private signing failure'}:null};});
 const upsert=vi.fn((value:unknown)=>{void value;order.push('filing');return {select:()=>({single:async()=>({data:{id:filingId},error:state.listingFailed?{message:'synthetic failure'}:null})})};});
 const db={from:vi.fn(()=>({upsert})),storage:{from:vi.fn(()=>({createSignedUrl:signed}))}};
 const dartRelay=vi.fn(async(payload:Record<string,unknown>,key:string,timeout:number,signal:AbortSignal)=>{
  expect(key).toBe(secret);expect(timeout).toBeLessThanOrEqual(12000);expect(signal).toBeInstanceOf(AbortSignal);order.push('relay:'+payload.kind);
  if(payload.kind==='periodic_list')return new TextEncoder().encode(state.list);
  if(payload.kind==='document')return raw.bytes;
  if(payload.kind==='profile_parse'){
   expect(uploads.some(item=>item.path===`profiles/dart/${payload.sha}.zip`)).toBe(true);
   const parsed=parseDartProfileArchive(raw.bytes,{...raw.payload,...payload} as ProfileParsePayload);
   if(state.wrongResult)parsed.normalized_sha256='b'.repeat(64);
   return new TextEncoder().encode(JSON.stringify(parsed));
  }
  throw new Error('Unexpected transport');
 });
 const source=readFileSync(new URL('../../../supabase/functions/signalbrief-profiles/enrichment-dart.ts',import.meta.url),'utf8').replace(/^import .*\r?\n/gm,'').replace(/^export /gm,'');
 const context={ProfileError,dartRelay,koreaDate,dartProfileFilings,dartPublicSource,validateDartProfileResult,emptyEnrichment,crypto,Date,Uint8Array,TextEncoder,TextDecoder,collectDartProfileEnrichment:undefined as undefined|((...args:unknown[])=>Promise<ProfileEnrichmentSnapshot>)};
 runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText,context);
 const reserve=vi.fn().mockResolvedValue(undefined),signal=new AbortController().signal;
 const collect=()=>context.collectDartProfileEnrichment!(db,dartProfileCompany,dartProfileName,{DART_API_KEY:'b'.repeat(40),DART_RELAY_SECRET:secret},{archive,reserve,signal,now:()=>now});
 return {state,raw,order,uploads,archive,signed,upsert,db,dartRelay,collect,reserve,filingId};
}
describe('DART profile Edge→Node archive boundary',()=>{
 it('archives official listing and ZIP before Node parsing, then archives exact normalized evidence',async()=>{
  const f=fixture(),snapshot=await f.collect();expect(snapshot.result.status).toBe('partial');expect(snapshot.result.business[0].text).toBe(businessQuote);
  expect(f.order).toEqual(['relay:periodic_list','archive:dart/lists','filing','relay:document','archive:profiles/dart','signed','relay:profile_parse','archive:profiles/dart']);
  expect(f.reserve).toHaveBeenCalledTimes(2);
  const source=snapshot.archives[0],normalized=f.uploads.find(value=>value.path===source.normalized_object_key)!;
  expect(new TextDecoder().decode(normalized.bytes)).toBe(source.normalized_text);
  expect(source).toMatchObject({filing_id:f.filingId,provider_company_id:'12345678',ticker:'123456',published_on:'2026-08-14',report_period:'2026-06',publication_timezone:'Asia/Seoul'});
  expect(snapshot.result.sources[0]).toMatchObject({source_sha256:f.raw.payload.sha,normalized_sha256:source.normalized_sha256});
  for(const field of ['object_key','normalized_object_key','filing_id','normalized_text'])expect(JSON.stringify(snapshot.result)).not.toContain('"'+field+'":');
  expect(f.upsert).toHaveBeenCalledWith(expect.objectContaining({company_id:dartProfileCompany.id,source_object_key:expect.stringMatching(/^dart\/lists\/[a-f0-9]{64}\.json$/)}),expect.anything());
  expect(snapshot.result.leadership).toEqual([]);expect(snapshot.result.formation).toEqual([]);
 });
 it('reports recovered markup explicitly without producing approved analysis or changing registry basics',async()=>{
  const f=fixture(profileXML().replace('<P>'+businessQuote,'<P ENG="bad "attribute"">'+businessQuote)),snapshot=await f.collect();
  expect(snapshot.result.status).toBe('partial');expect(snapshot.result.limitations).toContain('source_markup_recovery_requires_review');
  expect(snapshot.result.sources[0].normalization).toBe('dart-periodic-recovered-text-v1');
  expect(f.db.from).toHaveBeenCalledExactlyOnceWith('dart_filings');
 });
 it.each(['archiveFailed','signedFailed','listingFailed','wrongResult'] as const)('publishes no snapshot when %s fails',async key=>{
  const f=fixture();f.state[key]=true;await expect(f.collect()).rejects.toThrow();
  if(key==='archiveFailed')expect(f.dartRelay).toHaveBeenCalledTimes(1);
  if(key==='listingFailed')expect(f.signed).not.toHaveBeenCalled();
  expect(f.uploads.some(value=>value.path.includes('/normalized/'))).toBe(false);
 });
 it('distinguishes explicit absence from provider failure without downloading an unrelated document',async()=>{
  const absent=fixture();absent.state.list='{"status":"013"}';expect((await absent.collect()).result).toMatchObject({status:'not_available',limitations:['periodic_report_not_found']});expect(absent.dartRelay).toHaveBeenCalledTimes(1);expect(absent.upsert).not.toHaveBeenCalled();
  const failed=fixture();failed.state.list='{"status":"020"}';await expect(failed.collect()).rejects.toThrow('profile_source_rate_limited');expect(failed.dartRelay).toHaveBeenCalledTimes(1);
 });
 it('contains no ZIP inflation, XML parsing or arbitrary fetch inside the Edge acquisition graph',()=>{
  const source=readFileSync(new URL('../../../supabase/functions/signalbrief-profiles/enrichment-dart.ts',import.meta.url),'utf8');
  expect(source).not.toMatch(/unzip|inflate|saxes|htmlparser2|fetch\(/);expect(source).toContain("kind:'profile_parse'");
 });
});
