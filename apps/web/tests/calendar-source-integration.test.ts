// @vitest-environment node
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import type {ClientRequest,IncomingMessage} from 'node:http';
import type {RequestOptions} from 'node:https';
import type {LookupFunction} from 'node:net';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {POST} from '../src/app/api/internal/calendar-source/route';
import {collectSecIR,type SecIRSource} from '../../../supabase/functions/signalbrief-calendar/sec-ir';
import {createCalendarSourceFetch} from '../../../supabase/functions/signalbrief-calendar/source-relay';

const mocks=vi.hoisted(()=>({resolve:vi.fn(),request:vi.fn(),rpc:vi.fn()}));
vi.mock('@supabase/supabase-js',()=>({createClient:()=>({rpc:mocks.rpc})}));
vi.mock('@/server/calendar-source',async importActual=>{
 const actual=await importActual<typeof import('../src/server/calendar-source')>();
 return {...actual,downloadCalendarSource:(url:string,options:Parameters<typeof actual.downloadCalendarSource>[1])=>actual.downloadCalendarSource(url,{...options,resolve:mocks.resolve,request:mocks.request})};
});
const secret='d'.repeat(64),ir='https://investors.synthetic-corp.com/',events=ir+'events/';
const source:SecIRSource={key:'sec-ir-0000000996',ticker:'SYN',market:'NASDAQ',provider:'sec',provider_company_id:'0000000996',company_id:'10000000-0000-4000-8000-000000000096',adapter:'sec-ir',url:'https://www.sec.gov/edgar/browse/?CIK=0000000996'};
const q4={EventId:1,Title:'Synthetic annual meeting',StartDate:'12/08/2028 10:00:00',EndDate:'12/08/2028 11:00:00',TimeZone:'PST',TagsList:[],LinkToDetailPage:'/events/annual'};
function fixture(){
 const seenNonces=new Set<string>(),pinned:unknown[][]=[],originals=new Map<string,Uint8Array>();
 mocks.rpc.mockImplementation(async(name:string,args:Record<string,string>)=>{
  expect(name).toBe('sb_dart_relay_claim');const nonce=JSON.parse(args.body_text).nonce;
  const accepted=!seenNonces.has(nonce);seenNonces.add(nonce);return {error:null,data:accepted};
 });
 mocks.resolve.mockResolvedValue([{address:'8.8.4.4',family:4}]);
 mocks.request.mockImplementation((url:URL,options:RequestOptions,callback:(response:IncomingMessage)=>void)=>{
  const request=new EventEmitter() as ClientRequest;
  request.destroy=vi.fn(()=>request);request.end=vi.fn(()=>{
   queueMicrotask(()=>{
    (options.lookup as LookupFunction)(url.hostname,{},(...args:unknown[])=>{pinned.push(args);});
    const isFeed=url.pathname.includes('/feed/');
    const bytes=isFeed?JSON.stringify({GetEventListResult:url.searchParams.get('pageNumber')==='0'?[q4]:[]}):url.href===ir
     ? '<title>Synthetic Official Issuer - Investor Relations</title><a href="/events/">Events &amp; Presentations</a>'
     : '<title>Synthetic Official Issuer - Events Calendar</title><script src="/js/module/widgets/dist/latest/evergreen.q4Api.min.js"></script>';
    const response=new PassThrough() as PassThrough&IncomingMessage;
    response.statusCode=200;response.complete=true;response.headers={'content-type':isFeed?'application/json':'text/html; charset=utf-8'};
    callback(response);response.end(bytes);
   });return request;
  });return request;
 });
 const secFetch=vi.fn<typeof fetch>().mockImplementation(async input=>{
  expect(String(input)).toBe('https://data.sec.gov/submissions/CIK0000000996.json');
  return Response.json({cik:996,name:'Synthetic Official Issuer, Inc.',tickers:['SYN'],investorWebsite:ir});
 });
 const relay=vi.fn<typeof fetch>().mockImplementation(async(input,init)=>POST(new Request(String(input),init)));
 const archive=vi.fn(async(path:string,bytes:Uint8Array)=>{originals.set(path,bytes);});
 return {relay,archive,originals,secFetch,pinned,collect:()=>collectSecIR(source,'2028-11-02','synthetic@example.invalid',archive,secFetch,createCalendarSourceFetch(secret,relay))};
}
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('DART_RELAY_SECRET',secret);vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://synthetic-project.supabase.co');vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY','synthetic-public-key');});
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();});

describe('real Edge signer → Node HMAC/replay route → pinned downloader → archived calendar manifest',()=>{
 it('uses the authenticated pinned route for every IR/feed request while preserving canonical SEC and original bytes',async()=>{
  const f=fixture(),result=await f.collect();
  expect(f.secFetch).toHaveBeenCalledTimes(1);expect(f.relay).toHaveBeenCalledTimes(4);
  expect(mocks.rpc).toHaveBeenCalledTimes(4);expect(mocks.resolve).toHaveBeenCalledTimes(4);
  expect(f.pinned).toEqual(Array.from({length:4},()=>[null,'8.8.4.4',4]));
  expect(result.manifest.issuer_evidence.map(item=>item.source_url)).toEqual([ir,events]);
  expect(result.manifest.entries).toEqual([expect.objectContaining({key:'q4:1',occurs_on:'2028-12-08',source_url:events})]);
  expect(result.manifest.q4?.pages.map(page=>page.count)).toEqual([1,0]);
  expect(f.originals.has(result.object_key)).toBe(true);
  for(const [url,options]of mocks.request.mock.calls){expect(url.hostname).toBe('investors.synthetic-corp.com');expect(options).toMatchObject({agent:false,servername:'investors.synthetic-corp.com',rejectUnauthorized:true});}
 });
 it('fails before opening a private socket and never falls back to direct IR fetch',async()=>{
  const f=fixture();mocks.resolve.mockResolvedValue([{address:'127.0.0.1',family:4}]);vi.spyOn(console,'error').mockImplementation(()=>{});
  await expect(f.collect()).rejects.toThrow('calendar_relay_upstream_failed');
  expect(f.secFetch).toHaveBeenCalledTimes(1);expect(mocks.rpc).toHaveBeenCalledTimes(1);expect(mocks.request).not.toHaveBeenCalled();
  expect([...f.originals.keys()].every(path=>path.includes('/discovery/'))).toBe(true);
 });
});
