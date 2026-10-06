'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {useRouter} from 'next/navigation';
import {useResource} from '@/components/ui';
import {eventsSchema} from '@/lib/contracts';
import {usePrefs} from '@/workspace/preferences';
import {useData} from '@/workspace/ui';
import {catalogSchema,companyDetailSchema,safeSource,type Resource} from '@/workspace/contracts';
import {useQuotes} from '@/workspace/market';
import {CompanyLogo,EmptyState,LoadState,MIcon,SmallChart,eventLabel,formatMoney} from './ui';
import './research.css';

export default function MobileTimeline({id}:{id?:string}){
 return <TimelineContent key={id??'company-picker'} id={id}/>;
}
function TimelineContent({id}:{id?:string}){
 const router=useRouter(),{text:t}=usePrefs(),[query,setQuery]=useState(''),[search,setSearch]=useState(''),[days,setDays]=useState(180);
 useEffect(()=>{const timer=setTimeout(()=>setSearch(query.trim()),250);return()=>clearTimeout(timer);},[query]);
 // The catalog shares Discover's supported-company scope and Korean aliases.
 const catalog=useData({action:'catalog',p:{q:search,kind:'company',limit:50}},catalogSchema);
 const company=useData(id?{action:'company',p:{id}}:null,companyDetailSchema);
 const stock=company.data?.company,companies=catalog.data?.items??[];
 return <div className="m-timeline"><header className="m-page-heading"><h1>{t('기업 타임라인','Company timeline')}</h1><p>{t('기업의 주요 변화를 시간의 흐름에 따라 확인하세요.','Follow a company’s changes over time.')}</p></header>
  <label className="m-field"><span>{t('기업명 또는 종목코드 검색','Search company or ticker')}</span><input value={query} maxLength={100} onChange={e=>setQuery(e.target.value)} placeholder={t('기업을 검색하세요.','Search companies')}/></label>
  <LoadState {...catalog} retry={catalog.reload}/>
  <label className="m-field"><span>{t('타임라인 기업 선택','Timeline company')}</span><select value={id??''} disabled={catalog.loading} onChange={e=>router.push(e.target.value?`/companies/${encodeURIComponent(e.target.value)}/timeline`:'/timeline')}><option value="">{t('기업 선택','Choose a company')}</option>{id&&!companies.some(c=>c.id===id)&&<option value={id}>{stock?`${stock.title} · ${stock.ticker}`:t('선택한 기업','Selected company')}</option>}{companies.map(c=><option value={c.id} key={c.id}>{c.title} · {c.ticker}</option>)}</select></label>
  {catalog.data?.next_offset!==null&&catalog.data?.next_offset!==undefined&&<p className="m-note">{t('검색 결과 중 50개 기업을 표시합니다. 기업명이나 종목코드로 범위를 좁혀 주세요.','Showing 50 matching companies. Refine by company name or ticker.')}</p>}
  {!id?<EmptyState title={t('변화를 확인할 기업을 선택하세요','Choose a company to follow')} description={t('공식 자료를 바탕으로 게시된 이벤트가 날짜순으로 표시됩니다.','Published events based on official sources appear in date order.')}/>:<>
   <LoadState {...company} retry={company.reload}/>{stock&&<TimelineCompany key={`${id}:${days}`} stock={stock} days={days}/>}
   <TimelineEvents key={`${id}:${days}`} id={id} days={days} onDaysChange={setDays}/>
  </>}
 </div>;
}
function TimelineCompany({stock,days}:{stock:Resource;days:number}){
 const {text:t,value,date}=usePrefs(),market=useQuotes([stock.ticker],days<=90?'3m':days<=180?'6m':days<=365?'1y':'3y'),quote=market.quotes.find(q=>q.symbol===stock.ticker);
 return <section className="m-card m-timeline-company"><div><CompanyLogo ticker={stock.ticker} size={43}/><Link href={`/companies/${stock.id}`}><strong>{stock.title}</strong><small>{stock.ticker} · {stock.market}</small></Link><Link href={`/companies/${stock.id}`} className="m-icon-button" aria-label={t('기업 개요','Company overview')}><MIcon name="chevron"/></Link></div><div className="m-timeline-quote"><strong>{formatMoney(quote?.price,quote?.currency,value.locale)}</strong><SmallChart values={quote?.history.map(x=>x.close)??[]}/></div><p className="m-note">{quote?`${quote.source} · ${date(quote.as_of)}`:market.loading?t('시세를 불러오는 중입니다.','Loading quotes.'):t('연결된 시세가 없습니다.','Quote data is unavailable.')}</p>{quote&&days>365&&<p className="m-note">{t('가격 차트는 공급자가 제공하는 최대 1년의 일별 종가입니다.','The price chart contains up to one year of provider daily closing prices.')}</p>}</section>;
}
function TimelineEvents({id,days,onDaysChange}:{id:string;days:number;onDaysChange:(days:number)=>void}){
 const {text:t,value,date}=usePrefs(),[type,setType]=useState(''),[cutoff]=useState(()=>Date.now()-days*86400000);
 const timeline=useResource(`/v1/companies/${encodeURIComponent(id)}/timeline?days=${days}&limit=100`,eventsSchema);
 // The local API may return a wider range. Keep the selected window truthful
 // without converting date-only evidence into a different publication date.
 const items=(timeline.data??[]).filter(event=>event.company.id===id&&Date.parse(event.published_at)>=cutoff);
 const types=[...new Set(items.map(event=>event.event_type))],activeType=types.includes(type)?type:'',events=items.filter(event=>!activeType||event.event_type===activeType);
 return <><div className="m-timeline-filters"><label className="m-field"><span>{t('기간','Period')}</span><select value={days} onChange={e=>onDaysChange(Number(e.target.value))}>{[[90,'3개월','3 months'],[180,'6개월','6 months'],[365,'1년','1 year'],[1095,'3년','3 years']].map(([n,ko,en])=><option value={n} key={n}>{t(String(ko),String(en))}</option>)}</select></label><label className="m-field"><span>{t('이벤트 유형','Event type')}</span><select value={activeType} onChange={e=>setType(e.target.value)}><option value="">{t('전체 유형','All types')}</option>{types.map(item=><option key={item} value={item}>{eventLabel(item,value.locale)}</option>)}</select></label></div>
  <LoadState {...timeline} retry={timeline.reload}/>{!timeline.loading&&!timeline.error&&!events.length&&<EmptyState title={t('선택한 범위에 게시된 변화가 없습니다','No published changes in this range')} description={t('기간이나 이벤트 유형을 변경해 보세요.','Try another period or event type.')}/>}
  <div className="m-timeline-list">{events.map(event=><article className="m-timeline-item" key={event.id}><time dateTime={event.published_at}>{date(event.published_at,event.publication_precision)}</time><div className="m-card"><span className="m-pill">{eventLabel(event.event_type,value.locale)}</span><Link href={`/events/${event.id}`}><h2>{event.headline}</h2></Link><p>{event.fact_summary||event.what_happened}</p>{event.change_summary.length>0&&<dl>{event.change_summary.slice(0,3).map((change,i)=><div key={`${change.field}-${i}`}><dt>{change.field}</dt><dd><span>{change.previous_value??t('이전 근거 없음','No prior evidence')}</span><MIcon name="arrow" size={14}/><strong>{change.current_value??t('현재 근거 없음','No current evidence')}</strong></dd></div>)}</dl>}<footer><Link href={`/events/${event.id}`}>{t('이벤트 상세','Event details')}<MIcon name="chevron" size={14}/></Link>{safeSource(event.source_url)&&<a href={safeSource(event.source_url)} target="_blank" rel="noopener noreferrer">{event.source_provider.toUpperCase()}<MIcon name="external" size={13}/></a>}</footer></div></article>)}</div>
  {timeline.data?.length===100&&<p className="m-notice">{t('최근 100개 이벤트를 표시합니다. 기간을 좁혀 확인하세요.','Showing the latest 100 events. Narrow the period to refine the list.')}</p>}
 </>;
}
