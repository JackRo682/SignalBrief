"use client";
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {usePathname} from 'next/navigation';
import Link from 'next/link';
import {consentChoice,measurementId,setMeasurementConsent} from '@/lib/public-analytics';
import {useAuth} from '@/components/auth';
import {trafficPage} from './contracts';
import {JOURNEY_CONSENT_VERSION,rememberEntrySource,SURFACE_CONSENT_VERSION,chooseConsent,erasePending,privacySignal,readConsent,recordAcquisition,type Consent} from './client';
import {isProductPath,productConsentChoice,setProductConsent,syncProductAccount} from './product-client';
import {usePreloginJourney} from './prelogin-journey';
import {useSurfaceTracking} from './surface-tracker';
import './traffic.css';
export default function AcquisitionTracker(){
 const path=usePathname(),page=trafficPage(path),auth=useAuth();
 const [state,setState]=useState<{ready:boolean;consent:Consent|null;blocked:boolean}>({ready:false,consent:null,blocked:false});
 const [googleChoice,setGoogleChoice]=useState<string|null>(null);
 const [productChoice,setProductChoice]=useState<string|null>(null);
 const [open,setOpen]=useState(false),[error,setError]=useState('');
 const lastView=useRef(''),completed=useRef(new Set<string>());
 useLayoutEffect(()=>{syncProductAccount({token:auth.token,analyticsConsent:auth.me?.analytics_consent===true,isAdmin:auth.me?.is_admin!==false,isDemo:auth.me?.demo_mode!==false});},[auth.token,auth.me?.analytics_consent,auth.me?.is_admin,auth.me?.demo_mode]);
 usePreloginJourney(path,state.consent,!auth.loading&&!auth.token&&!auth.me&&auth.config?.demo_mode===false,Boolean(auth.token||auth.me));
 useSurfaceTracking(path,state.consent,auth.token,auth.me?.analytics_consent===true&&!auth.me?.demo_mode,Boolean(auth.me?.is_admin),productChoice);
 useLayoutEffect(()=>{rememberEntrySource();},[]);
 useEffect(()=>{const sync=()=>{setGoogleChoice(consentChoice());setProductChoice(productConsentChoice());setState({ready:true,consent:readConsent(),blocked:privacySignal()});};sync();void erasePending();
  window.addEventListener('sb:traffic-consent',sync);window.addEventListener('storage',sync);window.addEventListener('sb:google-consent',sync);window.addEventListener('sb:product-consent',sync);
  return()=>{window.removeEventListener('sb:traffic-consent',sync);window.removeEventListener('storage',sync);window.removeEventListener('sb:google-consent',sync);window.removeEventListener('sb:product-consent',sync);};
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
 function choose(allow:boolean){
  const saved=chooseConsent(allow),productSaved=setProductConsent(allow&&saved);
  // Withdrawal also stops the Google runtime when one browser-store write fails.
  if(!allow||saved)setMeasurementConsent(allow&&saved);
  if(saved&&productSaved){setOpen(false);setError('');}
  else setError('브라우저의 개인정보 보호 또는 저장소 설정으로 통계 선택을 저장하지 못했습니다. 서비스는 그대로 이용할 수 있습니다.');
 }
 const productPage=isProductPath(path)&&auth.me?.analytics_consent===true&&!auth.me.is_admin&&!auth.me.demo_mode;
 const needsChoice=!state.consent||state.consent.choice==='yes'&&(Boolean(measurementId())&&googleChoice===null||productChoice===null||state.consent.surfaceVersion!==SURFACE_CONSENT_VERSION||state.consent.journeyVersion!==JOURNEY_CONSENT_VERSION);
 const visible=state.ready&&Boolean(page||productPage)&&(open||needsChoice&&!state.blocked);
 return <>{path==='/privacy'&&<button type="button" className="traffic-settings button secondary" onClick={()=>setOpen(v=>!v)}>방문 통계 설정</button>}
 {visible&&<aside className="traffic-consent" aria-label="선택적 방문 통계"><div><strong>방문 통계 수집에 동의하시나요?</strong><p>내부 통계와 Google Analytics로 공개 화면·유입 경로·가입 단계를 측정합니다. 내부 통계에서는 로그인 전 화면 순서와 기능·요금·가입·로그인 버튼 선택도 집계합니다. 새 안내에 동의하면 화면 너비에 따른 모바일·태블릿·데스크톱 분류를 추가합니다. 내부 통계는 화면별 활성 체류 시간과 서비스 버전도 집계하며, 화면이 가려지거나 30초간 입력이 없으면 시간을 더하지 않습니다. 계정의 이용 통계에도 동의하면 검색·필터 사용과 이벤트 상세 열람을 내부 통계에 연결합니다. 검색어·보유종목·질문은 기록하지 않습니다. Google은 공개 화면의 IP와 쿠키를 처리하며 로그인 후 행동은 보내지 않습니다. 거절해도 이용에 영향이 없습니다. <Link href="/privacy#analytics">자세히 보기</Link></p></div><div className="traffic-consent-actions"><button className="button secondary" onClick={()=>choose(false)}>거절 / 동의 철회</button><button className="button secondary" onClick={()=>choose(true)}>동의</button></div>{error&&<p role="alert">{error}</p>}</aside>}
 </>;
}
