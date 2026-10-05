'use client';
import {useRef,useState,type FormEvent} from 'react';
import Link from 'next/link';
import {PasswordEye,SecurityPicture} from './marketing/screenshot-preview';
import {initializeSupabase} from '@/lib/supabase';

export default function ResetPasswordForm(){
 const [password,setPassword]=useState(''),[repeat,setRepeat]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const [show,setShow]=useState(false),[showRepeat,setShowRepeat]=useState(false);
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
 return <form className="login-box v-login-box v-reset-password-form form-stack" onSubmit={save} aria-label="새 비밀번호 설정" aria-busy={busy}><SecurityPicture/><h1>새 비밀번호 설정</h1><p className="muted">더 안전한 계정 사용을 위해<br/>새로운 비밀번호를 설정해주세요.</p><label className="field"><span>새 비밀번호</span><div className="password-field"><input required type={show?'text':'password'} placeholder="새 비밀번호를 입력해주세요." autoComplete="new-password" minLength={12} maxLength={128} value={password} onChange={event=>setPassword(event.target.value)} disabled={busy}/><button type="button" disabled={busy} aria-label={show?'비밀번호 숨기기':'비밀번호 보기'} aria-pressed={show} onClick={()=>setShow(v=>!v)}><PasswordEye visible={show}/></button></div></label><label className="field"><span>비밀번호 확인</span><div className="password-field"><input required type={showRepeat?'text':'password'} placeholder="비밀번호를 다시 입력해주세요." autoComplete="new-password" maxLength={128} value={repeat} onChange={event=>setRepeat(event.target.value)} disabled={busy}/><button type="button" disabled={busy} aria-label={showRepeat?'확인 비밀번호 숨기기':'확인 비밀번호 보기'} aria-pressed={showRepeat} onClick={()=>setShowRepeat(v=>!v)}><PasswordEye visible={showRepeat}/></button></div></label><div className="v-password-guide"><b>안전한 비밀번호를 만들어주세요.</b><p className={password.length>=12?'is-met':''}><span>✓</span>12자 이상 128자 이하</p><p className={password&&password===repeat?'is-met':''}><span>✓</span>비밀번호 확인 일치</p><small>다른 서비스에서 사용하지 않는 긴 비밀번호를 권장합니다.</small></div>{message&&<p role="alert" className="notice danger">{message}</p>}<button className="button primary full" disabled={busy}>{busy?'저장 중…':'비밀번호 변경'}</button><p className="v-reset-note">변경 후에는 새로운 비밀번호로 다시 로그인해주세요.</p><div className="auth-links"><Link href="/forgot-password">새 복구 메일 요청</Link><Link href="/login">로그인으로 돌아가기</Link></div></form>;
}
