'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {initializeSupabase} from '@/lib/supabase';
import {completeOAuth} from '@/lib/oauth-callback';
export default function Callback(){
 const [error,setError]=useState('');
 useEffect(()=>{let active=true;initializeSupabase().then(db=>completeOAuth(db,location.href)).then(path=>{if(active)location.replace(path);}).catch(e=>{if(active)setError(e instanceof Error?e.message:'oauth_failed');});return()=>{active=false;};},[]);
 return <main className="auth-wrap"><h1>{error?'로그인을 완료하지 못했습니다':'로그인을 확인하고 있습니다'}</h1>{error?<><p role="alert">오류 코드: {error}</p><p>로그인을 시작한 같은 브라우저에서 다시 시도해 주세요. 반복되면 이 오류 코드를 알려주세요. 새 Google API를 구매할 필요는 없습니다.</p><Link href="/login" className="button primary">로그인 다시 시작</Link><p><Link href="/status">연결 진단 보기</Link></p></>:<p role="status">Google 인증 코드를 한 번만 교환한 뒤 실제 사용자 세션을 확인합니다.</p>}</main>;
}
