"use client";
import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/components/auth";
import { API_URL } from "@/lib/api";
import { getSupabase } from "@/lib/supabase";
import { templates } from "./templates";
import { mountReference, type Row } from "./controller";
import "./reference.css";
import "./overrides.css";

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
   const url=endpoint.startsWith("/market")?"/api/market"+endpoint.slice(7):endpoint==="/v1/public/stats"?"/api/public-stats":API_URL+endpoint;
   const response=await fetch(url,{method,cache:"no-store",headers:{...(selected.token?{Authorization:`Bearer ${selected.token}`} : {}),...(payload!==undefined?{"Content-Type":"application/json"}:{})},...(payload!==undefined?{body:JSON.stringify(payload)}:{}),signal:AbortSignal.timeout(30000)});
   if(response.status===204)return null;
   const data=await response.json().catch(()=>null);
   if(!response.ok){const code=data?.error?.code??data?.error??`HTTP ${response.status}`;if(response.status===401&&!publicPage)router.replace("/login");throw new Error(typeof code==="string"?code:"요청을 완료하지 못했습니다.");}
   return data;
  };
  return mountReference(target,screen,{
   id,user:latest.current.me as unknown as Row|null,demo:!!latest.current.config?.demo_mode,
   go:(url)=>router.push(url),api,
   rpc:async(name,args={})=>{
    const result=await getSupabase().rpc(name,args);
    if(result.error)throw new Error(/^[a-z_0-9]+$/.test(result.error.message)?result.error.message:"설정을 저장하지 못했습니다. 입력값과 로그인 상태를 확인하세요.");
    return result.data;
   },
   download:async(endpoint,name)=>{const token=latest.current.token;const response=await fetch(API_URL+endpoint,{headers:token?{Authorization:`Bearer ${token}`}:{},cache:"no-store",signal:AbortSignal.timeout(30000)});if(!response.ok)throw new Error("파일을 내려받지 못했습니다.");const url=URL.createObjectURL(await response.blob());const a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);},
   auth:async(kind,fields={})=>{
    const selected=latest.current;if(kind==="logout"){await selected.logout();return {};}
    if(kind==="google"){await selected.googleLogin();return {};}
    if(kind==="demo"||kind==="demo-admin"){await selected.demoLogin(kind==="demo-admin");return {};}
    const db=getSupabase(),email=String(fields.email??""),password=String(fields.password??"");
    if(kind==="login"){const {error}=await db.auth.signInWithPassword({email,password});if(error)throw new Error("이메일 또는 비밀번호를 확인해 주세요.");location.assign("/today");return {};}
    if(kind==="signup"){const result=await db.auth.signUp({email,password,options:{emailRedirectTo:`${location.origin}/auth/callback`}});if(result.error)throw new Error("가입을 완료하지 못했습니다. 이메일 형식과 비밀번호를 확인하거나 Google 로그인을 이용하세요.");if(result.data.session)location.assign("/onboarding");return {session:!!result.data.session};}
    if(kind==="reset"){const {error}=await db.auth.resetPasswordForEmail(email,{redirectTo:`${location.origin}/auth/callback?next=reset-password`});if(error)throw new Error("메일 요청이 제한되었습니다. 잠시 후 다시 시도해 주세요.");return {};}
    throw new Error("지원하지 않는 로그인 방식입니다.");
   }
  });
 },[screen,id,path,publicPage,signedIn,auth.config?.demo_mode,router]);
 if(!publicPage&&!signedIn)return <main className="referenceGate"><Link href="/">SignalBrief</Link><h1>{auth.error?"연결을 확인해 주세요":"계정을 확인하고 있습니다"}</h1><p role={auth.error?"alert":"status"}>{auth.error??"잠시만 기다려 주세요."}</p>{auth.error&&<><button onClick={()=>location.reload()}>다시 시도</button><Link href="/login">로그인</Link></>}</main>;
 return <div ref={root} className={`reference-ui screen-${screen}`} data-screen={screen} />;
}
