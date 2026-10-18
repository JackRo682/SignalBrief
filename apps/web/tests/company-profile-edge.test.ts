// @vitest-environment node
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {describe,it,expect,vi} from 'vitest';
import {parseProfile,ProfileError} from '../../../supabase/functions/signalbrief-profiles/core';
const id='20000000-0000-4000-8000-000000000001';
function fixture(){
 const cache=new Map<string,unknown>();let claim=false,actor=true;
 const company={id,provider:'dart',provider_company_id:'12345678',ticker:'123456'};
 const raw=JSON.stringify({status:'000',corp_code:'12345678',stock_code:'123456',corp_name:'Synthetic company'});
 const dartRelay=vi.fn().mockResolvedValue(new TextEncoder().encode(raw));
 const upload=vi.fn().mockResolvedValue({error:null});
 const rpc=vi.fn(async(name:string,args:Record<string,unknown>={})=>({error:null,data:name==='sb_dart_relay_claim'?claim:name==='sb_us_cache'?args.v?(cache.set(String(args.k),args.v),args.v):cache.get(String(args.k))??null:name==='sb_us_secrets'?{DART_API_KEY:'b'.repeat(40),DART_RELAY_SECRET:'a'.repeat(64)}:true}));
 const query={select:()=>query,eq:()=>query,maybeSingle:async()=>({data:company,error:null})};
 const db={rpc,from:vi.fn(()=>query),auth:{getUser:async()=>({data:{user:actor?{id:'synthetic-user'}:null},error:null})},storage:{from:()=>({upload})}};
 let handler!:(r:Request)=>Promise<Response>;
 const source=readFileSync(new URL('../../../supabase/functions/signalbrief-profiles/index.ts',import.meta.url),'utf8').replace(/^import .*\r?\n/gm,'').replace(/^export /gm,'');
 runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText,{createClient:()=>db,dartRelay,parseProfile,ProfileError,Response,Request,Headers,URL,Uint8Array,TextEncoder,TextDecoder,crypto,Deno:{env:{get:(key:string)=>key==='DART_API_KEY'?'b'.repeat(40):'synthetic-env'},serve:(fn:typeof handler)=>{handler=fn;}}});
 const get=()=>handler(new Request('https://fixture.test/?company_id='+id,{headers:{Authorization:'Bearer '+'a'.repeat(25)}}));
 const warm=()=>handler(new Request('https://fixture.test/',{method:'POST',body:JSON.stringify({kind:'company-profile-refresh',company_id:id,nonce:'c'.repeat(64)})}));
 return {handler,get,warm,dartRelay,upload,rpc,cache,company,setClaim:(v:boolean)=>{claim=v;},setActor:(v:boolean)=>{actor=v;}};
}
describe('profile function authorization, archival and cache',()=>{
 it('rejects anonymous GETs without a provider call',async()=>{const f=fixture();expect((await f.handler(new Request('https://fixture.test'))).status).toBe(401);expect(f.dartRelay).not.toHaveBeenCalled();});
 it('rejects expired user sessions',async()=>{const f=fixture();f.setActor(false);expect((await f.get()).status).toBe(401);expect(f.dartRelay).not.toHaveBeenCalled();});
 it('rejects unsigned or replayed operations requests',async()=>{const f=fixture();expect((await f.warm()).status).toBe(401);expect(f.dartRelay).not.toHaveBeenCalled();});
 it('archives original bytes and reuses the verified cache',async()=>{const f=fixture();expect((await f.get()).status).toBe(200);expect((await f.get()).status).toBe(200);expect(f.dartRelay).toHaveBeenCalledTimes(1);expect(f.upload).toHaveBeenCalledTimes(1);expect(f.rpc).toHaveBeenCalledWith('sb_us_cache',expect.objectContaining({ttl:86400}));});
 it('does not cache a provider failure or reflect its credentials',async()=>{const f=fixture();f.dartRelay.mockRejectedValue(new Error('synthetic-secret'));const r=await f.get();expect(r.status).toBe(502);expect(await r.text()).not.toContain('synthetic-secret');expect(f.cache.size).toBe(0);expect(f.upload).not.toHaveBeenCalled();});
 it('does not publish a response from a different company',async()=>{const f=fixture();f.dartRelay.mockResolvedValue(new TextEncoder().encode(JSON.stringify({status:'000',corp_code:'99999999',stock_code:'123456',corp_name:'Wrong company'})));const r=await f.get();expect(r.status).toBe(502);expect(f.cache.size).toBe(0);});
 it('allows a signed operation to warm only an existing mapped company',async()=>{const f=fixture();f.setClaim(true);const r=await f.warm();expect(r.status).toBe(200);expect(await r.json()).toMatchObject({status:'verified',company_id:id});});
});
