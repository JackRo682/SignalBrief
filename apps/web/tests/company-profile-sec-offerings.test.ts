// @vitest-environment node
import {describe,expect,it} from 'vitest';
import {parseSecProfileCharter,parseSecProfileFiling,profileCharterLink} from '../../../supabase/functions/signalbrief-profiles/enrichment-sec';
import type {ProfileArchivedSource} from '../../../supabase/functions/signalbrief-profiles/enrichment-types';

const company={id:'20000000-0000-4000-8000-000000000001',provider_company_id:'0000000123',ticker:'SYN'};
const annualURL='https://www.sec.gov/Archives/edgar/data/123/000000012326000001/synthetic.htm';
const charterURL='https://www.sec.gov/Archives/edgar/data/123/000000012324000001/ex31.htm';
const wrap=(body:string)=>`<html><head><title>Synthetic annual report</title></head><body><div hidden><ix:nonNumeric name="dei:EntityCentralIndexKey">0000000123</ix:nonNumeric><ix:nonNumeric name="dei:DocumentType">10-K</ix:nonNumeric><ix:nonNumeric name="dei:DocumentPeriodEndDate">2026-06-30</ix:nonNumeric></div><ix:nonNumeric name="dei:EntityRegistrantName">Synthetic Corporation</ix:nonNumeric>${body}</body></html>`;
const business=(body='')=>`<h2>Item 1. Business</h2><h3>Overview</h3><p>Synthetic Corporation develops laboratory instruments and software for research customers throughout the world.</p><p>We provide equipment and documented support through our manufacturing operations and commercial distribution network.</p>${body}<h2>Item 1A. Risk Factors</h2>`;
const source=():ProfileArchivedSource=>({id:'a'.repeat(64),provider:'SEC EDGAR',source_url:annualURL,source_sha256:'a'.repeat(64),fetched_at:'2026-11-02T06:00:00Z',published_on:'2026-08-17',publication_precision:'date',report_period:'2026-06-30',form_type:'10-K',title:'Synthetic annual report',normalization:'profile-visible-text-v1',object_key:'profiles/sec/'+'a'.repeat(64)+'.html',provider_company_id:company.provider_company_id,ticker:company.ticker,normalized_text:''});
function parse(body:string){
 const archived=source(),result=parseSecProfileFiling(wrap(body),archived,company);
 for(const field of Object.values(result.fields))for(const item of field){
  const {quote,location}=item.evidence;
  expect(Array.from(archived.normalized_text).slice(location.start,location.end).join('')).toBe(quote);
  expect(quote.length).toBeLessThanOrEqual(1600);
  if('name' in item)expect(quote).toContain(item.name);
 }
 return result;
}

describe('source-bound SEC offerings and completed signature groups',()=>{
 it.each(['Vice President, Chief Accounting Officer','Executive Vice President and Chief Financial Officer'])('closes the preceding %s signature before a distinct CEO row',role=>{
  const prior=`<p>By: /s/ Accounting Person</p><p>Accounting Person</p><p>${role}</p><p>(Principal Accounting Officer and Duly Authorized Officer)</p>`;
  const executive='<table><tr><th>Signature</th><th>Title</th><th>Date</th></tr><tr><td><p>/s/ Taylor Example</p></td><td><p>Chief Executive Officer, Director</p><p>(Principal Executive Officer)</p></td><td><p>August 17, 2026</p></td></tr><tr><td><p>Taylor Example</p></td></tr></table>';
  const fields=parse(business()+'<h2>Signatures</h2>'+prior+executive).fields;
  expect(fields.leadership).toMatchObject([{name:'Taylor Example',as_of:'2026-08-17',basis:'filing'}]);
  expect(fields.leadership[0].evidence.quote).not.toContain('Accounting Person');
 });
 it('still rejects two unresolved signers before a role even after a completed vice-president row',()=>{
  const fields=parse(business()+'<h2>Signatures</h2><p>/s/ Prior Person</p><p>Vice President, Chief Accounting Officer</p><p>/s/ Executive Person</p><p>/s/ Finance Person</p><p>Chief Executive Officer</p><p>Chief Financial Officer</p>').fields;
  expect(fields.leadership).toEqual([]);
 });
 it.each([
  'We generally warrant our newly manufactured products against defects in materials and workmanship for two years. Our warranty obligation is limited to repair or replacement.',
  'We provide a two-year limited warranty on all laboratory instruments against defects in materials and workmanship.',
  'We provide our customers with a two-year limited warranty on all laboratory instruments against defects in materials and workmanship.',
 ])('does not present a warranty policy as a product or commercial service: %s',text=>{
  const fields=parse(business('<h3>Service and Warranty</h3><p>'+text+'</p>')).fields;
  expect(fields.products).toEqual([]);
 });
 it('retains an actual service offering beneath the same service-and-warranty heading',()=>{
  const text='We provide service for our laboratory equipment at company-owned service locations and through technicians who perform repairs at customer facilities.';
  const fields=parse(business('<h3>Service and Warranty</h3><h4>Equipment</h4><h4>Service</h4><p>'+text+'</p>')).fields;
  expect(fields.products).toContainEqual(expect.objectContaining({name:'Service and Warranty',description:text}));
 });
 it('retains explicitly offered extended service plans even when the paragraph also describes warranties',()=>{
  const text='We provide a limited warranty on the laboratory equipment we sell directly to customers. We also currently offer optional extended service plans that provide coverage after the initial warranty ends.';
  const fields=parse(business('<h3>Limited Warranties and Extended Service Plans</h3><p>'+text+'</p>')).fields;
  expect(fields.products).toContainEqual(expect.objectContaining({name:'Limited Warranties and Extended Service Plans',description:text}));
 });
 it('extracts only explicit unsplit offerings from a generic solutions section',()=>{
  const first='We provide the research end market with an array of high-performance laboratory instruments.';
  const second='We offer portable analysis devices with a range of capacities and measurement capabilities.';
  const fields=parse(business('<p>🧪 Preserved source marker.</p><h3>Our Data Solutions</h3><p>Our portfolio addresses the Research and Consumer end markets through established distribution partners.</p><p>Research represents an important end market for our products. '+first+'</p><p>'+second+' Through another end market, we provide numerous solutions that consist of equipment, controllers and other components.</p>')).fields;
  expect(fields.products.map(item=>item.name)).toEqual(['high-performance laboratory instruments','portable analysis devices']);
  expect(fields.products.map(item=>item.evidence.quote)).toEqual([first,second]);
 });
 it('does not treat a competing, conditional, generic or out-of-section offering as an issuer product',()=>{
  const fields=parse(business('<h3>Our Data Solutions</h3><p>Competitors offer portable analysis devices with a range of capacities for customers. We may offer new equipment for research in the future. We offer products and services for customer laboratories.</p><h3>Competition</h3><p>We offer competing solutions for our customers in a challenging market environment.</p>')+'<p>We offer risk mitigation services for customers described in a different business context.</p>').fields;
  expect(fields.products).toEqual([]);
 });
 it.each(['single reportable operating segment','Single Reportable Operating Segment','SINGLE REPORTABLE OPERATING SEGMENT'])('preserves the exact source phrase %s for an unnamed segment without relabeling end markets',name=>{
  const quote=`The Company manages and reports its business operations under a ${name}.`;
  const fields=parse(business('<h3>Our Data Solutions</h3><p>Our products address the Research, Industrial and Consumer end markets through commercial distribution.</p>')+'<h3>Segment Reporting</h3><p>'+quote+' Separate financial information is reviewed by the chief operating decision maker.</p>').fields;
  expect(fields.segments).toEqual([{name,description:quote,evidence:expect.objectContaining({quote})}]);
 });
 it.each([
  'Another Corporation manages and reports its business operations under a single reportable operating segment.',
  'The Company may manage and report its business operations under a single reportable operating segment in the future.',
  'The Company uses a single reporting unit for goodwill impairment testing.',
 ])('does not manufacture segment structure from unrelated disclosure: %s',quote=>{
  expect(parse(business()+'<h3>Segment Reporting</h3><p>'+quote+'</p>').fields.segments).toEqual([]);
 });
});

describe('official charter links retain their local exhibit-row description',()=>{
 it.each([
  `<a href="${charterURL}">3.1</a><a href="https://www.sec.gov/Archives/edgar/data/123/000000012324000002/report.htm">Form 8-K</a>`,
  `<a href="${charterURL}">Eighth</a><a href="${charterURL}">filed February 5, 2024</a>`,
 ])('preserves a strong explicit charter anchor despite other anchors in the same exhibit row',otherLinks=>{
  const row=`<table><tr><td><a href="${charterURL}">Restated Certificate of Incorporation of Synthetic Corporation</a>${otherLinks}</td></tr></table>`;
  const {parsed}=parse(business()+row);
  expect(profileCharterLink(parsed,annualURL,company.provider_company_id)).toBe(charterURL);
 });
 it('does not resolve ambiguous strong charter anchors through the numeric-row fallback',()=>{
  const rows=`<a href="${charterURL}">Certificate of Incorporation</a><a href="${charterURL.replace('ex31','other')}">Restated Certificate of Incorporation</a><table><tr><td><a href="${charterURL}">3.1</a></td><td>Certificate of Incorporation of Synthetic Corporation.</td></tr></table>`;
  expect(profileCharterLink(parse(business()+rows).parsed,annualURL,company.provider_company_id)).toBeNull();
 });
 it('resolves a numeric exhibit link only with its own explicit charter description',()=>{
  const row=`<table><tr><td><a href="${charterURL}">3.1</a></td><td><p>Amended and Restated Certificate of Incorporation of Synthetic Corporation.</p></td></tr></table>`;
  const {parsed}=parse(business()+row);
  expect(profileCharterLink(parsed,annualURL,company.provider_company_id)).toBe(charterURL);
  expect(parsed.text).toContain('3.1\nAmended and Restated Certificate of Incorporation of Synthetic Corporation.');
 });
 it.each([
  `<table><tr><td><a href="${charterURL}">3.1</a></td><td>Unrelated agreement.</td></tr><tr><td>3.2</td><td>Certificate of Incorporation of Synthetic Corporation.</td></tr></table>`,
  `<table><tr><td><a href="${charterURL}">3.1</a></td></tr></table>`,
  `<table><tr><td>Certificate of Incorporation of Synthetic Corporation.<table><tr><td><a href="${charterURL}">3.1</a></td></tr></table></td></tr></table>`,
  `<table><tr><td><a href="https://www.sec.gov/Archives/edgar/data/999/000000099924000001/ex31.htm">3.1</a></td><td>Certificate of Incorporation of Another Corporation.</td></tr></table>`,
  `<table><tr><td><a href="${charterURL}">3.1</a><a href="${charterURL.replace('ex31','another')}">3.2</a></td><td>Certificate of Incorporation of Synthetic Corporation.</td></tr></table>`,
 ])('rejects cross-row, absent, nested, foreign or ambiguous exhibit evidence',row=>{
  const {parsed}=parse(business()+row);
  expect(profileCharterLink(parsed,annualURL,company.provider_company_id)).toBeNull();
 });
 it('retains independent charter-issuer verification after a same-CIK exhibit link resolves',()=>{
  const archived={...source(),source_url:charterURL};
  const html='<html><body><h1>Certificate of Incorporation of Another Corporation</h1><p>The original Certificate of Incorporation of this Corporation was filed on February 5, 2024.</p></body></html>';
  expect(()=>parseSecProfileCharter(html,archived,'Synthetic Corporation')).toThrow('company_identity_mismatch');
 });
});
