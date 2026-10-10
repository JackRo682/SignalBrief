'use client';
import Link from 'next/link';
import {usePathname,useRouter,useSearchParams} from 'next/navigation';
import {Suspense,useEffect,useRef,useState,type ReactNode,type RefObject} from 'react';
import {useAuth} from '@/components/auth';
import {Icon,type IconName} from '@/components/icons';
import WorkspaceLoading from '@/components/workspace-loading';
import {usePcResource as useResource} from './data';
import {notificationsSchema} from '@/lib/contracts';
import {useMutation} from '@/workspace/ui';
import {usePrefs} from '@/workspace/preferences';
import {PcNotice} from './ui';
import './shell.css';

const navigation:[string,string,string,IconName][]=[
 ['/today','홈','Home','home'],['/today#changes','오늘의 변화','Today’s changes','clock'],['/explore','검색 / 탐색','Search / explore','search'],['/watchlist','관심종목','Watchlist','star'],['/portfolio','포트폴리오','Portfolio','pie'],['/timeline','기업 타임라인','Company timeline','timeline'],['/calendar','캘린더','Calendar','calendar'],['/alerts','알림 센터','Notifications','bell'],['/settings','설정','Settings','settings']
];
function PcBrand(){return <svg className="pc-brand-mark" width="32" height="36" viewBox="0 0 32 36" aria-hidden="true"><path d="M5 18C1 14 4 6 10 3c6-4 13-1 15 4l-5 4c-1-3-4-4-6-2s-3 5-1 7l-8 9-4-4Z" fill="#096eff"/><path d="M27 16c4 4 1 12-5 15-6 4-13 1-15-4l5-4c1 3 4 4 6 2s3-5 1-7l8-9 4 4Z" fill="#247eff"/><path d="m9 26 14-16" stroke="white" strokeWidth="6" strokeLinecap="round"/><path d="m5 30 8-9m5-7 8-9" stroke="#096eff" strokeWidth="5" strokeLinecap="round"/></svg>;}
function PcGlobalSearch({inputRef}:{inputRef:RefObject<HTMLInputElement|null>}){
 const params=useSearchParams(),urlQuery=params.get('q')??'',router=useRouter(),{text:t}=usePrefs(),[query,setQuery]=useState(urlQuery);
 useEffect(()=>setQuery(urlQuery),[urlQuery]);
 return <form className="pc-global-search" onSubmit={event=>{event.preventDefault();const q=query.trim();router.push(q?`/search?q=${encodeURIComponent(q)}`:'/explore');}}><Icon name="search" size={22}/><input ref={inputRef} id="pc-global-search" value={query} onChange={event=>setQuery(event.target.value)} maxLength={100} autoComplete="off" placeholder={t('종목명 또는 키워드를 검색하세요','Search companies or keywords')} aria-label={t('전체 검색','Global search')}/><button type="submit" aria-label={t('검색','Search')}><span aria-hidden="true">↵</span></button></form>;
}
export function DesktopShell({children}:{children:ReactNode}){
 const auth=useAuth(),path=usePathname(),router=useRouter(),{text:t}=usePrefs(),action=useMutation();
 const searchRef=useRef<HTMLInputElement>(null),profileRef=useRef<HTMLDetailsElement>(null);
 const [fragment,setFragment]=useState('');
 const notifications=useResource(auth.me?.onboarding_completed?'/v1/notifications':null,notificationsSchema),unread=notifications.data?.filter(item=>!item.read_at).length??0;
 useEffect(()=>{if(!auth.loading&&!auth.token)router.replace(`/login?next=${encodeURIComponent(path+window.location.search)}`);else if(auth.me&&!auth.me.onboarding_completed)router.replace('/onboarding');},[auth.loading,auth.token,auth.me,path,router]);
 useEffect(()=>{if(profileRef.current)profileRef.current.open=false;setFragment(window.location.hash);},[path]);
 useEffect(()=>{const hash=()=>setFragment(window.location.hash);window.addEventListener('hashchange',hash);window.addEventListener('popstate',hash);return()=>{window.removeEventListener('hashchange',hash);window.removeEventListener('popstate',hash);};},[]);
 useEffect(()=>{const key=(event:KeyboardEvent)=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();searchRef.current?.focus();}if(event.key==='Escape'&&profileRef.current?.open){profileRef.current.open=false;profileRef.current.querySelector('summary')?.focus();}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[]);
 const active=(href:string)=>href==='/today'?path==='/today'&&fragment!=='#changes':href==='/today#changes'?path==='/today'&&fragment==='#changes':href==='/explore'?/^\/(explore|search|companies|documents)(\/|$)/.test(path)&&!path.endsWith('/timeline'):href==='/timeline'?path==='/timeline'||path.endsWith('/timeline'):href==='/settings'?path.startsWith('/settings'):path===href;
 if(!auth.me||!auth.me.onboarding_completed)return <WorkspaceLoading error={auth.loading?null:auth.error}/>;
 return <div className="sb-pc" data-desktop-shell="references-v1"><a className="pc-skip" href="#pc-main">{t('본문으로 이동','Skip to content')}</a>
 <aside className="pc-sidebar"><Link href="/today" className="pc-brand" aria-label="SignalBrief" onClick={()=>setFragment('')}><PcBrand/><span>SignalBrief</span></Link><nav aria-label={t('주 메뉴','Main navigation')}>{navigation.map(([href,ko,en,icon])=><Link key={href} href={href} onClick={()=>setFragment(href.includes('#')?'#'+href.split('#')[1]:'')} className={active(href)?'active':''} aria-current={active(href)?'page':undefined}><Icon name={icon} size={22}/><span>{t(ko,en)}</span></Link>)}{path==='/questions'&&<Link href="/questions" className="active" aria-current="page"><Icon name="spark" size={22}/>{t('AI 후속 질문','AI follow-up')}</Link>}</nav>
 <div className="pc-sidebar-bottom"><div className="pc-promo"><svg viewBox="0 0 64 38" width="64" height="38" aria-hidden="true"><path d="M3 32 18 17 26 23 37 11 44 16 60 2m-9 0h9v9" fill="none" stroke="currentColor" strokeWidth="1.8"/></svg><p>{t('더 나은','A clearer view,')}<br/>{t('투자의 결정을 위해','grounded in evidence.')}<br/>SignalBrief{t('가','')}<br/>{t('함께합니다.','')}</p><svg className="pc-promo-wave" viewBox="0 0 190 120" aria-hidden="true"><path d="M0 90c25-22 28 30 58-1 24-25 28-51 53-27 28 29 41-52 79-40v98H0Z" fill="#b9d7ff"/><path d="M0 93c27-12 31 18 55 7 40-18 49-62 76-31 25 29 40-9 59-2v53H0Z" fill="#d3e6ff"/></svg></div><p className="pc-sidebar-caption">{t('데이터가 만드는','Evidence for')}<br/>{t('더 나은 투자 시선','a clearer perspective')}<br/><strong>SignalBrief</strong></p></div></aside>
 <header className="pc-topbar"><Suspense fallback={<div className="pc-global-search" aria-busy="true"><Icon name="search" size={22}/></div>}><PcGlobalSearch inputRef={searchRef}/></Suspense>
 <div className="pc-top-actions"><Link href="/alerts" className="pc-top-bell" aria-label={t(`알림 센터${unread?` · 읽지 않은 알림 ${unread}개`:''}`,`Notifications${unread?` · ${unread} unread`:''}`)}><Icon name="bell" size={24}/>{unread>0&&<i/>}</Link><span className="pc-top-divider"/><details ref={profileRef} className="pc-profile"><summary><span className="pc-avatar">{auth.me.display_name.slice(0,1)}</span><span>{auth.me.display_name}{t('님','')}</span><span className="pc-profile-chevron" aria-hidden="true">⌄</span></summary><div className="pc-profile-menu"><Link href="/settings/account">{t('계정 정보','Account details')}</Link><Link href="/saved">{t('저장 / 기록','Saved / history')}</Link><Link href="/questions">{t('AI 후속 질문','AI follow-up')}</Link><Link href="/help">{t('도움말 및 지원','Help & support')}</Link>{auth.me.is_admin&&<Link href="/ops">{t('운영 콘솔','Operations')}</Link>}<button disabled={action.busy} onClick={()=>void action.run(async()=>{await auth.logout();router.replace('/login');})}>{t('로그아웃','Sign out')}</button><PcNotice action={action}/></div></details></div></header>
 <main id="pc-main" className="pc-main" key={auth.me.id}>{children}</main></div>;
}
