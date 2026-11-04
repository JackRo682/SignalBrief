// @vitest-environment node
// Synthetic fixtures use the SEC's actual N-CSR/N-CSRS submission structure.
import {describe,expect,it,vi} from 'vitest';
import {normalizeFiling,secSubmissions,validateAnalysis} from '../../../supabase/functions/signalbrief-api/us-core';
import {selectAnalysisExcerpt} from '../../../supabase/functions/signalbrief-api/analysis-excerpt';

const forms=['N-CSR','N-CSRS','N-CSR/A','N-CSRS/A'];
function submissions(form:string,patch:Record<string,unknown>={}){
 return {cik:42,name:'Synthetic closed-end fund',tickers:['SYN'],filings:{recent:{
  accessionNumber:['0000000042-25-000001'],form:[form],filingDate:['2025-06-25'],
  reportDate:['2025-04-30'],primaryDocument:['synthetic-20250430.htm'],...patch,
 }}};
}
describe('registered fund SEC report metadata',()=>{
 it.each(forms)('preserves the actual %s form and primary document identity',async form=>{
  const raw=JSON.stringify(submissions(form)),fetcher=vi.fn().mockResolvedValue(new Response(raw));
  const result=await secSubmissions('0000000042','fixture@example.test',fetcher);
  expect(result.raw).toBe(raw);
  expect(result.filings).toEqual([{
   accession:'0000000042-25-000001',form,filing_date:'2025-06-25',report_date:'2025-04-30',
   source_url:'https://data.sec.gov/submissions/CIK0000000042.json',
   document_url:'https://www.sec.gov/Archives/edgar/data/42/000000004225000001/synthetic-20250430.htm',
  }]);
  expect(fetcher).toHaveBeenCalledWith(new URL('https://data.sec.gov/submissions/CIK0000000042.json'),expect.objectContaining({redirect:'error'}));
 });
 it.each(['NPORT-P','NT-NCSR','N-CSR/A/A','NCSR','n-csrs','N-CSRS-extra'])('does not broaden support to %s',async form=>{
  const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify(submissions(form))));
  expect((await secSubmissions('0000000042','fixture@example.test',fetcher)).filings).toEqual([]);
 });
 it.each([
  {primaryDocument:['../other.htm']},
  {primaryDocument:['https://other.example/fund.htm']},
  {accessionNumber:['invalid-accession']},
  {filingDate:['2099-06-25']},
 ])('retains the existing identifier, URL, and future-date rejection guards',async patch=>{
  const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify(submissions('N-CSRS',patch))));
  expect((await secSubmissions('0000000042','fixture@example.test',fetcher)).filings).toEqual([]);
 });
 it('rejects a source for another CIK even when its form is supported',async()=>{
  const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({...submissions('N-CSRS'),cik:43})));
  await expect(secSubmissions('0000000042','fixture@example.test',fetcher)).rejects.toThrow('cik_mismatch');
 });
});

const cover='<p>Synthetic registration and schedule of investments metadata.</p>'.repeat(350);
const statement='<h2>Statement of Assets and Liabilities</h2><p>As of April 30, 2025 (Unaudited)</p>'+
 '<p>(in thousands, except share and per share data)</p><p>Total assets $123,456. Total liabilities $23,456. Net assets $100,000.</p>'+
 '<h2>Statement of Operations</h2><p>For the six months ended April 30, 2025 (in thousands)</p>'+
 '<p>Investment income $12,345. Net expenses $2,345. Net investment income $10,000.</p>';
const fundSource=normalizeFiling(cover+statement+'<p>Explanatory notes without additional amounts.</p>'.repeat(300));
describe('fund-form-specific financial excerpts',()=>{
 it.each(forms)('selects exact fund statements beyond the cover for %s',form=>{
  const excerpt=selectAnalysisExcerpt(fundSource,form);
  expect(excerpt.start).toBeGreaterThan(12000);
  expect(excerpt.text).toContain('Statement of Assets and Liabilities');
  expect(excerpt.text).toContain('As of April 30, 2025 (Unaudited)');
  expect(excerpt.text).toContain('(in thousands, except share and per share data)');
  expect(fundSource.slice(excerpt.start,excerpt.end)).toBe(excerpt.text);
  expect(excerpt.text.length).toBeLessThanOrEqual(12000);
 });
 it.each([undefined,'10-K','10-Q','8-K','NPORT-P'])('does not enable unconsolidated fund headings for %s',form=>{
  expect(()=>selectAnalysisExcerpt(fundSource,form)).toThrow('financial_excerpt_not_identified');
 });
 it('retains human review and rejects unsupported amounts for a fund excerpt',()=>{
  const excerpt=selectAnalysisExcerpt(fundSource,'N-CSRS');
  const quote='Total assets $123,456. Total liabilities $23,456. Net assets $100,000.';
  expect(validateAnalysis({claims:[{text:'Net assets were $100,000 thousand.',quote}]},excerpt.text)).toMatchObject({requires_human_review:true,coverage:'bounded_normalized_excerpt'});
  expect(()=>validateAnalysis({claims:[{text:'Net assets were $999,000 thousand.',quote}]},excerpt.text)).toThrow('numeric_citation_mismatch');
 });
});
