// @vitest-environment node
import {describe,it,expect,vi} from 'vitest';
import {collectSecProfileEnrichment,type ProfileTransport} from '../../../supabase/functions/signalbrief-profiles/enrichment-service';
import {profileEnrichmentSchema} from '../src/lib/company-profile-contract';

const company={id:'20000000-0000-4000-8000-000000000001',provider_company_id:'0000000123',ticker:'SYN'};
const originalURL='https://www.sec.gov/Archives/edgar/data/123/000000012326000001/annual.htm';
const amendmentURL='https://www.sec.gov/Archives/edgar/data/123/000000012326000002/amendment.htm';
const quarterURL='https://www.sec.gov/Archives/edgar/data/123/000000012326000003/quarter.htm';
const overview='We provide synthetic laboratory infrastructure and documented equipment services for industrial research customers.';
const operations='Our engineering teams maintain laboratory instruments and provide research support to customers in several markets.';
const wrap=(body:string,form='10-K',period='2025-12-31',flag='false')=>`<html><head><title>Synthetic filing</title></head><body><div hidden><ix:nonNumeric name="dei:EntityCentralIndexKey">0000000123</ix:nonNumeric><ix:nonNumeric name="dei:DocumentType">${form}</ix:nonNumeric><ix:nonNumeric name="dei:DocumentPeriodEndDate">${period}</ix:nonNumeric><ix:nonNumeric name="dei:AmendmentFlag">${flag}</ix:nonNumeric></div><h1><ix:nonNumeric name="dei:EntityRegistrantName">Synthetic Corporation</ix:nonNumeric></h1>${body}</body></html>`;
const business=`<h2>Item 1. Business</h2><p>${overview}</p><p>${operations}</p><h3>Products</h3><p>Research Tool: We provide this synthetic instrument for documented laboratory analysis and commercial equipment testing.</p><h2>Item 1A. Risk Factors</h2><p>The Company has one reportable segment, Laboratory Services.</p>`;
const original=wrap(business+'<h2>Signatures</h2><p>/s/ Taylor Example</p><p>Chief Executive Officer</p>');
const quarter=wrap('<p>The Company has one reportable segment, Laboratory Services.</p><h2>Signatures</h2><p>/s/ Finance Person</p><p>Chief Financial Officer</p>','10-Q','2026-09-30');
const explanation=`<h2>EXPLANATORY NOTE</h2><p>We previously filed the <a href="https://www.sec.gov/ix?doc=${new URL(originalURL).pathname}">Annual Report on Form 10-K</a> for the year ended December 31, 2025.</p><p>This amendment is filed solely to:</p><p>amend Part III, Items 10, 11, 12, 13 and 14, with the required governance disclosures;</p><p>file new executive certifications under Item 15 of Part IV.</p><p>All other disclosures in the Original Form 10-K remain unchanged by this amendment.</p><h2>INDEX</h2><h2>PART III</h2><p>The following sections provide the specified governance disclosures.</p>`;
const amendment=wrap('<h2>FORM 10-K/A</h2><p>Amendment No. 1</p>'+explanation,'10-K/A');
type Filing={accession:string;form:string;date:string;period:string;document:string};
const filings:Filing[]=[
 {accession:'0000000123-26-000003',form:'10-Q',date:'2026-10-29',period:'2026-09-30',document:'quarter.htm'},
 {accession:'0000000123-26-000002',form:'10-K/A',date:'2026-04-30',period:'2025-12-31',document:'amendment.htm'},
 {accession:'0000000123-26-000001',form:'10-K',date:'2026-02-01',period:'2025-12-31',document:'annual.htm'},
];
const submissions=(rows=filings)=>JSON.stringify({cik:123,tickers:['SYN'],filings:{recent:{accessionNumber:rows.map(row=>row.accession),form:rows.map(row=>row.form),filingDate:rows.map(row=>row.date),reportDate:rows.map(row=>row.period),primaryDocument:rows.map(row=>row.document)}}});
function fixture(){
 const responses=new Map([[originalURL,original],[amendmentURL,amendment],[quarterURL,quarter]]);
 const writes:{path:string;bytes:Uint8Array}[]=[];
 const fetcher=vi.fn(async(input:URL|RequestInfo)=>new Response(responses.get(String(input))??'',{status:responses.has(String(input))?200:404}));
 const archive=vi.fn(async(path:string,bytes:Uint8Array)=>{writes.push({path,bytes});});
 const reserve=vi.fn().mockResolvedValue(undefined);
 const transport:ProfileTransport={fetcher:fetcher as typeof fetch,archive,reserve,signal:new AbortController().signal,now:()=>new Date('2026-11-02T05:30:00Z')};
 const collect=(raw=submissions())=>collectSecProfileEnrichment(company,raw,'Synthetic Corporation','audit@example.test',[],transport);
 return {responses,writes,fetcher,archive,reserve,transport,collect};
}

describe('explicit unchanged-original recovery for SEC Part III amendments',()=>{
 it('collects the selected amendment, its explicitly linked original and latest filing with independent dated evidence',async()=>{
  const f=fixture(),snapshot=await f.collect();
  expect(profileEnrichmentSchema.parse(snapshot.result).business.map(item=>item.text)).toEqual([overview,operations]);
  expect(snapshot.result.products.map(item=>item.name)).toEqual(['Research Tool']);
  expect(snapshot.result.leadership).toMatchObject([{name:'Taylor Example',as_of:'2026-02-01',basis:'filing'}]);
  expect(new Set(f.fetcher.mock.calls.map(([url])=>String(url)))).toEqual(new Set([originalURL,amendmentURL,quarterURL]));
  expect(f.fetcher).toHaveBeenCalledTimes(3);expect(f.reserve).toHaveBeenCalledTimes(3);
  expect(snapshot.result.sources.map(source=>source.source_url)).toContain(amendmentURL);
  expect(snapshot.result.sources.find(source=>source.source_url===originalURL)).toMatchObject({published_on:'2026-02-01',form_type:'10-K',report_period:'2025-12-31'});
  for(const source of snapshot.archives){
   const bytes=f.writes.find(write=>write.path===source.object_key)!.bytes;
   const sha=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes)))].map(value=>value.toString(16).padStart(2,'0')).join('');
   expect(sha).toBe(source.source_sha256);
  }
  for(const item of [...snapshot.result.business,...snapshot.result.products,...snapshot.result.segments,...snapshot.result.leadership]){
   const source=snapshot.archives.find(source=>source.id===item.evidence.source_id)!;
   expect(Array.from(source.normalized_text).slice(item.evidence.location.start,item.evidence.location.end).join('')).toBe(item.evidence.quote);
  }
  expect(JSON.stringify(snapshot.result)).not.toContain('object_key');
 });
 it('allows only an explicit newer CEO signature to replace the original dated executive evidence',async()=>{
  const f=fixture();f.responses.set(quarterURL,quarter.replace('Finance Person','Morgan Example').replace('Chief Financial Officer','Chief Executive Officer'));
  const result=(await f.collect()).result;
  expect(result.business.map(item=>item.text)).toEqual([overview,operations]);
  expect(result.leadership).toMatchObject([{name:'Morgan Example',as_of:'2026-10-29',basis:'filing'}]);
 });
 it.each([
  ['no explanatory note',amendment.replace('EXPLANATORY NOTE','BACKGROUND')],
  ['no exclusive scope',amendment.replace('filed solely to','filed to')],
  ['no unchanged statement',amendment.replace('All other disclosures in the Original Form 10-K remain unchanged by this amendment.','Other report content may also require updates.')],
  ['changed Part I',amendment.replace('amend Part III','amend Part I and Part III')],
  ['changed Item 1',amendment.replace('Items 10, 11','Items 1, 10, 11')],
  ['no explicit original link',amendment.replace(/<a href="[^"]+">(Annual Report on Form 10-K)<\/a>/,'$1')],
  ['foreign original link',amendment.replace('/data/123/000000012326000001/','/data/999/000000012326000001/')],
  ['wrong inline form',amendment.replace('>10-K/A<','>10-K<')],
  ['missing amendment flag',amendment.replace('<ix:nonNumeric name="dei:AmendmentFlag">false</ix:nonNumeric>','')],
  ['unknown amendment flag',amendment.replace('<ix:nonNumeric name="dei:AmendmentFlag">false</ix:nonNumeric>','<ix:nonNumeric name="dei:AmendmentFlag">unknown</ix:nonNumeric>')],
 ])('rejects an inconsistent amendment without complete recovery evidence: %s',async(_label,html)=>{
  const f=fixture();f.responses.set(amendmentURL,html);
  await expect(f.collect()).rejects.toThrow('profile_filing_identity_invalid');
  expect(f.fetcher.mock.calls.map(([url])=>String(url))).not.toContain(originalURL);
 });
 it.each(['missing_original','wrong_period','future_original'])('requires the original link to match complete submissions metadata: %s',async kind=>{
  const f=fixture();const rows=filings.map(row=>({...row}));
  if(kind==='missing_original')rows.pop();else if(kind==='wrong_period')rows[2].period='2024-12-31';else rows[2].date='2026-12-01';
  await expect(f.collect(submissions(rows))).rejects.toThrow('profile_filing_identity_invalid');
  expect(f.fetcher.mock.calls.map(([url])=>String(url))).not.toContain(originalURL);
 });
 it.each([
  ['issuer','>0000000123<','>0000000999<','company_identity_mismatch'],
  ['period','>2025-12-31<','>2024-12-31<','profile_filing_identity_invalid'],
  ['form','>10-K<','>10-Q<','profile_filing_identity_invalid'],
 ])('independently rejects a substituted original %s',async(_label,before,after,error)=>{
  const f=fixture();f.responses.set(originalURL,original.replace(before,after));
  await expect(f.collect()).rejects.toThrow(error);
 });
 it('never falls back to the original when a valid amendment changes the business section',async()=>{
  const f=fixture(),updated='We now provide a different synthetic research platform with newly documented commercial equipment services.';
  f.responses.set(amendmentURL,wrap(business.replace(overview,updated),'10-K/A','2025-12-31','true'));
  const result=(await f.collect()).result;
  expect(result.business[0].text).toBe(updated);
  expect(f.fetcher.mock.calls.map(([url])=>String(url))).not.toContain(originalURL);
 });
 it('does not publish recovered original fields when their archive cannot be persisted',async()=>{
  const f=fixture();f.archive.mockImplementation(async(path,bytes)=>{
   if(new TextDecoder().decode(bytes)===original)throw new Error('archive failed');
   f.writes.push({path,bytes});
  });
  const result=(await f.collect()).result;
  expect(result.business).toEqual([]);expect(result.products).toEqual([]);
  expect(result.sources.map(source=>source.source_url)).not.toContain(originalURL);
  expect(result.limitations).toContain('annual_report_unavailable');
 });
});
