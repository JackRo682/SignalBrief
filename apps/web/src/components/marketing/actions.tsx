'use client';
import Link from 'next/link';
import {useState,useSyncExternalStore,type ReactNode} from 'react';
import {useAuth} from '@/components/auth';
import {Icon} from '@/components/icons';

export function AccountLink({href='/signup',destination='/today',children,className,ariaLabel}:{href?:'/signup'|'/login';destination?:string;children:ReactNode;className?:string;ariaLabel?:string}){
 const {me}=useAuth();
 return <Link href={me?destination:href} className={className} aria-label={ariaLabel}>{children}</Link>;
}
const tabs=[['today','오늘의 변화','home'],['watchlist','관심종목','star'],['portfolio','포트폴리오','pie'],['timeline','기업 타임라인','timeline'],['calendar','캘린더','calendar'],['alerts','알림','bell']] as const;
const copy={
 today:['오늘의 변화','예시 기업의 새 공시에서 중요한 변화를 확인하세요.'],
 watchlist:['관심종목','저장한 기업의 공시와 확인할 근거를 한곳에서 살펴보세요.'],
 portfolio:['포트폴리오','보유종목과 관련된 변화를 이어서 확인하세요.'],
 timeline:['기업 타임라인','이전 공시와 새 공시를 시간 순서로 연결해 보세요.'],
 calendar:['캘린더','확인된 발표 일정과 내가 등록한 일정을 관리하세요.'],
 alerts:['알림','관심종목과 관련된 새 이벤트를 확인하세요.'],
} as const;
const compactQuery='(max-width: 900px)';
function subscribeCompact(notify:()=>void){const media=window.matchMedia(compactQuery);media.addEventListener('change',notify);return()=>media.removeEventListener('change',notify);}
const compactSnapshot=()=>window.matchMedia(compactQuery).matches;
const serverSnapshot=()=>false;
export function DashboardPreview(){
 const [tab,setTab]=useState<keyof typeof copy>('today');
 const horizontal=useSyncExternalStore(subscribeCompact,compactSnapshot,serverSnapshot);
 return <div className="public-info-demo" id="demo" aria-label="기능별 화면 예시">
  <div className="demo-side"><div className="demo-logo"><span className="public-info-mark"/>SignalBrief</div><div role="tablist" aria-label="화면 예시 선택" aria-orientation={horizontal?'horizontal':'vertical'}>{tabs.map(([key,label,icon],i)=><button key={key} type="button" id={'demo-tab-'+key} role="tab" aria-selected={tab===key} aria-controls="demo-panel" tabIndex={tab===key?0:-1} onClick={()=>setTab(key)} onKeyDown={event=>{if(['ArrowDown','ArrowUp','ArrowRight','ArrowLeft','Home','End'].includes(event.key)){event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(i+(['ArrowDown','ArrowRight'].includes(event.key)?1:tabs.length-1))%tabs.length;setTab(tabs[next][0]);document.getElementById('demo-tab-'+tabs[next][0])?.focus();}}}><Icon name={icon} size={13}/>{label}</button>)}</div></div>
  <div className="demo-body" id="demo-panel" role="tabpanel" aria-labelledby={'demo-tab-'+tab}>
   <div className="demo-heading"><h2>{copy[tab][0]}</h2><AccountLink href="/login" destination="/watchlist" className="demo-search" ariaLabel="내 관심종목 검색"><Icon name="search" size={12}/><span>종목 검색</span></AccountLink></div>
   <p className="demo-caption">{copy[tab][1]}</p><span className="demo-disclaimer">화면 예시 · 실제 기업·시세 데이터가 아닙니다</span>
   <div className="demo-indices">{['공시 확인','변화 비교','근거 연결'].map((label,i)=><div key={label}><strong>{label}</strong><b>{['FACT','CHANGE','EVIDENCE'][i]}</b><svg viewBox="0 0 95 30" aria-hidden="true"><path d="M1 26 12 20 19 24 28 13 38 17 45 10 54 14 66 6 72 11 84 3 93 7" fill="none" stroke="currentColor" strokeWidth="1.4"/></svg></div>)}</div>
   <div className="demo-bottom"><section><h3>{tab==='calendar'?'다가오는 일정':tab==='alerts'?'새로운 알림':'확인할 변화'}</h3>{['예시 기업 A · 새 공시 확인','예시 기업 B · 이전 자료와 비교','예시 기업 C · 원문 근거 읽기'].map((text,i)=><AccountLink href="/login" destination={'/'+tab} className="demo-row" key={text}><span className={'demo-tag tag-'+i}>{['공시','기업','근거'][i]}</span><span>{text}</span><Icon name="arrow" size={12}/></AccountLink>)}</section><section><h3>내 관심종목 <AccountLink href="/login" destination="/watchlist">더보기 ›</AccountLink></h3>{['예시 기업 A','예시 기업 B','예시 기업 C'].map((company,i)=><AccountLink href="/login" destination="/watchlist" className="demo-company" key={company}><span className={'demo-company-mark tag-'+i}>{['A','B','C'][i]}</span><strong>{company}</strong><span>—</span><small>샘플</small></AccountLink>)}</section></div>
   <AccountLink href="/login" destination={'/'+tab} className="demo-open">이 기능 사용하기 <Icon name="arrow" size={12}/></AccountLink>
  </div>
 </div>;
}
