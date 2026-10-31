'use client';
import {useState} from 'react';
import {calendarSchema} from '@/lib/contracts';
import {useResource} from '@/components/ui';
import {usePrefs} from '@/workspace/preferences';
import {safeSource} from '@/workspace/contracts';
import './filing-timeline.css';
export function CalendarRange(){
 const {text:t,value}=usePrefs(),[days,setDays]=useState(30),[today]=useState(()=>new Intl.DateTimeFormat('en-CA',{timeZone:value.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()));
 const until=new Date(Date.parse(today+'T00:00:00Z')+(days-1)*86400000).toISOString().slice(0,10),result=useResource(`/v1/calendar?from_date=${today}&until_date=${until}`,calendarSchema);
 return <section className="sb-filing-timeline"><h2>{t('다가오는 확인 일정','Confirmed upcoming dates')}</h2><label>{t('조회 기간','Date range')} <select value={days} onChange={e=>setDays(Number(e.target.value))}>{[30,90,365].map(n=><option key={n} value={n}>{n===365?t('1년','1 year'):`${n} ${t('일','days')}`}</option>)}</select></label><p>{today} – {until}</p>{result.loading?<p role="status">{t('불러오는 중…','Loading…')}</p>:result.error?<p role="alert">{result.error} <button onClick={result.reload}>{t('다시 시도','Retry')}</button></p>:result.data?.length?<ol>{result.data.map(item=><li key={item.id}><time>{item.occurs_on}</time><span>{item.title}</span>{safeSource(item.source_url)&&<a href={safeSource(item.source_url)} target="_blank" rel="noopener noreferrer">{t('공식 원문','Official source')}</a>}</li>)}</ol>:<p>{t('선택한 기간에 확인된 일정이 없습니다. 다른 기간을 선택하세요.','No confirmed dates in this period. Try a wider range.')}</p>}{result.data?.length===500&&<p>{t('최대 500건입니다. 기간을 줄여 확인하세요.','Limit of 500 reached. Narrow the date range.')}</p>}</section>;
}
