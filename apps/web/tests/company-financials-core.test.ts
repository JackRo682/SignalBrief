// @vitest-environment node
import {describe,expect,it} from 'vitest';
import {parseSecFinancials,parseDartFinancials,exactDecimal,dartFinancialReports,financialParserVersion} from '../../../supabase/functions/signalbrief-api/company-financials-core';

const sha='a'.repeat(64),stamp='2026-11-02T00:00:00Z',cik='0000000042';
const record={start:'2026-01-01',end:'2026-03-31',val:1234.5,accn:'0000000042-26-000001',fy:2026,fp:'Q1',form:'10-Q',filed:'2026-05-01'};
function sec(rows:unknown[]=[record],unit='USD',taxonomy='us-gaap',concept='RevenueFromContractWithCustomerExcludingAssessedTax'){
 return JSON.stringify({cik:42,entityName:'Synthetic issuer',facts:{[taxonomy]:{[concept]:{label:'Synthetic reported revenue',units:{[unit]:rows}}}}});
}
const dartReport={year:'2026',code:'11012' as const};
const dartRow={corp_code:'12345678',stock_code:'0068Y0',bsns_year:'2026',reprt_code:'11012',rcept_no:'20260814000001',fs_div:'CFS',sj_div:'IS',account_nm:'매출액',currency:'KRW',thstrm_dt:'2026.01.01 ~ 2026.06.30',thstrm_amount:'4,000',thstrm_add_amount:'12,345,678,901,234,567',thstrm_nm:'제 4 기 반기',frmtrm_dt:'2025.01.01 ~ 2025.06.30',frmtrm_amount:'3,000',frmtrm_add_amount:'10,000,000,000,000,001'};
const dart=(rows:unknown[]=[dartRow])=>JSON.stringify({status:'000',list:rows});

describe('exact official SEC financial contexts',()=>{
 it('preserves original spans, dates, unit, issuer and taxonomy without manufacturing ratios',()=>{
  const raw=sec(),value=parseSecFinancials(raw,cik,sha,stamp);expect(value.items).toHaveLength(1);
  expect(value.items[0]).toMatchObject({value_raw:'1234.5',unit:'USD',period_start:'2026-01-01',period_end:'2026-03-31',fiscal_period:'Q1',accounting_standard:'US-GAAP',basis:'reported',scope:'entity',location:'/facts/us-gaap/RevenueFromContractWithCustomerExcludingAssessedTax/units/USD/0',raw_sha256:sha});
  expect(raw).toContain(value.items[0].source_quote);expect(JSON.parse(value.items[0].source_quote)).toEqual(record);
  expect(JSON.stringify(value)).not.toContain('growth');
 });
 it('never rounds amounts larger than Number.MAX_SAFE_INTEGER',()=>{
  const raw=sec().replace('1234.5','99999999999999999999.12345678');
  expect(parseSecFinancials(raw,cik,sha,stamp).items[0].value_raw).toBe('99999999999999999999.12345678');
 });
 it.each([['1.234567890123456789e+20','123456789012345678900'],['-1.2500e-3','-0.00125'],['0.0000','0'],['100.5000','100.5']])('normalizes exact decimal notation %s without floating point', (input,expected)=>expect(exactDecimal(input)).toBe(expected));
 it.each(['NaN','Infinity','1e999','1,234','1.2.3',''])('rejects invalid numbers %s',value=>expect(()=>exactDecimal(value)).toThrow());
 it('retains quarter and YTD as different explicit contexts and never derives a quarter',()=>{
  const value=parseSecFinancials(sec([record,{...record,start:'2025-10-01',val:3456}]),cik,sha,stamp);
  expect(value.items.map(x=>x.period_start).sort()).toEqual(['2025-10-01','2026-01-01']);expect(value.items.map(x=>x.value_raw).sort()).toEqual(['1234.5','3456']);
 });
 it('chooses the later filed restatement with its own evidence',()=>{
  const revised={...record,val:1200,filed:'2026-06-01',accn:'0000000042-26-000002',form:'10-Q/A'};
  expect(parseSecFinancials(sec([record,revised]),cik,sha,stamp).items[0]).toMatchObject({value_raw:'1200',filed_on:'2026-06-01',form:'10-Q/A'});
 });
 it('rejects contradictory same-date facts rather than silently choosing one',()=>expect(()=>parseSecFinancials(sec([record,{...record,val:999}]),cik,sha,stamp)).toThrow('conflicting_reported_facts'));
 it('distinguishes IFRS taxonomy and leaves entity scope honest',()=>expect(parseSecFinancials(sec([record],'EUR','ifrs-full','Revenue'),cik,sha,stamp).items[0]).toMatchObject({accounting_standard:'IFRS',unit:'EUR',scope:'entity'}));
 it('preserves per-share unit in the JSON pointer',()=>expect(parseSecFinancials(sec([record],'USD/shares','us-gaap','EarningsPerShareBasic'),cik,sha,stamp).items[0].location).toContain('/USD~1shares/'));
 it.each([42,'42','0000000042'])('accepts the same exact issuer as numeric or decimal-string CIK %j without changing reported facts',sourceCIK=>{
  const raw=JSON.stringify({...JSON.parse(sec()),cik:sourceCIK});
  const value=parseSecFinancials(raw,cik,sha,stamp);
  expect(value).toEqual(parseSecFinancials(sec(),cik,sha,stamp));
  expect(value.provider_company_id).toBe(cik);
  expect(value.source_url).toBe('https://data.sec.gov/api/xbrl/companyfacts/CIK0000000042.json');
  expect(raw).toContain(value.items[0].source_quote);
 });
 it.each([7,'7','0000000007'])('still rejects a different issuer represented as %j',sourceCIK=>{
  expect(()=>parseSecFinancials(JSON.stringify({...JSON.parse(sec()),cik:sourceCIK}),cik,sha,stamp)).toThrow('financial_identity_mismatch');
 });
 it.each([null,undefined,true,false,[42],{value:42},' 42','42 ','+42','-42','4.2e1','42.0','00000000042','0042x','',0,'0000000000',42.5,10_000_000_000].map(sourceCIK=>({sourceCIK})))
 ('rejects malformed or coercible source CIK $sourceCIK',({sourceCIK})=>{
  expect(()=>parseSecFinancials(JSON.stringify({...JSON.parse(sec()),cik:sourceCIK}),cik,sha,stamp)).toThrow('financial_identity_mismatch');
 });
 it.each([{cik:7}, {entityName:''}, {facts:null}])('rejects mismatched or incomplete issuer source %j',patch=>expect(()=>parseSecFinancials(JSON.stringify({...JSON.parse(sec()),...patch}),cik,sha,stamp)).toThrow());
 it('rejects duplicate JSON keys even when JSON.parse would silently overwrite them',()=>expect(()=>parseSecFinancials(sec().replace('"cik":42','"cik":7,"cik":42'),cik,sha,stamp)).toThrow('duplicate_source_key'));
 it.each([{end:'2026-02-30'},{end:'2026-12-31'},{filed:'2027-01-01'},{start:null},{form:'S-1'},{val:null}])('does not publish unsupported or invalid contexts %j',patch=>expect(parseSecFinancials(sec([{...record,...patch}]),cik,sha,stamp).items).toEqual([]));
 it('does not mix dimensional/custom values into standardized company metrics',()=>expect(parseSecFinancials(sec([record],'USD','custom','Revenue'),cik,sha,stamp).items).toEqual([]));
});

describe('DART major-account facts retain explicit periods and statement basis',()=>{
 it('preserves exact large strings, reported period, consolidated scope and source receipt',()=>{
  const raw=dart(),value=parseDartFinancials(raw,'12345678','0068Y0',dartReport,sha,stamp);
  expect(value.items).toHaveLength(2);expect(value.items[0]).toMatchObject({value_raw:'12345678901234567',unit:'KRW',period_start:'2026-01-01',period_end:'2026-06-30',scope:'consolidated',basis:'reported',accounting_standard:null,source_url:'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20260814000001',location:'/list/0/thstrm_add_amount'});
  expect(value.items[1].value_raw).toBe('10000000000000001');expect(raw).toContain(value.items[0].source_quote);
 });
 it('keeps separate and consolidated statements as separate facts',()=>expect(parseDartFinancials(dart([dartRow,{...dartRow,fs_div:'OFS'}]),'12345678','0068Y0',dartReport,sha,stamp).items.map(x=>x.scope)).toEqual(['consolidated','consolidated','separate','separate']));
 it('retains an explicit unfamiliar period label without inventing dates',()=>expect(parseDartFinancials(dart([{...dartRow,thstrm_dt:'제 4 기 반기',frmtrm_add_amount:'-'}]),'12345678','0068Y0',dartReport,sha,stamp).items[0]).toMatchObject({period_label:'제 4 기 반기',period_start:null,period_end:null}));
 it('uses the stated balance-sheet date and never manufactures a start date',()=>expect(parseDartFinancials(dart([{...dartRow,sj_div:'BS',account_nm:'자산총계',thstrm_dt:'2026.06.30 현재',frmtrm_amount:'-'}]),'12345678','0068Y0',dartReport,sha,stamp).items[0]).toMatchObject({metric:'assets',period_kind:'instant',period_start:null,period_end:'2026-06-30'}));
 it.each([{stock_code:'123456'},{corp_code:'99999999'},{bsns_year:'2025'},{reprt_code:'11011'}])('rejects wrong identity or query context %j',patch=>expect(()=>parseDartFinancials(dart([{...dartRow,...patch}]),'12345678','0068Y0',dartReport,sha,stamp)).toThrow('financial_identity_mismatch'));
 it('returns explicit empty official responses but rejects quota errors',()=>{
  expect(parseDartFinancials('{"status":"013"}','12345678','0068Y0',dartReport,sha,stamp).items).toEqual([]);
  expect(()=>parseDartFinancials('{"status":"020"}','12345678','0068Y0',dartReport,sha,stamp)).toThrow('quota_exceeded');
 });
 it('does not turn unavailable accumulated amounts into zero or substitute the quarter amount',()=>expect(parseDartFinancials(dart([{...dartRow,thstrm_add_amount:'-',frmtrm_add_amount:''}]),'12345678','0068Y0',dartReport,sha,stamp).items).toEqual([]));
 it.each(['IS','CIS'])('binds the actual half-year cumulative value and comparison to reported dates for %s',sj_div=>{
  const row={...dartRow,sj_div,thstrm_amount:'3,388,755,080,295',thstrm_add_amount:'6,629,816,183,195',frmtrm_amount:'2,900,000,000,000',frmtrm_add_amount:'5,701,868,408,120'};
  const items=parseDartFinancials(dart([row]),'12345678','0068Y0',dartReport,sha,stamp).items;
  expect(items).toMatchObject([{value_raw:'6629816183195',period_start:'2026-01-01',period_end:'2026-06-30',location:'/list/0/thstrm_add_amount'},{value_raw:'5701868408120',period_start:'2025-01-01',period_end:'2025-06-30',location:'/list/0/frmtrm_add_amount'}]);
 });
 it.each(['11013','11012','11014'] as const)('requires the explicit accumulated field for interim report %s',code=>{
  const row={...dartRow,reprt_code:code,thstrm_add_amount:undefined,frmtrm_add_amount:undefined};
  expect(parseDartFinancials(dart([row]),'12345678','0068Y0',{year:'2026',code},sha,stamp).items).toEqual([]);
 });
 it('keeps annual income amounts and their full reported period unchanged',()=>{
  const row={...dartRow,bsns_year:'2025',reprt_code:'11011',thstrm_dt:'2025.01.01 ~ 2025.12.31',thstrm_amount:'12,000',thstrm_add_amount:'99,000',frmtrm_amount:'-'};
  expect(parseDartFinancials(dart([row]),'12345678','0068Y0',{year:'2025',code:'11011'},sha,stamp).items).toMatchObject([{value_raw:'12000',period_start:'2025-01-01',period_end:'2025-12-31',location:'/list/0/thstrm_amount'}]);
 });
 it('does not use an accumulated field for a balance-sheet instant',()=>{
  const row={...dartRow,sj_div:'BS',account_nm:'자산총계',thstrm_dt:'2026.06.30 현재',thstrm_amount:'42,000',thstrm_add_amount:'99,000',frmtrm_amount:'-'};
  expect(parseDartFinancials(dart([row]),'12345678','0068Y0',dartReport,sha,stamp).items).toMatchObject([{value_raw:'42000',period_kind:'instant',period_start:null,period_end:'2026-06-30',location:'/list/0/thstrm_amount'}]);
 });
 it('versions only DART extraction while retaining the existing SEC parser identity',()=>{
  expect(financialParserVersion('dart')).toBe('reported-financials-dart-v2');expect(financialParserVersion('sec')).toBe('reported-financials-v1');
 });
 it('bounds candidate requests without asserting nonexistent periods',()=>expect(dartFinancialReports(new Date(stamp))).toEqual([{year:'2026',code:'11014'},{year:'2026',code:'11012'},{year:'2026',code:'11013'},{year:'2025',code:'11011'}]));
});
