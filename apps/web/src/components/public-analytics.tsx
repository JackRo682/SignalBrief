'use client';
import {useEffect,useReducer,useRef} from 'react';
import {usePathname} from 'next/navigation';
import {readConsent} from '@/acquisition/client';
import {consentChoice,flushVerifiedSignup,measurementId,pauseMeasurement,publicScreens,resumeMeasurement,trackPublicPage,trackSignupClick} from '@/lib/public-analytics';
export default function PublicAnalytics(){
 const path=usePathname(),[revision,refresh]=useReducer((v:number)=>v+1,0),lastView=useRef('');
 useEffect(()=>{const sync=()=>refresh();for(const event of ['storage','sb:traffic-consent','sb:google-consent'])window.addEventListener(event,sync);return()=>{for(const event of ['storage','sb:traffic-consent','sb:google-consent'])window.removeEventListener(event,sync);};},[]);
 useEffect(()=>{
  if(!measurementId())return;
  const consent=readConsent(),isPublic=Boolean(publicScreens[path]);
  if(consent?.choice!=='yes'||consentChoice()!=='granted'){lastView.current='';pauseMeasurement();return;}
  const signupSent=flushVerifiedSignup(!isPublic);
  if(!isPublic){lastView.current='';if(!signupSent)pauseMeasurement();return;}
  if(!resumeMeasurement())return;
  const key=path+'/'+consent.at;
  if(lastView.current!==key){lastView.current=key;trackPublicPage(path,document.referrer);}
  const click=(event:MouseEvent)=>{const target=event.target;if(!(target instanceof Element))return;const anchor=target.closest('a');if(!anchor)return;try{const url=new URL(anchor.href,location.href);if(url.origin===location.origin&&url.pathname==='/signup')trackSignupClick();}catch{/* Invalid links are not events. */}};
  document.addEventListener('click',click);return()=>{document.removeEventListener('click',click);pauseMeasurement();};
 },[path,revision]);
 return null;
}
