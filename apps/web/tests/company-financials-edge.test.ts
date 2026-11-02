// @vitest-environment node
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {describe,expect,it,vi} from 'vitest';
import * as parser from '../../../supabase/functions/signalbrief-api/company-financials-core';
import {obj,str,ProviderError,transportCode} from '../../../supabase/functions/signalbrief-api/us-core';
import {selectAnalysisExcerpt} from '../../../supabase/functions/signalbrief-api/analysis-excerpt';

type Row=Record<string,unknown>;
const company={id:'20000000-0000-4000-8000-000000000001',provider:'sec',provider_company_id:'0000000042',ticker:'SYN'};
const secrets={SEC_CONTACT_EMAIL:'fixture@example.test',DART_API_KEY:'b'.repeat(40),DART_RELAY_SECRET:'a'.repeat(64)};
const source=JSON.stringify({cik:42,entityName:'Synthetic issuer',facts:{'us-gaap':{Assets:{label:'Assets',units:{USD:[{end:'2026-03-31',val:42,accn:'0000000042-26-000001',fy:2026,fp:'Q1',form:'10-Q',filed:'2026-05-01'}]}}}}});
function fixture(){
 const order:string[]=[],state={claim:{claimed:true,status:'pending'},archiveFailed:false,raw:source};
 const rpc=vi.fn(async(name:string,args:Row={})=>{
  if(name==='sb_us_reserve'){order.push('reserve');return {data:null,error:null};}
  if(name==='sb_company_financial_admin'){const op=String(args.op);order.push(op);return {data:op==='claim'?state.claim:op==='save'?{status:'ready',count:obj(args.p).snapshot?1:0}:{},error:null};}
  throw new Error('Unexpected database boundary '+name);
 });
 const upload=vi.fn<(path:string,bytes:Uint8Array,options:Row)=>Promise<{error:{message:string}|null}>>(async()=>{order.push('archive');return {error:state.archiveFailed?{message:'Synthetic storage failure'}:null};});
 const fetcher=vi.fn(async()=>{order.push('download');return new Response(state.raw);});
 const relay=vi.fn(async()=>new TextEncoder().encode('{"status":"013"}'));
 const db={rpc,storage:{from:()=>({upload})}};
 const text=readFileSync(new URL('../../../supabase/functions/signalbrief-api/company-financials.ts',import.meta.url),'utf8').replace(/^import .*\r?\n/gm,'').replace(/^export /gm,'');
 const compiled=ts.transpileModule(text,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
 const api=runInNewContext(compiled+'\n({requestCompanyFinancials,collectCompanyFinancials,secFinancialBytes});',{
  ...parser,obj,str,ProviderError,transportCode,dartRelay:relay,fetch:fetcher,crypto,Date,URL,Uint8Array,TextEncoder,TextDecoder,AbortSignal,Response,
 }) as {requestCompanyFinancials:(db:unknown,s:Row,c:Row)=>Promise<Row>;collectCompanyFinancials:(db:unknown,s:Row,c:Row)=>Promise<Row>;secFinancialBytes:(cik:string,contact:string,f?:typeof fetch)=>Promise<Uint8Array>};
 return {order,state,rpc,upload,fetcher,relay,db,api};
}
describe('official financial collection boundaries',()=>{
 it('archives the exact original before persisting hash-bound numeric evidence and never invokes a model',async()=>{
  const f=fixture();expect(await f.api.requestCompanyFinancials(f.db,secrets,company)).toMatchObject({status:'ready'});
  expect(f.order).toEqual(['request','claim','reserve','download','archive','save']);
  const bytes=new TextEncoder().encode(source),sha=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');
  expect(f.upload).toHaveBeenCalledWith(`financials/sec/0000000042/${sha}.json`,bytes,{contentType:'application/json',upsert:false});
  expect(f.rpc).toHaveBeenCalledWith('sb_company_financial_admin',{op:'save',p:expect.objectContaining({company_id:company.id,parser_version:'reported-financials-v1',object_key:`financials/sec/0000000042/${sha}.json`,snapshot:expect.objectContaining({raw_sha256:sha,provider_company_id:'0000000042',items:[expect.objectContaining({value_raw:'42',source_quote:expect.any(String)})]})})});
  expect(f.fetcher).toHaveBeenCalledExactlyOnceWith('https://data.sec.gov/api/xbrl/companyfacts/CIK0000000042.json',expect.objectContaining({redirect:'error',signal:expect.any(AbortSignal)}));
 });
 it('does not publish data when immutable archival fails',async()=>{
  const f=fixture();f.state.archiveFailed=true;expect(await f.api.requestCompanyFinancials(f.db,secrets,company)).toMatchObject({status:'unavailable',error_code:'financial_archive_failed'});
  expect(f.order).not.toContain('save');expect(f.order.at(-1)).toBe('fail');
 });
 it('archives a response but refuses a mismatched issuer',async()=>{
  const f=fixture();f.state.raw=source.replace('"cik":42','"cik":43');expect(await f.api.requestCompanyFinancials(f.db,secrets,company)).toMatchObject({status:'unavailable',error_code:'financial_identity_mismatch'});expect(f.order).toContain('archive');expect(f.order).not.toContain('save');
 });
 it.each(['ready','pending'])('honors an existing cache or another collection lease (%s)',async status=>{
  const f=fixture();f.state.claim={claimed:false,status};expect(await f.api.requestCompanyFinancials(f.db,secrets,company)).toEqual({status});expect(f.fetcher).not.toHaveBeenCalled();expect(f.upload).not.toHaveBeenCalled();
 });
 it('does not silently fall back to older DART data after a newer response fails',async()=>{
  const f=fixture();f.relay.mockRejectedValueOnce(new ProviderError('dart','quota_exceeded'));
  const result=await f.api.requestCompanyFinancials(f.db,secrets,{...company,provider:'dart',provider_company_id:'12345678',ticker:'0068Y0'});
  expect(result).toMatchObject({status:'unavailable',error_code:'quota_exceeded'});expect(f.relay.mock.calls.length).toBeLessThanOrEqual(4);expect(f.order).not.toContain('save');
 });
 it('saves DART results with the corrected provider-specific parser version',async()=>{
  const f=fixture();await f.api.requestCompanyFinancials(f.db,secrets,{...company,provider:'dart',provider_company_id:'12345678',ticker:'0068Y0'});
  expect(f.rpc).toHaveBeenCalledWith('sb_company_financial_admin',{op:'save',p:expect.objectContaining({parser_version:'reported-financials-dart-v2',snapshot:expect.objectContaining({provider:'dart'})})});
 });
 it('preserves the exact bytes even when text contains a UTF-8 BOM',async()=>{
  const f=fixture();f.state.raw='\ufeff'+source;await f.api.requestCompanyFinancials(f.db,secrets,company);
  expect(f.upload.mock.calls[0][1]).toEqual(new TextEncoder().encode(f.state.raw));
 });
 it('rejects invalid identifiers before making any SEC request',async()=>{
  const f=fixture();await expect(f.api.secFinancialBytes('../bad',secrets.SEC_CONTACT_EMAIL)).rejects.toThrow('invalid_cik');await expect(f.api.secFinancialBytes('0000000042','')).rejects.toThrow('contact_email_required');expect(f.fetcher).not.toHaveBeenCalled();
 });
 it('bounds SEC bytes and hides provider transport secrets',async()=>{
  const f=fixture(),fetcher=vi.fn().mockResolvedValue(new Response('small',{headers:{'content-length':'12000001'}}));
  await expect(f.api.secFinancialBytes('0000000042',secrets.SEC_CONTACT_EMAIL,fetcher)).rejects.toThrow('financial_source_too_large');
  fetcher.mockRejectedValue(new Error('secret endpoint private key'));await expect(f.api.secFinancialBytes('0000000042',secrets.SEC_CONTACT_EMAIL,fetcher)).rejects.toThrow('network_or_timeout');
 });
});

describe('declared financial document excerpts',()=>{
 it('selects the actual statement beyond a long cover and retains exact offsets and units',()=>{
  const cover='Synthetic registration cover and legal metadata. '.repeat(500);
  const statement='CONSOLIDATED STATEMENTS OF INCOME\n(in millions of USD, except per share data)\nYear ended 2026. Revenue $12,345. Operating income $3,456. Net income $2,345. Assets $99,999.\n'.repeat(15);
  const source=cover+statement,excerpt=selectAnalysisExcerpt(source);
  expect(excerpt.selection).toBe('financial_statement_window_v1');expect(excerpt.start).toBeGreaterThan(12000);expect(excerpt.text).toContain('in millions of USD');expect(source.slice(excerpt.start,excerpt.end)).toBe(excerpt.text);expect(excerpt.text.length).toBeLessThanOrEqual(12000);
 });
 it('keeps a genuinely short original whole',()=>expect(selectAnalysisExcerpt('Synthetic short source')).toEqual({text:'Synthetic short source',start:0,end:22,selection:'complete_normalized_document'}));
 it('does not analyze an arbitrary cover excerpt when no financial window was found',()=>expect(()=>selectAnalysisExcerpt('Synthetic legal text. '.repeat(1000))).toThrow('financial_excerpt_not_identified'));
});
