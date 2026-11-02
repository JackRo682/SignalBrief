// @vitest-environment node
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {describe,it,expect,vi} from 'vitest';
import {parseProfile,parseSecProfile,ProfileError} from '../../../supabase/functions/signalbrief-profiles/core';
const id='20000000-0000-4000-8000-000000000001';
function fixture(){
 const cache=new Map<string,unknown>();let claim=false,actor=true;
 const company={id,provider:'dart',provider_company_id:'12345678',ticker:'123456'};
 const raw=JSON.stringify({status:'000',corp_code:'12345678',stock_code:'123456',corp_name:'Synthetic company'});
 const dartRelay=vi.fn().mockResolvedValue(new TextEncoder().encode(raw));
 const providerFetch=vi.fn().mockResolvedValue(JSON.stringify({cik:'12345678',tickers:['TEST'],name:'Synthetic US company',sic:'1234',sicDescription:'Synthetic industry'}));
 const loadProfileEnrichment=vi.fn().mockResolvedValue({schema:'signalbrief.company-profile.v1',company_id:id,status:'partial',leadership:[],formation:[],business:[],products:[],segments:[],sources:[],limitations:['formation_date_not_verified'],last_error:null});
 const upload=vi.fn().mockResolvedValue({error:null});
 const rpc=vi.fn(async(name:string,args:Record<string,unknown>={})=>({error:null,data:name==='sb_dart_relay_claim'?claim:name==='sb_us_cache'?args.v?(cache.set(String(args.k),args.v),args.v):cache.get(String(args.k))??null:name==='sb_us_secrets'?{DART_API_KEY:'b'.repeat(40),DART_RELAY_SECRET:'a'.repeat(64)}:true}));
 const query={select:()=>query,eq:()=>query,maybeSingle:async()=>({data:company,error:null})};
 const db={rpc,from:vi.fn(()=>query),auth:{getUser:async()=>({data:{user:actor?{id:'synthetic-user'}:null},error:null})},storage:{from:()=>({upload})}};
 let handler!:(r:Request)=>Promise<Response>;
 const source=readFileSync(new URL('../../../supabase/functions/signalbrief-profiles/index.ts',import.meta.url),'utf8').replace(/^import .*\r?\n/gm,'').replace(/^export /gm,'');
 runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText,{createClient:()=>db,dartRelay,providerFetch,loadProfileEnrichment,fetch,parseProfile,parseSecProfile,ProfileError,Response,Request,Headers,URL,Uint8Array,TextEncoder,TextDecoder,AbortSignal,crypto,Deno:{env:{get:(key:string)=>key==='SEC_CONTACT_EMAIL'?'synthetic@example.test':key==='DART_API_KEY'?'b'.repeat(40):key==='DART_RELAY_SECRET'?'c'.repeat(64):'synthetic-env'},serve:(fn:typeof handler)=>{handler=fn;}}});
 const get=()=>handler(new Request('https://fixture.test/?company_id='+id,{headers:{Authorization:'Bearer '+'a'.repeat(25)}}));
 const warm=()=>handler(new Request('https://fixture.test/',{method:'POST',body:JSON.stringify({kind:'company-profile-refresh',company_id:id,nonce:'c'.repeat(64)})}));
 return {handler,get,warm,dartRelay,providerFetch,loadProfileEnrichment,upload,rpc,cache,company,setClaim:(v:boolean)=>{claim=v;},setActor:(v:boolean)=>{actor=v;}};
}
describe('profile function authorization, archival and cache',()=>{
 it('rejects anonymous GETs without a provider call',async()=>{const f=fixture();expect((await f.handler(new Request('https://fixture.test'))).status).toBe(401);expect(f.dartRelay).not.toHaveBeenCalled();});
 it('does not enrich an unauthenticated or mismatched company',async()=>{const f=fixture();f.setActor(false);expect((await f.get()).status).toBe(401);expect(f.loadProfileEnrichment).not.toHaveBeenCalled();f.setActor(true);f.dartRelay.mockResolvedValue(new TextEncoder().encode(JSON.stringify({status:'000',corp_code:'99999999',stock_code:'123456',corp_name:'Other company'})));expect((await f.get()).status).toBe(502);expect(f.loadProfileEnrichment).not.toHaveBeenCalled();});
 it('attaches independently refreshed enrichment even when basic metadata was already cached',async()=>{const f=fixture();await f.get();f.loadProfileEnrichment.mockResolvedValue({status:'unavailable',last_error:'profile_source_unavailable'});const response=await f.get();expect(response.status).toBe(200);expect(await response.json()).toMatchObject({status:'verified',profile:{name:'Synthetic company'},enrichment:{status:'unavailable',last_error:'profile_source_unavailable'}});expect(f.dartRelay).toHaveBeenCalledTimes(1);expect(f.loadProfileEnrichment).toHaveBeenCalledTimes(2);});
 it('passes server DART settings to enrichment for both newly fetched and cached basic profiles',async()=>{
  const f=fixture();await f.get();await f.get();
  expect(f.loadProfileEnrichment).toHaveBeenCalledTimes(2);
  for(const call of f.loadProfileEnrichment.mock.calls)expect(call[5]).toMatchObject({dartApiKey:'b'.repeat(40),dartRelaySecret:'c'.repeat(64),signal:expect.any(AbortSignal)});
 });
 it('rejects expired user sessions',async()=>{const f=fixture();f.setActor(false);expect((await f.get()).status).toBe(401);expect(f.dartRelay).not.toHaveBeenCalled();});
 it('rejects unsigned or replayed operations requests',async()=>{const f=fixture();expect((await f.warm()).status).toBe(401);expect(f.dartRelay).not.toHaveBeenCalled();});
 it('archives original bytes and reuses the verified cache',async()=>{const f=fixture();expect((await f.get()).status).toBe(200);expect((await f.get()).status).toBe(200);expect(f.dartRelay).toHaveBeenCalledTimes(1);expect(f.upload).toHaveBeenCalledTimes(1);expect(f.rpc).toHaveBeenCalledWith('sb_us_cache',expect.objectContaining({ttl:86400}));});
 it.each(['0068Y0','0017J0'])('loads and caches an identity-matched official profile for %s',async ticker=>{
  const f=fixture();f.company.ticker=ticker;
  f.dartRelay.mockResolvedValue(new TextEncoder().encode(JSON.stringify({status:'000',corp_code:f.company.provider_company_id,stock_code:ticker,corp_name:'Synthetic alphanumeric issuer'})));
  const response=await f.get();expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({status:'verified',company_id:id,profile:{corp_code:f.company.provider_company_id,ticker,name:'Synthetic alphanumeric issuer'}});
  expect(f.upload).toHaveBeenCalledTimes(1);
  expect(f.rpc).toHaveBeenCalledWith('sb_us_cache',expect.objectContaining({k:`profile:dart:v1:${id}:${f.company.provider_company_id}:${ticker}`,ttl:86400}));
  expect((await f.get()).status).toBe(200);expect(f.dartRelay).toHaveBeenCalledTimes(1);
 });
 it.each(['0068y0','0068Y','0068Y00','006-Y0','006 Y0','００６８Y0','0068가0'])('rejects malformed profile stock mapping %s before provider work',async ticker=>{
  const f=fixture();f.company.ticker=ticker;const response=await f.get();expect(response.status).toBe(409);
  expect(await response.json()).toEqual({error:{code:'invalid_company_mapping'}});
  expect(f.dartRelay).not.toHaveBeenCalled();expect(f.upload).not.toHaveBeenCalled();expect(f.cache.size).toBe(0);
 });
 it('keeps the numeric corporation-ID requirement and exact alphanumeric stock match',async()=>{
  const malformed=fixture();malformed.company.ticker='0068Y0';malformed.company.provider_company_id='1234567A';
  expect((await malformed.get()).status).toBe(409);expect(malformed.dartRelay).not.toHaveBeenCalled();
  const mismatch=fixture();mismatch.company.ticker='0068Y0';
  mismatch.dartRelay.mockResolvedValue(new TextEncoder().encode(JSON.stringify({status:'000',corp_code:mismatch.company.provider_company_id,stock_code:'0017J0',corp_name:'Wrong synthetic security'})));
  const response=await mismatch.get();expect(response.status).toBe(502);
  expect(await response.json()).toEqual({error:{code:'company_identity_mismatch'}});
  expect(mismatch.upload).not.toHaveBeenCalled();expect(mismatch.cache.size).toBe(0);
 });
 it('does not cache a provider failure or reflect its credentials',async()=>{const f=fixture();f.dartRelay.mockRejectedValue(new Error('synthetic-secret'));const r=await f.get();expect(r.status).toBe(502);expect(await r.text()).not.toContain('synthetic-secret');expect(f.cache.size).toBe(0);expect(f.upload).not.toHaveBeenCalled();});
 it('reports only an allowlisted relay code, never its exception text',async()=>{const f=fixture();f.dartRelay.mockRejectedValue(Object.assign(new Error('synthetic-secret'),{code:'relay_unauthorized'}));const r=await f.get();expect(await r.json()).toEqual({error:{code:'relay_unauthorized'}});});
 it('does not publish a response from a different company',async()=>{const f=fixture();f.dartRelay.mockResolvedValue(new TextEncoder().encode(JSON.stringify({status:'000',corp_code:'99999999',stock_code:'123456',corp_name:'Wrong company'})));const r=await f.get();expect(r.status).toBe(502);expect(f.cache.size).toBe(0);});
 it('allows a signed operation to warm only an existing mapped company',async()=>{const f=fixture();f.setClaim(true);const r=await f.warm();expect(r.status).toBe(200);expect(await r.json()).toMatchObject({status:'verified',company_id:id});});
 it('loads and archives SEC issuer metadata with identity validation and a distinct cache',async()=>{const f=fixture();f.company.provider='sec';f.company.ticker='TEST';const r=await f.get();expect(r.status).toBe(200);expect(await r.json()).toMatchObject({provider:'SEC EDGAR',profile:{ticker:'TEST',name:'Synthetic US company'}});expect(f.dartRelay).not.toHaveBeenCalled();expect(f.upload).toHaveBeenCalledTimes(1);expect(f.providerFetch).toHaveBeenCalledWith(expect.any(URL),'sec',expect.anything(),expect.anything(),3000000);expect(f.providerFetch.mock.calls[0][0].href).toBe('https://data.sec.gov/submissions/CIK0012345678.json');await f.get();expect(f.providerFetch).toHaveBeenCalledTimes(1);});
 it('rejects a mismatched SEC company without publishing or caching it',async()=>{const f=fixture();f.company.provider='sec';f.company.ticker='OTHER';expect((await f.get()).status).toBe(502);expect(f.cache.size).toBe(0);expect(f.upload).not.toHaveBeenCalled();});
});
