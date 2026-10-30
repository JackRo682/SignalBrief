import {obj,str,arr,ProviderError,jsonFetch,websitePermission,fmpQuote,fmpHistory,usSymbol,type Row,type Fetcher} from './us-core.ts';
/** Explicit EOD selection never falls back to an intraday endpoint. Rights apply to both modes. */
export async function fmpEquityQuote(symbol:string,key:string,config:Row,fetcher:Fetcher=fetch):Promise<Row>{
 if(!websitePermission(config,'fmp'))throw new ProviderError('fmp','fmp_display_license_unverified',409);
 const name=usSymbol(symbol),mode=config.fmp_quote_mode??'snapshot';
 if(mode==='snapshot')return fmpQuote(name,key,fetcher);
 if(mode!=='eod')throw new ProviderError('fmp','invalid_quote_mode',503);
 const history=await fmpHistory(name,key,fetcher),last=history.at(-1);
 if(!last)throw new ProviderError('fmp','eod_price_unavailable',503);
 if(history.some(point=>{const day=str(point.date),date=new Date(day);return !Number.isFinite(+date)||date.toISOString().slice(0,10)!==day;}))throw new ProviderError('fmp','invalid_history');
 // The provider supplies a trading date, not an exchange timestamp. Do not invent a closing time
 // or a daily return from a series whose adjustment basis has not been confirmed.
 return {symbol:name,price:last.close,currency:'USD',change_pct:null,as_of:last.date,source:'FMP EOD',history,
  price_kind:'end_of_day_close',timestamp_kind:'provider_date',delay:'end_of_day',history_resolution:'daily'};
}
export const indexSymbols:Record<string,string>={KOSPI:'0001',KOSDAQ:'1001',NASDAQ:'^IXIC','S&P500':'^GSPC'};
export function koreanSymbol(value:string):string{if(!/^\d{6}$/.test(value))throw new ProviderError('kis','invalid_korean_symbol',422);return value;}
const number=(value:unknown)=>{const s=typeof value==='number'?String(value):str(value);if(!/^-?\d+(?:\.\d+)?$/.test(s))throw new ProviderError('market','invalid_numeric_quote');const n=Number(s);if(!Number.isFinite(n))throw new ProviderError('market','invalid_numeric_quote');return n;};
export function normalizeKIS(payload:unknown,symbol:string,index=false,now=new Date()):Row{
 const response=obj(payload);if(response.rt_cd!=='0')throw new ProviderError('kis','provider_rejected');
 const output=obj(response.output),price=number(output[index?'bstp_nmix_prpr':'stck_prpr']);
 if(price<=0)throw new ProviderError('kis','invalid_price');
 return {symbol,price,currency:index?'POINTS':'KRW',change_pct:number(output[index?'bstp_nmix_prdy_ctrt':'prdy_ctrt']),
 as_of:now.toISOString(),source:'KIS',history:[],timestamp_kind:'request_observed_at_not_exchange_timestamp',history_coverage:'not_connected',delay:'REST_snapshot_not_streaming'};
}
export async function kisToken(appkey:string,appsecret:string,fetcher:Fetcher=fetch):Promise<Row>{
 if(!appkey||!appsecret)throw new ProviderError('kis','missing_credentials',503);
 const data=obj(await jsonFetch(new URL('https://openapi.koreainvestment.com:9443/oauth2/tokenP'),'kis',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({grant_type:'client_credentials',appkey,appsecret})},fetcher));
 if(!str(data.access_token)||!Number.isFinite(Number(data.expires_in))||Number(data.expires_in)<=0)throw new ProviderError('kis','invalid_auth_response');
 return {access_token:data.access_token,expires_in:Math.min(Number(data.expires_in),86400)};
}
export async function kisQuote(symbol:string,credentials:Row,config:Row,token:string,index=false,fetcher:Fetcher=fetch):Promise<Row>{
 if(!websitePermission(config,'kis'))throw new ProviderError('kis','kis_display_license_unverified',409);
 const code=index?indexSymbols[symbol]:koreanSymbol(symbol);if(!code||index&&!['KOSPI','KOSDAQ'].includes(symbol))throw new ProviderError('kis','unsupported_index',422);
 if(!token||!credentials.KIS_APP_KEY||!credentials.KIS_APP_SECRET)throw new ProviderError('kis','missing_credentials',503);
 const url=new URL('https://openapi.koreainvestment.com:9443/uapi/domestic-stock/v1/quotations/'+(index?'inquire-index-price':'inquire-price'));
 url.searchParams.set('FID_COND_MRKT_DIV_CODE',index?'U':'J');url.searchParams.set('FID_INPUT_ISCD',code);
 return normalizeKIS(await jsonFetch(url,'kis',{headers:{Authorization:'Bearer '+token,appkey:str(credentials.KIS_APP_KEY),appsecret:str(credentials.KIS_APP_SECRET),tr_id:index?'FHPUP02100000':'FHKST01010100',custtype:'P'}},fetcher),symbol,index);
}
export async function fmpIndex(name:string,key:string,config:Row,fetcher:Fetcher=fetch):Promise<Row>{
 if(!websitePermission(config,'fmp')||config.fmp_indices_display_enabled!==true)throw new ProviderError('fmp','index_entitlement_unverified',409);
 const symbol=indexSymbols[name];if(!['NASDAQ','S&P500'].includes(name)||!symbol)throw new ProviderError('market','unsupported_index',422);
 if(!key)throw new ProviderError('fmp','missing_key',503);
 const url=new URL('https://financialmodelingprep.com/stable/quote');url.searchParams.set('symbol',symbol);url.searchParams.set('apikey',key);
 const quote=arr(await jsonFetch(url,'fmp',{},fetcher)).find(q=>q.symbol===symbol);
 if(!quote||typeof quote.timestamp!=='number'||quote.timestamp<=0||quote.timestamp*1000>Date.now()+300000)throw new ProviderError('fmp','invalid_index');
 const price=number(quote.price);if(price<=0)throw new ProviderError('fmp','invalid_index');
 return {symbol:name,provider_symbol:symbol,price,currency:'POINTS',as_of:new Date(quote.timestamp*1000).toISOString(),change_pct:quote.changePercentage==null?null:number(quote.changePercentage),source:'FMP',history:[],timestamp_kind:'provider_timestamp',delay:'provider_timestamp_only'};
}
