'use client';
import {useEffect,useState} from 'react';
import {useAuth} from '@/components/auth';
import {pageDataCache} from '@/lib/page-data-cache';
import {universeCoverageSchema,type UniverseCoverageData} from '@/lib/universe-coverage-contract';
import {usePrefs} from '@/workspace/preferences';
import './universe-coverage.css';

export default function UniverseCoverage(){
 const {token}=useAuth(),{text:t}=usePrefs(),[revision,setRevision]=useState(0),[expanded,setExpanded]=useState(false);
 const [state,setState]=useState<{scope:string|null;data:UniverseCoverageData|null;error:boolean}>({scope:null,data:null,error:false});
 useEffect(()=>{
  if(!token||!expanded)return;
  const controller=new AbortController();let active=true;
  void fetch('/api/universe-coverage',{headers:{Authorization:`Bearer ${token}`},credentials:'omit',cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(25000)])})
   .then(async response=>{
    if(!response.ok){
     const detail=await response.json().catch(()=>null);
     if(active&&pageDataCache.isCurrent(token)){
      if(response.status===401)window.dispatchEvent(new Event('signalbrief:unauthorized'));
      if(response.status===403&&detail?.error?.code==='mfa_required')window.dispatchEvent(new Event('signalbrief:mfa-required'));
     }
     throw new Error('coverage_unavailable');
    }
    const data=universeCoverageSchema.parse(await response.json());if(active)setState({scope:token,data,error:false});
   })
   .catch(()=>{if(active)setState({scope:token,data:null,error:true});});
  return()=>{active=false;controller.abort();};
 },[token,revision,expanded]);
 if(!token)return null;
 const current=state.scope===token,data=current?state.data:null,error=current&&state.error;
 return <details className="rd-universe" onToggle={event=>setExpanded(event.currentTarget.open)}>
  <summary>{t('전체 시장 자료 수집 현황','Market coverage and collection progress')}</summary>
  {!data&&!error&&<p role="status">{t('거래소 목록과 자료 수집 현황을 확인하고 있습니다.','Checking listing and collection coverage.')}</p>}
  {error&&<p role="status">{t('수집 현황을 불러오지 못했습니다.','Collection coverage is unavailable.')} <button type="button" className="rd-btn" onClick={()=>setRevision(x=>x+1)}>{t('수집 현황 다시 조회','Retry coverage')}</button></p>}
  {data&&<>
   <p>{t('종목별 상장 정보와 발행사별 자료 수집을 구분합니다. 다음 수치는 자료가 한 건 이상 확인된 발행사 수입니다.','Listing records and issuer coverage are tracked separately. Coverage columns count issuers with at least one matching record.')}</p>
   <div className="rd-universe-scroll"><table><caption>{t('시장별 실제 수집 상태','Observed coverage by market')}</caption>
    <thead><tr>{[['시장','Market'],['대상 종목','Eligible listings'],['연결 기업','Registered issuers'],['공시','Filings'],['다가오는 일정','Upcoming events'],['승인된 분석','Approved analyses'],['검토 대기','Awaiting review'],['연결 확인 중','Unresolved listings'],['유형 확인 중','Classification pending']].map(([ko,en])=><th key={en} scope="col">{t(ko,en)}</th>)}</tr></thead>
    <tbody>{data.markets.filter(row=>row.eligible_listings>0||row.classification_pending_listings>0).map(row=><tr key={row.market}><th scope="row">{row.market.replaceAll('_',' ')}</th>{[row.eligible_listings,row.registered_issuers,row.issuers_with_filings,row.issuers_with_upcoming_calendar,row.issuers_with_approved_analysis,row.issuers_with_pending_review,row.unresolved_listings,row.classification_pending_listings].map((n,i)=><td key={i}>{n.toLocaleString()}</td>)}</tr>)}</tbody>
   </table></div>
   {!data.markets.length&&<p>{t('공식 상장 목록을 아직 반영하지 않았습니다.','Official listing snapshots have not been imported yet.')}</p>}
   <p>{t('한국 목록은 발행사별 대표 종목 기준이며, 추가 종류주식 연결은 별도 확인이 필요합니다. 미국 ETF·채권·워런트 등과 유형 미확인 종목은 주식 수집 대상 수에서 제외합니다.','Korean lists identify each issuer’s representative listing; additional share classes require separate verification. U.S. ETFs, debt, warrants and unclassified instruments are excluded from the equity collection count.')}</p>
   <ul>{data.sources.map(source=><li key={source.source_key}><a href={source.source_url} target="_blank" rel="noopener noreferrer">{source.source_key==='kind_kospi'?'KOSPI · KIND':source.source_key==='kind_kosdaq'?'KOSDAQ · KIND':'U.S. · Nasdaq Trader'}</a> · {source.as_of??t('미반영','Not imported')} · {source.status==='ready'?t('목록 확인','Snapshot available'):source.status==='stale'?t('목록 갱신 필요','Snapshot needs refresh'):t('수집 대기','Pending import')}</li>)}</ul>
   <p>{t(`분석 생성은 하루 최대 ${data.limits.model_daily_calls}회이며, 승인된 분석에는 사람의 검토가 필요합니다. 확정 공지가 없는 기업의 일정은 비어 있을 수 있습니다.`,`Analysis generation is limited to ${data.limits.model_daily_calls} calls per day; approved analyses require human review. A company may have no officially announced upcoming event.`)}</p>
   <button type="button" className="rd-btn" onClick={()=>setRevision(x=>x+1)}>{t('수집 현황 새로고침','Refresh coverage')}</button>
  </>}
 </details>;
}
