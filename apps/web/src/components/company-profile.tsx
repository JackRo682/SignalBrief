'use client';
import {useEffect,useState} from 'react';
import {z} from 'zod';
import {useAuth} from '@/components/auth';
import {usePrefs} from '@/workspace/preferences';
import './company-profile.css';
const safeURL=z.string().url().refine(value=>{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password;});
const profileSchema=z.object({status:z.enum(['verified','not_available','unsupported']),fetched_at:z.string().optional(),provider:z.string().optional(),source_url:safeURL.optional(),source_sha256:z.string().optional(),profile:z.object({corp_code:z.string(),ticker:z.string(),name:z.string(),english_name:z.string().nullable(),ceo:z.string().nullable(),address:z.string().nullable(),website:safeURL.nullable(),established_on:z.string().nullable(),industry_description:z.string().nullable().optional(),industry_code:z.string().nullable(),fiscal_month:z.string().nullable()}).nullable()});
type Result=z.infer<typeof profileSchema>;
type ProfileFields=Array<[string,string|null|undefined,boolean]>;
export default function CompanyProfile({id,ticker,hideUnavailable=false}:{id:string;ticker:string;hideUnavailable?:boolean}){
 const {token}=useAuth(),{text:t,date}=usePrefs();
 const scope=`${token}:${id}:${ticker}`;
 const [state,setState]=useState<{scope:string;data:Result|null;error:boolean;status?:number}>({scope:'',data:null,error:false});
 const [revision,setRevision]=useState(0);
 useEffect(()=>{
  if(!token)return;
  let active=true;const controller=new AbortController();
  fetch(`/api/company-profile?company_id=${encodeURIComponent(id)}`,{headers:{Authorization:`Bearer ${token}`},cache:'no-store',credentials:'omit',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(45000)])})
   .then(async response=>{if(!response.ok){if(active)setState({scope,data:null,error:true,status:response.status});return;}const result=profileSchema.parse(await response.json());if(result.status==='verified'&&result.profile?.ticker!==ticker)throw new Error('company_identity_mismatch');if(active)setState({scope,data:result,error:false});})
   .catch(()=>{if(active)setState({scope,data:null,error:true,status:502});});
  return()=>{active=false;controller.abort();};
 },[id,ticker,token,scope,revision]);

 const current=state.scope===scope?state:null,data=current?.data,p=data?.status==='verified'?data.profile:null;
 const retry=()=>{setState({scope:'',data:null,error:false});setRevision(x=>x+1);};
 const sec=data?.provider==='SEC EDGAR';
 const fields:ProfileFields=p?[[t('회사명','Company'),p.name,false],[t('영문명','English name'),p.english_name,false],[t('대표자','CEO'),p.ceo,sec],[t('설립일','Established'),p.established_on,sec],[t('업종','Industry'),p.industry_description??p.industry_code,false],[t('결산월','Fiscal year end month'),p.fiscal_month,false],[t('주소','Address'),p.address,false]]:[];
 if(hideUnavailable&&current?.data&&!current.error&&!p)return null;
 return <section className="sb-company-profile" aria-label={t('기업 기본정보','Company profile')}>
  <h2>{t('기업 기본정보','Company profile')}</h2>
  {!token?<p role="status">{t('로그인 후 기업정보를 조회할 수 있습니다.','Sign in to load company information.')}</p>:!current?<p role="status">{t('기업정보를 불러오는 중입니다.','Loading company profile.')}</p>:current.error?<p role="alert">{current.status===401?t('로그인이 만료되었습니다. 다시 로그인해 주세요.','Your session expired. Sign in again.'):current.status===429?t('기업정보 제공자의 요청 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.','The company profile request limit was reached. Retry shortly.'):t('기업정보를 불러오지 못했습니다.','Company profile could not be loaded.')} <button type="button" aria-label={t('기업정보 다시 시도','Retry company profile')} onClick={retry}>{t('다시 시도','Retry')}</button></p>:!p?<p>{data?.status==='unsupported'?t('이 출처의 기업 기본정보는 아직 지원하지 않습니다.','Company profiles from this source are not supported yet.'):t('제공된 기업정보가 없습니다.','No company profile is available.')}</p>:<>
   <dl>{fields.map(([label,value,sourceUnavailable])=><div key={label}><dt>{label}</dt><dd>{value||(sourceUnavailable?t('원천 데이터에서 미제공','Not supplied by this source'):t('정보 없음','Not available'))}</dd></div>)}</dl>
   {sec&&(!p.ceo||!p.established_on)&&<p className="sb-company-profile-source">{t('SEC 기업정보 원천에는 대표자·설립일이 제공되지 않습니다. 해당 항목은 조회 오류가 아닙니다.','The SEC issuer metadata source does not provide the CEO or establishment date. Missing entries are not loading errors.')}</p>}
   {p.website&&<p><a href={p.website} target="_blank" rel="noopener noreferrer">{t('공식 홈페이지','Company website')} ↗</a></p>}
   <p className="sb-company-profile-source"><a href={data?.source_url} target="_blank" rel="noopener noreferrer">{data?.provider==='SEC EDGAR'?t('출처: SEC EDGAR 기업정보','Source: SEC EDGAR issuer information'):t('출처: 금융감독원 OpenDART 기업개황','Source: FSS OpenDART company overview')}</a><br/>{t('조회','Retrieved')}: {date(data?.fetched_at??null)} · {t('실시간 정보가 아닙니다.','Not real-time data.')}</p>
  </>}
 </section>;
}
