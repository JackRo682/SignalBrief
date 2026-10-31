'use client';
import Link from 'next/link';
import {sourceOverviewSchema,resourceHref,safeSource,type Resource} from '@/workspace/contracts';
import {useData,DataState} from '@/workspace/ui';
import {usePrefs} from '@/workspace/preferences';
import './source-overview.css';

/** Filing metadata has its own visibility contract; it never publishes an AI draft. */
export function SourceOverview(){
 const state=useData({action:'source_overview',p:{}},sourceOverviewSchema),{text:t,date}=usePrefs();
 const data=state.data;
 function resource(item:Resource){return <li key={`${item.kind}:${item.id}`}><Link href={resourceHref(item)}><strong>{item.title}</strong><span>{item.ticker} · {item.published_at?date(item.published_at,item.publication_precision):t('날짜 미제공','Date unavailable')}</span></Link>{safeSource(item.source_url)&&<a href={safeSource(item.source_url)} target="_blank" rel="noopener noreferrer">{t('공식 원문','Official source')} ↗</a>}</li>;}
 return <section className="source-overview" aria-label={t('수집된 공식 자료','Collected official records')}>
  <header><h2>{t('수집된 공식 자료','Collected official records')}</h2><Link href="/search?kind=document">{t('공시 검색','Search filings')} ›</Link></header>
  <p>{t('공시 목록은 AI 분석 공개 여부와 별개입니다. 아래 과거 자료는 오늘의 변화나 현재 시세가 아닙니다.','Filing metadata is independent of AI publication. Historical records below are not today’s changes or current prices.')}</p>
  <DataState {...state} retry={state.reload}/>
  {data&&<><p className="source-overview-coverage">{t(`관심·보유 ${data.companies}개 기업 · 수집 공시 ${data.filing_count}건 · 공개 분석 ${data.published_count}건`,`Your ${data.companies} followed/held companies · ${data.filing_count} collected filings · ${data.published_count} published analyses`)}</p>
   {!data.companies&&<Link href="/watchlist">{t('관심종목을 추가하면 수집된 공시를 확인할 수 있습니다.','Add companies to see their collected filings.')}</Link>}
   {data.companies>0&&<div className="source-overview-columns">
    <section><h3>{t('최근 수집 공시','Collected filing history')}</h3><ul>{data.filings.map(resource)}</ul>{!data.filings.length&&<p>{t('이 기업들의 수집 공시가 없습니다.','No collected filings for these companies.')}</p>}</section>
    <section><h3>{t('최근 공개 분석 · 과거 자료 포함','Published analyses · includes history')}</h3><ul>{data.historical_events.map(resource)}</ul>{!data.historical_events.length&&<p>{t('아직 공개 요건을 통과한 분석이 없습니다. 원문 공시는 왼쪽 목록에서 확인하세요.','No analyses have passed publication checks. Filing metadata remains available in the filing list.')}</p>}
     <h3>{t('공식 일정 · 과거 및 다음 일정','Official calendar · historical and upcoming')}</h3><ul>{data.calendar.map(item=><li key={item.id}><Link href="/calendar"><strong>{item.title}</strong><span><time dateTime={item.occurs_on}>{date(item.occurs_on,'date')}</time>{item.source_timezone?` · ${item.source_timezone}`:''}</span></Link>{safeSource(item.source_url)&&<a href={safeSource(item.source_url)} target="_blank" rel="noopener noreferrer">{t('공식 원문','Official source')} ↗</a>}</li>)}</ul>{!data.calendar.length&&<p>{t('확인된 공식 일정이 없습니다.','No verified official dates.')}</p>}
    </section>
   </div>}
  </>}
 </section>;
}
