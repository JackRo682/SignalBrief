import {describe,expect,it} from 'vitest';
import {NASDAQ_COLUMNS,NASDAQ_HEADER,parseNasdaqRows,parseNasdaqSnapshot,type NasdaqFields} from '../../../supabase/functions/signalbrief-universe/us-listings';

// Synthetic issuer names and rows; actual-source replay is a separate audit.
const row=(patch:Partial<NasdaqFields>={}):NasdaqFields=>({'Nasdaq Traded':'Y',Symbol:'EXMP','Security Name':'Example Corporation - Common Stock','Listing Exchange':'Q','Market Category':'G',ETF:'N','Round Lot Size':'100','Test Issue':'N','Financial Status':'N','CQS Symbol':'','NASDAQ Symbol':'EXMP',NextShares:'N',...patch});
const other=(patch:Partial<NasdaqFields>={})=>row({'Listing Exchange':'N','Market Category':' ','Financial Status':'','CQS Symbol':'EXMP',...patch});
const file=(rows:NasdaqFields[],footer='File Creation Time: 1104202608:47|||||')=>[NASDAQ_HEADER,...rows.map(value=>NASDAQ_COLUMNS.map(field=>value[field]).join('|')),footer,''].join('\n');

describe('complete Nasdaq listed-security source',()=>{
 it('preserves all rows and original fields with physical source lines and unzoned footer time',()=>{
  const input=[other({Symbol:'EXMP.A','CQS Symbol':'EXMP.A','NASDAQ Symbol':'EXMP.A','Nasdaq Traded':'N','Security Name':'Example  Corporation Common Stock '}),row({Symbol:'FUND','NASDAQ Symbol':'FUND',ETF:'Y','Security Name':'Example ETF'}),row({Symbol:'TEST','NASDAQ Symbol':'TEST','Test Issue':'Y'})];
  const parsed=parseNasdaqSnapshot(file(input));
  expect(parsed.as_of).toBe('2026-11-04');expect(parsed.creation_time_local).toBe('2026-11-04T08:47');
  expect(parsed.rows).toHaveLength(3);expect(parsed.rows.map(value=>value.source_row)).toEqual([2,3,4]);
  expect(parsed.rows[0]).toMatchObject({fields:input[0],eligible:true,name:'Example Corporation Common Stock',aliases:['EXMP.A','EXMP-A']});
  expect(parsed.rows[1]).toMatchObject({eligible:false,instrument_type:'exchange_traded_product'});
  expect(parsed.rows[2]).toMatchObject({eligible:false,instrument_type:'test_issue'});
 });
 it.each([['F','TXSE'],['M','NYSE_TEXAS'],['V','IEX'],['A','NYSE_AMERICAN'],['P','NYSE_ARCA'],['Z','CBOE']])('recognizes current listing market %s', (code,market)=>{
  expect(parseNasdaqRows(file([other({'Listing Exchange':code})]))[0].market).toBe(market);
 });
 it('retains a deficient issuer and accepts CRLF without converting financial status to delisted',()=>{
  const parsed=parseNasdaqRows(file([row({'Financial Status':'D'})]).replaceAll('\n','\r\n'));
  expect(parsed[0].eligible).toBe(true);expect(parsed[0].fields['Financial Status']).toBe('D');
 });
 it.each([
  ['Example Company - American Depositary Shares','depositary_receipt',true],
  ['Example Company - Ordinary Shares','equity_share',true],
  ['Example Company - New York Registry Shares','equity_share',true],
  ['Example Company - Class A Ord Share','equity_share',true],
  ['Example Fund - Closed End Fund','closed_end_fund',true],
  ['Example Capital - Business Development Company','business_development_company',true],
  ['Example Property - Real Estate Investment Trust','reit_equity',true],
  ['Example Partners LP Common Units','partnership_or_trust_equity',true],
  ['Example Company Perpetual Preference Shares','preferred_equity',true],
  ['Example Acquisition - Unit','bundle_unit',false],
  ['Example Acquisition Units, each consisting of one Common Share and one Warrant','bundle_unit',false],
  ['Example Company 6% Corporate Units','bundle_unit',false],
  ['Example Company Warrants to purchase Common Stock','warrant',false],
  ['Example Company Rights to receive Ordinary Shares','right',false],
  ['Example Company 6.5% Notes due 2030','debt',false],
  ['Example Preferred Stock Index ETN due 2048','exchange_traded_note',false],
  ['Example Income Trust','other_non_etf_security',false],
  ['Example Corporation','other_non_etf_security',false],
 ])('classifies the security described by %s', (name,instrument_type,eligible)=>{
  expect(parseNasdaqRows(file([row({'Security Name':name})]))[0]).toMatchObject({instrument_type,eligible});
 });
 it('preserves raw preferred aliases and derives only ticker candidates, never a provider identity',()=>{
  const parsed=parseNasdaqRows(file([other({Symbol:'EXMP$B','CQS Symbol':'EXMPpB','NASDAQ Symbol':'EXMP-B','Security Name':'Example Depositary Shares'})]))[0];
  expect(parsed).toMatchObject({instrument_type:'preferred_equity',eligible:true,aliases:['EXMP$B','EXMPpB','EXMP-B','EXMP-PB']});
  expect(parsed.aliases).not.toContain('EXMPPB');
  expect(parsed.fields['CQS Symbol']).toBe('EXMPpB');expect(parsed).not.toHaveProperty('provider_company_id');
 });
 it.each([
  ['EXMP.U','EXMP.U','EXMP=','Example Units, each consisting of one Common Share and one Warrant','EXMP-UN'],
  ['EXMP.W','EXMP.WS','EXMP+','Example Warrants','EXMP-WT'],
  ['EXMP.R','EXMPr','EXMP^','Example Rights','EXMP-RT'],
 ])('retains derivative aliases without treating %s as a common share class', (symbol,cqs,nasdaq,name,sec)=>{
  const parsed=parseNasdaqRows(file([other({Symbol:symbol,'CQS Symbol':cqs,'NASDAQ Symbol':nasdaq,'Security Name':name})]))[0];
  expect(parsed.aliases).toContain(nasdaq);expect(parsed.aliases).toContain(sec);expect(parsed.aliases).not.toContain(symbol.replace('.','-'));expect(parsed.eligible).toBe(false);
 });
 it.each([
  ['missing footer',(s:string)=>s.slice(0,s.indexOf('File Creation'))],
  ['wrong header',(s:string)=>s.replace('Nasdaq Traded|','Traded|')],
  ['invalid day',(s:string)=>s.replace('11042026','11312026')],
  ['invalid hour',(s:string)=>s.replace('08:47','24:47')],
  ['trailing data',(s:string)=>s+'garbage\n'],
  ['blank body row',(s:string)=>s.replace('\nY|','\n\nY|')],
  ['truncated row',(s:string)=>s.replace('|100|N|N|','|100|N|')],
 ])('rejects %s instead of accepting a partial snapshot',(_name,change)=>{
  expect(()=>parseNasdaqRows(change(file([row()])))).toThrow();
 });
 it.each([
  {'Listing Exchange':'X'}, {'ETF':'?'}, {'Nasdaq Traded':'?'}, {'Test Issue':''}, {'NextShares':'0'},
  {'Round Lot Size':'0'}, {'Market Category':'?'}, {'Financial Status':'?'}, {'Security Name':''},
  {'Symbol':'EXMP<script>'}, {'NASDAQ Symbol':'EXMP|INJECT'},
 ] as Partial<NasdaqFields>[])('rejects invalid authoritative fields %j',patch=>{
  expect(()=>parseNasdaqRows(file([row(patch)]))).toThrow();
 });
 it('rejects duplicate symbols rather than silently deduplicating the source',()=>{
  expect(()=>parseNasdaqRows(file([row(),row()]))).toThrow('duplicate_nasdaq_symbol');
 });
});
