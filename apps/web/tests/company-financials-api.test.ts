// @vitest-environment node
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {describe,expect,it,vi} from 'vitest';
import * as core from '../../../supabase/functions/signalbrief-api/us-core';

const companyId='20000000-0000-4000-8000-000000000042';
function fixture(){
 const state={authenticated:true,deny:false,ready:false};
 const readerRpc=vi.fn(async(name:string,args:Record<string,unknown>={})=>{
  if(name==='sb_rate_limit')return {data:true,error:null};
  expect(name).toBe('sb_company_financials');expect(args).toEqual({company_id:companyId});
  return state.deny?{data:null,error:{code:'PT403',message:'mfa_required'}}:{data:{company_id:companyId,status:state.ready?'ready':'not_collected',items:[]},error:null};
 });
 const reader={auth:{getUser:vi.fn(async()=>({data:{user:state.authenticated?{id:'synthetic-user'}:null},error:null}))},rpc:readerRpc};
 const query={select:vi.fn(()=>query),eq:vi.fn(()=>query),maybeSingle:vi.fn(async()=>({data:{id:companyId,provider:'sec',provider_company_id:'0000000042',ticker:'SYN'},error:null}))};
 const admin={rpc:vi.fn(async(name:string)=>({data:name==='sb_us_secrets'?{SEC_CONTACT_EMAIL:'fixture@example.test'}:{},error:null})),from:vi.fn(()=>query)};
 const requestCompanyFinancials=vi.fn(async()=>{state.ready=true;return {status:'ready'};});
 const source=readFileSync(new URL('../../../supabase/functions/signalbrief-api/us-handler.ts',import.meta.url),'utf8').replace(/^import .*\r?\n/gm,'').replace(/^export /gm,'');
 const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
 const handle=runInNewContext(js+'\nhandleUS;',{
  ...core,requestCompanyFinancials,createClient:(_url:string,key:string)=>key==='synthetic-service'?admin:reader,
  Deno:{env:{get:(key:string)=>({SUPABASE_URL:'https://synthetic.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service',SUPABASE_ANON_KEY:'synthetic-anon'}[key]??'')}},
  Response,Request,Headers,URL,Uint8Array,TextEncoder,TextDecoder,crypto,Date,fetch:vi.fn(()=>{throw new Error('Unexpected provider call');}),
 }) as (req:Request)=>Promise<Response>;
 const request=(method='GET',body:unknown={company_id:companyId},auth=true)=>handle(new Request(`https://synthetic.test/signalbrief-us/company-financials?company_id=${companyId}`,{method,headers:{...(auth?{Authorization:'Bearer '+'a'.repeat(30)}:{}),'Content-Type':'application/json'},...(method==='POST'?{body:JSON.stringify(body)}:{})}));
 return {state,admin,readerRpc,query,requestCompanyFinancials,request};
}
describe('authenticated company financial API',()=>{
 it('GET only reads the protected projection and never starts collection',async()=>{
  const f=fixture(),r=await f.request();expect(r.status).toBe(200);expect(await r.json()).toMatchObject({company_id:companyId,status:'not_collected'});
  expect(f.requestCompanyFinancials).not.toHaveBeenCalled();expect(f.admin.from).not.toHaveBeenCalled();expect(f.admin.rpc).not.toHaveBeenCalledWith('sb_us_secrets',expect.anything());
 });
 it('POST checks the company projection before collecting the stored canonical identity',async()=>{
  const f=fixture(),r=await f.request('POST');expect(r.status).toBe(200);expect(await r.json()).toMatchObject({company_id:companyId,status:'ready'});
  expect(f.requestCompanyFinancials).toHaveBeenCalledExactlyOnceWith(f.admin,{SEC_CONTACT_EMAIL:'fixture@example.test'},expect.objectContaining({id:companyId,provider_company_id:'0000000042',ticker:'SYN'}));
  expect(f.readerRpc.mock.calls.filter(([name])=>name==='sb_company_financials')).toHaveLength(2);
 });
 it.each([false,true])('denies unassured access before service-side company work (expired=%s)',async expired=>{
  const f=fixture();if(expired)f.state.authenticated=false;else f.state.deny=true;
  expect((await f.request('POST')).status).toBe(expired?401:403);expect(f.requestCompanyFinancials).not.toHaveBeenCalled();expect(f.admin.from).not.toHaveBeenCalled();
 });
 it('rejects anonymous and caller-supplied identity overrides',async()=>{
  const f=fixture();expect((await f.request('POST',{},false)).status).toBe(401);
  expect((await f.request('POST',{company_id:companyId,ticker:'OTHER',provider_company_id:'0000009999'})).status).toBe(422);expect(f.requestCompanyFinancials).not.toHaveBeenCalled();
 });
});
