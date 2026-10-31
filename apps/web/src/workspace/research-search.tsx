'use client';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {useEffect,useRef,useState} from 'react';
import {z} from 'zod';
import {useAuth} from '@/components/auth';
import {Icon} from '@/components/icons';
import {catalogSchema,sourceOverviewSchema,resourceKind} from './contracts';
import {workspace} from './client';
import {usePrefs} from './preferences';
import {DataState,Empty,Logo,ResourceCard,useData} from './ui';
import './monitoring.css';

export type ResearchSearchProps={initial:string;initialKind:string;initialMarket?:string;initialDays?:number;initialOffset?:number;initialSort?:'relevance'|'newest';initialSource?:string;initialCompany?:string;initialCategory?:string};
function CompanyQuery({initial='',onSubmit}:{initial?:string;onSubmit:(q:string)=>void}){
  const {text:t}=usePrefs(),[query,setQuery]=useState(initial);
  useEffect(()=>setQuery(initial),[initial]);
  return <form className="sb-monitor-search" role="search" onSubmit={event=>{event.preventDefault();onSubmit(query.trim());}}><input type="search" aria-label={t('기업 또는 자료 검색','Search companies or sources')} placeholder={t('기업명, 코드 또는 키워드','Company, identifier or keyword')} value={query} maxLength={100} onChange={event=>setQuery(event.target.value)}/><button type="submit" className="sb-monitor-button primary"><Icon name="search" size={18}/>{t('검색','Search')}</button></form>;
}

export function ResearchDirectory(){
  const {text:t}=usePrefs(),router=useRouter();
  const directory=useData({action:'catalog',p:{kind:'company',limit:50}},catalogSchema);
  const overview=useData({action:'source_overview',p:{scope:'all',days:0}},sourceOverviewSchema);
  const monitoring=new Map(overview.data?.monitoring.map(row=>[row.company_id,row])??[]);
  return <div className="sb-monitoring" data-screen="research-directory"><header><div><h1>{t('기업','Companies')}</h1><p>{t('기업을 찾고 공식 공시와 검토된 분석을 확인하세요.','Find companies and explore their official disclosures and reviewed analyses.')}</p></div></header>
    <CompanyQuery onSubmit={q=>router.push(`/search?${new URLSearchParams({q})}`)}/>
    <DataState {...directory} retry={directory.reload}/><DataState {...overview} retry={overview.reload}/>
    <div className="sb-monitor-toolbar"><h2>{t('지원하는 기업','Supported companies')}</h2><span className="sb-monitor-count">{directory.data?t(`${directory.data.total}개 기업`,`${directory.data.total} companies`):t('확인 중','Loading')}</span></div>
    <div className="sb-monitor-company-grid">{directory.data?.items.map(company=>{const records=monitoring.get(company.id);return <Link key={company.id} className="sb-monitor-card" href={`/companies/${company.id}`}><Logo ticker={company.ticker}/><strong>{company.company_name}</strong><small>{company.ticker} · {company.market}</small><span className="sb-monitor-coverage">{overview.loading?t('자료 범위 확인 중','Checking coverage'):overview.error?t('자료 범위 확인 불가','Coverage unavailable'):records?.latest_analysis?t('공시 및 승인된 분석 제공','Disclosures and approved analysis'):records?.latest_filing?t('공시 수집됨 · 분석 확인 전','Disclosures collected; analysis pending'):t('기업 정보 · 공시 수집 전','Directory entry; no collected disclosures')}</span></Link>;})}</div>
    {directory.data&&!directory.data.items.length&&<Empty title={t('지원하는 기업이 없습니다.','No supported companies found.')}/>}
    <div className="sb-monitor-toolbar"><Link className="sb-monitor-button" href="/search?kind=document&sort=newest">{t('공시 전체 보기','Browse disclosures')}</Link><Link className="sb-monitor-button" href="/search?kind=analysis&sort=newest">{t('승인된 분석 보기','Browse approved analyses')}</Link></div>
  </div>;
}

const searchKind=resourceKind.or(z.literal('analysis')).or(z.literal(''));
export function ResearchSearch({initial,initialKind,initialMarket='',initialDays=0,initialOffset=0,initialSort='relevance',initialSource='',initialCompany='',initialCategory=''}:ResearchSearchProps){
  const {token}=useAuth(),prefs=usePrefs(),{text:t}=prefs,router=useRouter(),recorded=useRef('');
  const parsed=searchKind.safeParse(initialKind),kind=parsed.success?parsed.data:'';
  const source=initialSource==='sec'||initialSource==='dart'?initialSource:'';
  const company=z.string().uuid().safeParse(initialCompany).success?initialCompany:'';
  const filters={q:initial,kind,market:initialMarket,days:initialDays,sort:initialSort,source:source as ''|'sec'|'dart',company_id:company,category:initialCategory};
  const results=useData({action:'catalog',p:{...filters,limit:20,offset:initialOffset}},catalogSchema);
  const directory=useData({action:'catalog',p:{kind:'company',limit:50}},catalogSchema);
  useEffect(()=>{const q=initial.trim();if(token&&prefs.loaded&&prefs.value.history_enabled&&q&&recorded.current!==`${token}:${q}`){recorded.current=`${token}:${q}`;void workspace(token,{action:'search_record',p:{query:q}},z.unknown()).catch(()=>{recorded.current='';});}},[token,initial,prefs.loaded,prefs.value.history_enabled]);
  function change(patch:Partial<typeof filters>&{offset?:number}){const next={...filters,offset:0,...patch},params=new URLSearchParams();for(const [key,val] of Object.entries(next))if(val!==''&&val!==0)params.set(key,String(val));router.push(`/search?${params}`);}
  const tabs=[['',t('전체','All')],['company',t('기업','Companies')],['document',t('공시','Disclosures')],['analysis',t('승인된 분석','Approved analyses')],['event',t('검토된 이벤트','Reviewed events')]] as const;
  return <div className="sb-monitoring" data-screen="research-search"><header><div><h1>{t('검색 결과','Search results')}</h1><p>{t('수집된 공시와 승인된 분석에서 검색합니다. 날짜는 원문의 공개일 기준입니다.','Search collected disclosures and approved analyses. Date filters use the original publication date.')}</p></div></header>
    <CompanyQuery initial={initial} onSubmit={q=>change({q})}/>
    <nav className="sb-monitor-tabs" aria-label={t('검색 유형','Search type')}>{tabs.map(([key,label])=><button key={key} aria-pressed={kind===key||key==='document'&&kind==='filing'||key==='analysis'&&(kind==='us_analysis'||kind==='dart_analysis')} onClick={()=>change({kind:key})}>{label}</button>)}</nav>
    <div className="sb-monitor-toolbar"><label><span>{t('기업','Company')}</span><select value={company} onChange={event=>change({company_id:event.target.value})}><option value="">{t('전체 기업','All companies')}</option>{directory.data?.items.map(item=><option key={item.id} value={item.id}>{item.company_name}</option>)}</select></label>
      <label><span>{t('출처','Source')}</span><select value={source} onChange={event=>change({source:event.target.value as typeof source})}><option value="">{t('전체 출처','All sources')}</option><option value="sec">SEC</option><option value="dart">DART</option></select></label>
      {(results.data?.categories?.length??0)>0&&<label><span>{t('문서 유형','Document type')}</span><select value={initialCategory} onChange={event=>change({category:event.target.value})}><option value="">{t('전체 문서 유형','All document types')}</option>{[...new Set([...(results.data?.categories??[]),...initialCategory?[initialCategory]:[]])].map(category=><option value={category} key={category}>{category}</option>)}</select></label>}
      <label><span>{t('원문 기간','Source period')}</span><select value={initialDays} onChange={event=>change({days:Number(event.target.value)})}><option value={0}>{t('전체 기간','All history')}</option><option value={30}>{t('최근 30일','Last 30 days')}</option><option value={90}>{t('최근 90일','Last 90 days')}</option><option value={365}>{t('최근 1년','Last year')}</option>{![0,30,90,365].includes(initialDays)&&<option value={initialDays}>{t(`최근 ${initialDays}일`, `Last ${initialDays} days`)}</option>}</select></label>
      <label><span>{t('정렬','Sort')}</span><select value={initialSort} onChange={event=>change({sort:event.target.value as 'relevance'|'newest'})}><option value="relevance">{t('관련도','Relevance')}</option><option value="newest">{t('원문 최신순','Newest source')}</option></select></label>
      {(source||company||initialDays||initialMarket||initialCategory)?<button className="sb-monitor-button" onClick={()=>change({source:'',company_id:'',days:0,market:'',category:''})}>{t('필터 초기화','Reset filters')}</button>:null}</div>
    <DataState {...results} retry={results.reload}/>{directory.error&&<DataState loading={false} error={directory.error} retry={directory.reload}/>}
    {results.data&&<p className="sb-monitor-count">{t(`${results.data.total}개 결과`,`${results.data.total} results`)}</p>}
    <div className="sb-monitor-result-list">{results.data?.items.map(item=><ResourceCard key={`${item.kind}:${item.id}`} item={item}/>)}</div>
    {results.data&&!results.data.items.length&&!results.loading&&!results.error&&<Empty title={t('조건에 맞는 자료가 없습니다.','No records match these filters.')} description={t('기간이나 기업을 변경해 보세요. 검토 대기 중인 분석은 검색 결과에 포함되지 않습니다.','Try a different period or company. Analyses awaiting review are excluded from search results.')}/>}
    {(initialOffset>0||results.data?.next_offset!=null)&&<div className="sb-monitor-pagination"><button className="sb-monitor-button" disabled={results.loading||initialOffset===0} onClick={()=>change({offset:Math.max(0,initialOffset-20)})}>{t('이전','Previous')}</button><span>{Math.floor(initialOffset/20)+1}</span><button className="sb-monitor-button" disabled={results.loading||results.data?.next_offset==null} onClick={()=>change({offset:results.data?.next_offset??initialOffset})}>{t('다음','Next')}</button></div>}
  </div>;
}
