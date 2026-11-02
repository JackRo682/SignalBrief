// @vitest-environment node
import {describe,expect,it,vi} from 'vitest';
import {CalendarError,sha256} from '../../../supabase/functions/signalbrief-calendar/core';
import {calendarWindow,parseMicronPage} from '../../../supabase/functions/signalbrief-calendar/micron-q4';
import {collectSecIR,explicitIRDate,filedIRBinding,officialIRIdentity,structuredIREntries,type SecIRSource} from '../../../supabase/functions/signalbrief-calendar/sec-ir';
import {publicAddress,publicIRURL} from '../../../supabase/functions/signalbrief-calendar/public-source';

const source:SecIRSource={key:'sec-ir-0000000996',provider:'sec',provider_company_id:'0000000996',company_id:'10000000-0000-4000-8000-000000000096',ticker:'SYN',market:'NASDAQ',adapter:'sec-ir',url:'https://www.sec.gov/edgar/browse/?CIK=0000000996'};
const today='2028-11-02',window=calendarWindow(today),ir='https://investors.synthetic-corp.com/',events=ir+'events/';
const accession='0000000996-28-000001',primary=`https://www.sec.gov/Archives/edgar/data/996/${accession.replaceAll('-','')}/report.htm`,exhibit=primary.replace('report.htm','earnings.htm');
const encode=(text:string)=>new TextEncoder().encode(text);
const metadata=(patch:Record<string,unknown>={})=>({cik:996,name:'Synthetic Official Issuer',tickers:['SYN'],investorWebsite:'',filings:{recent:{form:['8-K'],accessionNumber:[accession],primaryDocument:['report.htm'],filingDate:['2028-10-21']}},...patch});
const quarterly='<table><tr><th>Year</th><th>Year</th><th>Quarter</th><th>Earnings Date</th></tr><tr><td rowspan="2">2028</td><td>2028</td><td>Q4</td><td>TBD</td></tr><tr><td>2028</td><td>Q3</td><td>Oct 21, 2028</td></tr></table>';
const q4Row=(id=1,patch:Record<string,unknown>={})=>({EventId:id,Title:'Synthetic official annual meeting',TagsList:[],StartDate:'12/08/2028 10:00:00',EndDate:'12/08/2028 11:00:00',TimeZone:'PST',LinkToDetailPage:'/events/annual-meeting',...patch});
const jsonResponse=(data:unknown)=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
const htmlResponse=(text:string)=>new Response(text,{headers:{'Content-Type':'text/html; charset=utf-8'}});
function fixture(options:{metadata?:Record<string,unknown>;body?:string;page?:string;q4?:boolean;secondPage?:unknown[];transportError?:string;irName?:string;eventName?:string}={}){
 const objects=new Map<string,Uint8Array>();
 const archive=vi.fn(async(path:string,bytes:Uint8Array)=>{objects.set(path,bytes);});
 const fetcher=vi.fn<typeof fetch>().mockImplementation(async input=>{
  const url=String(input);
  if(url===`https://data.sec.gov/submissions/CIK${source.provider_company_id}.json`)return jsonResponse(metadata(options.metadata));
  if(url===primary)return htmlResponse('<table><tr><td>99.1</td><td><a href="earnings.htm">Synthetic earnings release</a></td></tr></table>');
  if(url===exhibit)return htmlResponse(options.body??`<p>The live webcast is available on the Investor Relations website at ${ir}.</p>`);
  if(url===ir)return htmlResponse(`<title>${options.irName??'Synthetic Official Issuer'} - Investor Relations</title>`+(options.q4?'<a href="/events/">Events &amp; Presentations</a>':options.page??quarterly));
  if(url===events)return htmlResponse(`<title>${options.eventName??'Synthetic Official Issuer'} - Events Calendar</title><script src="/js/module/widgets/dist/latest/evergreen.q4Api.min.js"></script>`);
  if(url.startsWith(ir+'feed/Event.svc/GetEventList?'))return jsonResponse({GetEventListResult:new URL(url).searchParams.get('pageNumber')==='0'?[q4Row()]:options.secondPage??[]});
  throw new Error('Unexpected synthetic URL '+url);
 });
 const officialFetch=vi.fn<typeof fetch>().mockImplementation(async(input,init)=>{if(options.transportError)throw new CalendarError(options.transportError);return fetcher(input,init);});
 return {objects,archive,fetcher,officialFetch,collect:()=>collectSecIR(source,today,'synthetic@example.invalid',archive,fetcher,officialFetch)};
}

describe('canonical SEC-filed calendar discovery',()=>{
 it('binds an arbitrary issuer by CIK and filed exhibit, archives every original, and retains an explicit historical date without a forecast',async()=>{
  const f=fixture(),result=await f.collect();
  expect(result.manifest.binding).toMatchObject({url:ir,document_url:exhibit,location:'normalized-text/explicit-investor-relations-url'});
  expect(result.manifest.documents.map(d=>d.role)).toEqual(['submissions','primary','exhibit','ir']);
  expect(result.manifest.issuer_evidence).toEqual([expect.objectContaining({source_url:ir,label:'Synthetic Official Issuer - Investor Relations',location:'title[0]'})]);
  expect(result.manifest.entries).toEqual([expect.objectContaining({key:'quarter:2028:Q3',occurs_on:'2028-10-21',timezone:null,source_url:ir,quote:'2028 Q3 Oct 21, 2028'})]);
  for(const doc of result.manifest.documents)expect(await sha256(f.objects.get(doc.object_key)!)).toBe(doc.raw_sha256);
  expect(await sha256(f.objects.get(result.object_key)!)).toBe(result.raw_sha);
  expect(JSON.parse(result.manifest_text)).toEqual(result.manifest);
  expect(f.officialFetch).toHaveBeenCalledTimes(1);
  for(const [,init] of f.fetcher.mock.calls){expect(init?.redirect).toBe('error');expect(init?.signal).toBeInstanceOf(AbortSignal);}
 });
 it('uses SEC investorWebsite directly when present rather than guessing a hostname or fetching unrelated filings',async()=>{
  const f=fixture({metadata:{investorWebsite:ir}}),result=await f.collect();
  expect(result.manifest.documents.map(d=>d.role)).toEqual(['submissions','ir']);
  expect(result.manifest.binding.location).toBe('submissions.investorWebsite');
 });
 it('collects untagged official Q4 events with complete empty-tail pagination and hash-bound nested provenance',async()=>{
  const f=fixture({q4:true}),result=await f.collect();
  expect(result.manifest.format).toBe('q4');expect(result.manifest.q4?.tag_policy).toBe('official-events');
  expect(result.manifest.q4?.pages.map(p=>p.count)).toEqual([1,0]);
  expect(result.manifest.issuer_evidence.map(proof=>proof.source_url)).toEqual([ir,events]);
  expect(result.manifest.entries).toEqual([expect.objectContaining({key:'q4:1',occurs_on:'2028-12-08',timezone:'America/Los_Angeles',source_url:events,raw_sha256:result.manifest.q4!.pages[0].raw_sha256})]);
  expect(await sha256(f.objects.get(result.manifest.q4_manifest!.object_key)!)).toBe(result.manifest.q4_manifest!.raw_sha256);
  for(const page of result.manifest.q4!.pages)expect(await sha256(f.objects.get(page.object_key)!)).toBe(page.raw_sha256);
 });
 it('does not weaken the existing webcast policy and always excludes publication-only risk-factor rows',()=>{
  const bytes=encode(JSON.stringify({GetEventListResult:[q4Row(),q4Row(2,{TagsList:['risk-factor']}),q4Row(3,{TagsList:['webcast']})]}));
  expect(parseMicronPage(bytes,0,window).entries.map(e=>e.key)).toEqual(['3']);
  expect(parseMicronPage(bytes,0,window,'official-events').entries.map(e=>e.key)).toEqual(['1','3']);
  expect(()=>parseMicronPage(encode(JSON.stringify({GetEventListResult:[q4Row(4,{LinkToDetailPage:'//foreign.invalid/event'})]})),0,window,'official-events')).toThrow('invalid_event');
 });
 it.each([{cik:997},{tickers:['OTHER']}])('rejects wrong canonical SEC metadata before fetching IR documents %j',async patch=>{
  const f=fixture({metadata:patch});await expect(f.collect()).rejects.toThrow('company_identity_mismatch');
  expect(f.fetcher).toHaveBeenCalledTimes(1);expect(f.officialFetch).not.toHaveBeenCalled();
 });
 it('rejects invalid source identity and missing SEC contact before any provider request',async()=>{
  const f=fixture();
  await expect(collectSecIR({...source,provider_company_id:'0000000997'},today,'synthetic@example.invalid',f.archive,f.fetcher,f.officialFetch)).rejects.toThrow('invalid_source_identity');
  await expect(collectSecIR(source,today,'',f.archive,f.fetcher,f.officialFetch)).rejects.toThrow('sec_contact_not_configured');
  expect(f.fetcher).not.toHaveBeenCalled();
 });
 it('rejects a foreign-CIK exhibit instead of following an unbound SEC URL',async()=>{
  const f=fixture();f.fetcher.mockImplementationOnce(async()=>jsonResponse(metadata())).mockImplementationOnce(async()=>htmlResponse('<table><tr><td>99.1</td><td><a href="https://www.sec.gov/Archives/edgar/data/997/000000099728000001/report.htm">Earnings</a></td></tr></table>'));
  await expect(f.collect()).rejects.toThrow('invalid_sec_document');expect(f.fetcher).toHaveBeenCalledTimes(2);
 });
 it('stops on an ambiguous official IR binding rather than choosing one source',async()=>{
  const f=fixture({body:'<p>Investor Relations webcast at investors.first-corp.com or investors.second-corp.com.</p>'});
  await expect(f.collect()).rejects.toThrow('ambiguous_official_ir_source');expect(f.officialFetch).not.toHaveBeenCalled();
 });
 it.each([{irName:'Counterparty Corporation'},{q4:true,eventName:'Counterparty Corporation'}])('rejects a filed counterparty IR page before accepting calendar data %j',async options=>{
  const f=fixture(options);await expect(f.collect()).rejects.toThrow('official_ir_identity_mismatch');
  expect(f.fetcher.mock.calls.some(([url])=>String(url).includes('/feed/'))).toBe(false);
  expect([...f.objects.keys()].every(path=>path.includes('/discovery/'))).toBe(true);
 });
 it('requires an organization label matching the SEC legal name, not a ticker mention or shared fragment',()=>{
  expect(officialIRIdentity(encode('<title>Synthetic Official Issuer Investor Relations</title>'),ir,'a'.repeat(64),'Synthetic Official Issuer, Inc.').label).toBe('Synthetic Official Issuer Investor Relations');
  for(const page of ['<title>Counterparty Investor Relations</title><p>SYN partner announcement</p>',
   '<title>Synthetic Investor Relations</title>',
   '<title>Synthetic Official Issuer - Investor Relations</title><meta property="og:site_name" content="Counterparty">'])
   expect(()=>officialIRIdentity(encode(page),ir,'a'.repeat(64),'Synthetic Official Issuer, Inc.')).toThrow('official_ir_identity_mismatch');
 });
 it('retains the exact filed href alongside an explicit Investor Relations anchor label',()=>{
  expect(filedIRBinding(encode(`<a href="${ir}">Investor Relations</a>`),exhibit)).toEqual({url:ir,document_url:exhibit,quote:`Investor Relations | ${ir}`,location:'anchor/explicit-investor-relations-url'});
  expect(filedIRBinding(encode('<p>Company site without an explicitly published IR source.</p>'),exhibit)).toBeNull();
 });
 it.each(['calendar_relay_unauthorized','calendar_relay_upstream_failed','calendar_relay_network_failed'])('does not fall back to direct fetch when pinned transport fails: %s',async transportError=>{
  const f=fixture({transportError});await expect(f.collect()).rejects.toThrow(transportError);expect(f.fetcher).toHaveBeenCalledTimes(3);
 });
 it('requires the dedicated official transport rather than a DNS-preflight direct fetch',async()=>{
  const f=fixture();await expect(collectSecIR(source,today,'synthetic@example.invalid',f.archive,f.fetcher)).rejects.toThrow('official_ir_transport_unavailable');
  expect(f.fetcher).toHaveBeenCalledTimes(3);
 });
 it('fails closed on an unsupported official page without manufacturing an empty verified calendar',async()=>{
  const f=fixture({page:'<h1>Investor relations</h1><p>No structured event feed published here.</p>'});
  await expect(f.collect()).rejects.toThrow('official_calendar_format_unsupported');
  expect([...f.objects.keys()].every(path=>path.includes('/discovery/'))).toBe(true);
 });
 it('never emits a complete outer manifest when pagination or raw archival fails',async()=>{
  const partial=fixture({q4:true,secondPage:[q4Row(2)]});
  await expect(partial.collect()).rejects.toThrow('incomplete_pagination');
  expect([...partial.objects.keys()].every(path=>path.includes('/discovery/')||path.includes('/pages/'))).toBe(true);
  const failed=fixture();failed.archive.mockRejectedValueOnce(new CalendarError('archive_failed'));
  await expect(failed.collect()).rejects.toThrow('archive_failed');expect(failed.fetcher).toHaveBeenCalledTimes(1);
 });
 it.each([
  new Response('x',{status:503,headers:{'Content-Type':'application/json'}}),
  new Response('{}',{headers:{'Content-Type':'text/html'}}),
  new Response('x'.repeat(2000001),{headers:{'Content-Type':'application/json'}}),
 ])('rejects provider HTTP, media and response-size failures',async response=>{
  const f=fixture();f.fetcher.mockResolvedValueOnce(response);await expect(f.collect()).rejects.toThrow(CalendarError);
  expect(f.officialFetch).not.toHaveBeenCalled();
 });
});

describe('explicit structured IR dates',()=>{
 it('correctly expands duplicate Year columns and rowspans without assigning a date to TBD',()=>{
  const result=structuredIREntries(encode(quarterly),ir,'a'.repeat(64),source,window);
  expect(result.recognized).toBe(true);expect(result.entries.map(e=>[e.key,e.occurs_on])).toEqual([['quarter:2028:Q3','2028-10-21']]);
 });
 it.each(['Next quarter','February 30, 2028','10/21','2028-10-21T10:00:00'])('rejects unknown/invalid/ambiguous date %s',value=>{expect(()=>explicitIRDate(value)).toThrow(CalendarError);});
 it('keeps explicit JSON-LD local calendar date and raw quote without inferring an all-day event',()=>{
  const json={'@type':'Event',name:'Synthetic issuer event',startDate:'2028-11-09T09:00:00-05:00',url:'/events/synthetic'};
  const result=structuredIREntries(encode(`<script type="application/ld+json">${JSON.stringify(json)}</script>`),ir,'b'.repeat(64),source,window);
  expect(result.entries[0]).toMatchObject({key:'event:/events/synthetic',occurs_on:'2028-11-09',timezone:null,quote:'Synthetic issuer event | 2028-11-09T09:00:00-05:00'});
 });
 it.each([{startDate:'2028-11-09T09:00:00'},{eventStatus:'https://schema.org/EventCancelled'},{url:'https://foreign-corp.com/event'}])('requires explicit timezone/status and same-origin identity %j',patch=>{
  const json={'@type':'Event',name:'Synthetic issuer event',startDate:'2028-11-09',url:'/events/synthetic',...patch};
  expect(()=>structuredIREntries(encode(`<script type="application/ld+json">${JSON.stringify(json)}</script>`),ir,'b'.repeat(64),source,window)).toThrow(CalendarError);
 });
});

describe('bounded public-only official host verification',()=>{
 it.each(['http://investors.synthetic-corp.com/','https://user:pass@investors.synthetic-corp.com/','https://investors.synthetic-corp.com:444/','https://127.0.0.1/','https://[::1]/','https://issuer.local/','https://issuer.invalid/','https://project.supabase.co/'])('denies unsafe IR URL %s',url=>{expect(()=>publicIRURL(url)).toThrow('invalid_ir_url');});
 it.each(['0.0.0.0','10.0.0.1','127.0.0.1','169.254.169.254','172.16.0.1','192.168.0.1','100.64.0.1','192.0.2.1','198.51.100.1','203.0.113.1','198.18.0.1','224.0.0.1','256.1.1.1','08.8.8.8','::1','::ffff:127.0.0.1','fc00::1','fe80::1','2001:db8::1','2002:7f00:1::','2606::1::2'])('classifies nonpublic/malformed address %s as unsafe',address=>{expect(publicAddress(address)).toBe(false);});
 it.each(['8.8.4.4','104.18.9.21','2606:4700:4700::1111'])('accepts a syntactically valid public address %s',address=>{expect(publicAddress(address)).toBe(true);});
});
