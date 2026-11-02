import {obj,str,ProviderError} from './us-core.ts';

export type FinancialFact={
 metric:string;taxonomy:string;concept:string;label:string;value_raw:string;unit:string;
 period_start:string|null;period_end:string|null;period_label:string;period_kind:'instant'|'duration';
 fiscal_year:number|null;fiscal_period:string|null;form:string;accession:string;filed_on:string|null;
 accounting_standard:string|null;basis:'reported';scope:'entity'|'consolidated'|'separate';
 source_url:string;source_quote:string;location:string;raw_sha256:string;
};
export type FinancialSnapshot={provider:'sec'|'dart';provider_company_id:string;source_url:string;raw_sha256:string;fetched_at:string;items:FinancialFact[]};
export const FINANCIAL_PARSER_VERSION='reported-financials-v1';
export const DART_FINANCIAL_PARSER_VERSION='reported-financials-dart-v2';
export const financialParserVersion=(provider:'sec'|'dart')=>provider==='dart'?DART_FINANCIAL_PARSER_VERSION:FINANCIAL_PARSER_VERSION;
function fail(code:string):never{throw new ProviderError('financials',code);}
const date=(value:unknown):string|null=>{const s=str(value);return /^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s?s:null;};
const pointer=(parts:string[])=>'/'+parts.map(v=>v.replaceAll('~','~0').replaceAll('/','~1')).join('/');

/** Exact JSON source spans. Numeric values are never reconstructed through JS floats. */
function objects(raw:string,accept:(path:string[])=>boolean,visit:(path:string[],quote:string)=>void){
 let pos=0,nodes=0;
 const white=()=>{while(/\s/.test(raw[pos]??'')&&pos<raw.length)pos++;};
 const string=()=>{const start=pos++;while(pos<raw.length){const c=raw[pos++];if(c==='\\'){pos++;continue;}if(c==='"')return JSON.parse(raw.slice(start,pos)) as string;}return fail('invalid_json');};
 const value=(path:string[],depth:number)=>{
  if(++nodes>2_000_000||depth>24)fail('financial_source_too_complex');white();const start=pos;
  if(raw[pos]==='{'){
   pos++;white();const keys=new Set<string>();
   if(raw[pos]!=='}')while(true){const key=string();if(keys.has(key))fail('duplicate_source_key');keys.add(key);white();pos++;value([...path,key],depth+1);white();if(raw[pos]!==',')break;pos++;white();}
   pos++;if(accept(path)){const quote=raw.slice(start,pos);if(quote.length>8000)fail('financial_fact_too_large');visit(path,quote);}
  }else if(raw[pos]==='['){pos++;white();let index=0;if(raw[pos]!==']')while(true){value([...path,String(index++)],depth+1);white();if(raw[pos]!==',')break;pos++;}pos++;}
  else if(raw[pos]==='"')string();else while(pos<raw.length&&!/[\s,}\]]/.test(raw[pos]))pos++;
 };
 value([],0);white();if(pos!==raw.length)fail('invalid_json');
}

export function exactDecimal(value:string):string{
 const match=/^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(value);
 if(!match||value.length>150)fail('invalid_financial_number');
 const exponent=Number(match[4]??0);if(!Number.isInteger(exponent)||Math.abs(exponent)>100)fail('invalid_financial_number');
 const digits=match[2]+(match[3]??''),point=match[2].length+exponent;
 let result=point<=0?'0.'+'0'.repeat(-point)+digits:point>=digits.length?digits+'0'.repeat(point-digits.length):digits.slice(0,point)+'.'+digits.slice(point);
 result=result.replace(/^0+(?=\d)/,'').replace(/(\.\d*?)0+$/,'$1').replace(/\.$/,'');
 return /^0(?:\.0*)?$/.test(result)?'0':match[1]+result;
}

const secConcepts:Record<string,{metric:string;kind:'instant'|'duration'}>={
 RevenueFromContractWithCustomerExcludingAssessedTax:{metric:'revenue',kind:'duration'},
 RevenueFromContractWithCustomerIncludingAssessedTax:{metric:'revenue_including_assessed_tax',kind:'duration'},
 Revenues:{metric:'revenue',kind:'duration'},SalesRevenueNet:{metric:'net_sales',kind:'duration'},
 OperatingIncomeLoss:{metric:'operating_income',kind:'duration'},NetIncomeLoss:{metric:'net_income_parent',kind:'duration'},
 ProfitLoss:{metric:'net_income',kind:'duration'},Assets:{metric:'assets',kind:'instant'},Liabilities:{metric:'liabilities',kind:'instant'},
 StockholdersEquity:{metric:'equity_parent',kind:'instant'},StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest:{metric:'equity',kind:'instant'},
 CashAndCashEquivalentsAtCarryingValue:{metric:'cash_and_equivalents',kind:'instant'},
 NetCashProvidedByUsedInOperatingActivities:{metric:'operating_cash_flow',kind:'duration'},
 EarningsPerShareDiluted:{metric:'diluted_eps',kind:'duration'},EarningsPerShareBasic:{metric:'basic_eps',kind:'duration'},
 Revenue:{metric:'revenue',kind:'duration'},ProfitLossFromOperatingActivities:{metric:'operating_income',kind:'duration'},
 ProfitLossAttributableToOwnersOfParent:{metric:'net_income_parent',kind:'duration'},Equity:{metric:'equity',kind:'instant'},
 EquityAttributableToOwnersOfParent:{metric:'equity_parent',kind:'instant'},CashAndCashEquivalents:{metric:'cash_and_equivalents',kind:'instant'},
 CashFlowsFromUsedInOperatingActivities:{metric:'operating_cash_flow',kind:'duration'},
 DilutedEarningsLossPerShare:{metric:'diluted_eps',kind:'duration'},BasicEarningsLossPerShare:{metric:'basic_eps',kind:'duration'},
};
const secForms=new Set(['10-K','10-K/A','10-Q','10-Q/A','20-F','20-F/A','40-F','40-F/A','6-K','6-K/A']);
function metadata(raw:string,id:string,sha:string,fetchedAt:string,provider:'sec'|'dart'){
 if(!/^[a-f0-9]{64}$/.test(sha)||!Number.isFinite(Date.parse(fetchedAt))||!new RegExp(provider==='sec'?'^\\d{10}$':'^\\d{8}$').test(id))fail('invalid_financial_identity');
 if(new TextEncoder().encode(raw).length>(provider==='sec'?12_000_000:2_000_000))fail('financial_source_too_large');
 let parsed:unknown;try{parsed=JSON.parse(raw);}catch{return fail('invalid_json');}return obj(parsed);
}
// SEC emits CIK as either a JSON integer or a decimal string, sometimes padded.
// Normalize only that representation; objects, signs and nondecimal strings are invalid.
function canonicalSecCik(value:unknown):string|null{
 const digits=typeof value==='number'&&Number.isSafeInteger(value)&&value>0?String(value):typeof value==='string'?value:'';
 return /^[0-9]{1,10}$/.test(digits)&&/[1-9]/.test(digits)?digits.padStart(10,'0'):null;
}

export function parseSecFinancials(raw:string,cik:string,sha:string,fetchedAt:string):FinancialSnapshot{
 const root=metadata(raw,cik,sha,fetchedAt,'sec');if(canonicalSecCik(root.cik)!==cik)fail('financial_identity_mismatch');
 if(!str(root.entityName)||!root.facts||Array.isArray(root.facts)||typeof root.facts!=='object')fail('invalid_companyfacts');
 const source_url=`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`,today=fetchedAt.slice(0,10),facts:FinancialFact[]=[];
 objects(raw,p=>p.length===6&&p[0]==='facts'&&['us-gaap','ifrs-full'].includes(p[1])&&Object.hasOwn(secConcepts,p[2])&&p[3]==='units', (p,quote)=>{
  const row=obj(JSON.parse(quote)),spec=secConcepts[p[2]],end=date(row.end),start=date(row.start),filed=date(row.filed),accession=str(row.accn),form=str(row.form),unit=p[4];
  if(!end||!filed||end>today||filed>today||filed<end||!secForms.has(form)||!/^\d{10}-\d{2}-\d{6}$/.test(accession))return;
  if(spec.kind==='duration'&&(!start||start>end)||spec.kind==='instant'&&row.start!==undefined)return;
  if(!/^[A-Z]{3}(?:\/shares)?$/.test(unit))return;
  const number=/"val"\s*:\s*(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)(?=\s*[,}])/.exec(quote)?.[1];if(!number)return;
  const concept=obj(obj(obj(root.facts)[p[1]])[p[2]]),label=str(concept.label);if(!label||label.length>300)return;
  facts.push({metric:spec.metric,taxonomy:p[1],concept:p[2],label,value_raw:exactDecimal(number),unit,period_start:start,period_end:end,
   period_label:start?`${start} — ${end}`:end,period_kind:spec.kind,fiscal_year:Number.isInteger(row.fy)?Number(row.fy):null,
   fiscal_period:/^(FY|Q[1-4])$/.test(str(row.fp))?str(row.fp):null,form,accession,filed_on:filed,
   accounting_standard:p[1]==='us-gaap'?'US-GAAP':'IFRS',basis:'reported',scope:'entity',source_url,source_quote:quote,location:pointer(p),raw_sha256:sha});
 });
 // Keep reported contexts distinct (quarter vs YTD, currency, taxonomy, period).
 // Later official filings may restate a period; the selected filing date remains visible.
 const contexts=new Map<string,FinancialFact>();
 for(const f of facts){const key=[f.taxonomy,f.concept,f.unit,f.period_start,f.period_end].join('|'),old=contexts.get(key);
  if(!old||f.filed_on!>old.filed_on!)contexts.set(key,f);
  else if(f.filed_on===old.filed_on&&f.value_raw!==old.value_raw)fail('conflicting_reported_facts');
 }
 const counts=new Map<string,number>();
 const items=[...contexts.values()].sort((a,b)=>b.period_end!.localeCompare(a.period_end!)||b.filed_on!.localeCompare(a.filed_on!)||a.concept.localeCompare(b.concept)||String(a.period_start).localeCompare(String(b.period_start))).filter(f=>{
  const key=[f.taxonomy,f.concept,f.unit].join('|'),n=counts.get(key)??0;counts.set(key,n+1);return n<4;
 });
 if(items.length>240)fail('too_many_financial_contexts');
 return {provider:'sec',provider_company_id:cik,source_url,raw_sha256:sha,fetched_at:fetchedAt,items};
}

const dartAccounts:Record<string,string>={'매출액':'revenue','영업수익':'operating_revenue','영업이익':'operating_income','영업이익(손실)':'operating_income','당기순이익':'net_income','당기순이익(손실)':'net_income','자산총계':'assets','부채총계':'liabilities','자본총계':'equity'};
export type DartFinancialReport={year:string;code:'11011'|'11012'|'11013'|'11014'};
export function dartFinancialReports(now=new Date()):DartFinancialReport[]{
 // Candidate requests are not assertions that a reporting period has been filed.
 // Stop at the first official non-empty response; never invent a missing quarter.
 const year=now.getUTCFullYear(),month=now.getUTCMonth()+1;
 const codes:DartFinancialReport['code'][]=month>=10?['11014','11012','11013']:month>=7?['11012','11013']:month>=4?['11013']:[];
 return [...codes.map(code=>({year:String(year),code})),{year:String(year-1),code:'11011' as const}];
}
function dartDates(label:string,instant:boolean){
 const found=[...label.matchAll(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/g)].map(m=>date(`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`));
 if(instant&&found.length===1&&found[0])return {start:null,end:found[0]};
 if(!instant&&found.length===2&&found[0]&&found[1]&&found[0]<=found[1])return {start:found[0],end:found[1]};
 return {start:null,end:null};
}
export function parseDartFinancials(raw:string,corpCode:string,ticker:string,report:DartFinancialReport,sha:string,fetchedAt:string):FinancialSnapshot{
 const root=metadata(raw,corpCode,sha,fetchedAt,'dart');
 if(root.status==='013')return {provider:'dart',provider_company_id:corpCode,source_url:dartFinancialSource(corpCode,report),raw_sha256:sha,fetched_at:fetchedAt,items:[]};
 if(root.status!=='000'||!Array.isArray(root.list)||root.list.length>1000)fail(root.status==='020'?'quota_exceeded':'invalid_dart_financials');
 const items:FinancialFact[]=[],seen=new Map<string,string>();
 objects(raw,p=>p.length===2&&p[0]==='list',(p,quote)=>{
  const r=obj(JSON.parse(quote));
  if(r.stock_code!==ticker||r.corp_code!==undefined&&r.corp_code!==corpCode||r.bsns_year!==report.year||r.reprt_code!==report.code)fail('financial_identity_mismatch');
  const accession=str(r.rcept_no),scope=r.fs_div==='CFS'?'consolidated':r.fs_div==='OFS'?'separate':null,label=str(r.account_nm),metric=dartAccounts[label.replace(/\s/g,'')],unit=str(r.currency),instant=r.sj_div==='BS';
  if(!scope||!/^\d{14}$/.test(accession))fail('invalid_dart_financial_context');
  if(!metric||!['BS','IS','CIS'].includes(str(r.sj_div))||!/^[A-Z]{3}$/.test(unit))return;
  for(const term of ['thstrm','frmtrm'] as const){
   // Interim IS/CIS *_amount is a three-month amount; *_dt describes the
   // reported accumulated period. Never pair that date range with the quarter
   // amount, or derive a quarter start when the accumulated amount is absent.
   const amountField=term+(!instant&&report.code!=='11011'?'_add_amount':'_amount');
   const amount=str(r[amountField]).trim(),periodLabel=str(r[term+'_dt']).trim();
   if(!/^-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/.test(amount)||!periodLabel||periodLabel.length>200)continue;
   const dates=dartDates(periodLabel,instant),value=exactDecimal(amount.replaceAll(',',''));
   const key=[metric,scope,r.sj_div,periodLabel,term].join('|'),old=seen.get(key);if(old!==undefined&&old!==value)fail('conflicting_reported_facts');if(old!==undefined)continue;seen.set(key,value);
   items.push({metric,taxonomy:'dart',concept:label,label,value_raw:value,unit,period_start:dates.start,period_end:dates.end,period_label:periodLabel,
    period_kind:instant?'instant':'duration',fiscal_year:term==='thstrm'?Number(report.year):null,fiscal_period:report.code,form:report.code,accession,filed_on:null,
    accounting_standard:null,basis:'reported',scope,source_url:`https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${accession}`,source_quote:quote,location:pointer(p)+'/'+amountField,raw_sha256:sha});
  }
 });
 return {provider:'dart',provider_company_id:corpCode,source_url:dartFinancialSource(corpCode,report),raw_sha256:sha,fetched_at:fetchedAt,items};
}
export function dartFinancialSource(corpCode:string,report:DartFinancialReport){return `https://opendart.fss.or.kr/api/fnlttSinglAcnt.json?corp_code=${corpCode}&bsns_year=${report.year}&reprt_code=${report.code}`;}
