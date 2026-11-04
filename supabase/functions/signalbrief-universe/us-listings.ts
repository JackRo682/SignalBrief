/**
 * Nasdaq Trader's whole listed-security file, including securities not traded
 * on Nasdaq. Instrument decisions use declared fields/descriptions only.
 * https://www.nasdaqtrader.com/Trader.aspx?id=SymbolDirDefs
 * https://www.nasdaqtrader.com/trader.aspx?id=CQSsymbolconvention
 * F=TXSE: DTN2026-10; M=NYSE Texas: DTN2025-22.
 */
export const NASDAQ_COLUMNS = ['Nasdaq Traded','Symbol','Security Name','Listing Exchange','Market Category','ETF','Round Lot Size','Test Issue','Financial Status','CQS Symbol','NASDAQ Symbol','NextShares'] as const;
export const NASDAQ_HEADER = NASDAQ_COLUMNS.join('|');
export const NASDAQ_MARKETS:Record<string,string> = {Q:'NASDAQ',N:'NYSE',A:'NYSE_AMERICAN',P:'NYSE_ARCA',Z:'CBOE',F:'TXSE',M:'NYSE_TEXAS',V:'IEX'};
export type NasdaqFields = Record<typeof NASDAQ_COLUMNS[number],string>;
export type NasdaqListing = {
 source_row:number;fields:NasdaqFields;market:string;ticker:string;name:string;
 aliases:string[];instrument_type:string;eligible:boolean;exclusion_reason:string|null;
};
type Classification = Pick<NasdaqListing,'instrument_type'|'eligible'|'exclusion_reason'>;
const classify = (fields:NasdaqFields):Classification => {
 const name=fields['Security Name'];
 const result=(instrument_type:string,eligible:boolean,exclusion_reason:string|null=null)=>({instrument_type,eligible,exclusion_reason});
 if(fields['Test Issue']==='Y')return result('test_issue',false,'official_test_issue_flag');
 // This exchange flag also covers some ETNs/ETVs. It is not a SEC fund-type code.
 if(fields.ETF==='Y')return result('exchange_traded_product',false,'product_requires_security_or_fund_series_analysis');
 // Unit bundles often mention both common shares and warrants; classify the
 // security itself before interpreting words describing its components.
 if(/\bunits?\b[^;]*\b(?:consist|comprised)/i.test(name)||/\s-\sUnits?\.?\s*$/i.test(name)||fields['CQS Symbol'].endsWith('.U')||/\b(?:Tangible Equity|Corporate)\s+Units?\b/i.test(name))return result('bundle_unit',false,'bundle_unit_not_standalone_stock');
 if(/\bwarrants?\b/i.test(name))return result('warrant',false,'warrant_not_stock');
 if(/\brights?\b/i.test(name))return result('right',false,'right_not_stock');
 if(/\bETNs?\b/i.test(name))return result('exchange_traded_note',false,'exchange_traded_note_not_stock');
 if(/\b(?:notes?|debentures?|bonds?|STRATS|CorTS|ZONES)\b|\bCorp(?:orate)?\s+Backed\s+Tr(?:ust)?\b/i.test(name))return result('debt',false,'listed_debt_not_stock');
 if(/\b(?:preferred|preference|pfd|pref)\b/i.test(name)||/^[A-Z0-9]+\$[A-Z]?$/.test(fields.Symbol))return result('preferred_equity',true);
 if(/\b(?:American Depositary|American Depository|Depositary Receipts?|Depository Receipts?|ADSs?|ADRs?)\b/i.test(name))return result('depositary_receipt',true);
 if(/\bClosed[ -]End\s+Fund\b/i.test(name))return result('closed_end_fund',true);
 if(/\bBusiness Development Company\b/i.test(name))return result('business_development_company',true);
 if(/\b(?:REIT|Real Estate Investment Trust)\b/i.test(name))return result('reit_equity',true);
 if(/\b(?:common|ordinary|partnership|depositary)\s+units?\b|\bunits?\s+(?:of\s+)?(?:beneficial|limited|partnership)|\bunits?\b.*\blimited partner(?:ship)?\s+interests\b|\bLP\s+Limited Partnership\s*$/i.test(name))return result('partnership_or_trust_equity',true);
 if(/\b(?:common|ordinary|capital|ord)\s+(?:stock|stcok|shares?)\b|\bshares?\s+(?:of\s+)?beneficial\s+interest\b|\b(?:voting|non-voting|subordinate|registered|registry)\s+shares?\b|\bClass\s+[A-Z]\s+(?:Shares?|Common)\b|\bCommon\b(?:\s+New|\s*\(Canada\))?\s*$|\bCmn\s+Shs\s+of\s+BI\b/i.test(name))return result('equity_share',true);
 // A bare issuer name can represent equity or debt. Keep it visible for
 // supplemental official classification rather than guessing its instrument.
 return result('other_non_etf_security',false,'instrument_classification_unresolved');
};

export function nasdaqAliases(fields:NasdaqFields,instrumentType:string):string[]{
 const raw=[fields.Symbol,fields['CQS Symbol'],fields['NASDAQ Symbol']].filter(Boolean);
 // CQS suffixes are case-sensitive protocol identifiers. Uppercasing `TpC`
 // would manufacture `TPC`, which can be another issuer's actual SEC ticker.
 const aliases=new Set(raw);
 for(const value of raw){
  // These produce ticker candidates only, never a CIK. A separate exact join
  // to the archived SEC directory must establish each provider identity.
  if(!['bundle_unit','warrant','right'].includes(instrumentType)&&/^[A-Z0-9]+\.[A-Z]$/.test(value))aliases.add(value.replace('.','-'));
  if(/^[A-Z0-9]+\$[A-Z]?$/.test(value))aliases.add(value.replace('$','-P'));
  if(/^[A-Z0-9]+p[A-Z]?$/.test(value))aliases.add(value.replace('p','-P'));
  if(/^[A-Z0-9]+\.U$/.test(value))aliases.add(value.slice(0,-2)+'-UN');
  if(/^[A-Z0-9]+\.(?:W|WS)$/.test(value))aliases.add(value.replace(/\.(?:W|WS)$/,'-WT'));
  if(/^[A-Z0-9]+\.R$/.test(value))aliases.add(value.slice(0,-2)+'-RT');
 }
 return [...aliases];
}

export function parseNasdaqSnapshot(raw:string):{as_of:string;creation_time_local:string;rows:NasdaqListing[]}{
 if(typeof raw!=='string'||new TextEncoder().encode(raw).length>10000000)throw new Error('nasdaq_source_too_large');
 const lines=raw.replace(/^\uFEFF/,'').replaceAll('\r\n','\n').split('\n');
 if(lines.at(-1)==='')lines.pop();
 if(lines[0]!==NASDAQ_HEADER)throw new Error('invalid_nasdaq_header');
 if(lines.length<3||lines.length>50002)throw new Error('invalid_nasdaq_row_count');
 // Nasdaq's footer does not contain the same delimiter count as its header.
 const match=lines.at(-1)!.match(/^File Creation Time: (\d{2})(\d{2})(\d{4})(\d{2}):(\d{2})\|{1,11}$/);
 if(!match)throw new Error('invalid_nasdaq_footer');
 const [,month,day,year,hour,minute]=match;
 const as_of=`${year}-${month}-${day}`,date=new Date(`${as_of}T00:00:00.000Z`);
 if(!Number.isFinite(date.valueOf())||date.toISOString().slice(0,10)!==as_of||Number(hour)>23||Number(minute)>59)throw new Error('invalid_nasdaq_footer_date');
 const seen=new Set<string>();
 const rows:NasdaqListing[]=lines.slice(1,-1).map((line,index)=>{
  const values=line.split('|');
  if(values.length!==NASDAQ_COLUMNS.length||values.some(value=>/[\u0000-\u001f\u007f]/.test(value)))throw new Error('invalid_nasdaq_row');
  const fields=Object.fromEntries(NASDAQ_COLUMNS.map((field,position)=>[field,values[position]])) as NasdaqFields;
  if(!/^[A-Z0-9][A-Z0-9.^$+\/=\-]{0,13}$/.test(fields.Symbol))throw new Error('invalid_nasdaq_symbol');
  if(seen.has(fields.Symbol))throw new Error('duplicate_nasdaq_symbol');
  seen.add(fields.Symbol);
  for(const field of ['CQS Symbol','NASDAQ Symbol'] as const){
   if(fields[field]&&!/^[A-Z0-9][A-Za-z0-9.^$+\/=\-]{0,13}$/.test(fields[field]))throw new Error('invalid_nasdaq_alias');
  }
  if(!fields['NASDAQ Symbol']||!fields['Security Name'].trim()||fields['Security Name'].length>500)throw new Error('invalid_nasdaq_identity');
  const market=NASDAQ_MARKETS[fields['Listing Exchange']];
  if(!market)throw new Error('unsupported_nasdaq_exchange');
  for(const field of ['Nasdaq Traded','ETF','Test Issue','NextShares'] as const){
   if(!['Y','N'].includes(fields[field]))throw new Error('invalid_nasdaq_flag');
  }
  if(!/^[1-9][0-9]{0,5}$/.test(fields['Round Lot Size']))throw new Error('invalid_nasdaq_round_lot');
  if(fields['Listing Exchange']==='Q'){
   if(!['Q','G','S'].includes(fields['Market Category'])||!['N','D','E','Q','G','H','J','K'].includes(fields['Financial Status']))throw new Error('invalid_nasdaq_market_status');
  }else if(fields['Market Category'].trim()!==''||fields['Financial Status']!==''||!fields['CQS Symbol'])throw new Error('invalid_nasdaq_market_status');
  const classification=classify(fields);
  return {source_row:index+2,fields,market,ticker:fields.Symbol,name:fields['Security Name'].trim().replace(/\s+/g,' '),aliases:nasdaqAliases(fields,classification.instrument_type),...classification};
 });
 return {as_of,creation_time_local:`${as_of}T${hour}:${minute}`,rows};
}

export function parseNasdaqRows(raw:string):NasdaqListing[]{return parseNasdaqSnapshot(raw).rows;}
