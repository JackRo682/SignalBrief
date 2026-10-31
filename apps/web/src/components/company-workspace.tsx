'use client';
import Link from 'next/link';
import {useEffect,useState,type KeyboardEvent} from 'react';
import {z} from 'zod';
import {useAuth} from '@/components/auth';
import {Icon} from '@/components/icons';
import CompanyProfile from '@/components/company-profile';
import {SourcedBusinessProfile} from '@/components/sourced-business-profile';
import {companyBusinessProfiles} from '@/lib/company-business-profiles';
import {CompanyNews} from '@/components/company-news';
import {ResearchResources,VerifiedCalendar} from '@/components/research-resources';
import {body,emptySchema,request} from '@/lib/api';
import {decimalInput} from '@/lib/decimal-input';
import {workspace} from '@/workspace/client';
import {companyDetailSchema,sourceOverviewSchema} from '@/workspace/contracts';
import {usePrefs} from '@/workspace/preferences';
import {useData,useMutation,DataState,Notice} from '@/workspace/ui';
import './research-workspace.css';

const tabs=[['overview','개요','Overview'],['disclosures','공시','Disclosures'],['analyses','분석','Analyses'],['news','뉴스','News'],['events','일정','Events']] as const;
type Tab=typeof tabs[number][0];
const fieldNames:Record<string,[string,string]>={revenue:['매출','Revenue'],sales:['매출','Sales'],operating_income:['영업이익','Operating income'],operating_profit:['영업이익','Operating profit'],net_income:['순이익','Net income'],eps:['주당순이익','Earnings per share'],capex:['설비투자','Capital expenditure'],dividend:['배당','Dividend']};
function exact(raw:string){const n=decimalInput(raw);if(!/^[+-]?\d+(\.\d+)?$/.test(n))return raw;const [integer,fraction]=n.split('.');return integer.replace(/\B(?=(\d{3})+(?!\d))/g,',')+(fraction===undefined?'':`.${fraction}`);}
export function CompanyWorkspace({id}:{id:string}){
 const {token}=useAuth(),{text:t,value}=usePrefs(),result=useData({action:'company',p:{id}},companyDetailSchema),action=useMutation(),[tab,setTab]=useState<Tab>('overview');
 const data=result.data,company=data?.company;
 const source=useData(tab==='events'?{action:'source_overview',p:{scope:'all',company_id:id,days:0}}:null,sourceOverviewSchema);
 useEffect(()=>{const requested=new URLSearchParams(window.location.search).get('tab');setTab(tabs.some(([key])=>key===requested)?requested as Tab:'overview');},[id]);
 useEffect(()=>{if(value.history_enabled&&token&&company?.id)void workspace(token,{action:'visit',p:{kind:'company',id:company.id}},z.unknown()).catch(()=>{});},[value.history_enabled,token,company?.id]);
 const changeTab=(next:Tab)=>{setTab(next);const url=new URL(window.location.href);url.searchParams.set('tab',next);window.history.replaceState(window.history.state,'',`${url.pathname}${url.search}${url.hash}`);};
 function keyboard(event:KeyboardEvent<HTMLButtonElement>,index:number){if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const target=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;changeTab(tabs[target][0]);document.getElementById(`company-tab-${id}-${tabs[target][0]}`)?.focus();}
 const facts=data?.facts.filter(fact=>fact.value_raw!==null&&!!fact.unit&&!!fact.period&&!!fact.basis&&!!fact.quote)??[];
 return <div className="rw-page" data-testid="company-workspace"><nav className="rw-crumbs" aria-label={t('현재 위치','Breadcrumb')}><Link href="/explore">{t('기업','Companies')}</Link><span>›</span><span>{company?.company_name??t('기업 개요','Company overview')}</span></nav><DataState {...result} retry={result.reload}/><Notice action={action}/>
  {data&&company&&<><header className="rw-company-hero"><span className="rw-company-mark" aria-hidden="true">{company.ticker}</span><div className="rw-company-identity"><h1>{company.company_name}</h1><p>{company.ticker} · {company.market}</p><p>{t('공식 공시와 검토된 근거로 연결되는 기업 정보','Company information connected to official disclosures and reviewed evidence')}</p></div><button type="button" className="rw-button rw-button-secondary" disabled={action.busy} aria-pressed={data.watching} onClick={()=>void action.run(async()=>{await request(`/v1/watchlist/${encodeURIComponent(id)}`,token,emptySchema,body(data.watching?'DELETE':'PUT'));result.reload();},data.watching?t('관심 기업에서 삭제했습니다.','Company unfollowed.'):t('관심 기업에 추가했습니다.','Company followed.'))}><Icon name="star" size={17}/>{data.watching?t('관심 기업 · 등록됨','Following'):t('관심 기업 추가','Follow company')}</button></header>
   <nav className="rw-company-tabs" role="tablist" aria-label={t('기업 정보','Company information')}>{tabs.map(([key,ko,en],index)=><button key={key} id={`company-tab-${id}-${key}`} type="button" role="tab" aria-selected={tab===key} aria-controls={`company-panel-${id}-${key}`} tabIndex={tab===key?0:-1} onKeyDown={event=>keyboard(event,index)} onClick={()=>changeTab(key)}>{t(ko,en)}</button>)}</nav>
   <div role="tabpanel" id={`company-panel-${id}-${tab}`} aria-labelledby={`company-tab-${id}-${tab}`}>
    {tab==='overview'&&<><SourcedBusinessProfile ticker={company.ticker}/><CompanyProfile id={id} ticker={company.ticker} hideUnavailable={!!companyBusinessProfiles[company.ticker.toUpperCase()]}/><section className="rw-section"><header className="rw-section-header"><h2>{t('원문에서 확인된 수치','Verified source facts')}</h2></header><p className="rw-section-description">{t('기간, 단위, 회계 기준과 인용 근거가 있는 공개 수치만 표시합니다.','Only published figures with a reporting period, unit, accounting basis and supporting quotation are shown.')}</p>{facts.length?<div className="rw-facts">{facts.map(fact=><article className="rw-fact" key={fact.id}><h3>{fieldNames[fact.field]?t(...fieldNames[fact.field]):fact.field}</h3><strong>{exact(fact.value_raw!)} {fact.unit}</strong><p>{fact.period} · {fact.basis}</p><details><summary>{t('원문 근거','Source evidence')}</summary><blockquote>{fact.quote}</blockquote><Link href={`/events/${encodeURIComponent(fact.event_id)}?panel=evidence`}>{t('연결된 분석과 출처','Open supporting analysis and source')} →</Link></details></article>)}</div>:<p className="rw-empty">{t('표시 요건을 충족한 검토 수치가 아직 없습니다. 공시 탭에서 원문을 확인하세요.','No reviewed figures meet the display requirements yet. Open the Disclosures tab to read the source.')}</p>}</section><section className="rw-section"><header className="rw-section-header"><h2>{t('최근 공시','Recent disclosures')}</h2><button type="button" className="rw-save" onClick={()=>changeTab('disclosures')}>{t('공시 전체 보기','View disclosures')}</button></header><ResearchResources items={data.documents.slice(0,3)} empty={t('아직 수집된 공시가 없습니다.','No disclosures have been collected yet.')}/></section></>}
    {tab==='disclosures'&&<section className="rw-section"><header className="rw-section-header"><h2>{t('공식 공시','Official disclosures')}</h2><Link href={`/search?kind=document&company_id=${encodeURIComponent(id)}`}>{t('전체 이력 검색','Search full history')} →</Link></header><p className="rw-section-description">{t('최근 연결된 원문 자료입니다. 분석 대기 상태와 관계없이 원문을 열 수 있습니다.','Recently connected source records. Original documents remain available while analysis is pending.')}</p><ResearchResources items={data.documents} empty={t('이 기업의 공시가 아직 수집되지 않았습니다. 기업 등록과 문서 수집은 별개입니다.','No disclosures have been collected for this company yet. A directory entry does not imply collected coverage.')}/></section>}
    {tab==='analyses'&&<><section className="rw-section"><header className="rw-section-header"><h2>{t('승인된 발췌 요약','Approved excerpt summaries')}</h2><Link href={`/search?kind=analysis&company_id=${encodeURIComponent(id)}`}>{t('분석 검색','Search analyses')} →</Link></header><p className="rw-section-description">{t('승인된 원문 일부의 요약입니다. 인용문과 원문 링크를 함께 확인하세요.','Approved summaries of source excerpts. Open each summary to inspect its quotations and source link.')}</p><ResearchResources items={data.analyses} empty={t('아직 승인된 요약이 없습니다. 검토 대기 분석은 공개되지 않습니다.','No approved summaries are available. Analyses awaiting review are not published.')}/></section>{data.events.length>0&&<section className="rw-section"><header className="rw-section-header"><h2>{t('게시된 변화 분석','Published event analyses')}</h2></header><ResearchResources items={data.events} empty=""/></section>}</>}
    {tab==='news'&&<section className="rw-section"><header className="rw-section-header"><h2>{t('기업 관련 뉴스','Related company news')}</h2></header><CompanyNews companyId={id} companyName={company.company_name}/></section>}
    {tab==='events'&&<section className="rw-section"><header className="rw-section-header"><h2>{t('공식 기업 일정','Verified company events')}</h2></header><DataState {...source} retry={source.reload}/>{source.data&&<><VerifiedCalendar items={source.data.calendar} empty={t('공식 출처로 확인된 예정 일정이 없습니다.','No upcoming dates have been verified from official sources.')}/><details><summary>{t('지난 공식 일정','Historical official events')}</summary><VerifiedCalendar items={source.data.historical_calendar} empty={t('확인된 과거 일정이 없습니다.','No verified historical events are available.')}/></details></>}</section>}
   </div>
  </>}
 </div>;
}
