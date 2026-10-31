'use client';
import {companyBusinessProfiles} from '@/lib/company-business-profiles';
import {usePrefs} from '@/workspace/preferences';
import './research-workspace.css';
export function SourcedBusinessProfile({ticker}:{ticker:string}){
 const {text:t,value,date}=usePrefs(),profile=companyBusinessProfiles[ticker.toUpperCase()],locale=value.locale==='ko'?0:1;
 return <section className="rw-section" aria-label={t('기업 사업 소개','Company business overview')}><header className="rw-section-header"><h2>{t('사업과 제품','Business and products')}</h2>{profile&&<a href={profile.website} target="_blank" rel="noopener noreferrer">{t('공식 홈페이지','Official website')} ↗</a>}</header>
  {!profile?<p className="rw-empty">{t('이 기업의 사업 설명은 아직 검토되지 않았습니다. 아래 공식 기업정보와 공시를 확인하세요.','A reviewed business description is not available yet. Consult the official company information and disclosures below.')}</p>:<><p className="rw-profile-copy">{profile.description[locale]}</p>{profile.coverage&&<p className="rw-fallback">{profile.coverage[locale]}</p>}<div className="rw-profile-lists"><div><h3>{t('주요 제품·서비스','Main products and services')}</h3><ul>{profile.products[locale].map(item=><li key={item}>{item}</li>)}</ul></div><div><h3>{t('사업 분야','Business areas')}</h3><ul>{profile.areas[locale].map(item=><li key={item}>{item}</li>)}</ul></div></div><p className="rw-profile-sources">{t('공식 자료 확인','Official source checked')}: <time dateTime={profile.verifiedOn}>{date(profile.verifiedOn,'date')}</time><br/>{profile.sources.map((source,index)=><span key={source.url}>{index>0?' · ':''}<a href={source.url} target="_blank" rel="noopener noreferrer">{source.label} ↗</a></span>)}<br/>{t('사업 분야는 제품 설명을 위한 분류이며 공시의 회계 보고 부문과 다를 수 있습니다.','Business areas describe products and activities; they may differ from accounting reportable segments.')}</p></>}
 </section>;
}
