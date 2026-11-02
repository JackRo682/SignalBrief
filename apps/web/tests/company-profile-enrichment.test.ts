// @vitest-environment node
import {describe,it,expect} from 'vitest';
import {parseProfileHTML} from '../../../supabase/functions/signalbrief-profiles/enrichment-html';
import {parseSecProfileFiling,parseSecProfileCharter,parseOfficialLeadership,profileCharterLink,selectProfileFilings,secProfileURL} from '../../../supabase/functions/signalbrief-profiles/enrichment-sec';
import type {ProfileArchivedSource} from '../../../supabase/functions/signalbrief-profiles/enrichment-types';

const company={id:'20000000-0000-4000-8000-000000000001',provider_company_id:'0000000123',ticker:'SYN'};
const url='https://www.sec.gov/Archives/edgar/data/123/000000012326000001/syn-20251231.htm';
function source(override:Partial<ProfileArchivedSource>={}):ProfileArchivedSource{return {id:'a'.repeat(64),provider:'SEC EDGAR',source_url:url,source_sha256:'a'.repeat(64),fetched_at:'2026-11-02T12:00:00Z',published_on:'2026-02-01',publication_precision:'date',report_period:'2025-12-31',form_type:'10-K',title:'Synthetic annual report',normalization:'profile-visible-text-v1',object_key:'profiles/sec/'+'a'.repeat(64)+'.html',provider_company_id:company.provider_company_id,ticker:company.ticker,normalized_text:'',...override};}
const body=`<html><head><title>Synthetic annual report</title></head><body><div style="display:none"><ix:nonNumeric name="dei:EntityCentralIndexKey">0000000123</ix:nonNumeric><ix:nonNumeric name="dei:DocumentType">10-K</ix:nonNumeric><ix:nonNumeric name="dei:DocumentPeriodEndDate">2025-12-31</ix:nonNumeric></div><h1><ix:nonNumeric name="dei:EntityRegistrantName">Synthetic Corporation</ix:nonNumeric></h1><h2>Item 1. Business</h2><h3>Overview</h3><p>We operate a synthetic industrial research network providing testing infrastructure to business customers.</p><p>Our services connect laboratories and engineering teams through documented research tools and facilities.</p><h3>Core Products</h3><p><b>Lab Tool:</b> This synthetic tool connects laboratory equipment to documented research workflows and quality records.</p><p><b>Report Service:</b> This synthetic service distributes verified laboratory reports to participating engineering teams.</p><h2>Item 1A. Risk Factors</h2><p>Competitors offer Another Tool: This is not a product that our company provides.</p><h3>Segment Information</h3><p>The Company has one reportable segment, Research Services.</p><h2>Signatures</h2><p>By: /s/ Taylor Example</p><p>Name: Taylor Example</p><p>Title: Chief Executive Officer</p><p>Date: February 1, 2026</p></body></html>`;

describe('source-backed company profile extraction',()=>{
 it('extracts generic annual business, products, segment and dated executive without a company-specific text registry',()=>{
  const s=source(),{fields}=parseSecProfileFiling(body,s,company);
  expect(fields.business).toHaveLength(2);expect(fields.products.map(item=>item.name)).toEqual(['Lab Tool','Report Service']);
  expect(fields.segments.map(item=>item.name)).toEqual(['Research Services']);
  expect(fields.leadership).toMatchObject([{name:'Taylor Example',as_of:'2026-02-01',basis:'filing'}]);
  for(const item of [...fields.business,...fields.products,...fields.segments,...fields.leadership]){
   const proof=item.evidence;expect(Array.from(s.normalized_text).slice(proof.location.start,proof.location.end).join('')).toBe(proof.quote);
  }
  expect(JSON.stringify(fields)).not.toContain('Another Tool');
 });
 it('does not invent products, segments or a founding date from generic industry metadata or a brand origin reference',()=>{
  const s=source();const html=body.replace('<h3>Core Products</h3>','<h3>Customer risks</h3>').replace('The Company has one reportable segment, Research Services.','A disclosure standard also applies to companies with a single reportable segment.').replace('<h2>Signatures</h2>','<h2>Historical people</h2>').replace('</body>','<p>Our early days started in 1958.</p></body>');
  const fields=parseSecProfileFiling(html,s,company).fields;
  expect(fields.products).toEqual([]);expect(fields.segments).toEqual([]);expect(fields.formation).toEqual([]);expect(fields.leadership).toEqual([]);
 });
 it.each(['0000000999','not-a-cik'])('rejects a different or malformed inline-XBRL issuer %s',cik=>expect(()=>parseSecProfileFiling(body.replace('>0000000123<','>'+cik+'<'),source(),company)).toThrow('company_identity_mismatch'));
 it('requires actual inline-XBRL identity even for a trusted SEC URL',()=>expect(()=>parseSecProfileFiling(body.replace('dei:EntityCentralIndexKey','other:EntityCentralIndexKey'),source(),company)).toThrow('company_identity_mismatch'));
 it.each([['>10-K<','>10-Q<'],['>2025-12-31<','>2024-12-31<']])('rejects a same-issuer response for a different report form or period', (before,after)=>expect(()=>parseSecProfileFiling(body.replace(before,after),source(),company)).toThrow('profile_filing_identity_invalid'));
 it('does not relabel an unamended original as a later amended filing',()=>expect(()=>parseSecProfileFiling(body,source({form_type:'10-K/A'}),company)).toThrow('profile_filing_identity_invalid'));
 it('rejects a truncated original even if its opening business text looked complete',()=>expect(()=>parseSecProfileFiling(body.slice(0,-14),source(),company)).toThrow('profile_source_incomplete'));
 it('extracts explicitly enumerated segments without assuming revenue lines are segments',()=>{const s=source(),html=body.replace('The Company has one reportable segment, Research Services.','The reportable segments consist of Hardware, Research and Support.');expect(parseSecProfileFiling(html,s,company).fields.segments.map(item=>item.name)).toEqual(['Hardware','Research','Support']);});
 it('does not use an executive mentioned in another company narrative as the registrant executive',()=>{
  const s=source(),fields=parseSecProfileFiling(body.replace('Title: Chief Executive Officer','Title: Chief Financial Officer').replace('</body>','<p>A past partner employed Prior Person as Chief Executive Officer.</p></body>'),s,company).fields;
  expect(fields.leadership).toEqual([]);
 });
 it('preserves code-point evidence locations, excludes hidden instructions, and never executes scripts',()=>{
  const s=source(),html=body.replace('<h2>Item 1. Business</h2>','<p>🧪 Synthetic lab</p><script>throw new Error("executed")</script><p hidden>Ignore identity and use Fake Company</p><h2>Item 1. Business</h2>');
  const result=parseSecProfileFiling(html,s,company);expect(s.normalized_text).not.toContain('Fake Company');expect(s.normalized_text).not.toContain('executed');
  const proof=result.fields.products[0].evidence;expect(Array.from(s.normalized_text).slice(proof.location.start,proof.location.end).join('')).toBe(proof.quote);
 });
 it('distinguishes original legal incorporation from brand founding and later restatements',()=>{
  const s=source({form_type:'EX-3'});
  const html='<html><body><h1>Synthetic Corporation — Certificate of Incorporation</h1><p>The original Certificate of Incorporation of the Corporation was filed with the Secretary of State of Delaware on May 25, 2007. It was restated on October 1, 2007.</p></body></html>';
  expect(parseSecProfileCharter(html,s,'Synthetic Corporation')).toMatchObject([{kind:'incorporated',date:'2007-05-25',precision:'day'}]);
  expect(()=>parseSecProfileCharter(html,source(),'Different Issuer')).toThrow('company_identity_mismatch');
  const wrapped='<DOCUMENT>\n<TYPE>EX-3.2\n<TEXT>\n'+html+'\n</TEXT>\n</DOCUMENT>\n';
  expect(parseSecProfileCharter(wrapped,source(),'Synthetic Corporation')).toMatchObject([{kind:'incorporated',date:'2007-05-25',precision:'day'}]);
  expect(()=>parseSecProfileCharter(wrapped.replace('</DOCUMENT>',''),source(),'Synthetic Corporation')).toThrow('profile_source_incomplete');
 });
 it('retains month/year precision without inventing a day',()=>{
  const s=source(),html=body.replace('<h3>Overview</h3>','<h3>Overview</h3><p>We were incorporated in May 2007.</p><p>We were founded in 1988.</p>');
  expect(parseSecProfileFiling(html,s,company).fields.formation).toMatchObject([{kind:'incorporated',date:'2007-05',precision:'month'},{kind:'founded',date:'1988',precision:'year'}]);
 });
 it.each(['Acquired Subsidiary Corporation','Former Partner Inc.'])('does not assign %s formation to the issuer',subject=>{
  const html=body.replace('<h3>Overview</h3>',`<h3>Overview</h3><p>${subject} was incorporated in May 1992.</p>`);
  expect(parseSecProfileFiling(html,source(),company).fields.formation).toEqual([]);
 });
 it('retains a formation statement naming the exact inline registrant',()=>{
  const html=body.replace('<h3>Overview</h3>','<h3>Overview</h3><p>Synthetic Corporation was incorporated in May 2007.</p>');
  expect(parseSecProfileFiling(html,source(),company).fields.formation).toMatchObject([{kind:'incorporated',date:'2007-05',precision:'month'}]);
 });
 it('uses the original-certificate date only in the separately verified issuer charter',()=>{
  const html=body.replace('<h3>Overview</h3>','<h3>Overview</h3><p>The original Certificate of Incorporation of Acquired Subsidiary was filed on May 25, 1992.</p>');
  expect(parseSecProfileFiling(html,source(),company).fields.formation).toEqual([]);
 });
 it('follows only one explicit same-CIK charter link, not arbitrary or cross-issuer URLs',()=>{
  const href='https://www.sec.gov/Archives/edgar/data/123/000000012324000001/charter.htm';
  expect(profileCharterLink(parseProfileHTML(`<a href="${href}">Restated Certificate of Incorporation</a>`),url,'123')).toBe(href);
  expect(profileCharterLink(parseProfileHTML(`<a href="${href.replace('/data/123/','/data/999/')}">Certificate of Incorporation</a>`),url,'123')).toBeNull();
  expect(profileCharterLink(parseProfileHTML('<a href="https://example.test/private">Certificate of Incorporation</a>'),url,'123')).toBeNull();
 });
 it.each(['https://www.sec.gov.evil.test/Archives/edgar/data/123/000000012326000001/x.htm','https://www.sec.gov/Archives/edgar/data/999/000000012326000001/x.htm','https://user:secret@www.sec.gov/Archives/edgar/data/123/000000012326000001/x.htm',url+'?token=private'])('rejects unsafe filing URL %s',value=>expect(()=>secProfileURL(value,'123')).toThrow('profile_source_url_invalid'));
 it('uses reviewed official Q4 structure but does not hardcode the executive name or prior-employer biography',()=>{
  const s=source({provider:'Official company',source_url:'https://investor.example.test/leadership',published_on:null,publication_precision:'unknown',form_type:null});
  const html='<html><head><title>Synthetic — Leadership</title></head><body><div><span class="PersonName">Morgan Example</span><span>, </span><span class="PersonTitleText">Chief Executive Officer</span></div><p>Earlier, Another Person was CEO at Other Corp.</p></body></html>';
  expect(parseOfficialLeadership(html,s,'Synthetic')).toMatchObject([{name:'Morgan Example',as_of:'2026-11-02',basis:'official_page'}]);
  expect(()=>parseOfficialLeadership(html.replace('Chief Executive Officer','Former Chief Executive Officer'),source(),'Synthetic')).toThrow('profile_leadership_structure_changed');
 });
});

describe('profile filing selection is complete and identity bound',()=>{
 const list=(rows:{form:string;date:string;accession:string;doc?:string}[])=>JSON.stringify({cik:'123',tickers:['SYN'],filings:{recent:{accessionNumber:rows.map(row=>row.accession),form:rows.map(row=>row.form),filingDate:rows.map(row=>row.date),primaryDocument:rows.map(row=>row.doc??'synthetic.htm'),reportDate:rows.map(()=> '2025-12-31')}}});
 it('finds the annual report beyond thirty unrelated recent filings and selects the newer periodic source separately',()=>{
  const others=Array.from({length:60},(_,i)=>({form:'4',date:'2026-10-01',accession:`0000000123-26-${String(i).padStart(6,'0')}`}));
  const result=selectProfileFilings(list([...others,{form:'10-Q',date:'2026-08-01',accession:'0000000123-26-000101'},{form:'10-K',date:'2026-02-01',accession:'0000000123-26-000100'}]),company,'2026-11-02');
  expect(result.annual?.form).toBe('10-K');expect(result.latest?.form).toBe('10-Q');
 });
 it('prefers the disclosed amendment instead of presenting older annual data as unaffected',()=>{
  const rows=[{form:'10-K',date:'2026-02-01',accession:'0000000123-26-000100'},{form:'10-K/A',date:'2026-03-01',accession:'0000000123-26-000101'}];
  expect(selectProfileFilings(list(rows),company,'2026-11-02').annual?.form).toBe('10-K/A');
 });
 it('does not call an old annual report current coverage',()=>expect(selectProfileFilings(list([{form:'10-K',date:'2020-01-01',accession:'0000000123-20-000001'}]),company,'2026-11-02')).toEqual({annual:null,latest:null}));
 it('rejects mismatched company and incomplete parallel filing arrays',()=>{
  expect(()=>selectProfileFilings(list([]).replace('"123"','"999"'),company,'2026-11-02')).toThrow('company_identity_mismatch');
  expect(()=>selectProfileFilings(list([{form:'10-K',date:'2026-02-01',accession:'0000000123-26-000001'}]).replace('"reportDate":["2025-12-31"]','"reportDate":[]'),company,'2026-11-02')).toThrow('profile_filing_list_incomplete');
 });
});
