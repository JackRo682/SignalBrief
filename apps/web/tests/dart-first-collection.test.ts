// @vitest-environment node
import {describe,it,expect,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {collectDartFilings} from '../../../supabase/functions/signalbrief-collector/dart-ingest';
import {ProviderError} from '../../../supabase/functions/signalbrief-api/us-core';

const company={id:'synthetic-company',provider:'dart',provider_company_id:'12345678',ticker:'123456',last_ingested_at:null};
const key='a'.repeat(40),secret='b'.repeat(64),now=new Date('2026-11-03T15:30:00Z');
const filing={corp_code:'12345678',stock_code:'123456',rcept_no:'20260814000001',rcept_dt:'20260814',report_nm:'반기보고서 (2026.06)'};
const encode=(value:unknown)=>new TextEncoder().encode(JSON.stringify(value));
const periodic=(patch:Record<string,unknown>={})=>({status:'000',total_page:1,page_no:1,total_count:1,list:[filing],...patch});
type Failure='quota'|'archive'|'save'|'timestamp'|undefined;
function fixture(payload:unknown=periodic(),failure?:Failure){
 const events:string[]=[],uploaded:{path:string;bytes:Uint8Array;options:unknown}[]=[],saved:unknown[]=[];
 const rpc=vi.fn(async(name:string,args:unknown)=>{events.push(name);return {error:failure==='quota'?{code:'PT429',message:'daily_request_limit'}:null,data:args};});
 const upload=vi.fn(async(path:string,bytes:Uint8Array,options:unknown)=>{events.push('archive');uploaded.push({path,bytes,options});return {error:failure==='archive'?{message:'unavailable'}:null};});
 const upsert=vi.fn(async(rows:unknown,options:unknown)=>{events.push('save');saved.push(rows);return {error:failure==='save'?{message:'unavailable'}:null,data:options};});
 const eq=vi.fn(async()=>{events.push('timestamp');return {error:failure==='timestamp'?{message:'unavailable'}:null};});
 const update=vi.fn(()=>({eq}));
 const db={rpc,storage:{from:vi.fn((bucket:string)=>{expect(bucket).toBe('signalbrief-raw');return {upload};})},from:vi.fn((table:string)=>{
  if(table==='dart_filings')return {upsert};if(table==='companies')return {update};throw new Error('unexpected_table');
 })};
 const raw=payload instanceof Uint8Array?payload:encode(payload),relay=vi.fn(async()=>raw),list=vi.fn(async()=>JSON.stringify({status:'013'}));
 const transport={now:()=>now,relay,list};
 const run=(record:Record<string,unknown>=company)=>collectDartFilings(db as unknown as Parameters<typeof collectDartFilings>[0],record,key,secret,transport);
 return {run,db,transport,raw,events,uploaded,saved,rpc,upload,upsert,update,eq,relay,list};
}

describe('bounded first DART collection',()=>{
 it('retrieves existing periodic reports once with Korean calendar boundaries and archives exact bytes before metadata',async()=>{
  const f=fixture(),result=await f.run(),sha=createHash('sha256').update(f.raw).digest('hex');
  expect(f.relay).toHaveBeenCalledExactlyOnceWith({kind:'periodic_list',key,corp_code:'12345678',bgn_de:'20250503',end_de:'20261104'},secret);
  expect(f.list).not.toHaveBeenCalled();expect(f.rpc).toHaveBeenCalledExactlyOnceWith('sb_us_reserve',{p:'dart',amount:0,smoke:false});
  expect(f.events).toEqual(['sb_us_reserve','archive','save','timestamp']);
  expect(f.uploaded).toEqual([{path:`dart/lists/${sha}.json`,bytes:f.raw,options:{contentType:'application/json',upsert:false}}]);
  expect(f.saved).toEqual([[{company_id:company.id,receipt:filing.rcept_no,title:filing.report_nm,filing_date:'2026-08-14',source_url:'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20260814000001',source_sha256:sha,source_object_key:`dart/lists/${sha}.json`,publication_precision:'date',publication_timezone:'Asia/Seoul'}]]);
  expect(f.upsert).toHaveBeenCalledWith(expect.any(Array),{onConflict:'company_id,receipt',ignoreDuplicates:true});
  expect(f.update).toHaveBeenCalledWith({last_ingested_at:now.toISOString()});expect(f.eq).toHaveBeenCalledWith('id',company.id);
  expect(result).toEqual({symbol:'123456',filings:1,coverage:'previous_550_days_final_periodic_metadata',periodic_report_status:'available',document_analysis:'separate_document_stage'});
 });
 it('keeps all verified periodic rows, including a final correction to an older period',async()=>{
  const older={...filing,rcept_no:'20261030000001',rcept_dt:'20261030',report_nm:'[기재정정]사업보고서 (2025.12)'},f=fixture(periodic({total_count:2,list:[older,filing]}));
  expect((await f.run()).filings).toBe(2);expect((f.saved[0] as {receipt:string}[]).map(v=>v.receipt)).toEqual([filing.rcept_no,older.rcept_no]);
  expect(f.relay).toHaveBeenCalledTimes(1);
 });
 it('records an official no-data result without inventing a periodic report',async()=>{
  const f=fixture({status:'013',message:'조회된 데이타가 없습니다.'});
  expect(await f.run()).toMatchObject({filings:0,periodic_report_status:'not_available'});
  expect(f.events).toEqual(['sb_us_reserve','archive','timestamp']);expect(f.upsert).not.toHaveBeenCalled();
 });
 it.each([
  ['multiple pages',periodic({total_page:2,total_count:101})],
  ['incorrect page',periodic({page_no:2})],
  ['count mismatch',periodic({total_count:2})],
  ['duplicate receipts',periodic({total_count:2,list:[filing,filing]})],
  ['wrong issuer',periodic({list:[{...filing,corp_code:'87654321'}]})],
  ['wrong ticker',periodic({list:[{...filing,stock_code:'654321'}]})],
  ['invalid date',periodic({list:[{...filing,rcept_dt:'20260230'}]})],
  ['future date',periodic({list:[{...filing,rcept_dt:'20261105'}]})],
  ['outside requested window',periodic({list:[{...filing,rcept_dt:'20250502'}]})],
  ['nonperiodic title',periodic({list:[{...filing,report_nm:'기업설명회(IR) 개최'}]})],
  ['contradictory empty status',{status:'013',list:[filing]}],
  ['contradictory empty count',{status:'013',total_count:1}],
  ['malformed UTF8',new Uint8Array([0xff])],
  ['malformed JSON',new TextEncoder().encode('{')],
 ] as const)('never completes or persists an incomplete/unbound result: %s',async(_name,payload)=>{
  const f=fixture(payload);await expect(f.run()).rejects.toThrow();expect(f.upsert).not.toHaveBeenCalled();expect(f.update).not.toHaveBeenCalled();expect(f.list).not.toHaveBeenCalled();
 });
 it.each([['020','quota_exceeded'],['010','invalid_key'],['011','invalid_key'],['999','dart_periodic_list_unavailable']])('preserves provider status %s as %s',async(status,code)=>{
  const f=fixture({status});await expect(f.run()).rejects.toMatchObject({code});expect(f.update).not.toHaveBeenCalled();
 });
 it('does not request a source after the existing daily reservation is denied',async()=>{
  const f=fixture(periodic(),'quota');await expect(f.run()).rejects.toMatchObject({code:'daily_request_limit'});
  expect(f.relay).not.toHaveBeenCalled();expect(f.upload).not.toHaveBeenCalled();expect(f.update).not.toHaveBeenCalled();
 });
 it.each([['archive','archive_failed'],['save','dart_save_failed']] as const)('does not advance collection after %s failure',async(failure,code)=>{
  const f=fixture(periodic(),failure);await expect(f.run()).rejects.toMatchObject({code});expect(f.update).not.toHaveBeenCalled();
  if(failure==='archive')expect(f.upsert).not.toHaveBeenCalled();
 });
 it('does not report success if the completion timestamp cannot be saved',async()=>{
  const f=fixture(periodic(),'timestamp');await expect(f.run()).rejects.toMatchObject({code:'ingestion_timestamp_failed'});
 });
 it('preserves a sanitized relay error without persisting or completing anything',async()=>{
  const f=fixture();f.relay.mockRejectedValue(new ProviderError('dart','relay_network_failed'));
  await expect(f.run()).rejects.toMatchObject({code:'relay_network_failed'});expect(f.upload).not.toHaveBeenCalled();expect(f.update).not.toHaveBeenCalled();
 });
 it.each([{provider_company_id:'invalid'},{ticker:'INVALID'},{provider:'sec'}])('rejects invalid company identity before spending quota: %j',async(patch)=>{
  const f=fixture();await expect(f.run({...company,...patch})).rejects.toMatchObject({code:'invalid_filing_identity'});expect(f.rpc).not.toHaveBeenCalled();
 });
 it('requires the existing signed relay and key before spending quota',async()=>{
  const f=fixture(),db=f.db as unknown as Parameters<typeof collectDartFilings>[0];
  await expect(collectDartFilings(db,company,'',secret,f.transport)).rejects.toThrow('missing_or_invalid_key');
  await expect(collectDartFilings(db,company,key,'',f.transport)).rejects.toThrow('relay_not_configured');expect(f.rpc).not.toHaveBeenCalled();
 });
});

describe('existing DART incremental collection',()=>{
 it('retains the seven-day amendment-inclusive list path and reserves each page separately',async()=>{
  const f=fixture(),second={...filing,rcept_no:'20261103000002',rcept_dt:'20261103',report_nm:'기타공시'};
  f.list.mockResolvedValueOnce(JSON.stringify({status:'000',total_page:2,list:[filing]})).mockResolvedValueOnce(JSON.stringify({status:'000',total_page:2,list:[second]}));
  const result=await f.run({...company,last_ingested_at:'2026-11-02T00:00:00Z'});
  expect(f.relay).not.toHaveBeenCalled();expect(f.list.mock.calls.map(call=>call.slice(0,3))).toEqual([['12345678',key,1],['12345678',key,2]]);
  expect(f.rpc).toHaveBeenCalledTimes(2);expect(f.upload).toHaveBeenCalledTimes(2);expect(result).toEqual({symbol:'123456',filings:2,coverage:'previous_seven_days_metadata',document_analysis:'separate_document_stage'});
 });
 it('does not mark a partially persisted sequence complete if pagination changes',async()=>{
  const f=fixture();f.list.mockResolvedValueOnce(JSON.stringify({status:'000',total_page:2,list:[filing]})).mockResolvedValueOnce(JSON.stringify({status:'000',total_page:3,list:[filing]}));
  await expect(f.run({...company,last_ingested_at:'2026-11-02T00:00:00Z'})).rejects.toThrow('pagination_changed_retry_later');
  expect(f.upsert).toHaveBeenCalledTimes(1);expect(f.update).not.toHaveBeenCalled();
 });
});
