'use client';
import Link from 'next/link';
import {useState} from 'react';
import {sourceOverviewSchema} from '@/workspace/contracts';
import {useData,DataState} from '@/workspace/ui';
import {usePrefs} from '@/workspace/preferences';
import {ResearchResources,VerifiedCalendar} from '@/components/research-resources';
import './research-workspace.css';

/** Source records and approved analyses stay distinct, with their original dates. */
export function SourceOverview({onSaved}:{onSaved?:()=>void}){
 const {text:t}=usePrefs(),[scope,setScope]=useState<'all'|'following'>('following'),[days,setDays]=useState(0);
 const state=useData({action:'source_overview',p:{scope,days}},sourceOverviewSchema),data=state.data;
 const effectiveScope=data?.scope??scope;
 return <div className="rw-source-overview" aria-label={t('공식 자료와 승인된 분석','Official sources and approved analyses')}>
  <div className="rw-controls"><div className="rw-scope" role="group" aria-label={t('기업 범위','Company scope')}>
   <button type="button" aria-pressed={effectiveScope==='following'} disabled={!!data&&data.following_count===0} onClick={()=>setScope('following')}>{t('관심 기업','Following')}</button>
   <button type="button" aria-pressed={effectiveScope==='all'} onClick={()=>setScope('all')}>{t('전체 지원 기업','All supported companies')}</button>
  </div><label className="rw-range">{t('원문 공시 기간','Source date range')}<select value={days} onChange={e=>setDays(Number(e.target.value))}><option value={0}>{t('전체 기간 · 과거 자료 포함','All dates · includes history')}</option><option value={30}>{t('최근 30일','Last 30 days')}</option><option value={90}>{t('최근 90일','Last 90 days')}</option><option value={365}>{t('최근 1년','Last year')}</option></select></label></div>
  <DataState {...state} retry={state.reload}/>
  {data?.fallback_to_all&&<p className="rw-fallback">{t('아직 관심 기업이 없어 전체 지원 기업의 자료를 보여드립니다.','You are viewing all supported companies because you have not followed any yet.')} <Link href="/explore">{t('관심 기업 찾기','Find companies to follow')} →</Link></p>}
  {data&&<><p className="rw-note">{t(`${data.companies}개 기업 · 공시 ${data.filing_count}건 · 공개 분석 ${data.published_count}건`,`${data.companies} companies · ${data.filing_count} collected disclosures · ${data.published_count} published analyses`)} · {t('공시일과 분석 승인일을 구분해 표시합니다.','Source dates and review dates are shown separately.')}</p>
   <section className="rw-section" id="disclosures"><header className="rw-section-header"><h2>{t('최근 수집 공시','Recent disclosures')}</h2><Link href="/search?kind=document">{t('전체 공시 검색','Search all disclosures')} →</Link></header><p className="rw-section-description">{t('선택한 범위에서 수집된 최신 공식 자료입니다. 날짜를 확인하고 원문을 열어보세요.','The latest collected source records in this scope. Check the source date and open the original document.')}</p><ResearchResources items={data.filings} empty={t('선택한 기간에 수집된 공시가 없습니다. 기간을 넓혀 확인하세요.','No disclosures were collected in this date range. Try a wider period.')} onSaved={onSaved}/></section>
   <section className="rw-section" id="changes"><header className="rw-section-header"><h2>{t('최근 승인된 분석','Latest approved analyses')}</h2><Link href="/search?kind=analysis">{t('전체 분석 검색','Search all analyses')} →</Link></header><p className="rw-section-description">{t('검토를 통과한 원문 발췌 요약입니다. 전체 문서의 분석을 의미하지 않습니다.','Reviewed summaries of source excerpts. Coverage is limited to the identified part of each document.')}</p><ResearchResources items={data.analyses} empty={t('이 범위에는 아직 승인된 발췌 요약이 없습니다. 위 공시 목록에서 공식 원문을 확인하세요.','No approved excerpt summaries are available in this scope yet. Official disclosures remain available above.')} onSaved={onSaved}/>
    {data.historical_events.length>0&&<details><summary>{t('게시된 변화 분석도 보기','Also view published event analyses')} ({data.historical_events.length})</summary><ResearchResources items={data.historical_events} empty="" onSaved={onSaved}/></details>}
   </section>
   <section className="rw-section"><header className="rw-section-header"><h2>{t('확인된 예정 일정','Upcoming verified events')}</h2><Link href="/calendar">{t('캘린더','Calendar')} →</Link></header><VerifiedCalendar items={data.calendar} empty={t('공식 출처로 확인된 예정 일정이 없습니다.','No upcoming dates have been verified from official sources.')}/>
    {data.historical_calendar.length>0&&<details><summary>{t('지난 공식 일정','Historical official events')} ({data.historical_calendar.length})</summary><VerifiedCalendar items={data.historical_calendar} empty=""/></details>}
   </section>
  </>}
 </div>;
}
