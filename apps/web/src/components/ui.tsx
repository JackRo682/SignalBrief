"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect, useCallback, type ReactNode } from "react";
import { z } from "zod";
import { request,errorMessage,externalUrl,body } from "@/lib/api";
import { meSchema, type EventCard } from "@/lib/contracts";
import { dateText,score,typeLabels } from "@/lib/format";
import { useAuth } from "./auth";
export function useResource<T>(path:string|null,schema:z.ZodType<T>) {
  const {token}=useAuth();const [data,setData]=useState<T|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState<string|null>(null),[revision,setRevision]=useState(0);
  const reload=useCallback(()=>setRevision(v=>v+1),[]);
  useEffect(()=>{if(!token||!path){setLoading(false);setData(null);return;}const ctrl=new AbortController();let active=true;
    setLoading(true);setError(null);request(path,token,schema,{signal:ctrl.signal}).then(value=>{if(active)setData(value);}).catch(e=>{if(active)setError(errorMessage(e));}).finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;ctrl.abort();};},[token,path,schema,revision]);
  return {data,loading,error,reload};
}
export function useAction(){const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[message,setMessage]=useState<string|null>(null);
  async function run(action:()=>Promise<unknown>,success?:string){setBusy(true);setError(null);setMessage(null);try{await action();if(success)setMessage(success);return true;}catch(e){setError(errorMessage(e));return false;}finally{setBusy(false);}}
  return {busy,error,message,run};
}
export function Loading({label="데이터를 불러오고 있습니다."}:{label?:string}){return <div className="loading" role="status"><span className="spinner"/>{label}<div className="skeleton"/><div className="skeleton narrow"/></div>;}
export function ErrorState({message,retry}:{message:string;retry?:()=>void}){return <div className="notice danger" role="alert"><strong>확인이 필요합니다</strong><p>{message}</p>{retry&&<button className="button secondary" onClick={retry}>다시 시도</button>}</div>;}
export function ActionNotice({action}:{action:ReturnType<typeof useAction>}){return <>{action.error&&<ErrorState message={action.error}/ >}{action.message&&<div className="notice success" role="status">{action.message}</div>}</>;}
export function Empty({title,children}:{title:string;children:ReactNode}){return <div className="empty"><span className="empty-symbol" aria-hidden="true">◎</span><h2>{title}</h2><div>{children}</div></div>;}
export function PageHeading({eyebrow="SIGNALBRIEF",title,description,actions}:{eyebrow?:string;title:string;description?:string;actions?:ReactNode}){return <header className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1>{description&&<p className="muted">{description}</p>}</div>{actions&&<div>{actions}</div>}</header>;}
export function SourceLink({url,demo,label="원문 열기"}:{url:string;demo?:boolean;label?:string}){const safe=externalUrl(url);return demo||!safe ? <span className="badge muted-badge">합성 자료 · 실제 원문 아님</span> : <a href={safe} target="_blank" rel="noopener noreferrer" className="source-link">{label} <span aria-hidden="true">↗</span></a>;}
const links=[["/today","오늘의 변화","◈"],["/watchlist","관심종목","☆"],["/portfolio","포트폴리오","▤"],["/calendar","이벤트 캘린더","▦"],["/alerts","알림 센터","◉"],["/settings","설정","⚙"]];
export function AppShell({children}:{children:ReactNode}) {
  const auth=useAuth(),router=useRouter(),path=usePathname();const action=useAction();
  useEffect(()=>{if(!auth.loading&&!auth.token&&!auth.error)router.replace("/login");else if(!auth.loading&&auth.me&&!auth.me.onboarding_completed&&path!=="/onboarding")router.replace("/onboarding");},[auth.loading,auth.token,auth.me,auth.error,path,router]);
  if(auth.loading)return <main className="auth-wrap"><Loading label="세션을 확인하고 있습니다."/></main>;
  if(auth.error)return <main className="auth-wrap"><ErrorState message={auth.error} retry={()=>location.reload()}/><Link href="/login">로그인으로 이동</Link></main>;
  if(!auth.me)return <main className="auth-wrap"><Loading/></main>;
  const me=auth.me;
  return <div className="workspace"><a className="skip-link" href="#main">본문으로 건너뛰기</a><aside className="sidebar"><Link className="brand" href="/today"><span className="brand-mark">S</span>SignalBrief<span className="beta">BETA</span></Link><p className="nav-caption">MY INTELLIGENCE</p><nav aria-label="주 메뉴">{links.map(([href,label,icon])=><Link key={href} className={`nav-item ${path===href?"active":""}`} href={href} aria-current={path===href?"page":undefined}><span aria-hidden="true">{icon}</span>{label}</Link>)}{me.is_admin&&<Link href="/ops" className={`nav-item ${path.startsWith("/ops")?"active":""}`}>⌘ 운영 콘솔</Link>}</nav><div className="sidebar-bottom"><div className="trust-mark">원문에서 시작하는 분석</div><p>근거 없는 주장은 게시하지 않습니다.</p></div></aside>
    <div className="workspace-body"><header className="topbar"><span className="top-context">Evidence-first portfolio intelligence</span><div className="top-actions"><label className="density-label">정보 밀도<select aria-label="정보 밀도" value={me.density} onChange={e=>{const density=e.target.value;void action.run(async()=>{await request("/v1/me",auth.token,meSchema,body("PATCH",{density}));await auth.refresh();auth.track("density_changed",{density});});}} disabled={action.busy}><option value="beginner">쉽게 보기</option><option value="advanced">자세히 보기</option></select></label><span className="avatar" aria-hidden="true">{me.display_name.slice(0,1)}</span><span className="user-name">{me.display_name}</span><button className="button subtle" disabled={action.busy} onClick={()=>action.run(async()=>{await auth.logout();router.replace("/login");})}>로그아웃</button></div></header>
      {me.demo_mode&&<div className="demo-banner">데모 모드 · 모든 기업·수치·공시는 합성 예시입니다. 실제 투자 판단에 사용하지 마세요.</div>}
      <main id="main" className="main-content"><ActionNotice action={action}/>{children}</main><footer className="footer">SignalBrief는 정보 탐색을 돕습니다. 투자 추천·목표주가·주가 예측은 제공하지 않습니다.</footer></div></div>;
}
export function EventTile({item}:{item:EventCard}){const {track}=useAuth();return <article className="event-card"><div className="card-top"><div className="company-token">{item.company.ticker.slice(0,2)}</div><div><Link className="company-name" href={`/companies/${item.company.id}`}>{item.company.name}</Link><div className="small muted">{item.company.ticker} · {item.company.market}</div></div><span className="badge">{typeLabels[item.event_type]??item.event_type}</span></div><Link href={`/events/${item.id}`} className="headline-link" onClick={()=>track("brief_opened",{event_id:item.id})}><h2>{item.headline}</h2></Link><p className="card-summary">{item.what_happened}</p><div className="card-meta"><span>{item.change_count}개 비교 항목</span><span>우선순위 {score(item.ranking.score)}/100</span><span>{item.is_demo?"합성 출처":`공식 출처 · Tier ${item.source_tier??"미상"}`}</span></div><details className="why"><summary>왜 이 변화가 표시되나요?</summary><p>{item.ranking.reason}</p><p className="small muted">순위 점수는 수익 가능성이나 정확도 확률이 아닙니다. 미제공 항목: {item.ranking.missing_components.join(", ")||"없음"}</p></details><div className="card-bottom"><time dateTime={item.published_at}>{dateText(item.published_at,item.publication_precision)}</time><Link href={`/events/${item.id}`} className="text-button" onClick={()=>track("brief_opened",{event_id:item.id})}>60초 Brief 보기 →</Link></div></article>;}
