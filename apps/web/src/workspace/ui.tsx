'use client';
import Link from 'next/link';
import Image from 'next/image';
import {usePathname,useRouter} from 'next/navigation';
import {useCallback,useEffect,useRef,useState,type ReactNode} from 'react';
import {z} from 'zod';
import {useAuth} from '@/components/auth';
import {Icon,BrandMark,type IconName} from '@/components/icons';
import WorkspaceLoading from '@/components/workspace-loading';
import {workspace} from './client';
import {usePrefs} from './preferences';
import {type WorkspaceRequest,type Resource,resourceHref,safeSource,chartPoints} from './contracts';
import {pageDataCache} from '@/lib/page-data-cache';
import './workspace.css';
export {Icon};
export function useData<T>(req:WorkspaceRequest|null,schema:z.ZodType<T>){
 const {token}=useAuth(),[seq,setSeq]=useState(0);
 const [state,setState]=useState<{key:string;scope:string|null;data:T|null;loading:boolean;error:string}>({key:'',scope:null,data:null,loading:true,error:''});
 const serialized=JSON.stringify(req),key='workspace:'+serialized;
 const snapshot=token&&req?pageDataCache.peek<T>(token,key):undefined;
 const current=state.key===key&&state.scope===token;
 const data=current&&state.data!==null?state.data:snapshot??null;
 const loading=Boolean(token&&req&&!data&&(!current||state.loading));
 useEffect(()=>{
  if(!token||serialized==='null'){setState({key,scope:token,data:null,loading:false,error:''});return;}
  let alive=true;
  const saved=pageDataCache.peek<T>(token,key);
  setState({key,scope:token,data:saved??null,loading:saved===undefined,error:''});
  void Promise.resolve().then(()=>{
   if(!alive)return;
   return pageDataCache.request(token,key,'GET',()=>workspace(token,JSON.parse(serialized) as WorkspaceRequest,schema,AbortSignal.timeout(25000)))
     .then(value=>{if(alive)setState({key,scope:token,data:value,loading:false,error:''});})
     .catch(e=>{if(alive)setState({key,scope:token,data:pageDataCache.peek<T>(token,key)??null,loading:false,error:e instanceof Error?e.message:'요청 오류'});});
  });
  return()=>{alive=false;};
 },[token,key,serialized,schema,seq]);
 const reload=useCallback(()=>{pageDataCache.reset(token);setSeq(x=>x+1);},[token]);
 return {data,loading,error:current?state.error:'',reload};
}
export function useMutation(){const [busy,setBusy]=useState(false),[error,setError]=useState(''),[success,setSuccess]=useState('');const lock=useRef(false),alive=useRef(true);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 async function run(fn:()=>Promise<unknown>,message=''){if(lock.current)return false;lock.current=true;setBusy(true);setError('');setSuccess('');try{await fn();pageDataCache.reset();if(alive.current)setSuccess(message);return true;}catch(e){if(alive.current)setError(e instanceof Error?e.message:'요청 오류');return false;}finally{lock.current=false;if(alive.current)setBusy(false);}}
 return {busy,error,success,run};
}
export function Notice({action}:{action:ReturnType<typeof useMutation>}){return <>{action.error&&<div role="alert" className="ws-notice ws-error">{action.error}</div>}{action.success&&<div role="status" className="ws-notice ws-success">{action.success}</div>}</>;}
export function DataState({loading,error,retry}:{loading:boolean;error:string;retry:()=>void}){const {text:t}=usePrefs();return <>{loading&&<div role="status" aria-label={t('불러오는 중','Loading')} className="ws-loading"><i/><i/><i/></div>}{error&&<div role="alert" className="ws-notice ws-error">{error}<button onClick={retry}>{t('다시 시도','Retry')}</button></div>}</>;}
export function Panel({title,icon='file',action,children,className=''}:{title?:string;icon?:IconName;action?:ReactNode;children:ReactNode;className?:string}){return <section className={`ws-panel ${className}`}>{title&&<header className="ws-panel-head"><h2><Icon name={icon}/>{title}</h2>{action}</header>}{children}</section>;}
export function Heading({title,description,section,action}:{title:string;description?:string;section?:string;action?:ReactNode}){const {text:t}=usePrefs();return <header className="ws-heading"><div className="ws-breadcrumb"><Link href="/today">{t('홈','Home')}</Link><span>›</span>{section&&<><Link href="/settings">{section}</Link><span>›</span></>}{title}</div><div className="ws-heading-row"><div><h1>{title}</h1>{description&&<p>{description}</p>}</div>{action}</div></header>;}
export function Empty({title,description,href,label}:{title:string;description?:string;href?:string;label?:string}){return <div className="ws-empty"><Icon name="file" size={28}/><strong>{title}</strong>{description&&<p>{description}</p>}{href&&<Link className="ws-button ws-secondary" href={href}>{label}<Icon name="arrow" size={16}/></Link>}</div>;}
export function Logo({ticker,large=false}:{ticker:string;large?:boolean}){const known=['NVDA','AAPL','TSLA'];return <span className={`ws-logo ${large?'large':''}`} aria-hidden="true">{known.includes(ticker)?<Image alt="" src={`/reference-assets/logos/${ticker}.webp`} width={large?96:42} height={large?96:42}/>:ticker==='MSFT'?<span className="ws-msft"><i/><i/><i/><i/></span>:<b>{ticker.slice(0,3)}</b>}</span>;}
export function Switch({label,checked,onChange,disabled=false}:{label:string;checked:boolean;onChange:(v:boolean)=>void;disabled?:boolean}){return <button className="ws-switch" role="switch" aria-label={label} aria-checked={checked} disabled={disabled} onClick={()=>onChange(!checked)}><span/></button>;}
export function Chart({values}:{values:number[]}){const {text:t}=usePrefs(),points=chartPoints(values);return points?<svg className="ws-chart" viewBox="0 0 200 68" role="img" aria-label={t('공급자 종가 추이','Provider closing-price history')}><polyline fill="none" stroke="currentColor" strokeWidth="2.2" points={points}/></svg>:<span className="ws-muted ws-chart-empty">{t('차트 데이터 없음','Chart unavailable')}</span>;}
export function Modal({title,onClose,children}:{title:string;onClose:()=>void;children:ReactNode}){const ref=useRef<HTMLDialogElement>(null),{text:t}=usePrefs();useEffect(()=>{const dialog=ref.current;if(dialog&&!dialog.open)dialog.showModal();},[]);return <dialog ref={ref} className="ws-modal" onCancel={e=>{e.preventDefault();onClose();}} onClose={onClose} onClick={e=>{if(e.target===e.currentTarget){const b=e.currentTarget.getBoundingClientRect();if(e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom)onClose();}}}><header><h2>{title}</h2><button type="button" className="ws-icon-button" onClick={onClose} aria-label={t('닫기','Close')}><Icon name="close"/></button></header>{children}</dialog>;}
export function ResourceCard({item,saved=item.is_saved,onSaved,compact=false}:{item:Resource;saved?:boolean;onSaved?:()=>void;compact?:boolean}){const {token}=useAuth(),action=useMutation(),{text:t,date,value}=usePrefs();const [isSaved,setSaved]=useState(saved);useEffect(()=>setSaved(saved),[saved]);
 const track=()=>{if(value.history_enabled)void workspace(token,{action:'visit',p:{kind:item.kind,id:item.id}},z.unknown()).catch(()=>{});};
 return <article className={`ws-resource ${compact?'compact':''}`}><div className="ws-resource-icon">{item.kind==='company'?<Logo ticker={item.ticker}/>:<Icon name={item.kind==='event'?'calendar':'file'} size={24}/>}</div><div className="ws-resource-body"><div className="ws-meta"><span className={`ws-badge ${item.kind==='event'?'violet':''}`}>{item.kind==='company'?t('기업','Company'):item.kind==='event'?t('이벤트','Event'):t('공식 자료','Official source')}</span><span>{date(item.published_at,item.publication_precision)}</span></div><Link className="ws-resource-title" href={resourceHref(item)} onClick={track}>{item.title}</Link>{item.summary&&<p>{item.summary}</p>}<div className="ws-tags"><Link href={`/companies/${item.company_id}`}>{item.ticker}</Link><span>{item.market}</span><span>{item.category}</span></div>{item.saved_at&&<small className="ws-muted">{t('저장 / 방문','Saved / visited')} {date(item.saved_at)}</small>}</div><div className="ws-resource-actions"><Link className="ws-icon-button" href={resourceHref(item)} aria-label={`${item.title} ${t('열기','Open')}`} onClick={track}><Icon name="arrow" size={18}/></Link>{item.kind!=='company'&&<button className={`ws-icon-button ${isSaved?'selected':''}`} disabled={action.busy} aria-label={`${item.title} ${isSaved?t('저장 취소','Unsave'):t('저장','Save')}`} aria-pressed={isSaved} onClick={()=>void action.run(async()=>{await workspace(token,{action:'save',p:{id:item.id,kind:item.kind as 'event'|'document'|'filing',saved:!isSaved}},z.object({saved:z.boolean()}));setSaved(!isSaved);onSaved?.();})}><Icon name="star" size={18}/></button>}</div>{action.error&&<p role="alert" className="ws-error">{action.error}</p>}</article>;
}
const nav:[string,string,string,IconName][]=[['/today','오늘의 변화','Today','home'],['/explore','검색 / 탐색','Discover','search'],['/watchlist','관심종목','Watchlist','star'],['/portfolio','포트폴리오','Portfolio','pie'],['/timeline','기업 타임라인','Timeline','timeline'],['/calendar','캘린더','Calendar','calendar'],['/saved','저장 / 기록','Saved / history','file'],['/alerts','알림 센터','Alerts','bell'],['/help','도움말 및 지원','Help & support','shield'],['/settings','설정','Settings','settings']];
export function WorkspaceShell({children}:{children:ReactNode}){
 const auth=useAuth(),router=useRouter(),path=usePathname(),{text:t}=usePrefs(),[q,setQ]=useState(''),[menu,setMenu]=useState(false),action=useMutation();
 useEffect(()=>{if(!auth.loading&&!auth.token)router.replace(`/login?next=${encodeURIComponent(path)}`);if(auth.me&&!auth.me.onboarding_completed)router.replace('/onboarding');},[auth.loading,auth.token,auth.me,path,router]);
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();document.getElementById('ws-global-search')?.focus();}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[]);
 const active=(url:string)=>path===url||url==='/explore'&&(/^\/(search|companies|documents)(\/|$)/.test(path))||url==='/settings'&&path.startsWith('/settings');
 if(!auth.me)return <WorkspaceLoading error={auth.loading?null:auth.error}/>;
 return <div className="ws"><a className="ws-skip" href="#ws-main">{t('본문으로 이동','Skip to content')}</a><aside className={`ws-sidebar ${menu?'open':''}`}><Link href="/today" className="ws-brand"><BrandMark/>SignalBrief</Link><nav aria-label={t('주 메뉴','Main navigation')}>{nav.map(([href,ko,en,icon])=><Link key={href} href={href} className={active(href)?'active':''} aria-current={active(href)?'page':undefined} onClick={()=>setMenu(false)}><Icon name={icon}/>{t(ko,en)}</Link>)}{auth.me.is_admin&&<Link href="/ops"><Icon name="shield"/>{t('운영 콘솔','Operations')}</Link>}</nav><div className="ws-promo"><svg viewBox="0 0 72 38" aria-hidden="true"><path d="M1 34 17 19 30 29 47 12 57 18 69 3m-10 0h10v10" fill="none" stroke="currentColor" strokeWidth="2"/></svg><p>{t('더 나은 투자의 결정을 위해 SignalBrief가 함께합니다.','Read the evidence. Understand what changed.')}</p><div/></div><small>{t('데이터가 만드는 더 나은 투자 시선','A clearer view, grounded in data')}<br/>SignalBrief</small></aside>{menu&&<button className="ws-backdrop" aria-label={t('메뉴 닫기','Close menu')} onClick={()=>setMenu(false)}/>}
 <header className="ws-topbar"><button className="ws-icon-button ws-menu" aria-label={t('메뉴 열기','Open menu')} onClick={()=>setMenu(true)}><Icon name="menu"/></button><form onSubmit={e=>{e.preventDefault();router.push(`/search?q=${encodeURIComponent(q.trim())}`);}}><Icon name="search"/><input id="ws-global-search" value={q} maxLength={100} onChange={e=>setQ(e.target.value)} placeholder={t('종목명 또는 키워드를 검색하세요','Search companies or keywords')} aria-label={t('전체 검색','Global search')}/><button type="submit" className="ws-search-submit" aria-label={t('검색','Search')}>↵</button></form><div className="ws-top-actions"><Link href="/alerts" className="ws-icon-button" aria-label={t('알림 센터','Alerts')}><Icon name="bell" size={23}/></Link><details className="ws-profile"><summary><span className="ws-avatar">{auth.me.display_name.slice(0,1)}</span><span>{auth.me.display_name}</span><span>⌄</span></summary><div className="ws-profile-menu"><Link href="/settings/account">{t('계정 정보','Account')}</Link><Link href="/saved">{t('저장 / 기록','Saved / history')}</Link><button disabled={action.busy} onClick={()=>void action.run(async()=>{await auth.logout();router.replace('/login');})}>{t('로그아웃','Sign out')}</button><Notice action={action}/></div></details></div></header>
 <main id="ws-main" className="ws-main">{children}</main><nav className="ws-bottom" aria-label={t('모바일 메뉴','Mobile navigation')}>{[nav[0],nav[2],nav[3],nav[1],nav[9]].map(([href,ko,en,icon])=><Link key={href} className={active(href)?'active':''} href={href}><Icon name={icon}/><span>{t(ko,en)}</span></Link>)}</nav></div>;
}
export function SettingsTabs(){const path=usePathname(),{text:t}=usePrefs();return <nav className="ws-tabs ws-settings-tabs" aria-label={t('설정 메뉴','Settings navigation')}>{[['account','계정 정보','Account'],['security','보안 및 로그인','Security'],['notifications','알림 설정','Notifications'],['appearance','화면 및 언어','Appearance']].map(([key,ko,en])=><Link className={path.endsWith(key)||key==='account'&&path==='/settings'?'active':''} href={`/settings/${key}`} key={key}>{t(ko,en)}</Link>)}</nav>;}
export function External({url,children}:{url:string|null;children:ReactNode}){const safe=safeSource(url);return safe?<a href={safe} target="_blank" rel="noopener noreferrer" className="ws-link">{children} ↗</a>:<span className="ws-muted">{children} —</span>;}
