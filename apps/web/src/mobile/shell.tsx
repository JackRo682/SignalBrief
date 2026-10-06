'use client';
import Link from 'next/link';
import {usePathname,useRouter} from 'next/navigation';
import {useEffect,type ReactNode} from 'react';
import {useAuth} from '@/components/auth';
import WorkspaceLoading from '@/components/workspace-loading';
import {usePrefs} from '@/workspace/preferences';
import {MIcon} from './ui';
import './mobile.css';

export default function MobileShell({children}: {children:ReactNode}) {
  const auth=useAuth(),path=usePathname(),router=useRouter(),{text:t}=usePrefs();
  const onboarding=path==='/onboarding',event=/^\/events\/[^/]+$/.test(path),company=/^\/companies\/[^/]+$/.test(path);
  useEffect(()=>{
    if(!auth.loading&&!auth.token&&!auth.error)router.replace(`/login?next=${encodeURIComponent(path)}`);
    if(auth.me&&!auth.me.onboarding_completed&&!onboarding)router.replace('/onboarding');
  },[auth.loading,auth.token,auth.error,auth.me,onboarding,path,router]);
  if(!auth.me||(!auth.me.onboarding_completed&&!onboarding))return <WorkspaceLoading error={auth.loading?null:auth.error}/>;
  const secondary=path.startsWith('/settings/')||path==='/help'||path.startsWith('/documents/');
  const active=(href:string)=>path===href||href==='/explore'&&(path==='/search'||path.startsWith('/documents/'))||href==='/watchlist'&&company||href==='/settings'&&(path.startsWith('/settings/')||path==='/help');
  const nav=[['/today',t('홈','Home'),'home'],['/explore',t('탐색','Explore'),'search'],path==='/saved'?['/saved',t('저장 / 기록','Saved'),'bookmark']:['/watchlist',t('관심종목','Watchlist'),'star'],['/portfolio',t('포트폴리오','Portfolio'),'pie'],['/settings',t('설정','Settings'),'settings']];
  return <div className={`sb-mobile ${onboarding?'m-onboarding-shell':''} ${event?'m-event-shell':''} ${company?'m-company-shell':''}`}>
    <a className="m-skip" href="#mobile-main">{t('본문으로 이동','Skip to content')}</a>
    {!onboarding && (event||company ? <header className="m-detail-header"><button type="button" className="m-icon-button" aria-label={t('뒤로 가기','Go back')} onClick={()=>{if(window.history.length>1)router.back();else router.push('/today');}}><MIcon name="back" size={23}/></button><strong>{event?t('이벤트 상세','Event details'):t('기업 개요','Company overview')}</strong>{event&&<div className="m-header-actions"><Link className="m-icon-button" href="/explore" aria-label={t('검색','Search')}><MIcon name="search" size={23}/></Link><Link className="m-avatar" href="/settings" aria-label={t('내 계정','My account')}><MIcon name="person" size={24}/></Link></div>}</header> : <header className="m-brand-header"><Link className="m-brand" href="/today" aria-label="SignalBrief"><strong>Signal<span>Brief</span></strong><small>{t('세상의 신호를, 더 나은 투자로','A clearer view. A better decision.')}</small></Link><div className="m-header-actions"><Link className="m-icon-button" href="/explore" aria-label={t('검색','Search')}><MIcon name="search" size={25}/></Link><Link className="m-avatar" href="/settings" aria-label={t('내 계정','My account')}><MIcon name="person" size={25}/></Link></div></header>)}
    <main id="mobile-main" className={`m-main ${secondary?'m-workspace-page ws':''}`}>{secondary&&<Link className="m-backlink" href={path.startsWith('/settings/')?'/settings':'/today'}><MIcon name="back" size={16}/>{path.startsWith('/settings/')?t('설정','Settings'):t('홈','Home')}</Link>}{children}</main>
    {!onboarding&&!event&&<nav className="m-bottom-nav" aria-label={t('모바일 메뉴','Mobile navigation')}>{nav.map(([href,label,icon])=><Link key={href} href={href} className={active(href)?'active':''} aria-current={active(href)?'page':undefined}><MIcon name={icon} size={25}/><span>{label}</span></Link>)}</nav>}
  </div>;
}
