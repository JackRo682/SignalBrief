// @vitest-environment node
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {describe,expect,it,vi} from 'vitest';
import {CalendarError,sha256,type Source} from '../../../supabase/functions/signalbrief-calendar/core';
import {createCalendarSourceFetch} from '../../../supabase/functions/signalbrief-calendar/source-relay';

const q4:Source={key:'nvidia-ir',ticker:'NVDA',market:'NASDAQ',adapter:'q4-events',url:'https://investor.nvidia.com/events-and-presentations/events-and-presentations/default.aspx',feed_url:'https://investor.nvidia.com/feed/Event.svc/GetEventList',company_id:'10000000-0000-4000-8000-000000000093',provider:'sec',provider_company_id:'0001045810'};
const dart:Source={key:'dart-ir-00999991',ticker:'099991',market:'KOSPI',adapter:'dart-ir',url:'https://dart.fss.or.kr/',company_id:'10000000-0000-4000-8000-000000000094',provider:'dart',provider_company_id:'00999991'};
const sec:Source={key:'sec-ir-0000000996',ticker:'SYN',market:'NASDAQ',adapter:'sec-ir',url:'https://www.sec.gov/edgar/browse/?CIK=0000000996',company_id:'10000000-0000-4000-8000-000000000096',provider:'sec',provider_company_id:'0000000996'};
const notice:Source={...sec,key:'notice-sec-0000000996-aaaaaaaaaaaaaaaaaaaaaaaa',adapter:'curated-notice',url:'https://www.sec.gov/Archives/edgar/data/996/000000099626000001/notice.htm'};
const snapshot={raw_sha:'b'.repeat(64),object_key:'calendar/synthetic/manifest.json',manifest_text:'{"complete":true}'};

function fixture(sources:Source[],secrets:Record<string,string>={}){
 let clock=0,handler!:(req:Request)=>Promise<Response>;
 class Clock extends Date{static now(){return clock;}}
 const fetcher=vi.fn<typeof fetch>().mockImplementation(async()=>new Response('{}'));
 const collectQ4=vi.fn<(source:Source,today:string,archive:unknown,fetcher:typeof fetch)=>Promise<typeof snapshot>>().mockResolvedValue(snapshot);
 const collectDartIR=vi.fn<(source:Source,today:string,archive:unknown,listPage:unknown,fetcher:typeof fetch)=>Promise<typeof snapshot>>().mockResolvedValue(snapshot);
 const collectSecIR=vi.fn<(source:Source,today:string,contact:string,archive:unknown,fetcher:typeof fetch,resolve:unknown)=>Promise<typeof snapshot>>().mockResolvedValue(snapshot);
 const archiveNotice=vi.fn<(...args:unknown[])=>Promise<({completed:false}&typeof snapshot)|{completed:true;count:number}>>().mockResolvedValue({completed:false,...snapshot});
 const dartRelay=vi.fn(async()=>new TextEncoder().encode('{}'));
 const rpc=vi.fn<(name:string,args?:Record<string,unknown>)=>Promise<{error:{code:string;message:string}|null;data:unknown}>>(async(name:string,args:Record<string,unknown>={})=>({error:null,data:name==='sb_calendar_task_sources'?sources:name==='sb_us_secrets'?secrets:name.startsWith('sb_calendar_ingest')?1:name==='sb_calendar_claim'?true:args}));
 const upload=vi.fn(async()=>({error:null}));
 const createClient=vi.fn(()=>({rpc,storage:{from:()=>({upload})}}));
 const code=readFileSync(new URL('../../../supabase/functions/signalbrief-calendar/index.ts',import.meta.url),'utf8').replace(/^import .*\r?\n/gm,'').replace(/^export /gm,'');
 runInNewContext(ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText,{createClient,CalendarError,sha256,collectQ4,collectDartIR,collectSecIR,archiveNotice,createCalendarSourceFetch,dartRelay,koreaDate:()=> '20281102',fetchSource:vi.fn(),parseSource:vi.fn(),Response,Request,Headers,URL,TextEncoder,TextDecoder,AbortSignal,fetch:fetcher,Date:Clock,Deno:{env:{get:()=> ''},serve:(fn:typeof handler)=>{handler=fn;}}});
 return {rpc,collectQ4,collectDartIR,collectSecIR,archiveNotice,dartRelay,fetcher,createClient,setClock:(value:number)=>{clock=value;},call:()=>handler(new Request('https://fixture.invalid/calendar',{method:'POST',headers:{'x-signalbrief-task':'a'.repeat(64)}}))};
}

describe('one-source calendar worker handoff',()=>{
 it('rejects an unexpected multi-source task before any provider call',async()=>{
  const f=fixture([q4,dart]);expect((await f.call()).status).toBe(502);
  expect(f.collectQ4).not.toHaveBeenCalled();expect(f.collectDartIR).not.toHaveBeenCalled();
  expect(f.rpc).toHaveBeenCalledWith('sb_calendar_finish',expect.objectContaining({summary:[{status:'failed',code:'calendar_operation_failed'}]}));
 });
 it('collects a Q4 source without loading any DART credentials or global source list',async()=>{
  const f=fixture([q4]);expect(await (await f.call()).json()).toEqual({results:[{source:'nvidia-ir',status:'verified',items:1}]});
  expect(f.rpc.mock.calls.map(([name])=>name)).toEqual(['sb_calendar_claim','sb_calendar_task_sources','sb_calendar_ingest_q4','sb_calendar_finish']);
  expect(f.collectDartIR).not.toHaveBeenCalled();expect(f.dartRelay).not.toHaveBeenCalled();
 });
 it('records missing DART configuration and hands off the queue without invoking or ingesting a source',async()=>{
  const f=fixture([dart]);expect(await (await f.call()).json()).toEqual({results:[{source:dart.key,status:'failed',code:'dart_not_configured'}]});
  expect(f.collectDartIR).not.toHaveBeenCalled();expect(f.dartRelay).not.toHaveBeenCalled();
  expect(f.rpc.mock.calls.map(([name])=>name)).toEqual(['sb_calendar_claim','sb_calendar_task_sources','sb_us_secrets','sb_calendar_source_error','sb_calendar_finish']);
 });
 it('passes the Korean calendar day and scoped issuer into the DART collector',async()=>{
  const f=fixture([dart],{DART_API_KEY:'c'.repeat(40),DART_RELAY_SECRET:'d'.repeat(64)});
  expect((await f.call()).status).toBe(200);
  expect(f.collectDartIR).toHaveBeenCalledWith(dart,'2028-11-02',expect.any(Function),expect.any(Function),expect.any(Function));
  expect(f.rpc).toHaveBeenCalledWith('sb_calendar_ingest_dart_ir',{source:dart.key,...snapshot});
 });
 it('runs a canonical SEC discovery source with server contact and ingests only its archived manifest',async()=>{
  const f=fixture([sec],{SEC_CONTACT_EMAIL:'synthetic@example.invalid',DART_RELAY_SECRET:'d'.repeat(64)});
  expect(await(await f.call()).json()).toEqual({results:[{source:sec.key,status:'verified',items:1}]});
  expect(f.collectSecIR).toHaveBeenCalledWith(sec,expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),'synthetic@example.invalid',expect.any(Function),expect.any(Function),expect.any(Function));
  expect(f.rpc).toHaveBeenCalledWith('sb_calendar_ingest_sec_ir',{source:sec.key,...snapshot});
  expect(f.rpc.mock.calls.map(([name])=>name)).toEqual(['sb_calendar_claim','sb_calendar_task_sources','sb_us_secrets','sb_calendar_ingest_sec_ir','sb_calendar_finish']);
  expect(f.collectQ4).not.toHaveBeenCalled();expect(f.collectDartIR).not.toHaveBeenCalled();
 });
 it('records an unsupported SEC format without ingesting or blocking the existing queue handoff',async()=>{
  const f=fixture([sec],{SEC_CONTACT_EMAIL:'synthetic@example.invalid',DART_RELAY_SECRET:'d'.repeat(64)});
  f.collectSecIR.mockRejectedValueOnce(new CalendarError('official_calendar_format_unsupported'));
  expect(await(await f.call()).json()).toEqual({results:[{source:sec.key,status:'failed',code:'official_calendar_format_unsupported'}]});
  expect(f.rpc.mock.calls.some(([name])=>name.startsWith('sb_calendar_ingest'))).toBe(false);
  expect(f.rpc.mock.calls.map(([name])=>name)).toEqual(['sb_calendar_claim','sb_calendar_task_sources','sb_us_secrets','sb_calendar_source_error','sb_calendar_finish']);
 });
 it('stops provider work at 44 seconds while retaining bounded cleanup time for failure and queue handoff',async()=>{
  const f=fixture([q4]);
  f.collectQ4.mockImplementation(async(_source,_day,_archive,fetcher)=>{f.setClock(44000);await fetcher(q4.feed_url!);return snapshot;});
  expect(await (await f.call()).json()).toEqual({results:[{source:'nvidia-ir',status:'failed',code:'calendar_deadline_exceeded'}]});
  expect(f.fetcher).not.toHaveBeenCalled();expect(f.rpc.mock.calls.some(([name])=>name==='sb_calendar_ingest_q4')).toBe(false);
  expect(f.rpc.mock.calls.at(-1)?.[0]).toBe('sb_calendar_finish');
 });
 it('finishes an old unscoped handoff without invoking arbitrary sources',async()=>{
  const f=fixture([]);expect(await (await f.call()).json()).toEqual({results:[]});
  expect(f.collectQ4).not.toHaveBeenCalled();expect(f.rpc.mock.calls.at(-1)?.[0]).toBe('sb_calendar_finish');
 });
 it('archives only the claimed notice payload and binds its ingest to that same one-use task',async()=>{
  const f=fixture([notice]);expect(await(await f.call()).json()).toEqual({results:[{source:notice.key,status:'verified',items:1}]});
  const h=await sha256(new TextEncoder().encode('a'.repeat(64)));
  expect(f.rpc).toHaveBeenCalledWith('sb_calendar_notice_payload',{source:notice.key,h});
  expect(f.rpc).toHaveBeenCalledWith('sb_calendar_ingest_notice',{source:notice.key,h,...snapshot});
  expect(f.rpc.mock.calls.map(([name])=>name)).toEqual(['sb_calendar_claim','sb_calendar_task_sources','sb_calendar_notice_payload','sb_calendar_ingest_notice','sb_calendar_finish']);
  expect(f.fetcher).not.toHaveBeenCalled();expect(f.collectSecIR).not.toHaveBeenCalled();
 });
 it('failed notice validation never reaches ingestion and keeps the normal failure handoff',async()=>{
  const f=fixture([notice]);f.archiveNotice.mockRejectedValueOnce(new CalendarError('notice_original_hash'));
  expect(await(await f.call()).json()).toEqual({results:[{source:notice.key,status:'failed',code:'notice_original_hash'}]});
  expect(f.rpc.mock.calls.some(([name])=>name==='sb_calendar_ingest_notice')).toBe(false);
  expect(f.rpc.mock.calls.at(-1)?.[0]).toBe('sb_calendar_finish');
 });
 it('completed notice retries hand off cleanly without reingesting or re-fetching',async()=>{
  const f=fixture([notice]);f.archiveNotice.mockResolvedValueOnce({completed:true,count:3});
  expect(await(await f.call()).json()).toEqual({results:[{source:notice.key,status:'verified',items:3}]});
  expect(f.rpc.mock.calls.some(([name])=>name==='sb_calendar_ingest_notice')).toBe(false);expect(f.fetcher).not.toHaveBeenCalled();
 });
 it('reserves each regulator request and does not charge first-party storage or third-party IR transport',async()=>{
  const f=fixture([sec],{SEC_CONTACT_EMAIL:'synthetic@example.invalid',DART_RELAY_SECRET:'d'.repeat(64)});
  f.collectSecIR.mockImplementation(async(_source,_day,_contact,_archive,fetcher)=>{
   await fetcher('https://data.sec.gov/submissions/CIK0000000996.json');
   await fetcher('https://www.sec.gov/Archives/edgar/data/996/report.htm');
   await fetcher('https://investors.synthetic.invalid/events');return snapshot;
  });
  expect((await f.call()).status).toBe(200);
  expect(f.rpc.mock.calls.filter(([name])=>name==='sb_calendar_provider_reserve')).toEqual([
   ['sb_calendar_provider_reserve',{p:'sec'}],['sb_calendar_provider_reserve',{p:'sec'}],
  ]);
  expect(f.fetcher).toHaveBeenCalledTimes(3);
 });
 it('stops before regulator I/O and preserves the quota error for next-day queue deferral',async()=>{
  const f=fixture([sec],{SEC_CONTACT_EMAIL:'synthetic@example.invalid',DART_RELAY_SECRET:'d'.repeat(64)}),normal=f.rpc.getMockImplementation()!;
  f.rpc.mockImplementation(async(name,args)=>name==='sb_calendar_provider_reserve'?{error:{code:'PT429',message:'daily_request_limit'},data:null}:normal(name,args));
  f.collectSecIR.mockImplementation(async(_source,_day,_contact,_archive,fetcher)=>{await fetcher('https://data.sec.gov/submissions/CIK0000000996.json');return snapshot;});
  expect(await(await f.call()).json()).toEqual({results:[{source:sec.key,status:'failed',code:'daily_request_limit'}]});
  expect(f.fetcher).not.toHaveBeenCalled();
  expect(f.rpc).toHaveBeenCalledWith('sb_calendar_finish',expect.objectContaining({summary:[{source:sec.key,status:'failed',code:'daily_request_limit'}]}));
  expect(f.rpc.mock.calls.some(([name])=>name.startsWith('sb_calendar_ingest'))).toBe(false);
 });
 it('charges the DART relay list and each DART HTML request exactly once',async()=>{
  const f=fixture([dart],{DART_API_KEY:'c'.repeat(40),DART_RELAY_SECRET:'d'.repeat(64)});
  f.collectDartIR.mockImplementation(async(_source,_day,_archive,listPage,fetcher)=>{
   await (listPage as (corp:string,page:number,start:string,end:string,signal:AbortSignal)=>Promise<Uint8Array>)('00999991',1,'2028-08-01','2028-11-02',new AbortController().signal);
   await fetcher('https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20281101000001');return snapshot;
  });
  expect((await f.call()).status).toBe(200);
  expect(f.rpc.mock.calls.filter(([name])=>name==='sb_calendar_provider_reserve')).toHaveLength(2);
  expect(f.dartRelay).toHaveBeenCalledTimes(1);expect(f.fetcher).toHaveBeenCalledTimes(1);
 });
});
