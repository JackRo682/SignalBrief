// @vitest-environment node
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {describe,it,expect,vi} from 'vitest';
import {ProfileError,parseSecProfile} from '../../../supabase/functions/signalbrief-profiles/core';
import {emptyEnrichment,profileFailureCode} from '../../../supabase/functions/signalbrief-profiles/enrichment-service';
import type {ProfileEnrichment} from '../../../supabase/functions/signalbrief-profiles/enrichment-types';
const company={id:'20000000-0000-4000-8000-000000000001',provider_company_id:'0000000123',ticker:'SYN'};
function result():ProfileEnrichment{
 const now=new Date().toISOString(),value=emptyEnrichment(company.id,now,'products_not_explicitly_identified','partial');value.last_error=null;
 value.next_refresh_at=new Date(Date.now()+86400_000).toISOString();return value;
}
function fixture(){
 let cached:ProfileEnrichment|null=null,claim=true,persistence=true;const next=result();
 let secrets:Record<string,string>={SEC_CONTACT_EMAIL:'audit@example.test'};
 const collectSecProfileEnrichment=vi.fn().mockResolvedValue({result:next,archives:[]});
 const collectDartProfileEnrichment=vi.fn().mockResolvedValue({result:emptyEnrichment(company.id,new Date().toISOString(),'periodic_report_not_found','not_available'),archives:[]});
 const providerFetch=vi.fn().mockResolvedValue(JSON.stringify({cik:'123',tickers:['SYN'],name:'Synthetic company'}));
 const rpc=vi.fn(async(name:string,args:Record<string,unknown>={})=>{
  if(name==='sb_profile_enrichment_admin'){
   if(!persistence)return {error:{message:'credential-bearing-private-message'},data:null};
   const p=args.p as Record<string,unknown>;
   if(args.op==='read')return {error:null,data:{result:cached,official_sources:[]}};
   if(args.op==='claim')return {error:null,data:claim};
   if(args.op==='save')return {error:null,data:p.result};
   if(args.op==='fail')return {error:null,data:cached?{...cached,status:'partial',last_error:p.code}:emptyEnrichment(company.id,new Date().toISOString(),String(p.code))};
  }
  return {error:null,data:name==='sb_us_secrets'?secrets:true};
 });
 const upload=vi.fn().mockResolvedValue({error:null});const db={rpc,storage:{from:()=>({upload})}};
 const source=readFileSync(new URL('../../../supabase/functions/signalbrief-profiles/enrichment.ts',import.meta.url),'utf8').replace(/^import .*\r?\n/gm,'').replace(/^export /gm,'');
 const context={db,ProfileError,parseSecProfile,providerFetch,collectSecProfileEnrichment,collectDartProfileEnrichment,emptyEnrichment,profileFailureCode,crypto,Date,URL,Uint8Array,TextEncoder,TextDecoder,fetch,loadProfileEnrichment:undefined as undefined|((...args:unknown[])=>Promise<ProfileEnrichment>)};
 runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText,context);
 const get=(provider='sec',raw:string|null='synthetic-verified-submissions',environment:Record<string,string>={})=>context.loadProfileEnrichment!(db,company,provider,{status:'verified',profile:{name:'Synthetic company'}},raw??undefined,{contact:'audit@example.test',signal:new AbortController().signal,...environment});
 return {get,rpc,upload,providerFetch,collect:collectSecProfileEnrichment,collectDart:collectDartProfileEnrichment,next,setSecrets:(value:Record<string,string>)=>{secrets=value;},setCached:(value:ProfileEnrichment)=>{cached=value;},setClaim:(value:boolean)=>{claim=value;},setPersistence:(value:boolean)=>{persistence=value;}};
}
describe('profile enrichment cache, source priority and recovery',()=>{
 it('reuses a current enrichment without extra provider work or a new lease',async()=>{const f=fixture(),cached=result();f.setCached(cached);expect(await f.get()).toEqual(cached);expect(f.collect).not.toHaveBeenCalled();expect(f.rpc).toHaveBeenCalledTimes(1);});
 it('refreshes an expired enrichment independently of the existing basic metadata cache',async()=>{const f=fixture(),cached=result();cached.next_refresh_at=new Date(Date.now()-1).toISOString();f.setCached(cached);expect(await f.get()).toEqual(f.next);expect(f.collect).toHaveBeenCalledOnce();expect(f.rpc).toHaveBeenCalledWith('sb_profile_enrichment_admin',expect.objectContaining({op:'save'}));});
 it('does not start duplicate provider requests while another real lease owns the company',async()=>{const f=fixture();f.setClaim(false);const data=await f.get();expect(data.status).toBe('unavailable');expect(data.last_error).toBe('profile_refresh_in_progress');expect(f.collect).not.toHaveBeenCalled();});
 it('preserves dated official leadership if its refresh failed instead of replacing it with an older filing CEO',async()=>{
  const f=fixture(),cached=result();cached.next_refresh_at=new Date(Date.now()-1).toISOString();
  cached.leadership=[{name:'Current Source Executive',role:'Chief Executive Officer',as_of:'2026-10-01',basis:'official_page',evidence:{source_id:'a'.repeat(64),quote:'Current Source Executive, Chief Executive Officer',location:{kind:'normalized_text',start:0,end:46,section:'Official leadership'}}}];
  f.setCached(cached);f.next.leadership=[{...cached.leadership[0],name:'Historical Executive',as_of:'2025-01-01',basis:'filing'}];f.next.limitations=['leadership_page_unavailable'];
  const actual=await f.get();expect(actual.leadership).toEqual(cached.leadership);expect(actual.checked_at).toBe(cached.checked_at);expect(actual.last_error).toBe('authoritative_profile_refresh_unavailable');
  expect(f.rpc.mock.calls.some(([,args])=>args?.op==='save')).toBe(false);
 });
 it('reports source failure independently without returning raw exception or credential text',async()=>{const f=fixture();f.collect.mockRejectedValue(new Error('https://private.test/?secret=should-not-appear'));const value=await f.get();expect(value.status).toBe('unavailable');expect(value.last_error).toBe('profile_source_unavailable');expect(JSON.stringify(value)).not.toContain('should-not-appear');});
 it('fails safely when optional profile persistence is unavailable',async()=>{const f=fixture();f.setPersistence(false);expect(await f.get()).toMatchObject({status:'unavailable',last_error:'profile_persistence_unavailable'});expect(f.collect).not.toHaveBeenCalled();});
 it('revalidates and archives current submissions when only old basic metadata was cached',async()=>{const f=fixture();await f.get('sec',null);expect(f.providerFetch).toHaveBeenCalledOnce();expect(f.upload).toHaveBeenCalledOnce();expect(f.collect).toHaveBeenCalledOnce();});
 it('routes verified Korean basics to the isolated DART collector and preserves explicit absent coverage',async()=>{const f=fixture();expect(await f.get('dart')).toMatchObject({status:'not_available',last_error:null,limitations:['periodic_report_not_found']});expect(f.collectDart).toHaveBeenCalledOnce();expect(f.collect).not.toHaveBeenCalled();expect(f.providerFetch).not.toHaveBeenCalled();});
 it.each(['environment','vault','both'] as const)('forwards valid DART configuration from %s without exposing it in the response',async source=>{
  const f=fixture(),envKey='c'.repeat(40),envRelay='d'.repeat(64),vaultKey='e'.repeat(40),vaultRelay='f'.repeat(64);
  f.setSecrets(source==='environment'?{}:{DART_API_KEY:vaultKey,DART_RELAY_SECRET:vaultRelay});
  const data=await f.get('dart',null,source==='vault'?{}:{dartApiKey:envKey,dartRelaySecret:envRelay});
  expect(f.collectDart).toHaveBeenCalledExactlyOnceWith(expect.anything(),company,'Synthetic company',{
   DART_API_KEY:source==='vault'?vaultKey:envKey,DART_RELAY_SECRET:source==='environment'?envRelay:vaultRelay,
  },expect.anything());
  expect(data.status).toBe('not_available');
  for(const credential of [envKey,envRelay,vaultKey,vaultRelay])expect(JSON.stringify(data)).not.toContain(credential);
 });
});
