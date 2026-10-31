'use client';
import Link from 'next/link';
import {usePrefs} from '@/workspace/preferences';
import {resourceHref,type Resource} from '@/workspace/contracts';
import './filing-timeline.css';

/** Official metadata stays distinct from reviewed AI events. */
export function FilingTimeline({items,ticker,from,until}:{items:Resource[];ticker:string;from?:string;until?:string}){
 const {text:t,date}=usePrefs();
 const filings=items.filter(x=>x.kind==='filing'||x.kind==='document').filter(x=>(!from||!!x.published_at&&x.published_at.slice(0,10)>=from)&&(!until||!!x.published_at&&x.published_at.slice(0,10)<=until)).toSorted((a,b)=>(b.published_at??'').localeCompare(a.published_at??'')||a.id.localeCompare(b.id));
 return <section className="sb-filing-timeline" aria-label={t('공식 공시 이력','Official filing history')}><h2>{t('공식 공시 이력','Official filing history')}</h2><p>{t('수집된 원문 자료입니다. 검토된 AI 분석과 구분하여 표시합니다.','Collected source records, shown separately from reviewed AI analyses.')}</p>{filings.length?<ol>{filings.map(item=><li key={item.kind+item.id}><time dateTime={item.published_at??undefined}>{date(item.published_at,item.publication_precision)}</time><Link href={resourceHref(item)}>{item.title}</Link><small>{item.kind==='filing'?t('공시 원문','Official filing'):t('원문 문서','Source document')}</small></li>)}</ol>:<p>{t('선택한 기간에 수집된 공시가 없습니다. 기간을 넓히거나 전체 검색에서 확인하세요.','No collected filings in this range. Widen the period or search all records.')}</p>}<Link href={`/search?q=${encodeURIComponent(ticker)}&kind=document`}>{t('전체 공시 검색','Search all filings')} →</Link><p>{t('기업 상세에 연결된 최근 최대 20건을 표시합니다. 전체 이력은 검색에서 확인하세요.','Shows up to 20 recent records connected to this company. Use search for the full history.')}</p></section>;
}
