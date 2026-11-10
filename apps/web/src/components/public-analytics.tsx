'use client';
import {useEffect,useState} from 'react';
import {usePathname} from 'next/navigation';
import {consentChoice,flushVerifiedSignup,measurementId,pauseMeasurement,publicScreens,setMeasurementConsent,trackPublicPage,trackSignupClick} from '@/lib/public-analytics';
import './public-analytics.css';
export default function PublicAnalytics(){
 const path=usePathname();
 const [choice,setChoice]=useState<string|null>(null),[ready,setReady]=useState(false),[editing,setEditing]=useState(false);
 const isPublic=Boolean(publicScreens[path]);
 useEffect(()=>{setChoice(consentChoice());setReady(true);const sync=()=>setChoice(consentChoice());window.addEventListener('storage',sync);return()=>window.removeEventListener('storage',sync);},[]);
 useEffect(()=>{
  if(!measurementId()||!ready)return;
  // Deliver a confirmed conversion after navigation, using only the fixed signup URL.
  const signupSent=flushVerifiedSignup(!isPublic);
  if(!isPublic){if(!signupSent)pauseMeasurement();return;}
  if(choice!=='granted'){pauseMeasurement();return;}
  trackPublicPage(path,document.referrer);
  const click=(event:MouseEvent)=>{const target=event.target;if(!(target instanceof Element))return;const anchor=target.closest('a');if(!anchor)return;try{const url=new URL(anchor.href,location.href);if(url.origin===location.origin&&url.pathname==='/signup')trackSignupClick();}catch{/* Invalid links are not events. */}};
  document.addEventListener('click',click);return()=>{document.removeEventListener('click',click);pauseMeasurement();};
 },[path,isPublic,choice,ready]);
 if(!measurementId()||!ready||!isPublic)return null;
 function choose(granted:boolean){setMeasurementConsent(granted);setChoice(granted?'granted':'denied');setEditing(false);}
 return <aside className="sbAnalytics" aria-label="방문 통계 설정">{choice===null||editing?<><p>방문 경로와 가입 전환을 측정하기 위해 Google Analytics를 사용할까요? 동의하지 않아도 모든 기능을 이용할 수 있습니다. <a href="/privacy">개인정보처리방침</a></p><div><button type="button" onClick={()=>choose(false)}>거부</button><button type="button" onClick={()=>choose(true)}>동의</button></div></>:<button type="button" onClick={()=>setEditing(true)}>방문 통계 설정</button>}</aside>;
}
