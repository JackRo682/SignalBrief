// @vitest-environment node
import {describe,it,expect,vi} from 'vitest';
import {collectSecProfileEnrichment,fetchProfileSource,profileSourceURL,type ProfileTransport} from '../../../supabase/functions/signalbrief-profiles/enrichment-service';

const company={id:'20000000-0000-4000-8000-000000000001',provider_company_id:'0000000123',ticker:'SYN'};
const annualURL='https://www.sec.gov/Archives/edgar/data/123/000000012326000001/annual.htm';
const charterURL='https://www.sec.gov/Archives/edgar/data/123/000000012324000001/charter.htm';
const submissions=JSON.stringify({cik:123,tickers:['SYN'],filings:{recent:{accessionNumber:['0000000123-26-000001'],form:['10-K'],filingDate:['2026-02-01'],reportDate:['2025-12-31'],primaryDocument:['annual.htm']}}});
const annual=`<html><head><title>Synthetic annual</title></head><body><div hidden><ix:nonNumeric name="dei:EntityCentralIndexKey">0000000123</ix:nonNumeric><ix:nonNumeric name="dei:DocumentType">10-K</ix:nonNumeric><ix:nonNumeric name="dei:DocumentPeriodEndDate">2025-12-31</ix:nonNumeric></div><ix:nonNumeric name="dei:EntityRegistrantName">Synthetic Corporation</ix:nonNumeric><h2>Item 1. Business</h2><p>We provide synthetic laboratory testing services and documented research tools for engineering customers.</p><p>Our customers use those tools in research facilities, and our service teams maintain documented research records.</p><h3>Core Products</h3><p><b>Lab Tool:</b> This synthetic product manages laboratory equipment data and documents the associated experimental procedures.</p><h2>Item 1A. Risk Factors</h2><p>The Company has one reportable segment, Laboratory Services.</p><a href="${charterURL}">Certificate of Incorporation</a><h2>Signatures</h2><p>Name: Taylor Example</p><p>Title: Chief Executive Officer</p></body></html>`;
const charter='<html><body><h1>Synthetic Corporation — Certificate of Incorporation</h1><p>The original Certificate of Incorporation was filed with the Secretary of State on May 25, 2007.</p></body></html>';
function fixture(){
 const writes:{path:string;bytes:Uint8Array;type:string}[]=[];
 const responses=new Map([[annualURL,annual],[charterURL,charter]]);
 const fetcher=vi.fn(async(input:URL|RequestInfo)=>new Response(responses.get(String(input))??'',{status:responses.has(String(input))?200:404,headers:{'Content-Type':'text/html'}}));
 const archive=vi.fn(async(path:string,bytes:Uint8Array,type:string)=>{writes.push({path,bytes,type});});
 const reserve=vi.fn().mockResolvedValue(undefined);
 const transport:ProfileTransport={fetcher:fetcher as typeof fetch,archive,reserve,signal:new AbortController().signal,now:()=>new Date('2026-11-02T01:00:00Z')};
 const collect=()=>collectSecProfileEnrichment(company,submissions,'Synthetic Corporation','audit@example.test',[],transport);
 return {transport,collect,fetcher,archive,reserve,writes,responses};
}
describe('profile collection retains exact originals and independent field provenance',()=>{
 it('publishes source-backed fields only after every used original was archived',async()=>{
  const f=fixture(),snapshot=await f.collect();expect(snapshot.result.status).toBe('ready');
  expect(snapshot.result.formation).toMatchObject([{kind:'incorporated',date:'2007-05-25',precision:'day'}]);
  expect(snapshot.result.leadership).toMatchObject([{name:'Taylor Example',as_of:'2026-02-01',basis:'filing'}]);
  expect(f.writes).toHaveLength(2);expect(f.reserve).toHaveBeenCalledTimes(2);
  for(const source of snapshot.archives){
   const raw=f.writes.find(write=>write.path===source.object_key)!;
   const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(raw.bytes)))].map(value=>value.toString(16).padStart(2,'0')).join('');
   expect(digest).toBe(source.source_sha256);expect(raw.type).toBe('text/html; charset=utf-8');
  }
  expect(JSON.stringify(snapshot.result)).not.toContain('object_key');expect(JSON.stringify(snapshot.result)).not.toContain('normalized_text":"We');
  for(const call of f.fetcher.mock.calls)expect(call[0]).toBeInstanceOf(URL);
 });
 it('fails instead of publishing a source whose immutable archive failed',async()=>{const f=fixture();f.archive.mockRejectedValue(new Error('signed-url-secret'));await expect(f.collect()).rejects.toThrow('profile_source_unavailable');});
 it('rejects substituted issuer content even if the source URL is correctly bound',async()=>{const f=fixture();f.responses.set(annualURL,annual.replace('>0000000123<','>0000000999<'));await expect(f.collect()).rejects.toThrow('company_identity_mismatch');});
 it('keeps partial sourced business data while an optional charter is unavailable',async()=>{
  const f=fixture();f.responses.delete(charterURL);const result=(await f.collect()).result;
  expect(result.status).toBe('partial');expect(result.business.length).toBeGreaterThan(0);expect(result.formation).toEqual([]);expect(result.limitations).toContain('formation_source_unavailable');
  expect(result.sources).toHaveLength(1);
 });
 it('does not describe a failed annual request as a successful empty profile',async()=>{const f=fixture();f.responses.delete(annualURL);await expect(f.collect()).rejects.toThrow('profile_source_unavailable');});
 it('returns explicit missing-periodic coverage without inventing source-backed facts',async()=>{
  const f=fixture(),raw=JSON.stringify({cik:123,tickers:['SYN'],filings:{recent:{accessionNumber:[],form:[],filingDate:[],reportDate:[],primaryDocument:[]}}});
  const result=(await collectSecProfileEnrichment(company,raw,'Synthetic Corporation','audit@example.test',[],f.transport)).result;
  expect(result.status).toBe('not_available');expect(result.sources).toEqual([]);expect(f.fetcher).not.toHaveBeenCalled();
 });
 it('bounds a body by actual streamed bytes, not just Content-Length',async()=>{
  const f=fixture();f.transport.fetcher=vi.fn().mockResolvedValue(new Response('12345'));
  await expect(fetchProfileSource(new URL(annualURL),f.transport,{},4)).rejects.toThrow('profile_source_too_large');expect(f.archive).not.toHaveBeenCalled();
 });
 it('does not follow redirects or leak transport exceptions containing signed URLs',async()=>{
  const f=fixture();f.transport.fetcher=vi.fn().mockRejectedValue(new Error('https://private.example.test/?signed=secret'));
  await expect(f.collect()).rejects.toThrow('profile_source_unavailable');
  expect(f.transport.fetcher).toHaveBeenCalledWith(expect.any(URL),expect.objectContaining({redirect:'error',signal:expect.any(AbortSignal)}));
 });
 it.each(['https://127.0.0.1/internal','https://investor.visa.com.evil.test/private','https://investor.visa.com:444/private','https://user:password@investor.visa.com/private','http://investor.visa.com/private'])('rejects unreviewed official URL %s before fetching',url=>expect(()=>profileSourceURL(url,'official',{...company,provider_company_id:'0001403161'})).toThrow('profile_source_url_invalid'));
});
