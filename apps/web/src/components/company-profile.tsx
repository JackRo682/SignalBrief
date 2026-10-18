'use client';
import {useEffect,useState} from 'react';
import {z} from 'zod';
import {useAuth} from '@/components/auth';
import {usePrefs} from '@/workspace/preferences';
import './company-profile.css';
const profileSchema=z.object({status:z.enum(['verified','not_available','unsupported']),fetched_at:z.string().optional(),source_url:z.string().url().optional(),source_sha256:z.string().optional(),profile:z.object({corp_code:z.string(),ticker:z.string(),name:z.string(),english_name:z.string().nullable(),ceo:z.string().nullable(),address:z.string().nullable(),website:z.string().url().nullable(),established_on:z.string().nullable(),industry_code:z.string().nullable(),fiscal_month:z.string().nullable()}).nullable()});
type Result=z.infer<typeof profileSchema>;
export default function CompanyProfile({id,ticker}:{id:string;ticker:string}){
 const {token}=useAuth(),{text:t,date}=usePrefs();
 const scope=`${token}:${id}`;
 const [state,setState]=useState<{scope:string;data:Result|null;error:boolean}>({scope:'',data:null,error:false});
 const [revision,setRevision]=useState(0);
 useEffect(()=>{
  if(!token||!/^\d{6}$/.test(ticker))return;
  let active=true;const controller=new AbortController();
  fetch(`/api/company-profile?company_id=${encodeURIComponent(id)}`,{headers:{Authorization:`Bearer ${token}`},cache:'no-store',credentials:'omit',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(45000)])})
   .then(async response=>{if(!response.ok)throw new Error();const result=profileSchema.parse(await response.json());if(active)setState({scope,data:result,error:false});})
   .catch(()=>{if(active)setState({scope,data:null,error:true});});
  return()=>{active=false;controller.abort();};
 },[id,ticker,token,scope,revision]);
 if(!/^\d{6}$/.test(ticker))return null;
 const current=state.scope===scope?state:null,data=current?.data,p=data?.status==='verified'?data.profile:null;
 const retry=()=>{setState({scope:'',data:null,error:false});setRevision(x=>x+1);};
 const fields=p?[[t('회사명','Company'),p.name],[t('영문명','English name'),p.english_name],[t('대표자','CEO'),p.ceo],[t('설립일','Established'),p.established_on],[t('업종코드','Industry code'),p.industry_code],[t('결산월','Fiscal year end month'),p.fiscal_month],[t('주소','Address'),p.address]]:[];
 return <section className="sb-company-profile" aria-label={t('기업 기본정보','Company profile')}>
  <h2>{t('기업 기본정보','Company profile')}</h2>
  {!current?<p role="status">{t('기업정보를 불러오는 중입니다.','Loading company profile.')}</p>:current.error?<p role="status">{t('기업정보를 불러오지 못했습니다.','Company profile could not be loaded.')} <button type="button" onClick={retry}>{t('다시 시도','Retry')}</button></p>:!p?<p>{t('제공된 기업정보가 없습니다.','No company profile is available.')}</p>:<>
   <dl>{fields.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value||t('정보 없음','Not available')}</dd></div>)}</dl>
   {p.website&&<p><a href={p.website} target="_blank" rel="noopener noreferrer">{t('공식 홈페이지','Company website')} ↗</a></p>}
   <p className="sb-company-profile-source"><a href={data?.source_url} target="_blank" rel="noopener noreferrer">{t('출처: 금융감독원 OpenDART 기업개황','Source: FSS OpenDART company overview')}</a><br/>{t('조회','Retrieved')}: {date(data?.fetched_at??null)} · {t('실시간 정보가 아닙니다.','Not real-time data.')}</p>
  </>}
 </section>;
}
