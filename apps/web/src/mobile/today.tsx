'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {useAuth} from '@/components/auth';
import {useResource} from '@/components/ui';
import {feedSchema,watchlistSchema,portfolioSchema,notificationsSchema} from '@/lib/contracts';
import {savedSchema} from '@/workspace/contracts';
import {useData} from '@/workspace/ui';
import {usePrefs} from '@/workspace/preferences';
import {ActionNotice,DateNote,EmptyState,LoadState,MIcon,MobileEventCard,SectionTitle} from './ui';
import './today.css';

export default function MobileToday(){
 const auth=useAuth(),{text:t,value}=usePrefs(),[all,setAll]=useState(false),[days,setDays]=useState(30),[offset,setOffset]=useState(0);
 const feed=useResource(`/v1/feed?days=${days}&limit=${all?12:4}&offset=${offset}`,feedSchema);
 const watch=useResource('/v1/watchlist',watchlistSchema),portfolio=useResource('/v1/portfolio',portfolioSchema),alerts=useResource('/v1/notifications',notificationsSchema),saved=useData({action:'saved_list',p:{kind:''}},savedSchema);
 const track=auth.track;
 useEffect(()=>{feed.data?.items.forEach(item=>track('brief_impression',{event_id:item.id}));},[feed.data,track]);
 const hour=Number(new Intl.DateTimeFormat('en-US',{timeZone:value.timezone,hour:'numeric',hourCycle:'h23'}).format(new Date()));
 const greeting=hour<12?t('좋은 아침이에요!','Good morning!'):hour<18?t('좋은 오후예요!','Good afternoon!'):t('좋은 저녁이에요!','Good evening!');
 const metrics=[
  {href:'/watchlist',icon:'star',label:t('관심종목','Watchlist'),count:watch.data?.items.length,detail:t('추적 중인 기업','Companies followed'),color:'blue'},
  {href:'/portfolio',icon:'pie',label:t('포트폴리오','Portfolio'),count:portfolio.data?.positions.length,detail:t('보유종목','Holdings'),color:'blue'},
  {href:'/saved',icon:'bookmark',label:t('저장한 항목','Saved'),count:saved.data?(saved.data.counts.event+saved.data.counts.document):undefined,detail:t('이벤트 · 문서','Events · documents'),color:'purple'},
  {href:'/alerts',icon:'bell',label:t('알림','Alerts'),count:alerts.data?.filter(a=>!a.read_at).length,detail:t('안 읽은 알림','Unread alerts'),color:'gold'},
 ];
 return <div className="m-today"><div className="m-today-heading"><div><p className="m-greeting">{auth.me?.display_name}{t('님, ',', ')}{greeting}</p><h1>{t('오늘의 변화','Today’s changes')} <span aria-hidden="true">☀️</span></h1><p className="m-today-description">{t('관심 종목에서 중요한 변화 ','Important changes in your stocks: ')}<b>{feed.data?.total??'—'}{t('건','')}</b>{t('이 있어요.','')}</p></div><DateNote message={<>{t('오늘도 현명한 한 걸음을','A clearer view,')}<br/>{t('응원합니다.','one day at a time.')}</>}/></div>
  <div className="m-market-strip" aria-label={t('시장 지수','Market indices')}>{[[t('코스피','KOSPI'),'pink'],[t('코스닥','KOSDAQ'),'pink'],[t('나스닥','NASDAQ'),'blue']].map(([name,color])=><Link key={name} className={`m-market-index ${color}`} href="/us"><strong>{name}</strong><b>—</b><span>{t('지수 시세 미연결','Index feed unavailable')}</span></Link>)}</div>
  <SectionTitle title={t('주요 변화','Important changes')} action={<button type="button" onClick={()=>{setAll(v=>!v);setOffset(0);}} aria-expanded={all}>{all?t('간단히 보기','Show less'):t('전체 보기','View all')}<MIcon name="chevron" size={15}/></button>}/>
  {all&&<div className="m-today-filters"><label className="m-field"><span>{t('조회 기간','Period')}</span><select aria-label={t('변화 조회 기간','Change date range')} value={days} onChange={e=>{setDays(Number(e.target.value));setOffset(0);}}><option value={7}>{t('최근 7일','Last 7 days')}</option><option value={30}>{t('최근 30일','Last 30 days')}</option><option value={90}>{t('최근 90일','Last 90 days')}</option></select></label><span className="m-muted">{feed.data?.total??'—'} {t('건','results')}</span></div>}
  <LoadState {...feed} retry={feed.reload}/>
  <div className="m-stack">{feed.data?.items.map(event=><MobileEventCard key={event.id} event={event}/>)}{feed.data&&!feed.loading&&!feed.data.items.length&&<EmptyState title={t('아직 새로운 변화가 없습니다','No new changes yet')} description={t('관심종목의 공시가 수집되고 검토되면 여기에 표시됩니다.','Reviewed changes from the companies you follow will appear here.')} href="/watchlist" label={t('관심종목 설정하기','Set up your watchlist')}/>}</div>
  {all&&feed.data&&feed.data.total>12&&<div className="m-pagination"><button className="m-button m-button-secondary" disabled={!offset} onClick={()=>setOffset(Math.max(0,offset-12))}>{t('이전','Previous')}</button><span>{Math.floor(offset/12)+1}</span><button className="m-button m-button-secondary" disabled={!feed.data.has_more} onClick={()=>setOffset(offset+12)}>{t('다음','Next')}</button></div>}
  {feed.data?.truncated&&<p className="m-notice">{t('기간을 좁히면 더 많은 결과를 확인할 수 있습니다.','Narrow the date range to see all results.')}</p>}
  <SectionTitle title={t('내 현황 한눈에','My overview')}/>
  <div className="m-overview-grid">{metrics.map(metric=><Link href={metric.href} className="m-card m-overview-tile" key={metric.href}><MIcon name={metric.icon} size={27} className={metric.color}/><div><span>{metric.label}<MIcon name="chevron" size={11}/></span><strong>{metric.count??'—'}<small>{t('개','')}</small></strong><p>{metric.detail}</p></div></Link>)}</div>
  {(watch.error||portfolio.error||alerts.error||saved.error)&&<ActionNotice action={{error:t('일부 현황을 불러오지 못했습니다. 해당 메뉴에서 다시 확인해 주세요.','Some totals could not be loaded. Open that section to retry.')}}/>}
  <Link className="m-today-alert-cta" href="/settings/notifications"><span className="m-cta-icon"><MIcon name="trend" size={24}/></span><div><strong>{t('시장의 중요한 변화를 놓치지 마세요.','Stay close to important changes.')}</strong><p>{t('관심종목 맞춤 알림으로 더 빠르게 확인하세요.','Set alerts for the companies you follow.')}</p></div><span className="m-cta-button">{t('알림 설정하기','Set alerts')}<MIcon name="chevron" size={13}/></span></Link>
  <nav className="m-home-more" aria-label={t('바로가기','Quick links')}>{[['/timeline','timeline',t('기업 타임라인','Timeline')],['/calendar','calendar',t('캘린더','Calendar')],['/saved','bookmark',t('저장 / 기록','Saved / history')],['/help','help',t('도움말 및 지원','Help & support')]].map(([href,icon,label])=><Link href={href} key={href}><MIcon name={icon} size={16}/>{label}<MIcon name="chevron" size={12}/></Link>)}</nav>
 </div>;
}
