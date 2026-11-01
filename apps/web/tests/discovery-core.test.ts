// @vitest-environment node
import {describe,it,expect} from 'vitest';
import {parseSecDirectory,parseDartDirectory,parseSelection} from '../../../supabase/functions/signalbrief-discovery/core';
import {dartEndpoint,relaySignature,verifyRelay} from '../src/server/dart-relay';
import {secSubmissions} from '../../../supabase/functions/signalbrief-api/us-core';

describe('official issuer directory parsing',()=>{
 it('uses named SEC columns, preserves share classes and unknown exchange truthfully',()=>{
  const raw=JSON.stringify({fields:['name','cik','exchange','ticker'],data:[['Synthetic Corp',12,'Nasdaq','TEST'],['Synthetic Corp',12,null,'TEST.B']]});
  expect(parseSecDirectory(raw)).toEqual([
   {provider_company_id:'0000000012',ticker:'TEST',name:'Synthetic Corp',market:'NASDAQ'},
   {provider_company_id:'0000000012',ticker:'TEST.B',name:'Synthetic Corp',market:'US'},
  ]);
 });
 it('fails closed on invalid SEC identity or schema instead of saving partial data',()=>{
  expect(()=>parseSecDirectory(JSON.stringify({fields:['name','cik','exchange','ticker'],data:[['Test',12,'Nasdaq','OK'],['Other','not-cik','NYSE','BAD']]}))).toThrow('invalid_sec_identity');
  expect(()=>parseSecDirectory(JSON.stringify({0:{cik:12}}))).toThrow('invalid_sec_directory');
 });
 it('reads listed OpenDART issuers, decodes XML names and excludes unlisted identities',()=>{
  const xml='<result><list><corp_code>00123456</corp_code><corp_name>시험 &amp; 기업</corp_name><stock_code>123456</stock_code></list><list><corp_code>00123457</corp_code><corp_name>비상장</corp_name><stock_code> </stock_code></list></result>';
  expect(parseDartDirectory(xml)).toEqual([{provider_company_id:'00123456',ticker:'123456',name:'시험 & 기업',market:'KR'}]);
 });
 it('retains the official English name separately without changing Korean display name or identity',()=>{
  for(const english of [' Synthetic &amp; Research Co. ','<![CDATA[ Synthetic & Research Co. ]]>']){
   const xml=`<result><list><corp_code>00123456</corp_code><corp_name>시험기업</corp_name><corp_eng_name>${english}</corp_eng_name><stock_code>123456</stock_code></list></result>`;
   expect(parseDartDirectory(xml)).toEqual([{provider_company_id:'00123456',ticker:'123456',name:'시험기업',market:'KR',official_english_name:'Synthetic & Research Co.'}]);
  }
 });
 it('accepts missing or blank English names but rejects an oversized listed-company alias',()=>{
  const xml=(name:string)=>`<result><list><corp_code>00123456</corp_code><corp_name>시험기업</corp_name>${name}<stock_code>123456</stock_code></list></result>`;
  for(const field of ['', '<corp_eng_name> \n\t </corp_eng_name>'])expect(parseDartDirectory(xml(field))[0]).not.toHaveProperty('official_english_name');
  expect(parseDartDirectory(xml(`<corp_eng_name>${'A'.repeat(500)}</corp_eng_name>`))[0].official_english_name).toHaveLength(500);
  expect(()=>parseDartDirectory(xml(`<corp_eng_name>${'A'.repeat(501)}</corp_eng_name>`))).toThrow('invalid_dart_directory');
 });
 it('rejects XML entities, malformed XML, and provider error responses',()=>{
  expect(()=>parseDartDirectory('<!DOCTYPE result [<!ENTITY x SYSTEM "file:///etc/passwd">]><result>&x;</result>')).toThrow();
  expect(()=>parseDartDirectory('<result><list>')).toThrow();
  expect(()=>parseDartDirectory('<result><status>020</status></result>')).toThrow();
 });
 it('requires authoritative selected identity and ticker, or a single existing UUID',()=>{
  expect(parseSelection({provider:'sec',provider_company_id:'0000000012',ticker:'TEST.B'})).toMatchObject({ticker:'TEST.B'});
  expect(parseSelection({company_id:'10000000-0000-4000-8000-000000000001'})).toHaveProperty('company_id');
  for(const value of [{provider:'sec',provider_company_id:'12',ticker:'TEST'},{provider:'dart',provider_company_id:'00123456',ticker:'123456',name:'injected'},{company_id:'wrong'},{company_id:'10000000-0000-4000-8000-000000000001',provider:'sec'}])expect(()=>parseSelection(value)).toThrow('invalid_selection');
 });
 it('collects foreign issuer annual/current forms without pretending they use domestic forms',async()=>{
  const raw={cik:12,name:'Synthetic Foreign Issuer',tickers:['TEST'],filings:{recent:{accessionNumber:['0000000012-26-000001','0000000012-26-000002'],form:['20-F','6-K'],filingDate:['2026-01-01','2026-01-02'],reportDate:['2025-12-31','2025-12-31'],primaryDocument:['annual.htm','current.htm']}}};
  const fetcher=(async()=>Response.json(raw)) as typeof fetch;
  expect((await secSubmissions('0000000012','contact@example.invalid',fetcher)).filings.map(x=>x.form)).toEqual(['20-F','6-K']);
 });
 it('adds only the fixed official DART directory endpoint to the existing authenticated relay',()=>{
  const secret='a'.repeat(64),payload={kind:'directory' as const,key:'b'.repeat(40),nonce:'c'.repeat(64)},body=JSON.stringify(payload),timestamp=String(Date.now());
  expect(verifyRelay(body,timestamp,relaySignature(body,timestamp,secret),secret)).toEqual(payload);
  expect(dartEndpoint(payload).pathname).toBe('/api/corpCode.xml');
  expect(()=>dartEndpoint({...payload,corp_code:'12345678'})).toThrow('relay_invalid_request');
 });
});
