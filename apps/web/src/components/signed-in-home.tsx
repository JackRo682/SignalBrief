'use client';
import Link from 'next/link';
import {useState} from 'react';
import {useRouter} from 'next/navigation';
import {useAuth} from '@/components/auth';
import {Icon,type IconName} from '@/components/icons';
import {SourceOverview} from '@/components/source-overview';
import {CompanyNews} from '@/components/company-news';
import {catalogSchema,sourceOverviewSchema} from '@/workspace/contracts';
import {DataState,useData} from '@/workspace/ui';
import {usePrefs} from '@/workspace/preferences';
import './research-workspace.css';

export function SignedInHome({mobile=false}:{mobile?:boolean}){
 const {me}=useAuth(),{text:t,value}=usePrefs(),router=useRouter(),[query,setQuery]=useState(''),[newsCompany,setNewsCompany]=useState('');
 const summary=useData({action:'source_overview',p:{scope:'following',days:0}},sourceOverviewSchema),companies=useData({action:'catalog',p:{kind:'company',limit:50}},catalogSchema);
 const [now]=useState(()=>new Date());
 const directory=companies.data?.items??[],selectedNews=directory.find(item=>item.id===newsCompany)??directory[0];
 const metrics:{href:string;label:string;detail:string;count:number|null;loading:boolean;error:string|null;icon:IconName}[]=[
  {href:'/watchlist',label:t('관심 기업','Companies followed'),detail:t('업데이트를 모니터링하는 기업','Companies you monitor'),count:summary.data?.following_count??null,loading:summary.loading,error:summary.error,icon:'star'},
  {href:'/alerts',label:t('읽지 않은 알림','Unread alerts'),detail:t('확인하지 않은 기업 업데이트','Company updates to review'),count:summary.data?.unread_count??null,loading:summary.loading,error:summary.error,icon:'bell'},
  {href:'/saved',label:t('저장한 자료','Saved items'),detail:t('다시 볼 공시와 승인된 분석','Disclosures and approved analyses'),count:summary.data?.saved_count??null,loading:summary.loading,error:summary.error,icon:'file'}
 ];
 return <div className="rw-page" data-testid={mobile?'mobile-today':'desktop-today'}>
  <header className="rw-heading"><div><span className="rw-eyebrow">{me?.display_name?`${me.display_name} · `:''}SignalBrief</span><h1>{t('기업의 변화를 원문에서','Follow companies. Read the evidence.')}</h1><p>{t('공시, 승인된 요약, 공식 일정을 한곳에서 확인하세요.','Disclosures, reviewed summaries and verified dates in one workspace.')}</p></div><time className="rw-date" dateTime={now.toISOString()}>{new Intl.DateTimeFormat(value.locale==='ko'?'ko-KR':'en-US',{year:'numeric',month:'long',day:'numeric',timeZone:value.timezone}).format(now)}</time></header>
  <form className="rw-search" onSubmit={event=>{event.preventDefault();router.push(`/search?kind=company${query.trim()?`&q=${encodeURIComponent(query.trim())}`:''}`);}}><Icon name="search" size={22}/><input aria-label={t('기업명 또는 종목코드 검색','Search company name or identifier')} placeholder={t('기업명, 종목코드, 영문명으로 검색','Search company names, identifiers or aliases')} value={query} maxLength={100} onChange={e=>setQuery(e.target.value)}/><button type="submit">{t('기업 검색','Find company')}</button></form>
  <section className="rw-summary-grid" aria-label={t('내 모니터링 현황','Your monitoring overview')}>{metrics.map(metric=><Link className="rw-summary" href={metric.href} key={metric.href}><span className="rw-summary-icon"><Icon name={metric.icon} size={23}/></span><div><span>{metric.label}</span><strong className={metric.count===null||metric.error?'rw-summary-status':''}>{metric.error?t('조회 실패','Unavailable'):metric.loading?t('불러오는 중','Loading'):metric.count??t('미제공','Unavailable')}</strong><small>{metric.detail}</small></div></Link>)}</section>
  {summary.error&&<p className="rw-note" role="alert">{t('일부 현황을 불러오지 못했습니다. 해당 메뉴를 열어 다시 확인하세요.','Some totals could not be loaded. Open the relevant section to retry.')}</p>}
  <SourceOverview onSaved={summary.reload}/>
  <section className="rw-section"><header className="rw-section-header"><h2>{t('기업 관련 뉴스','Related company news')}</h2></header><p className="rw-section-description">{t('기업을 선택하면 연결된 뉴스 검색에서 관련 기사를 확인할 수 있습니다.','Choose a company to see related articles from the connected news provider.')}</p><DataState {...companies} retry={companies.reload}/>{selectedNews&&<><label className="rw-news-select">{t('뉴스 기업','Company')}<select value={selectedNews.id} onChange={e=>setNewsCompany(e.target.value)}>{directory.map(company=><option key={company.id} value={company.id}>{company.company_name} · {company.ticker}</option>)}</select></label><CompanyNews companyId={selectedNews.id} companyName={selectedNews.company_name}/></>}</section>
 </div>;
}
