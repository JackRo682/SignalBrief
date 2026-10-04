"use client";
import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/components/auth";
import { internalNavigation } from "@/lib/internal-navigation";
import { pageDataCache } from "@/lib/page-data-cache";
import { siteOrigin } from "@/lib/site-url";
import { API_URL } from "@/lib/api";
import { getSupabase, initializeSupabase } from "@/lib/supabase";
import { templates } from "./templates";
import { polishReference } from "./publication";
import { mountReference, type Row, type ReferenceContext } from "./controller";
import "./reference.css";
import "./overrides.css";
import "./publication.css";

type Screen=keyof typeof templates;
export default function ReferenceApp({screen,id}:{screen:Screen;id?:string}){
 const auth=useAuth(), router=useRouter(),path=usePathname(),root=useRef<HTMLDivElement>(null);
 const latest=useRef(auth);useEffect(()=>{latest.current=auth;},[auth]);
 const publicPage=screen==="landing",signedIn=!!auth.me;
 useEffect(()=>{if(!publicPage&&!auth.loading&&!auth.error&&!auth.token)router.replace("/login");},[publicPage,auth.loading,auth.error,auth.token,router]);
 useEffect(()=>{if(!publicPage&&auth.me&&!auth.me.onboarding_completed&&screen!=="onboarding"&&screen!=="setup")router.replace("/onboarding");},[publicPage,auth.me,screen,router]);
 useEffect(()=>{
  if(!root.current||(!publicPage&&!signedIn))return;
  const target=root.current;
  target.innerHTML=templates[screen];
  const api=async(endpoint:string,method="GET",payload?:unknown)=>{
   const selected=latest.current;
   return pageDataCache.request(selected.token,endpoint,method,async()=>{
   const url=endpoint.startsWith("/market")?"/api/market"+endpoint.slice(7):endpoint==="/v1/public/stats"?"/api/public-stats":API_URL+endpoint;
   const response=await fetch(url,{method,cache:"no-store",headers:{...(selected.token?{Authorization:`Bearer ${selected.token}`} : {}),...(payload!==undefined?{"Content-Type":"application/json"}:{})},...(payload!==undefined?{body:JSON.stringify(payload)}:{}),signal:AbortSignal.timeout(30000)});
   if(response.status===204)return null;
   const data=await response.json().catch(()=>null);
   if(!response.ok){const code=data?.error?.code??data?.error??`HTTP ${response.status}`;if(response.status===401&&!publicPage)router.replace("/login");throw new Error(typeof code==="string"?code:"요청을 완료하지 못했습니다.");}
   if(endpoint.startsWith("/v1/companies?")&&Array.isArray(data))return data.filter(c=>c.provider==="sec");
   return data;
   });
  };
  const context: ReferenceContext = {
   id,user:latest.current.me as unknown as Row|null,demo:!!latest.current.config?.demo_mode,
   go:(url)=>router.push(url),api,
   rpc:async(name,args={})=>{
    const readOnly = ["sb_reference_ops","sb_reference_users","sb_resolve_companies"].includes(name)||
      (["sb_reference_preferences","sb_reference_reminders"].includes(name)&&!Object.hasOwn(args,"p"))||
      (name==="sb_reference_reminders"&&(args.p as Row|undefined)?.action==="list");
    if(!readOnly)pageDataCache.reset(latest.current.token);
    const result=await getSupabase().rpc(name,args);
    if(result.error)throw new Error(/^[a-z_0-9]+$/.test(result.error.message)?result.error.message:"설정을 저장하지 못했습니다. 입력값과 로그인 상태를 확인하세요.");
    if(!readOnly)pageDataCache.reset(latest.current.token);
    return result.data;
   },
   download:async(endpoint,name)=>{const token=latest.current.token;const response=await fetch(API_URL+endpoint,{headers:token?{Authorization:`Bearer ${token}`}:{},cache:"no-store",signal:AbortSignal.timeout(30000)});if(!response.ok)throw new Error("파일을 내려받지 못했습니다.");const url=URL.createObjectURL(await response.blob());const a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);},
   auth:async(kind,fields={})=>{
    const selected=latest.current;if(kind==="logout"){await selected.logout();return {};}
    if(kind==="google"){await selected.googleLogin();return {};}
    if(kind==="demo"||kind==="demo-admin"){await selected.demoLogin(kind==="demo-admin");return {};}
    const callback=siteOrigin(location.href,process.env.NEXT_PUBLIC_SITE_URL,process.env.NODE_ENV === "production")+"/auth/callback";
    const db=await initializeSupabase(),email=String(fields.email??""),password=String(fields.password??"");
    if(kind==="login"){const {error}=await db.auth.signInWithPassword({email,password});if(error)throw new Error("이메일 또는 비밀번호를 확인해 주세요.");location.assign("/today");return {};}
    if(kind==="signup"){const result=await db.auth.signUp({email,password,options:{emailRedirectTo:callback}});if(result.error)throw new Error("가입을 완료하지 못했습니다. 이메일 형식과 비밀번호를 확인하거나 Google 로그인을 이용하세요.");if(result.data.session)location.assign("/onboarding");return {session:!!result.data.session};}
    if(kind==="reset"){const {error}=await db.auth.resetPasswordForEmail(email,{redirectTo:`${callback}?next=reset-password`});if(error)throw new Error("메일 요청이 제한되었습니다. 잠시 후 다시 시도해 주세요.");return {};}
    throw new Error("지원하지 않는 로그인 방식입니다.");
   }
  };
  const navigate=(event:MouseEvent)=>{
   const destination=internalNavigation(event,location.href);
   if(destination){event.preventDefault();router.push(destination);}
  };
  target.addEventListener("click",navigate);
  const unmount = mountReference(target,screen,context);
  const unpolish = polishReference(target,screen,context);
  if(screen!=="landing"){
    const banner=document.createElement("div");banner.className="usLaunchNotice";banner.innerHTML='<strong>US 주식 초기 버전</strong> · OpenDART·KRX는 보류되어 한국 공시·시세는 제공하지 않습니다. <a href="/us">미국 공시·연결 상태 보기 →</a>';
    (target.querySelector(".main")??target).prepend(banner);
  }
  return ()=>{target.removeEventListener("click",navigate);unpolish();unmount();};
 },[screen,id,path,publicPage,signedIn,auth.config?.demo_mode,router]);
 if(!publicPage&&!signedIn)return <main className="referenceGate"><Link href="/">SignalBrief</Link><h1>{auth.error?"연결을 확인해 주세요":"계정을 확인하고 있습니다"}</h1><p role={auth.error?"alert":"status"}>{auth.error??"잠시만 기다려 주세요."}</p>{auth.error&&<><button onClick={()=>location.reload()}>다시 시도</button><Link href="/login">로그인</Link></>}</main>;
 return <div ref={root} className={`reference-ui screen-${screen}`} data-screen={screen} dangerouslySetInnerHTML={{__html:templates[screen]}} />;
}
