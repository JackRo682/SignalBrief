"use client";
import { useEffect, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { Loading,ErrorState } from "@/components/ui";
export default function Callback(){const started=useRef(false),[error,setError]=useState<string|null>(null);
  useEffect(()=>{if(started.current)return;started.current=true;const params=new URLSearchParams(location.search),code=params.get("code");
    if(params.has("error")||!code){setError("Google 인증이 취소되었거나 인증 코드가 없습니다. 로그인부터 다시 시도해 주세요.");return;}
    getSupabase().auth.exchangeCodeForSession(code).then(({error})=>{if(error)throw error;location.replace("/today");}).catch(()=>setError("인증 코드를 확인하지 못했습니다. 같은 브라우저에서 다시 로그인해 주세요."));
  },[]);return <main className="auth-wrap">{error?<ErrorState message={error} retry={()=>location.replace("/login")}/>:<Loading label="Google 인증을 마무리하고 있습니다."/>}</main>;}
