"use client";
import {useEffect,useRef,useState} from 'react';
import {usePathname} from 'next/navigation';
import Link from 'next/link';
import {consentChoice,measurementId,setMeasurementConsent} from '@/lib/public-analytics';
import {useAuth} from '@/components/auth';
import {trafficPage} from './contracts';
import {chooseConsent,erasePending,privacySignal,readConsent,recordAcquisition,type Consent} from './client';
import './traffic.css';
export default function AcquisitionTracker(){
 const path=usePathname(),page=trafficPage(path),auth=useAuth();
 const [state,setState]=useState<{ready:boolean;consent:Consent|null;blocked:boolean}>({ready:false,consent:null,blocked:false});
 const [googleChoice,setGoogleChoice]=useState<string|null>(null);
 const [open,setOpen]=useState(false),[error,setError]=useState('');
 const lastView=useRef(''),completed=useRef(new Set<string>());
 useEffect(()=>{const sync=()=>{setGoogleChoice(consentChoice());setState({ready:true,consent:readConsent(),blocked:privacySignal()});};sync();void erasePending();
  window.addEventListener('sb:traffic-consent',sync);window.addEventListener('storage',sync);window.addEventListener('sb:google-consent',sync);
  return()=>{window.removeEventListener('sb:traffic-consent',sync);window.removeEventListener('storage',sync);window.removeEventListener('sb:google-consent',sync);};
 },[]);
 useEffect(()=>{if(!page||state.consent?.choice!=='yes'||state.blocked||auth.me?.is_admin)return;
  const key=state.consent.identity.visitor_id+'/'+page;if(lastView.current===key)return;lastView.current=key;
  void recordAcquisition('page_view',page,auth.token);
 },[page,state,auth.token,auth.me?.is_admin]);
 useEffect(()=>{if(state.consent?.choice!=='yes'||state.blocked||!auth.token||!auth.me||auth.me.is_admin)return;
  for(const kind of ['signup_complete',...(auth.me.onboarding_completed?['onboarding_complete']:[])] as const){
   const key=`${state.consent.identity.visitor_id}/${auth.me.id}/${kind}`;if(completed.current.has(key))continue;completed.current.add(key);
   void recordAcquisition(kind as 'signup_complete'|'onboarding_complete','onboarding',auth.token).then(ok=>{if(!ok)completed.current.delete(key);});
  }
 },[state,auth.me,auth.token]);
 function choose(allow:boolean){if(chooseConsent(allow)){setMeasurementConsent(allow);setOpen(false);setError('');}else setError('브라우저의 개인정보 보호 또는 저장소 설정으로 통계를 켤 수 없습니다. 서비스는 그대로 이용할 수 있습니다.');}
 const visible=state.ready&&!!page&&(open||(!state.consent||Boolean(measurementId())&&googleChoice===null)&&!state.blocked);
 return <>{path==='/privacy'&&<button type="button" className="traffic-settings button secondary" onClick={()=>setOpen(v=>!v)}>방문 통계 설정</button>}
 {visible&&<aside className="traffic-consent" aria-label="선택적 방문 통계"><div><strong>방문 통계 수집에 동의하시나요?</strong><p>내부 방문 통계와 Google Analytics로 공개 화면·유입 경로·가입 단계를 측정합니다. Google은 IP와 쿠키를 처리하며 이메일·개인별 주소·질문은 보내지 않습니다. 거절해도 이용에 영향이 없습니다. <Link href="/privacy#analytics">자세히 보기</Link></p></div><div className="traffic-consent-actions"><button className="button secondary" onClick={()=>choose(false)}>거절 / 동의 철회</button><button className="button secondary" onClick={()=>choose(true)}>동의</button></div>{error&&<p role="alert">{error}</p>}</aside>}
 </>;
}
