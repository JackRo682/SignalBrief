'use client';
import {useEffect,useRef,useState} from 'react';
import {widgetSymbol} from './market-widget';
import {usePrefs} from '@/workspace/preferences';
import './market-widget.css';
type Kind='profile'|'financials'|'news';
const scripts:Record<Kind,string>={profile:'symbol-profile',financials:'financials',news:'timeline'};
export function CompanyWidgets({ticker,market}:{ticker:string;market:string}){
 const {text:t}=usePrefs(),[kind,setKind]=useState<Kind>('financials'),[enabled,setEnabled]=useState(false),[revision,setRevision]=useState(0),[state,setState]=useState('loading'),host=useRef<HTMLDivElement>(null);
 const mapped=widgetSymbol(ticker,market),symbol=mapped&&!mapped.startsWith('KRX:')?mapped:null;
 useEffect(()=>{
  if(!enabled||!symbol||!host.current)return;
  const container=host.current,widget=document.createElement('div'),script=document.createElement('script');let active=true;
  widget.className='tradingview-widget-container__widget';script.src=`https://s3.tradingview.com/external-embedding/embed-widget-${scripts[kind]}.js`;script.async=true;
  script.textContent=JSON.stringify({symbol,width:'100%',height:550,colorTheme:'light',isTransparent:false,locale:'en',displayMode:'regular',...(kind==='news'?{feedMode:'symbol',market:'stock'}:{})});
  const timer=setTimeout(()=>{if(active)setState('error');},20000);
  const observer=new MutationObserver(()=>{const frame=container.querySelector('iframe');if(frame){frame.title=`TradingView ${ticker} ${kind}`;clearTimeout(timer);if(active)setState('embedded');}});observer.observe(container,{childList:true,subtree:true});
  script.onerror=()=>{clearTimeout(timer);if(active)setState('error');};container.replaceChildren(widget,script);
  return()=>{active=false;clearTimeout(timer);observer.disconnect();script.onerror=null;container.replaceChildren();};
 },[enabled,symbol,ticker,kind,revision]);
 return <section className="sb-market-widget" aria-label={t('외부 기업 자료','External company data')}><h3>{t('외부 기업 자료','External company data')}</h3><p>{t('TradingView 제공 · 영어 자료이며 기업별 제공 범위가 다릅니다. 검토된 공시 분석과 별개이며 계산에 사용하지 않습니다.','Provided by TradingView in English; coverage varies by company. Separate from reviewed filing analysis and excluded from calculations.')}</p>{symbol?<><div role="group" aria-label={t('자료 유형','Data type')}>{(['profile','financials','news'] as Kind[]).map(item=><button key={item} aria-pressed={kind===item} onClick={()=>{setKind(item);setState('loading');}}>{item==='profile'?t('기업 소개','Profile'):item==='financials'?t('재무정보','Fundamentals'):t('기업 뉴스','Company news')}</button>)}</div>{!enabled?<button onClick={()=>{setEnabled(true);setState('loading');}}>{t('외부 기업 자료 불러오기','Load external company data')}</button>:state==='error'?<p role="status">{t('위젯을 불러오지 못했습니다.','The widget could not be loaded.')} <button onClick={()=>{setState('loading');setRevision(x=>x+1);}}>{t('재시도','Retry')}</button></p>:state==='loading'?<p role="status">{t('불러오는 중…','Loading…')}</p>:null}<div hidden={!enabled} ref={host} className="tradingview-widget-container" style={{height:550,width:'100%',overflow:'hidden'}}/><div className="tradingview-widget-copyright"><a href={`https://www.tradingview.com/symbols/${symbol.replace(':','-')}/`} target="_blank" rel="noopener noreferrer nofollow">{ticker} — TradingView</a></div></>:<p>{t('이 기업의 외부 위젯 제공 범위는 확인되지 않았습니다. 연결된 공식 공시와 기업 소개를 확인하세요.','External widget coverage is unconfirmed for this company. Use the connected official filings and company profile.')}</p>}</section>;
}
