'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {z} from 'zod';
import {useAuth} from '@/components/auth';
import {usePrefs} from '@/workspace/preferences';
import './market-indices.css';

export const indexNames=['KOSPI','KOSDAQ','NASDAQ','S&P500'] as const;
type IndexName=typeof indexNames[number];
const symbolSchema=z.enum(indexNames);
const quoteSchema=z.object({
 symbol:symbolSchema,price:z.number().finite().positive(),currency:z.literal('POINTS'),
 change_pct:z.number().finite().nullable(),as_of:z.string().datetime({offset:true}),
 source:z.enum(['KIS','FMP']),timestamp_kind:z.enum(['provider_timestamp','request_observed_at_not_exchange_timestamp']),
}).superRefine((q,ctx)=>{
 const korean=q.symbol==='KOSPI'||q.symbol==='KOSDAQ';
 if(q.source!==(korean?'KIS':'FMP')||q.timestamp_kind!==(korean?'request_observed_at_not_exchange_timestamp':'provider_timestamp'))ctx.addIssue({code:z.ZodIssueCode.custom,message:'invalid_provider_metadata'});
});
const responseSchema=z.object({indices:z.array(z.unknown()),unavailable:z.array(z.object({symbol:symbolSchema,reason:z.string().min(1)})),available:z.boolean()});
type Quote=z.infer<typeof quoteSchema>;
type IndexData={quotes:Partial<Record<IndexName,Quote>>;reasons:Partial<Record<IndexName,string>>};

/** Validate each quote independently so one bad provider record cannot hide another index. */
export function parseIndices(payload:unknown,now=Date.now()):IndexData{
 const response=responseSchema.parse(payload),quotes:IndexData['quotes']={},reasons:IndexData['reasons']={};
 for(const item of response.unavailable)reasons[item.symbol]=item.reason;
 const seen=new Set<IndexName>();
 for(const raw of response.indices){
  const identity=z.object({symbol:symbolSchema}).safeParse(raw);if(!identity.success)continue;
  const name=identity.data.symbol,quote=quoteSchema.safeParse(raw);
  if(seen.has(name)||reasons[name]){delete quotes[name];reasons[name]='invalid_response';continue;}
  seen.add(name);
  if(!quote.success){reasons[name]='invalid_response';continue;}
  const age=now-Date.parse(quote.data.as_of);
  if(age < -300000){reasons[name]='invalid_response';continue;}
  if(age>7*86400000){reasons[name]='stale_quote';continue;}
  quotes[name]=quote.data;
 }
 for(const name of indexNames)if(!quotes[name]&&!reasons[name])reasons[name]='missing_index';
 return {quotes,reasons};
}

export function useMarketIndices(){
 const {token}=useAuth(),[revision,setRevision]=useState(0);
 const [state,setState]=useState<{token:string|null;data:IndexData|null;loading:boolean;error:string}>({token:null,data:null,loading:false,error:''});
 useEffect(()=>{
  if(!token)return;
  const controller=new AbortController();let live=true;
  const timer=setTimeout(()=>controller.abort(),55000);
  setState({token,data:null,loading:true,error:''});
  (async()=>{
   try{
    const response=await fetch('/api/us/indices',{headers:{Authorization:`Bearer ${token}`},cache:'no-store',signal:controller.signal});
    if(!live)return;
    if(!response.ok){
     if(response.status===401)window.dispatchEvent(new Event('signalbrief:unauthorized'));
     const body=await response.json().catch(()=>null);
     if(!live)return;
     if(response.status===403&&body?.error?.code==='mfa_required')window.dispatchEvent(new Event('signalbrief:mfa-required'));
     throw new Error(`http_${response.status}`);
    }
    const payload=await response.json().catch(()=>{throw new Error('invalid_response');});
    const data=parseIndices(payload);
    if(live)setState({token,data,loading:false,error:''});
   }catch(error){
    if(live)setState({token,data:null,loading:false,error:controller.signal.aborted?'timeout':error instanceof z.ZodError||error instanceof Error&&error.message==='invalid_response'?'invalid_response':error instanceof Error&&/^http_\d+$/.test(error.message)?error.message:'network_error'});
   }finally{clearTimeout(timer);}
  })();
  return()=>{live=false;clearTimeout(timer);controller.abort();};
 },[token,revision]);
 const current=state.token===token?state:null;
 return {data:token?current?.data??null:null,loading:!!token&&(current?.loading??true),error:token?current?.error??'':'authentication_required',reload:()=>setRevision(v=>v+1)};
}
type IndexState=ReturnType<typeof useMarketIndices>;

function reasonText(reason:string,t:(ko:string,en:string)=>string):string{
 if(['kis_display_license_unverified','index_entitlement_unverified'].includes(reason))return t('시세 표시 권한 확인 대기','Display authorization pending');
 if(['missing_credentials','missing_key'].includes(reason))return t('공급자 계정 연결 필요','Provider credentials required');
 if(reason==='invalid_key')return t('공급자 인증 실패','Provider authentication failed');
 if(reason==='access_or_plan_denied')return t('공급자 접근 권한·요금제 확인 필요','Provider access or plan requires review');
 if(['invalid_index','invalid_numeric_quote','invalid_price','invalid_json'].includes(reason))return t('공급자 지수 데이터 검증 실패','Provider index data failed validation');
 if(['provider_timeout','transport_timeout'].includes(reason))return t('공급자 응답 시간 초과','Provider request timed out');
 if(reason==='authentication_required'||reason==='http_401')return t('로그인이 필요합니다','Sign in required');
 if(reason==='http_403')return t('접근 권한 확인 필요','Access permission required');
 if(reason==='http_429'||reason==='quota_exceeded'||reason==='budget_exceeded')return t('요청 한도 초과 · 잠시 후 재시도','Request limit reached · try later');
 if(reason==='invalid_response')return t('지수 응답 형식 오류','Invalid index response');
 if(reason==='stale_quote')return t('최신 지수 데이터 없음 · 7일 초과','No recent index data · over 7 days old');
 if(reason==='missing_index')return t('API 응답에 해당 지수 없음','Index missing from API response');
 if(reason==='timeout')return t('지수 요청 시간 초과','Index request timed out');
 if(reason==='network_error')return t('지수 API 연결 실패','Index API connection failed');
 if(reason.startsWith('http_'))return `${t('지수 API 오류','Index API error')} (HTTP ${reason.slice(5)})`;
 return t('공급자 지수 조회 실패','Provider index lookup failed');
}

export function MarketIndexCards({state,mobile=false}:{state:IndexState;mobile?:boolean}){
 const {text:t,date,value}=usePrefs(),locale=value.locale==='ko'?'ko-KR':'en-US';
 return indexNames.map((name,index)=>{
  const quote=state.data?.quotes[name],reason=state.error||state.data?.reasons[name]||'missing_index';
  return <Link key={name} href="/us" className={mobile?`m-market-index ${index<2?'pink':'blue'}`:index<2?'warm':'cool'}>
   <strong>{t(['코스피','코스닥','나스닥','S&P 500'][index],name==='S&P500'?'S&P 500':name)}</strong>
   <b>{quote?quote.price.toLocaleString(locale,{minimumFractionDigits:2,maximumFractionDigits:2}):'—'}</b>
   {quote?<><span>{quote.change_pct===null?t('등락률 미제공','Change unavailable'):`${quote.change_pct>0?'+':''}${quote.change_pct.toFixed(2)}%`} · {quote.source}</span>
    <span>{quote.timestamp_kind==='provider_timestamp'?t('시세 기준','Quote time'):t('조회 시각','Retrieved')} <time dateTime={quote.as_of}>{date(quote.as_of)}</time></span>
    {quote.source==='KIS'&&<span>{t('REST 스냅샷 · 거래소 시각 아님','REST snapshot · retrieval time')}</span>}
   </>:<span>{state.loading?t('지수 확인 중…','Loading index…'):reasonText(reason,t)}</span>}
  </Link>;
 });
}

export function MarketIndicesStatus({state}:{state:IndexState}){
 const {text:t}=usePrefs();
 return <div className="market-indices-status" role={state.error&&state.error!=='authentication_required'?'alert':'status'} aria-live="polite">
  {state.error&&<span>{reasonText(state.error,t)} </span>}
  <span>{t('권한이 확인된 공급자 데이터 · 시각은 설정한 시간대 기준','Authorized provider data · times use your selected timezone')}</span>
  <button type="button" onClick={state.reload} disabled={state.loading}>{state.loading?t('확인 중…','Loading…'):t('지수 다시 조회','Refresh indices')}</button>
 </div>;
}
