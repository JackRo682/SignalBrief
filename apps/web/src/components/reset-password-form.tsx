'use client';
import {useRef,useState,type FormEvent} from 'react';
import Link from 'next/link';
import {initializeSupabase} from '@/lib/supabase';

export default function ResetPasswordForm(){
 const [password,setPassword]=useState(''),[repeat,setRepeat]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const inFlight=useRef(false);
 async function save(event:FormEvent){
  event.preventDefault();
  if(inFlight.current)return;
  setMessage('');
  if(password!==repeat){setMessage('두 비밀번호가 다릅니다. 다시 확인해 주세요.');return;}
  inFlight.current=true;setBusy(true);
  try{
   const db=await initializeSupabase(),{data,error}=await db.auth.getUser();
   if(error||!data.user)throw new Error('session');
   const result=await db.auth.updateUser({password});
   if(result.error)throw result.error;
   await db.auth.signOut({scope:'local'});
   // Reload after revoking the local session so AuthProvider bootstraps without it.
   location.replace('/login');
  }catch{setMessage('복구 세션이 만료되었거나 변경하지 못했습니다. 새 복구 메일을 요청해 주세요.');}
  finally{inFlight.current=false;setBusy(false);}
 }
 return <form className="login-box form-stack" onSubmit={save} aria-label="새 비밀번호 설정" aria-busy={busy}><p className="eyebrow">ACCOUNT RECOVERY</p><h2>새 비밀번호 설정</h2><p className="muted">새 비밀번호로 계정을 안전하게 연결하세요.</p><label className="field"><span>새 비밀번호 · 12자 이상</span><input required type="password" autoComplete="new-password" minLength={12} maxLength={128} value={password} onChange={event=>setPassword(event.target.value)} disabled={busy}/></label><label className="field"><span>다시 입력</span><input required type="password" autoComplete="new-password" maxLength={128} value={repeat} onChange={event=>setRepeat(event.target.value)} disabled={busy}/></label>{message&&<p role="alert" className="notice danger">{message}</p>}<button className="button primary full" disabled={busy}>{busy?'저장 중…':'비밀번호 저장'}</button><div className="auth-links"><Link href="/forgot-password">새 복구 메일 요청</Link><Link href="/login">로그인으로 돌아가기</Link></div></form>;
}
