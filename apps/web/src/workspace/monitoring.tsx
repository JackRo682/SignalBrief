'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {useAuth} from '@/components/auth';
import {Icon} from '@/components/icons';
import {useResource} from '@/components/ui';
import {companiesSchema,watchlistSchema} from '@/lib/contracts';
import {body,emptySchema,request} from '@/lib/api';
import {sourceOverviewSchema,resourceHref,type Resource} from './contracts';
import {usePrefs} from './preferences';
import {DataState,Empty,Logo,Modal,Notice,useData,useMutation} from './ui';
import './monitoring.css';

export default function Monitoring(){
  const {token}=useAuth(),prefs=usePrefs(),{text:t,date,value}=prefs,action=useMutation();
  const list=useResource('/v1/watchlist',watchlistSchema);
  const content=useData({action:'source_overview',p:{scope:'following',days:0}},sourceOverviewSchema);
  const [adding,setAdding]=useState(false),[query,setQuery]=useState(''),[search,setSearch]=useState('');
  const [filter,setFilter]=useState(''),[sort,setSort]=useState('name');
  const catalog=useResource(adding?`/v1/companies?q=${encodeURIComponent(search)}&limit=50`:null,companiesSchema);
  useEffect(()=>{const timeout=setTimeout(()=>setSearch(query.trim()),250);return()=>clearTimeout(timeout);},[query]);
  const companies=list.data?.items??[],ids=new Set(companies.map(company=>company.id));
  const rows=new Map(content.data?.monitoring.map(row=>[row.company_id,row])??[]);
  const filtered=companies.filter(company=>!filter||`${company.name} ${company.ticker}`.toLowerCase().includes(filter.toLowerCase())).sort((a,b)=>sort==='latest'?(rows.get(b.id)?.latest_filing?.published_at??'').localeCompare(rows.get(a.id)?.latest_filing?.published_at??'')||a.name.localeCompare(b.name,value.locale):a.name.localeCompare(b.name,value.locale));
  const reload=()=>{list.reload();content.reload();};
  async function follow(id:string,following:boolean){await request(`/v1/watchlist/${encodeURIComponent(id)}`,token,emptySchema,body(following?'PUT':'DELETE'));reload();}
  const evidence=(item:Resource|null|undefined,empty:string)=>item?<><Link href={resourceHref(item)}>{item.title}</Link><time dateTime={item.published_at??undefined}>{item.published_at?date(item.published_at,item.publication_precision):t('원문 날짜 미제공','Source date unavailable')}</time></>:<span>{empty}</span>;
  return <div className="sb-monitoring" data-screen="company-monitoring"><header><div><h1>{t('관심 기업','Watchlist')}</h1><p>{t('공시, 검토된 분석과 공식 일정을 한곳에서 확인하세요.','Follow disclosures, reviewed analyses and official dates in one place.')}</p></div><button className="sb-monitor-button primary" onClick={()=>setAdding(true)}><Icon name="plus" size={18}/>{t('기업 추가','Add company')}</button></header>
    <Notice action={action}/><DataState loading={list.loading} error={list.error??''} retry={list.reload}/><DataState {...content} retry={content.reload}/>
    <div className="sb-monitor-toolbar"><label><span>{t('관심 기업 검색','Search followed companies')}</span><input value={filter} onChange={event=>setFilter(event.target.value)} maxLength={100} placeholder={t('기업명 또는 코드','Company or identifier')}/></label><label><span>{t('정렬','Sort')}</span><select value={sort} onChange={event=>setSort(event.target.value)}><option value="name">{t('이름순','Name')}</option><option value="latest">{t('최근 공시순','Latest disclosure')}</option></select></label><span className="sb-monitor-count">{list.data?t(`${companies.length}개 기업 팔로우 중`,`Following ${companies.length} companies`):t('확인 중','Loading')}</span></div>
    {!list.loading&&!list.error&&!companies.length&&<Empty title={t('첫 기업을 팔로우해 보세요.','Follow your first company.')} description={t('기업을 추가하면 수집된 공식 자료와 새 분석을 여기에서 확인할 수 있습니다.','Add a company to monitor its collected disclosures and newly approved summaries.')} href="/explore" label={t('기업 찾기','Find companies')}/>}
    <div className="sb-monitor-grid">{filtered.map(company=>{const row=rows.get(company.id),muted=prefs.value.muted_companies.includes(company.id);return <article className="sb-monitor-card" key={company.id}><div className="sb-monitor-company-head"><Link href={`/companies/${company.id}`}><Logo ticker={company.ticker}/><span><strong>{company.name}</strong><small>{company.ticker} · {company.market}</small></span></Link><button title={t('팔로우 취소','Unfollow')} aria-label={`${company.name} ${t('팔로우 취소','unfollow')}`} disabled={action.busy} onClick={()=>void action.run(()=>follow(company.id,false),t('관심 기업에서 삭제했습니다.','Company unfollowed.'))}><Icon name="close" size={18}/></button></div>
      <dl className="sb-monitor-facts"><div><dt>{t('최근 공시','Latest disclosure')}</dt><dd>{content.error?t('불러오지 못했습니다.','Could not load records.'):content.loading?t('확인 중','Loading'):evidence(row?.latest_filing,t('아직 수집된 공시가 없습니다.','No collected disclosures yet.'))}</dd></div>
      <div><dt>{t('최근 분석','Latest analysis')}</dt><dd>{content.error?t('불러오지 못했습니다.','Could not load records.'):content.loading?t('확인 중','Loading'):evidence(row?.latest_analysis,t('아직 승인된 분석이 없습니다.','No approved analysis yet.'))}</dd></div>
      <div><dt>{t('다음 공식 일정','Next verified event')}</dt><dd>{row?.next_event?<><Link href={`/companies/${company.id}?tab=events`}>{row.next_event.title}</Link><time dateTime={row.next_event.occurs_on}>{date(row.next_event.occurs_on,'date')}</time></>:content.loading?t('확인 중','Loading'):content.error?t('확인 불가','Unavailable'):t('확인된 예정 일정이 없습니다.','No verified upcoming event.')}</dd></div></dl>
      <div className="sb-monitor-footer"><span>{t('최근 수집 기록','Latest collection record')}: {row?.last_collected_at?date(row.last_collected_at):content.loading?t('확인 중','Loading'):t('확인 전','Not recorded')}</span><button disabled={!prefs.loaded||prefs.busy||action.busy} aria-pressed={!muted} aria-label={`${company.name} ${t('알림','alerts')}`} onClick={()=>void action.run(()=>prefs.save({muted_companies:muted?prefs.value.muted_companies.filter(id=>id!==company.id):[...prefs.value.muted_companies,company.id]}))}><Icon name="bell" size={16}/>{muted?t('알림 꺼짐','Alerts muted'):t('알림 켜짐','Alerts enabled')}</button></div>
    </article>;})}</div>
    {list.data&&companies.length>0&&!filtered.length&&<Empty title={t('검색 결과가 없습니다.','No matching followed companies.')}/>}
    <Link className="sb-monitor-button" href="/settings/notifications">{t('알림 설정','Notification settings')} <Icon name="arrow" size={16}/></Link>
    {adding&&<Modal title={t('관심 기업 추가','Follow a company')} onClose={()=>setAdding(false)}><Notice action={action}/><label className="ws-field"><span>{t('기업명 또는 코드','Company name or identifier')}</span><input autoFocus value={query} maxLength={100} onChange={event=>setQuery(event.target.value)}/></label><DataState loading={catalog.loading} error={catalog.error??''} retry={catalog.reload}/><div className="sb-monitor-result-list">{catalog.data?.map(company=><div className="sb-monitor-company-head" key={company.id}><Link href={`/companies/${company.id}`}><Logo ticker={company.ticker}/><span><strong>{company.name}</strong><small>{company.ticker} · {company.market}</small></span></Link><button className="sb-monitor-button" disabled={action.busy||ids.has(company.id)} onClick={()=>void action.run(()=>follow(company.id,true),t('관심 기업에 추가했습니다.','Company followed.'))}>{ids.has(company.id)?t('팔로우 중','Following'):t('팔로우','Follow')}</button></div>)}</div>{catalog.data&&!catalog.data.length&&<Empty title={t('지원하는 기업을 찾지 못했습니다.','No supported company found.')}/>}</Modal>}
  </div>;
}
