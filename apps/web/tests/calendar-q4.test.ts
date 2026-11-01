// @vitest-environment node
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {describe,expect,it,vi} from 'vitest';
import {CalendarError,fetchSource,parseSource,sha256,type Source} from '../../../supabase/functions/signalbrief-calendar/core';
import {calendarWindow,collectMicronQ4,MICRON_EVENTS_URL,micronFeedUrl,parseMicronPage} from '../../../supabase/functions/signalbrief-calendar/micron-q4';

const source:Source={key:'micron-ir',ticker:'MU',market:'NASDAQ',url:MICRON_EVENTS_URL,adapter:'micron-q4'};
const today='2028-11-01',window=calendarWindow(today);
const row=(id=1,patch:Record<string,unknown>={})=>({EventId:id,Title:`Synthetic issuer webcast ${id}`,StartDate:'10/21/2028 10:00:00',EndDate:'10/21/2028 11:00:00',TimeZone:'ET',TagsList:['webcast'],...patch});
const raw=(rows:unknown[])=>new TextEncoder().encode(JSON.stringify({GetEventListResult:rows}));
const response=(rows:unknown[])=>new Response(raw(rows),{headers:{'Content-Type':'application/json; charset=utf-8'}});
const archiveFixture=()=>{
 const objects=new Map<string,Uint8Array>();
 const archive=vi.fn(async(path:string,bytes:Uint8Array,contentType:string)=>{expect(contentType).toBe('application/json');objects.set(path,bytes);});
 return {objects,archive};
};

describe('official Micron Q4 source and complete pagination',()=>{
 it('retains exact pages plus a digest-bound manifest, fetching an explicit empty tail even after a short page',async()=>{
  const first=Array.from({length:100},(_,index)=>row(index+1,{TagsList:index===0?['webcast']:['risk-factor']}));
  const f=archiveFixture(),fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(response(first)).mockResolvedValueOnce(response([row(101)])).mockResolvedValueOnce(response([]));
  const result=await collectMicronQ4(source,today,f.archive,fetcher);
  expect(fetcher.mock.calls.map(([url])=>String(url))).toEqual([0,1,2].map(micronFeedUrl));
  for(const [,init] of fetcher.mock.calls){expect(init?.redirect).toBe('error');expect(init?.signal).toBeInstanceOf(AbortSignal);}
  expect(result.manifest.pages.map(page=>page.count)).toEqual([100,1,0]);expect(result.manifest.complete).toBe(true);
  expect(result.manifest.entries.map(entry=>entry.key)).toEqual(['1','101']);
  expect(f.objects.get(result.manifest.pages[0].object_key)).toEqual(raw(first));
  for(const page of result.manifest.pages)expect(await sha256(f.objects.get(page.object_key)!)).toBe(page.raw_sha256);
  expect(await sha256(f.objects.get(result.object_key)!)).toBe(result.raw_sha);
  expect(JSON.parse(result.manifest_text)).toEqual(result.manifest);
 });
 it('uses stable provider event IDs, exact local-time quotes and JSON locations while excluding publication-only rows',()=>{
  const parsed=parseMicronPage(raw([row(1),row(2,{TagsList:['risk-factor']}),row(3,{TagsList:['webcast','risk-factor']}),row(4,{TagsList:[]})]),2,window);
  expect(parsed.count).toBe(4);expect(parsed.entries).toEqual([{key:'1',title:'Synthetic issuer webcast 1',occurs_on:'2028-10-21',quote:'Synthetic issuer webcast 1 | 10/21/2028 10:00:00 ET',timezone:'America/New_York',location:'pages[2].GetEventListResult[0]'}]);
 });
 it('fails closed on an empty all-years catalog but accepts a nonempty catalog with no current eligible events',async()=>{
  const f=archiveFixture();
  await expect(collectMicronQ4(source,today,f.archive,vi.fn<typeof fetch>().mockResolvedValueOnce(response([])))).rejects.toThrow('unexpected_empty_catalog');
  expect([...f.objects.keys()].every(path=>path.includes('/pages/'))).toBe(true);
  const result=await collectMicronQ4(source,today,f.archive,vi.fn<typeof fetch>().mockResolvedValueOnce(response([row(1,{TagsList:['risk-factor']})])).mockResolvedValueOnce(response([])));
  expect(result.manifest.entries).toEqual([]);expect(result.manifest.pages.map(page=>page.count)).toEqual([1,0]);
 });
 it.each(['ET','EDT','EST'])('preserves explicitly supplied %s without inventing UTC or an all-day time',zone=>{
  const [entry]=parseMicronPage(raw([row(1,{TimeZone:zone})]),0,window).entries;
  expect(entry.occurs_on).toBe('2028-10-21');expect(entry.quote.endsWith(`10:00:00 ${zone}`)).toBe(true);expect(entry.timezone).toBe('America/New_York');
 });
 it.each([
  {StartDate:'10/21/2028'}, {StartDate:'TBD'}, {StartDate:'02/30/2028 10:00:00'}, {StartDate:'10/21/2028 24:00:00'},
  {EndDate:'10/20/2028 11:00:00'}, {TimeZone:''}, {TimeZone:'UTC'}, {TimeZone:null}, {TagsList:'webcast'}, {EventId:'1'},
 ])('rejects ambiguous or malformed source fields %j',patch=>{expect(()=>parseMicronPage(raw([row(1,patch)]),0,window)).toThrow(CalendarError);});
 it('keeps only explicitly dated events inside the supported window, including clamped month ends',()=>{
  expect(calendarWindow('2027-08-31').end).toBe('2029-02-28');
  const parsed=parseMicronPage(raw([row(1,{StartDate:'01/01/2028 10:00:00',EndDate:'01/01/2028 11:00:00'}),row(2),row(3,{StartDate:'01/01/2031 10:00:00',EndDate:'01/01/2031 11:00:00'})]),0,window);
  expect(parsed.entries.map(entry=>entry.key)).toEqual(['2']);
 });
 it.each([{}, {Title:'Conflicting synthetic revision'}])('rejects duplicate or conflicting identities across pages rather than accepting a drifting snapshot',async patch=>{
  const first=Array.from({length:100},(_,index)=>row(index+1,{TagsList:['risk-factor']}));
  const f=archiveFixture(),fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(response(first)).mockResolvedValueOnce(response([row(1,patch)]));
  await expect(collectMicronQ4(source,today,f.archive,fetcher)).rejects.toThrow('duplicate_calendar_identity');
  expect([...f.objects.keys()].every(path=>path.includes('/pages/'))).toBe(true);
 });
 it('rejects a nonempty page following a short page rather than authorizing a partial replacement',async()=>{
  const f=archiveFixture(),fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(response([row(1)])).mockResolvedValueOnce(response([row(2)]));
  await expect(collectMicronQ4(source,today,f.archive,fetcher)).rejects.toThrow('incomplete_pagination');
  expect([...f.objects.keys()].every(path=>path.includes('/pages/'))).toBe(true);
 });
 it('rejects a capped feed without an empty tail',async()=>{
  const f=archiveFixture(),fetcher=vi.fn<typeof fetch>().mockImplementation(async url=>response(Array.from({length:100},(_,index)=>row(Number(new URL(String(url)).searchParams.get('pageNumber'))*100+index+1,{TagsList:['risk-factor']}))));
  await expect(collectMicronQ4(source,today,f.archive,fetcher)).rejects.toThrow('incomplete_pagination');
  expect(fetcher).toHaveBeenCalledTimes(10);expect([...f.objects.keys()].every(path=>path.includes('/pages/'))).toBe(true);
 });
 it.each([{url:'https://untrusted.example.invalid/'},{url:MICRON_EVENTS_URL+'?redirect=1'},{ticker:'OTHER'},{key:'other-ir'}])('denies changed source configuration before any network/archive work %j',async patch=>{
  const f=archiveFixture(),fetcher=vi.fn<typeof fetch>();await expect(collectMicronQ4({...source,...patch},today,f.archive,fetcher)).rejects.toThrow('invalid_source_url');expect(fetcher).not.toHaveBeenCalled();expect(f.archive).not.toHaveBeenCalled();
 });
 it.each([
  new Response('{}',{status:503,headers:{'Content-Type':'application/json'}}),
  new Response('<html>unexpected</html>',{headers:{'Content-Type':'text/html'}}),
  new Response('x'.repeat(1000001),{headers:{'Content-Type':'application/json'}}),
  new Response('{"error":"provider_failure"}',{headers:{'Content-Type':'application/json'}}),
 ])('rejects provider HTTP, media, size and wrapper failures',async result=>{
  const f=archiveFixture(),fetcher=vi.fn<typeof fetch>().mockResolvedValue(result);
  await expect(collectMicronQ4(source,today,f.archive,fetcher)).rejects.toThrow(CalendarError);
  expect([...f.objects.keys()].every(path=>path.includes('/pages/'))).toBe(true);
 });
 it('cannot complete when a raw page or the final manifest fails archival',async()=>{
  for(const failOn of [1,3]){
   const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(response([row()])).mockResolvedValueOnce(response([]));
   let count=0;const archive=vi.fn(async()=>{if(++count===failOn)throw new CalendarError('archive_failed');});
   await expect(collectMicronQ4(source,today,archive,fetcher)).rejects.toThrow('archive_failed');
  }
 });
});

function handlerFixture(fetcher:typeof fetch,archiveError=false){
 const upload=vi.fn(async()=>({error:archiveError?{message:'Synthetic archive failure'}:null}));
 const rpc=vi.fn(async(name:string)=>({error:null,data:name==='sb_calendar_sources'?[source]:name==='sb_calendar_ingest_q4'?1:true}));
 const db={rpc,storage:{from:()=>({upload})}};
 let handler!:(request:Request)=>Promise<Response>;
 const code=readFileSync(new URL('../../../supabase/functions/signalbrief-calendar/index.ts',import.meta.url),'utf8').replace(/^import .*\r?\n/gm,'').replace(/^export /gm,'');
 runInNewContext(ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText,{createClient:()=>db,CalendarError,fetchSource,parseSource,sha256,collectMicronQ4:(s:Source,_today:string,archive:Parameters<typeof collectMicronQ4>[2])=>collectMicronQ4(s,today,archive,fetcher),Response,Request,Headers,TextEncoder,TextDecoder,Date,Deno:{env:{get:()=> 'synthetic-env'},serve:(fn:typeof handler)=>{handler=fn;}}});
 return {rpc,upload,call:()=>handler(new Request('https://fixture.invalid/calendar',{method:'POST',headers:{'x-signalbrief-task':'a'.repeat(64)}}))};
}

describe('calendar task atomic source boundary',()=>{
 it('passes only the fully archived manifest to the new service RPC',async()=>{
  const f=handlerFixture(vi.fn<typeof fetch>().mockResolvedValueOnce(response([row()])).mockResolvedValueOnce(response([])));
  expect((await f.call()).status).toBe(200);expect(f.upload).toHaveBeenCalledTimes(3);
  expect(f.rpc).toHaveBeenCalledWith('sb_calendar_ingest_q4',expect.objectContaining({source:'micron-ir',object_key:expect.stringMatching(/\.json$/),manifest_text:expect.stringContaining('"complete":true')}));
  expect(f.rpc).not.toHaveBeenCalledWith('sb_calendar_ingest',expect.anything());
 });
 it.each(['partial','archive'])('records a %s failure without ingestion or withdrawal',async mode=>{
  const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(response([row()])).mockRejectedValueOnce(new Error('Synthetic provider failure'));
  const f=handlerFixture(fetcher,mode==='archive'),result=await f.call();
  expect(await result.json()).toMatchObject({results:[{source:'micron-ir',status:'failed'}]});
  expect(f.rpc.mock.calls.some(([name])=>name==='sb_calendar_ingest_q4'||name==='sb_calendar_ingest')).toBe(false);
  expect(f.rpc).toHaveBeenCalledWith('sb_calendar_source_error',expect.objectContaining({source:'micron-ir'}));
 });
});
