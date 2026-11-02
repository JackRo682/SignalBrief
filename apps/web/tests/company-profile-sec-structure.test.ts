// @vitest-environment node
import {describe,it,expect} from 'vitest';
import {parseSecProfileFiling} from '../../../supabase/functions/signalbrief-profiles/enrichment-sec';
import type {ProfileArchivedSource} from '../../../supabase/functions/signalbrief-profiles/enrichment-types';

const company={id:'20000000-0000-4000-8000-000000000001',provider_company_id:'0000000123',ticker:'SYN'};
const overview='Synthetic Corporation provides laboratory equipment and research services to engineering customers around the world.';
const description='We provide documented equipment, software and technical support for customers performing industrial research and laboratory testing.';
const wrap=(body:string)=>`<html><head><title>Synthetic annual report</title></head><body><div hidden><ix:nonNumeric name="dei:EntityCentralIndexKey">0000000123</ix:nonNumeric><ix:nonNumeric name="dei:DocumentType">10-K</ix:nonNumeric><ix:nonNumeric name="dei:DocumentPeriodEndDate">2025-12-31</ix:nonNumeric></div><ix:nonNumeric name="dei:EntityRegistrantName">Synthetic Corporation</ix:nonNumeric>${body}</body></html>`;
const business=(body='')=>`<h2>Item 1. Business</h2><h3>Overview</h3><p>${overview}</p><p>${description}</p>${body}<h2>Item 1A. Risk Factors</h2><p>Competitors offer a different tool. This risk statement is not our business introduction.</p>`;
function parse(body:string){
 const source:ProfileArchivedSource={id:'a'.repeat(64),provider:'SEC EDGAR',source_url:'https://www.sec.gov/Archives/edgar/data/123/000000012326000001/synthetic.htm',source_sha256:'a'.repeat(64),fetched_at:'2026-11-02T12:00:00Z',published_on:'2026-10-29',publication_precision:'date',report_period:'2025-12-31',form_type:'10-K',title:'Synthetic annual report',normalization:'profile-visible-text-v1',object_key:'profiles/sec/'+'a'.repeat(64)+'.html',provider_company_id:company.provider_company_id,ticker:company.ticker,normalized_text:''};
 const result=parseSecProfileFiling(wrap(body),source,company);
 for(const item of [...result.fields.business,...result.fields.products,...result.fields.segments,...result.fields.leadership]){
  const proof=item.evidence;
  expect(Array.from(source.normalized_text).slice(proof.location.start,proof.location.end).join('')).toBe(proof.quote);
  expect(proof.quote.length).toBeLessThanOrEqual(1600);
 }
 return {...result,source};
}

describe('generic SEC section boundaries and explicit executive signatures',()=>{
 it('uses the opening business section after contents instead of the last repeated page header',()=>{
  const toc='<h2>Contents</h2><div>Item 1. Business</div><div>Item 1A. Risk Factors</div><div>Item 2. Properties</div>';
  const repeated='<div>12 SYNTHETIC 2025 FORM 10-K</div><div>PART I</div><div>ITEM 1. BUSINESS</div><p>places). The following continuation concerns regulatory interpretation and is not an issuer overview.</p><h3>Additional Regulatory Developments</h3><p>Regulations continue to change in different markets, requiring monitoring and governance processes.</p>';
  const fields=parse(toc+business(repeated)).fields;
  expect(fields.business.map(item=>item.text)).toEqual([overview,description]);
  expect(JSON.stringify(fields.business)).not.toContain('places).');
 });
 it('keeps a long opening overview as exact complete-sentence excerpts instead of discarding it',()=>{
  const intro=overview+' '+Array.from({length:13},(_,index)=>`Our verified service line ${index+1} supplies documented research capabilities and equipment support to participating engineering customers.`).join(' ');
  expect(intro.length).toBeGreaterThan(1600);
  const fields=parse(`<p>🧪 Source marker.</p><h2>Item 1. Business</h2><h3>Overview</h3><p>${intro}</p><h3>Performance</h3><p>The following are our key financial highlights for the current reporting period.</p><h2>Item 1A. Risk Factors</h2>`).fields;
  expect(fields.business).toHaveLength(2);expect(fields.business[0].text.startsWith(overview)).toBe(true);
  for(const item of fields.business){expect(intro).toContain(item.text);expect(item.text.endsWith('.')).toBe(true);}
  expect(JSON.stringify(fields.business)).not.toContain('financial highlights');
 });
 it('does not turn contents-only labels into a business section',()=>{
  expect(parse('<div>Item 1. Business</div><div>Item 1A. Risk Factors</div><p>'+overview+'</p><p>'+description+'</p>').fields.business).toEqual([]);
 });
 it('retains named product categories beneath a generic products heading and deduplicates repeated labels',()=>{
  const products='<h3>Our Products and Services</h3><h4>Laboratory Equipment</h4><p>We manufacture laboratory instruments and measurement equipment for commercial testing and documented quality control.</p><h4>Risk Control Solutions</h4><p>We provide software services that help customers verify research quality and identify errors in laboratory workflows.</p><h4>Energy Storage Products</h4><p>We sell synthetic energy storage products for laboratory backup systems and industrial research facilities.</p><h4>Energy Storage Products</h4><p>We sell those same products through our established commercial distribution network and service teams.</p><h4>Enabling our products and services:</h4><p>'+description+'</p>';
  const fields=parse(business(products)).fields;
  expect(fields.products.map(item=>item.name)).toEqual(['Laboratory Equipment','Risk Control Solutions','Energy Storage Products']);
 });
 it('preserves quoted single-segment names and exact punctuation in the supporting sentence',()=>{
  const quote='Synthetic Corporation has concluded it has one reportable operating segment, “Research Solutions.”';
  const fields=parse(business()+`<h3>Segment Information</h3><p>${quote} The segment provides laboratory equipment and associated research services.</p>`).fields;
  expect(fields.segments).toMatchObject([{name:'Research Solutions',evidence:{quote}}]);
 });
 it('uses explicit numbered segment boundaries without splitting an internal and in a segment name',()=>{
  const quote='We operate as two reportable segments: (i) equipment and (ii) energy generation and storage.';
  const fields=parse(business()+`<h3>Segment Information</h3><p>${quote}</p>`).fields;
  expect(fields.segments.map(item=>item.name)).toEqual(['equipment','energy generation and storage']);
  expect(fields.segments.every(item=>item.evidence.quote===quote)).toBe(true);
 });
 it.each([
  '<p>Date: October 29, 2026 By: /s/ TAYLOR EXAMPLE</p><p><b>Taylor Example</b></p><p>President and Chief Executive Officer</p><p>(Principal Executive Officer)</p>',
  '<p>Date: October 29, 2026 By:</p><p>/S/ TAYLOR EXAMPLE</p><p><b>Taylor Example</b></p><p>President and Chief Executive Officer; Director</p><p>(Principal Executive Officer)</p>',
  '<p>/s/ Taylor Example Chief Executive Officer and Director (Principal Executive Officer)</p>',
 ])('binds the explicit CEO role to its dated same-signature identity',signature=>{
  const fields=parse(business()+'<h2>Signatures</h2>'+signature).fields;
  expect(fields.leadership).toMatchObject([{name:'Taylor Example',role:'Chief Executive Officer',as_of:'2026-10-29',basis:'filing'}]);
 });
 it('does not reinterpret a CFO-only newer report as identifying a CEO',()=>{
  const fields=parse(business()+'<h2>Signatures</h2><p>/S/ FINANCE PERSON</p><p>Finance Person</p><p>Chief Financial Officer</p><p>(Principal Financial Officer and Principal Accounting Officer)</p>').fields;
  expect(fields.leadership).toEqual([]);
 });
 it('does not cross a conflicting financial-officer signature to fill an executive field',()=>{
  const fields=parse(business()+'<h2>Signatures</h2><p>/s/ Finance Person</p><p>Chief Financial Officer</p><p>Chief Executive Officer</p>').fields;
  expect(fields.leadership).toEqual([]);
 });
 it('rejects an explicit printed name that contradicts the signed executive identity',()=>{
  const fields=parse(business()+'<h2>Signatures</h2><p>/s/ Taylor Example</p><p>Name: Different Person</p><p>Title: Chief Executive Officer</p>').fields;
  expect(fields.leadership).toEqual([]);
 });
 it.each(['/s/','Name:'])('rejects unresolved signer associations in a multi-column signature table (%s)',prefix=>{
  const table=`<table><tr><td><p>${prefix} Executive Person</p></td><td><p>${prefix} Finance Person</p></td></tr><tr><td><p>Chief Executive Officer</p></td><td><p>Chief Financial Officer</p></td></tr></table>`;
  const fields=parse(business()+'<h2>Signatures</h2>'+table).fields;
  expect(fields.leadership).toEqual([]);
 });
 it('preserves distinct sequential financial and executive signature blocks',()=>{
  const signature='<p>/s/ Finance Person</p><p>Name: Finance Person</p><p>Chief Financial Officer</p><p>(Principal Financial Officer and Principal Accounting Officer)</p><p>/s/ Taylor Example</p><p>Name: Taylor Example</p><p>President and Chief Executive Officer</p><p>(Principal Executive Officer)</p>';
  const fields=parse(business()+'<h2>Signatures</h2>'+signature).fields;
  expect(fields.leadership).toMatchObject([{name:'Taylor Example',role:'Chief Executive Officer',as_of:'2026-10-29',basis:'filing'}]);
  expect(fields.leadership[0].evidence.quote).not.toContain('Finance Person');
 });
 it('does not infer a CEO from a biography outside the signatures section',()=>{
  const fields=parse(business()+'<p>Another organization appointed Taylor Example Chief Executive Officer.</p><h2>Signatures</h2><p>/s/ Director Person</p><p>Director</p>').fields;
  expect(fields.leadership).toEqual([]);
 });
});
