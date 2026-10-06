'use client';
import Link from 'next/link';
import {usePathname,useRouter} from 'next/navigation';
import {createContext,useCallback,useContext,useEffect,useState,type ReactNode} from 'react';
import {useAuth} from '@/components/auth';
import WorkspaceLoading from '@/components/workspace-loading';
import {usePrefs} from '@/workspace/preferences';
import {MIcon} from './ui';
import './mobile.css';
import './detail-shell.css';

const MobileAlertBadgeContext=createContext<(count:number)=>void>(()=>{});
export function useMobileAlertBadge(){return useContext(MobileAlertBadgeContext);}

export default function MobileShell({children}: {children:ReactNode}) {
  const auth=useAuth(),path=usePathname(),router=useRouter(),{text:t}=usePrefs();
  const [unread,setUnread]=useState<{id:string;count:number}|null>(null);
  const updateUnread=useCallback((count:number)=>setUnread({id:auth.me?.id??'',count}),[auth.me?.id]);
  const onboarding=path==='/onboarding',event=/^\/events\/[^/]+$/.test(path),company=/^\/companies\/[^/]+$/.test(path),document=/^\/documents\/[^/]+$/.test(path),timeline=path==='/timeline'||/^\/companies\/[^/]+\/timeline$/.test(path),questions=path==='/questions';
  useEffect(()=>{
    if(!auth.loading&&!auth.token&&!auth.error)router.replace(`/login?next=${encodeURIComponent(path)}`);
    if(auth.me&&!auth.me.onboarding_completed&&!onboarding)router.replace('/onboarding');
  },[auth.loading,auth.token,auth.error,auth.me,onboarding,path,router]);
  if(!auth.me||(!auth.me.onboarding_completed&&!onboarding))return <WorkspaceLoading error={auth.loading?null:auth.error}/>;
  const detailTitles:Record<string,string>={
    '/questions':t('AI 후속 질문','AI follow-up questions'),'/help':t('도움말 및 지원','Help & support'),
    '/settings/account':t('계정 정보','Account information'),'/settings/security':t('보안 및 로그인','Security & sign-in'),
    '/settings/notifications':t('알림 설정','Notification settings'),'/settings/appearance':t('화면 및 언어 설정','Appearance & language'),
  };
  const title=event?t('이벤트 상세','Event details'):company?t('기업 개요','Company overview'):document?t('문서 상세','Document details'):timeline?t('기업 타임라인','Company timeline'):detailTitles[path];
  const compact=!!title,newDetail=compact&&!event&&!company;
  const active=(href:string)=>path===href||href==='/explore'&&path==='/search'||href==='/watchlist'&&(company||timeline)||href==='/saved'&&document||href==='/settings'&&(path.startsWith('/settings/')||path==='/help');
  const nav=[['/today',t('홈','Home'),'home'],['/explore',t('탐색','Explore'),'search'],path==='/saved'||document?['/saved',t('저장 / 기록','Saved'),'bookmark']:['/watchlist',t('관심종목','Watchlist'),'star'],path==='/alerts'?['/alerts',t('알림 센터','Alerts'),'bell']:['/portfolio',t('포트폴리오','Portfolio'),'pie'],['/settings',t('설정','Settings'),'settings']];
  const back=()=>{if(window.history.length>1)router.back();else router.push(path.startsWith('/settings/')||path==='/help'?'/settings':'/today');};
  return <div className={`sb-mobile ${onboarding?'m-onboarding-shell':''} ${event?'m-event-shell':''} ${company?'m-company-shell':''} ${newDetail?'m-secondary-shell':''} ${questions?'m-questions-shell':''} ${path==='/alerts'?'m-alerts-shell':''}`}>
    <a className="m-skip" href="#mobile-main">{t('본문으로 이동','Skip to content')}</a>
    {!onboarding && (compact ? <header className="m-detail-header"><button type="button" className="m-icon-button" aria-label={t('뒤로 가기','Go back')} onClick={back}><MIcon name="back" size={23}/></button><strong>{title}</strong>{!company&&<div className="m-header-actions">{path!=='/settings/appearance'&&<Link className="m-icon-button" href="/explore" aria-label={t('검색','Search')}><MIcon name="search" size={23}/></Link>}<Link className="m-avatar" href="/settings/account" aria-label={t('내 계정','My account')}><MIcon name="person" size={24}/></Link></div>}</header> : <header className="m-brand-header"><Link className="m-brand" href="/today" aria-label="SignalBrief"><strong>Signal<span>Brief</span></strong><small>{t('세상의 신호를, 더 나은 투자로','A clearer view. A better decision.')}</small></Link><div className="m-header-actions"><Link className="m-icon-button" href={path==='/alerts'?'/alerts':'/explore'} aria-label={path==='/alerts'?t('알림 센터','Alert center'):t('검색','Search')}><MIcon name={path==='/alerts'?'bell':'search'} size={25}/>{path==='/alerts'&&unread?.id===auth.me.id&&unread.count>0&&<span className="m-header-unread" aria-label={`${unread.count} ${t('읽지 않은 알림','unread alerts')}`}>{unread.count>99?'99+':unread.count}</span>}</Link><Link className="m-avatar" href="/settings/account" aria-label={t('내 계정','My account')}><MIcon name="person" size={25}/></Link></div></header>)}
    <main id="mobile-main" className="m-main"><MobileAlertBadgeContext.Provider value={updateUnread}>{children}</MobileAlertBadgeContext.Provider></main>
    {!onboarding&&!event&&!questions&&<nav className="m-bottom-nav" aria-label={t('모바일 메뉴','Mobile navigation')}>{nav.map(([href,label,icon])=><Link key={href} href={href} className={active(href)?'active':''} aria-current={active(href)?'page':undefined}><MIcon name={icon} size={25}/><span>{label}</span></Link>)}</nav>}
  </div>;
}
