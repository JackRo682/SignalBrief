"use client";
import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth";
import { useAction,ActionNotice,Loading,ErrorState } from "@/components/ui";
export default function Login(){const auth=useAuth(),action=useAction(),router=useRouter();
  useEffect(()=>{if(auth.me)router.replace(auth.me.onboarding_completed?"/today":"/onboarding");},[auth.me,router]);
  return <main className="auth-wrap"><Link className="brand" href="/"><span className="brand-mark">S</span>SignalBrief</Link><section className="auth-card"><p className="eyebrow">WELCOME BACK</p><h1>변화를 읽는<br/>새로운 시작</h1><p className="muted">관심종목을 선택하고 원문에 기반한 브리핑을 확인하세요.</p>{auth.loading?<Loading/>:auth.error?<ErrorState message={auth.error} retry={()=>location.reload()}/>:<>{auth.config?.demo_mode?<><div className="notice">키 없이 체험하는 합성 데이터 데모입니다. 실제 기업 자료와 연결되지 않습니다.</div><button className="button primary full" disabled={action.busy} onClick={()=>action.run(()=>auth.demoLogin())}>데모로 시작하기 →</button>{auth.config.demo_admin_enabled&&<button className="button secondary full" disabled={action.busy} onClick={()=>action.run(()=>auth.demoLogin(true))}>개발용 운영자 데모</button>}</>:<button className="button primary full" disabled={action.busy} onClick={()=>action.run(()=>auth.googleLogin())}>Google로 로그인</button>}<ActionNotice action={action}/></>}<p className="small muted">인증 세션은 브라우저에 저장됩니다. 공용 기기에서는 사용 후 로그아웃해 주세요.</p><Link className="small" href="/privacy">개인정보 처리 안내</Link></section></main>;}
