'use client';
import Link from 'next/link';
import {useState} from 'react';
import {usePrefs} from './preferences';
import {DataState,Empty,useData} from './ui';
import {safeSource,sourceOverviewSchema} from './contracts';
import MobileCalendar from '@/mobile/calendar-legacy';
import './monitoring.css';

export default function ResearchCalendar(){
  const {text:t,date}=usePrefs(),[scope,setScope]=useState<'all'|'following'>('all'),[history,setHistory]=useState(false),[personal,setPersonal]=useState(false);
  const content=useData({action:'source_overview',p:{scope,days:0}},sourceOverviewSchema);
  const records=history?content.data?.historical_calendar:content.data?.calendar;
  return <div className="sb-monitoring" data-screen="research-calendar"><header><div><h1>{t('캘린더','Calendar')}</h1><p>{t('공식 출처에서 날짜가 확인된 일정입니다.','Dates verified against official sources.')}</p></div></header>
    <div className="sb-monitor-toolbar"><label><span>{t('기업 범위','Company scope')}</span><select value={scope} onChange={event=>setScope(event.target.value as typeof scope)}><option value="all">{t('지원하는 모든 기업','All supported companies')}</option><option value="following">{t('팔로우한 기업','Following')}</option></select></label><div className="sb-monitor-tabs" role="group" aria-label={t('일정 기간','Calendar period')}><button aria-pressed={!history} onClick={()=>setHistory(false)}>{t('다가오는 일정','Upcoming')}</button><button aria-pressed={history} onClick={()=>setHistory(true)}>{t('지난 일정','Historical')}</button></div></div>
    <DataState {...content} retry={content.reload}/>{content.data?.fallback_to_all&&<p className="sb-monitor-status">{t('아직 팔로우한 기업이 없어 지원하는 모든 기업의 일정을 표시합니다.','You have no followed companies yet. Showing all supported companies.')}</p>}
    <div className="sb-monitor-calendar">{records?.map(item=><article className="sb-monitor-card" key={item.id}><time dateTime={item.occurs_on}>{date(item.occurs_on,'date')}</time><div><h3><Link href={`/companies/${item.company_id}?tab=events`}>{item.title}</Link></h3><small>{item.source_timezone??t('종일 일정','Date only')} · {t('확인일','Verified')} {date(item.verified_at)}</small>{safeSource(item.source_url)&&<a href={safeSource(item.source_url)} target="_blank" rel="noopener noreferrer">{t('공식 출처','Official source')} ↗</a>}</div></article>)}</div>
    {content.data&&!records?.length&&!content.error&&<Empty title={history?t('확인된 지난 일정이 없습니다.','No verified historical dates.'):t('확인된 예정 일정이 없습니다.','No verified upcoming dates.')} description={t('공식 출처에 날짜가 확인되면 표시됩니다.','Dates appear when they can be verified in official sources.')}/>}
    <section className="sb-monitor-card"><button className="sb-monitor-button" aria-expanded={personal} onClick={()=>setPersonal(value=>!value)}>{t('내 일정 · 월간 보기 · 내보내기','My dates · month view · export')} {personal?'−':'+'}</button>{personal&&<div className="sb-mobile sb-personal-calendar"><MobileCalendar/></div>}</section>
  </div>;
}
