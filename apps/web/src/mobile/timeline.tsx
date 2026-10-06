'use client';
import Link from 'next/link';
import {useEffect,useId,useState} from 'react';
import {useRouter} from 'next/navigation';
import {useAuth} from '@/components/auth';
import {useResource} from '@/components/ui';
import {request,body,emptySchema} from '@/lib/api';
import {eventsSchema,type EventCard} from '@/lib/contracts';
import {usePrefs} from '@/workspace/preferences';
import {useData,useMutation} from '@/workspace/ui';
import {catalogSchema,companyDetailSchema,safeSource,type Resource} from '@/workspace/contracts';
import {useQuotes} from '@/workspace/market';
import {ActionNotice,CompanyLogo,EmptyState,LoadState,MIcon,eventLabel,formatMoney} from './ui';
import './research.css';

export default function MobileTimeline({id}:{id?:string}){
 return <TimelineContent key={id??'company-picker'} id={id}/>;
}
function TimelineContent({id}:{id?:string}){
 const router=useRouter(),{text:t}=usePrefs(),[query,setQuery]=useState(''),[search,setSearch]=useState(''),[days,setDays]=useState(180);
 useEffect(()=>{const timer=setTimeout(()=>setSearch(query.trim()),250);return()=>clearTimeout(timer);},[query]);
 const catalog=useData(!id?{action:'catalog',p:{q:search,kind:'company',limit:50}}:null,catalogSchema);
 const company=useData(id?{action:'company',p:{id}}:null,companyDetailSchema),stock=company.data?.company,companies=catalog.data?.items??[];
 return <div className="m-timeline"><h1 className="m-research-sr">{t('기업 타임라인','Company timeline')}</h1>
  {!id?<><p className="m-timeline-intro">{t('기업의 주요 변화를 시간의 흐름에 따라 확인하세요.','Follow a company’s changes over time.')}</p><label className="m-field"><span>{t('기업명 또는 종목코드 검색','Search company or ticker')}</span><input value={query} maxLength={100} onChange={e=>setQuery(e.target.value)} placeholder={t('기업을 검색하세요.','Search companies')}/></label><LoadState {...catalog} retry={catalog.reload}/><label className="m-field"><span>{t('타임라인 기업 선택','Timeline company')}</span><select value="" disabled={catalog.loading} onChange={e=>router.push(e.target.value?`/companies/${encodeURIComponent(e.target.value)}/timeline`:'/timeline')}><option value="">{t('기업 선택','Choose a company')}</option>{companies.map(c=><option value={c.id} key={c.id}>{c.title} · {c.ticker}</option>)}</select></label>{catalog.data?.next_offset!==null&&catalog.data?.next_offset!==undefined&&<p className="m-note">{t('검색 결과 중 50개 기업을 표시합니다. 기업명이나 종목코드로 범위를 좁혀 주세요.','Showing 50 matching companies. Refine by company name or ticker.')}</p>}<EmptyState title={t('변화를 확인할 기업을 선택하세요','Choose a company to follow')} description={t('공식 자료를 바탕으로 게시된 이벤트가 날짜순으로 표시됩니다.','Published events based on official sources appear in date order.')}/></>:<>
   <LoadState {...company} retry={company.reload}/>{stock&&company.data&&<TimelineCompany key={id} stock={stock} watching={company.data.watching} onChanged={company.reload}/>}
   <TimelineEvents key={`${id}:${days}`} id={id} days={days} onDaysChange={setDays}/>
  </>}
 </div>;
}
function TimelineCompany({stock,watching,onChanged}:{stock:Resource;watching:boolean;onChanged:()=>void}){
 const {token}=useAuth(),{text:t,value,date}=usePrefs(),action=useMutation(),market=useQuotes([stock.ticker],'1m'),quote=market.quotes.find(q=>q.symbol===stock.ticker);
 return <><section className="m-timeline-company"><CompanyLogo ticker={stock.ticker} size={61}/><div className="m-timeline-company-body"><Link className="m-timeline-company-name" href={`/companies/${stock.id}`}><strong>{stock.title}</strong><span>{stock.ticker}</span><span className="m-research-sr"> · {stock.market}</span></Link><span className="m-timeline-market">{stock.market}<i/> {t('현재가','Current price')}</span><div className="m-timeline-quote"><strong>{formatMoney(quote?.price,quote?.currency,value.locale)}</strong>{quote?.change_pct!=null&&<span className={quote.change_pct<0?'m-down':'m-up'}>{quote.change_pct<0?'▼':'▲'} {quote.change_pct>0?'+':''}{quote.change_pct.toFixed(2)}%</span>}</div></div><button className="m-button m-button-secondary" type="button" disabled={action.busy} aria-pressed={watching} onClick={()=>void action.run(async()=>{await request(`/v1/watchlist/${encodeURIComponent(stock.id)}`,token,emptySchema,body(watching?'DELETE':'PUT'));onChanged();})}><MIcon name={watching?'check':'plus'} size={21}/>{watching?t('관심종목 등록됨','Watching'):t('관심종목','Watchlist')}</button></section><ActionNotice action={action}/><details className="m-timeline-quote-source"><summary>{t('시세 기준','Quote source')}</summary><p>{quote?`${quote.source} · ${date(quote.as_of)}`:market.loading?t('시세를 불러오는 중입니다.','Loading quotes.'):t('연결된 시세가 없습니다.','Quote data is unavailable.')}</p></details></>;
}
function eventGlyph(type:string){
 if(type==='earnings')return <svg viewBox="0 0 32 32" fill="currentColor" aria-hidden="true"><rect x="5" y="19" width="5" height="9" rx="2"/><rect x="14" y="11" width="5" height="17" rx="2"/><rect x="23" y="4" width="5" height="24" rx="2"/></svg>;
 if(['product','supply','capex'].includes(type))return <MIcon name="chip" size={28}/>;
 if(['contract','partnership','business'].includes(type))return <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m3 12 5-6 6 3 6-3 9 9-6 12-4 1-9-9-4-1Z"/><path d="m14 9-4 7 3 2 5-4 9 9M14 22l3-3M18 26l3-4M2 11l4 2M25 7l5 6"/></svg>;
 if(['regulation','regulatory','capital'].includes(type))return <MIcon name="trend" size={29}/>;
 return <MIcon name="file" size={28}/>;
}
function TimelineDate({event}:{event:EventCard}){
 const {value,date}=usePrefs(),stamp=new Date(event.published_at),valid=Number.isFinite(stamp.getTime());
 const parts=valid?new Intl.DateTimeFormat(value.locale,{year:'numeric',month:value.locale==='ko'?'long':'short',day:'numeric',timeZone:['date','date_only'].includes(event.publication_precision)?'UTC':value.timezone}).formatToParts(stamp):[];
 const year=parts.find(p=>p.type==='year')?.value,month=parts.find(p=>p.type==='month')?.value,day=parts.find(p=>p.type==='day')?.value;
 return <time dateTime={event.published_at} title={date(event.published_at,event.publication_precision)}>{valid?<><span>{year}{value.locale==='ko'?'년':''}</span><strong>{month} {day}{value.locale==='ko'?'일':''}</strong></>:<span>{date(event.published_at,event.publication_precision)}</span>}</time>;
}
function TimelineEvents({id,days,onDaysChange}:{id:string;days:number;onDaysChange:(days:number)=>void}){
 const {text:t,value}=usePrefs(),[type,setType]=useState(''),[cutoff]=useState(()=>Date.now()-days*86400000),[showInsights,setShowInsights]=useState(false),periodLabelId=useId();
 const timeline=useResource(`/v1/companies/${encodeURIComponent(id)}/timeline?days=${days}&limit=100`,eventsSchema);
 const items=(timeline.data??[]).filter(event=>event.company.id===id&&Date.parse(event.published_at)>=cutoff).sort((a,b)=>Date.parse(b.published_at)-Date.parse(a.published_at)||a.id.localeCompare(b.id));
 const types=[...new Set(items.map(event=>event.event_type))],activeType=types.includes(type)?type:'',events=items.filter(event=>!activeType||event.event_type===activeType),insights=events.filter(event=>!!event.interpretation);
 return <><div className="m-timeline-filters"><div className="m-timeline-type-tabs" role="group" aria-label={t('이벤트 유형','Event type')}><button type="button" aria-pressed={!activeType} onClick={()=>setType('')}>{t('전체','All')} ({items.length})</button>{types.map(item=><button type="button" key={item} aria-pressed={activeType===item} onClick={()=>setType(item)}>{eventLabel(item,value.locale)} ({items.filter(event=>event.event_type===item).length})</button>)}</div><label className="m-timeline-period-control" title={t('기간 선택','Choose period')}><MIcon name="filter" size={22}/><span id={periodLabelId} className="m-research-sr">{t('기간','Period')}</span><select aria-labelledby={periodLabelId} value={days} onChange={e=>onDaysChange(Number(e.target.value))}>{[[90,'3개월','3 months'],[180,'6개월','6 months'],[365,'1년','1 year'],[1095,'3년','3 years']].map(([n,ko,en])=><option value={n} key={n}>{t(String(ko),String(en))}</option>)}</select></label></div>
  <LoadState {...timeline} retry={timeline.reload}/>{!timeline.loading&&!timeline.error&&!events.length&&<EmptyState title={t('선택한 범위에 게시된 변화가 없습니다','No published changes in this range')} description={t('기간이나 이벤트 유형을 변경해 보세요.','Try another period or event type.')}/>}
  <div className="m-timeline-list">{events.map(event=><article className="m-timeline-item" key={event.id}><TimelineDate event={event}/><div className={`m-card m-timeline-event m-timeline-tone-${event.event_type}`}><span className="m-timeline-glyph">{eventGlyph(event.event_type)}</span><div className="m-timeline-event-body"><span className="m-pill">{eventLabel(event.event_type,value.locale)}</span><Link className="m-timeline-event-link" href={`/events/${event.id}`}><h2>{event.headline}</h2><MIcon name="chevron" size={18}/></Link><p>{event.fact_summary||event.what_happened}</p><footer>{safeSource(event.source_url)&&<a href={safeSource(event.source_url)} target="_blank" rel="noopener noreferrer">{event.source_provider.toUpperCase()}<MIcon name="external" size={11}/></a>}</footer></div></div></article>)}</div>
  {timeline.data?.length===100&&<p className="m-notice">{t('최근 100개 이벤트를 표시합니다. 기간을 좁혀 확인하세요.','Showing the latest 100 events. Narrow the period to refine the list.')}</p>}
  {events.length>0&&<aside className="m-timeline-insights"><span className="m-timeline-insight-icon"><MIcon name="spark" size={26}/></span><div><div className="m-timeline-insight-heading"><h2>{t('타임라인에서 확인한 변화','Changes in this timeline')}</h2><button type="button" aria-expanded={showInsights} onClick={()=>setShowInsights(open=>!open)}>{showInsights?t('요약 닫기','Close summary'):t('분석 근거 보기','View analysis')}<MIcon name="chevron" size={13}/></button></div><ol>{events.slice(0,2).map(event=><li key={event.id}><Link href={`/events/${event.id}`}>{event.headline}</Link></li>)}</ol>{showInsights&&<div className="m-timeline-reviewed">{insights.length?insights.map(event=><section key={event.id}><Link href={`/events/${event.id}`}><strong>{event.headline}</strong></Link><p>{event.interpretation}</p><Link href={`/events/${event.id}?panel=evidence`}>{t('원문과 분석 근거','Sources and analysis evidence')}<MIcon name="chevron" size={13}/></Link></section>):<p>{t('선택한 이벤트에 게시된 분석이 없습니다. 이벤트 상세에서 원문 사실을 확인하세요.','No published interpretation is available for these events. Review the sourced facts in event details.')}</p>}</div>}</div></aside>}
 </>;
}
