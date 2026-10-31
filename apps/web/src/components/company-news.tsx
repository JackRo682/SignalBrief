'use client';
import {useEffect,useState} from 'react';
import {useAuth} from '@/components/auth';
import {usePrefs} from '@/workspace/preferences';
import {newsResponse,type NewsResponse} from '@/lib/news-contract';
import './korean-news.css';
export function CompanyNews({companyId,companyName}:{companyId:string;companyName:string}){
 const {token}=useAuth(),{text:t,date}=usePrefs(),[revision,setRevision]=useState(0);
 const key=`${token}:${companyId}:${revision}`;
 const [state,setState]=useState<{key:string;data:NewsResponse|null;error:string;status:number}>({key:'',data:null,error:'',status:0});
 useEffect(()=>{
  if(!token)return;
  let active=true;const controller=new AbortController();
  fetch(`/api/news?company_id=${encodeURIComponent(companyId)}`,{headers:{Authorization:`Bearer ${token}`},cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(22000)])}).then(async response=>{
   if(!response.ok){if(active)setState({key,data:null,error:response.status===422?'unsupported':response.status===429?'busy':'failed',status:response.status});return;}
   const data=newsResponse.parse(await response.json());if(active)setState({key,data,error:'',status:200});
  }).catch(()=>{if(active)setState({key,data:null,error:'failed',status:0});});
  return()=>{active=false;controller.abort();};
 },[token,companyId,revision,key]);
 const current=state.key===key?state:null;
 return <div className="sb-korean-news rw-company-news" aria-label={t(`${companyName} 관련 뉴스`,`${companyName} related news`)}>
  {!token?<p>{t('로그인 후 뉴스를 조회할 수 있습니다.','Sign in to view company news.')}</p>:!current?<p role="status">{t('관련 뉴스를 불러오는 중입니다.','Loading related news…')}</p>:current.error?<div role="alert"><p>{current.error==='unsupported'?t('이 기업은 아직 회사별 뉴스 검색을 지원하지 않습니다.','Company news is not available for this company yet.'):current.error==='busy'?t('뉴스 요청이 많습니다. 잠시 후 다시 시도하세요.','The news provider is busy. Try again shortly.'):t('뉴스 제공자에 연결하지 못했습니다. 공시 자료는 계속 이용할 수 있습니다.','The news provider could not be reached. Disclosures remain available.')}</p>{current.error!=='unsupported'&&<button type="button" onClick={()=>setRevision(x=>x+1)}>{t('뉴스 다시 시도','Retry news')}</button>}</div>:current.data&&<>
   <p>{t('검색어','Search query')}: {current.data.query} · {t('조회','Retrieved')}: {date(current.data.retrievedAt)}</p>
   {current.data.items.length?<ol>{current.data.items.map((item,index)=><li key={`${item.link}:${index}`}><a href={item.originalLink??item.link} target="_blank" rel="noopener noreferrer">{item.title}</a><div>{new URL(item.originalLink??item.link).hostname} · <time dateTime={item.publishedAt}>{date(item.publishedAt)}</time>{item.originalLink&&<> · <a href={item.link} target="_blank" rel="noopener noreferrer">{t('네이버 검색 링크','NAVER search link')}</a></>}</div></li>)}</ol>:<p>{t('이 기업과 관련된 검색결과가 없습니다.','No matching articles were returned for this company.')}</p>}
   <button type="button" onClick={()=>setRevision(x=>x+1)}>{t('뉴스 새로고침','Refresh news')}</button>
  </>}
  <footer><a href="https://www.ncloud.com/product/applicationService/NAVERAPIHUB" target="_blank" rel="noopener noreferrer">NAVER™ API HUB</a><p>{t('외부 뉴스 검색결과입니다. SignalBrief가 검토한 공시 분석과 별도로 제공됩니다. 기사 권리는 각 언론사에 있습니다.','External news search results, separate from SignalBrief’s reviewed disclosure analyses. Article rights belong to their publishers.')}</p></footer>
 </div>;
}
