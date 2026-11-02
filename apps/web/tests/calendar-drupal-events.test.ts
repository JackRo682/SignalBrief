// @vitest-environment node
import {describe,expect,it,vi} from 'vitest';
import {collectSecIR,structuredIREntries,type SecIRSource} from '../../../supabase/functions/signalbrief-calendar/sec-ir';
import {sha256} from '../../../supabase/functions/signalbrief-calendar/core';

const url='https://investors.synthetic-corp.com/news-events/events';
const source:SecIRSource={key:'sec-ir-0000000996',company_id:'10000000-0000-4000-8000-000000000096',provider:'sec',provider_company_id:'0000000996',ticker:'SYN',market:'NASDAQ',adapter:'sec-ir',url:'https://www.sec.gov/edgar/browse/?CIK=0000000996'};
const window={start:'2028-08-03',end:'2030-05-01'};
const encode=(s:string)=>new TextEncoder().encode(s);
const article=(title='Synthetic annual meeting',date='November 17, 2028',time='8:00 AM PST',href='/events/event-details/annual-meeting')=>`<article class="node node--type-nir-event node--view-mode-nir-widget-list"><div class="field-nir-event-title"><a href="${href}">${title}</a></div><div class="nir-widget--event--date">${date}${time?` <span class="lfg_time">${time}</span>`:''}</div><div>Official webcast</div></article>`;
const page=(body:string)=>`<title>Events | Synthetic Official Issuer, Inc.</title><meta property="og:site_name" content="Synthetic Official Issuer, Inc."><div class="block-nir-events__widget">${body}</div>`;
const parse=(body:string)=>structuredIREntries(encode(page(body)),url,'a'.repeat(64),source,window);

describe('generic Nasdaq/Drupal published event lists',()=>{
 it('recognizes explicit visible dates and stable same-origin detail identities',()=>{
  const result=parse(article());expect(result.recognized).toBe(true);
  expect(result.entries).toEqual([expect.objectContaining({key:'event:/events/event-details/annual-meeting',title:'Synthetic annual meeting',occurs_on:'2028-11-17',source_url:url,raw_sha256:'a'.repeat(64),timezone:null,event_url:'https://investors.synthetic-corp.com/events/event-details/annual-meeting',source_date:'November 17, 2028 8:00 AM PST',date_text:'November 17, 2028'})]);
 });
 it('binds exact normalized article text and Unicode code-point quotation offsets',()=>{
  const result=parse(article('Older 📄 conference','February 11, 2027','','/events/event-details/older')+article('Synthetic 📊 annual meeting'));
  const entry=result.entries[0],drupal=result.drupal!;
  expect(drupal).toMatchObject({normalization:'drupal-event-articles-text-v1',row_count:2,pagination_detected:false});
  expect(entry.quote).toBe('Synthetic 📊 annual meeting November 17, 2028 8:00 AM PST');
  expect(Array.from(drupal.normalized_text).slice(entry.quote_start,entry.quote_end).join('')).toBe(entry.quote);
  expect(entry.location).toBe(`drupal-list.articles[1].normalized-text[${entry.quote_start}:${entry.quote_end}]`);
 });
 it('keeps date-only events and records observed pagination',()=>{
  const result=parse(article('Date-only meeting','November 17, 2028','')+'<nav class="pager"><a rel="next" href="?page=1">Next</a></nav>');
  expect(result.entries[0].occurs_on).toBe('2028-11-17');expect(result.entries[0].timezone).toBeNull();expect(result.drupal!.pagination_detected).toBe(true);
 });
 it('returns a partial empty current window from explicitly dated older rows',()=>{
  const result=parse(article('Past meeting','February 11, 2027',''));
  expect(result.recognized).toBe(true);expect(result.entries).toEqual([]);expect(result.drupal!.row_count).toBe(1);
 });
 it.each([
  article('Meeting','November 17'),article('Meeting','TBD'),article('Meeting','February 30, 2028'),article('Meeting','November 17, 2028','8:00 AM UNKNOWN'),
  article('Meeting','November 17, 2028','8:00 AM PST','https://counterparty.com/events/event-details/meeting'),
  article('Meeting','November 17, 2028','8:00 AM PST','/news/meeting'),
  article('Meeting','November 17, 2028','8:00 AM PST','/events/event-details/meeting?year=2027'),
  article('Meeting','November 17, 2028','8:00 AM PST','/events/event-details/meeting#other'),
  article().replace('class="nir-widget--event--date"','class="unknown-date"'),
  article().replace('</a>','</a><a href="/events/event-details/other">Other meeting</a>'),
  article()+article('Other date','November 18, 2028'),article('Cancelled meeting'),
 ])('rejects ambiguous, incomplete or conflicting rows %#',body=>{expect(()=>parse(body)).toThrow();});
 it('rejects oversized catalogs instead of truncating',()=>{expect(()=>parse(Array.from({length:201},(_,n)=>article(`Meeting ${n}`,'November 17, 2028','','/events/event-details/meeting-'+n)).join(''))).toThrow('source_too_large');});
 it('still rejects floating JSON-LD timestamps',()=>{
  const jsonld='<script type="application/ld+json">{"@type":"Event","name":"Meeting","url":"'+url+'","startDate":"2028-11-17T16:00:00"}</script>';
  expect(()=>structuredIREntries(encode(jsonld),url,'a'.repeat(64),source,window)).toThrow('ambiguous_date');
 });
});
function collector(body:string,failArchive=false){
 const objects=new Map<string,Uint8Array>();
 const archive=vi.fn(async(path:string,bytes:Uint8Array)=>{if(failArchive&&path.includes('/normalized/'))throw new Error('archive_failed');objects.set(path,bytes);});
 const fetcher=vi.fn<typeof fetch>(async input=>{
  if(String(input)==='https://data.sec.gov/submissions/CIK0000000996.json')return new Response(JSON.stringify({cik:'996',name:'Synthetic Official Issuer, Inc.',tickers:['SYN'],investorWebsite:url,filings:{recent:{form:[],accessionNumber:[],primaryDocument:[],filingDate:[]}}}),{headers:{'Content-Type':'application/json'}});
  throw new Error('unexpected SEC URL');
 });
 const official=vi.fn<typeof fetch>(async input=>{if(String(input)!==url)throw new Error('unexpected official URL');return new Response(page(body),{headers:{'Content-Type':'text/html'}});});
 return {objects,archive,fetcher,official,collect:()=>collectSecIR(source,'2028-11-01','test@example.com',archive,fetcher,official)};
}
describe('archived partial Drupal collector manifest',()=>{
 it('archives original, normalized text and manifest without extra requests',async()=>{
  const f=collector(article()),result=await f.collect(),drupal=result.manifest.drupal!;
  expect(result.manifest).toMatchObject({schema:'signalbrief.calendar.sec-ir.v1',format:'drupal-list',complete:false,coverage:'published-event-list',issuer_name:'Synthetic Official Issuer, Inc.'});
  expect(f.fetcher).toHaveBeenCalledTimes(1);expect(f.official).toHaveBeenCalledTimes(1);
  expect(await sha256(f.objects.get(drupal.normalized_object_key)!)).toBe(drupal.normalized_sha256);
  expect(await sha256(f.objects.get(result.object_key)!)).toBe(result.raw_sha);
  expect(result.manifest.issuer_evidence[0].source_url).toBe(url);expect(result.manifest.entries[0].source_url).toBe(url);expect(result.manifest.entries[0].event_url).not.toBe(url);
 });
 it('requires normalized archival before the manifest',async()=>{
  const f=collector(article(),true);await expect(f.collect()).rejects.toThrow('archive_failed');expect([...f.objects.keys()].every(path=>path.includes('/discovery/'))).toBe(true);
 });
 it('retains issuer validation before interpreting widget classes',async()=>{
  const f=collector(article());f.official.mockResolvedValue(new Response(page(article()).replaceAll('Synthetic Official Issuer, Inc.','Counterparty Corporation'),{headers:{'Content-Type':'text/html'}}));
  await expect(f.collect()).rejects.toThrow('official_ir_identity_mismatch');
 });
});
