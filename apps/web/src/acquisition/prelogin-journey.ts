'use client';
import {useEffect, useLayoutEffect, useRef} from 'react';
import {JOURNEY_CONSENT_VERSION, privacySignal, readConsent, type Consent} from './client';
import {journeyPages, journeySteps} from './contracts';

type Step=typeof journeySteps[number];
type Page=typeof journeyPages[number];
type Session={id:string;visitor:string;seq:number;last:number};
const KEY='sb.prelogin.session.v1', GAP=30*60*1000;
let memory:Session|null=null;
function forget(){
  memory=null;
  try{sessionStorage.removeItem(KEY);}catch{/* in-memory session already gone */}
}
function reserve(visitor:string):{session:Session;first:boolean}{
  const now=Date.now();
  if(!memory)try{
    const stored=JSON.parse(sessionStorage.getItem(KEY)??'null');
    if(stored&&/^[0-9a-f-]{36}$/i.test(stored.id)&&Number.isInteger(stored.seq)&&Number.isFinite(stored.last))memory=stored;
  }catch{/* storage can be disabled */}
  const first=!memory||memory.visitor!==visitor||now<memory.last||now-memory.last>=GAP||memory.seq>=99998;
  if(first)memory={id:crypto.randomUUID(),visitor,seq:0,last:now};
  const session=memory!;
  session.seq++; session.last=now;
  try{sessionStorage.setItem(KEY,JSON.stringify(session));}catch{/* navigation in this document still works */}
  return {session:{...session},first};
}
export function notifyAuthAttempt(step:'signup_submit'|'login_submit'|'google_start'){
  window.dispatchEvent(new CustomEvent('sb:prelogin-attempt',{detail:step}));
}
export function usePreloginJourney(path:string,consent:Consent|null,anonymous:boolean,signedIn:boolean){
  const visitor=consent?.choice==='yes'&&consent.journeyVersion===JOURNEY_CONSENT_VERSION?consent.identity.visitor_id:null;
  const allowed=!!visitor&&anonymous;
  const live=useRef(allowed);
  const previous=useRef('');
  useLayoutEffect(()=>{live.current=allowed;},[allowed]);
  useEffect(()=>{
    if(signedIn||consent?.choice==='no'){forget();previous.current='';}
  },[signedIn,consent?.choice]);
  useEffect(()=>{
    const name=path==='/'?'home':path.slice(1);
    if(!allowed||!visitor||!journeyPages.some(page=>page===name)||privacySignal()){previous.current='';return;}
    const page=name as Page;
    function permitted(){
      const c=readConsent();
      return live.current&&!privacySignal()&&c?.choice==='yes'&&c.identity.visitor_id===visitor&&c.journeyVersion===JOURNEY_CONSENT_VERSION?c:null;
    }
    function send(step:Step,session:Session){
      const grant=permitted(); if(!grant)return;
      const payload={action:'prelogin',...grant.identity,id:crypto.randomUUID(),session:session.id,seq:session.seq,page,step,source:grant.source,consent_version:JOURNEY_CONSENT_VERSION};
      async function deliver(){
        for(let attempt=0;attempt<2;attempt++){
          if(!permitted())return;
          try{
            const res=await fetch('/api/traffic',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),keepalive:true,signal:AbortSignal.timeout(3000)});
            if(res.ok||res.status<500)return;
          }catch{/* same event ID and sequence on retry */}
          if(!attempt)await new Promise(resolve=>setTimeout(resolve,250));
        }
      }
      void deliver();
    }
    function observe(step:Step){
      if(!permitted())return;
      const reserved=reserve(visitor!);
      let session=reserved.session;
      if(reserved.first&&step!=='view'){
        send('view',session);
        session=reserve(visitor!).session;
      }
      send(step,session);
    }
    const key=visitor+'|'+path;
    if(previous.current!==key){previous.current=key;observe('view');}
    function clicked(event:MouseEvent){
      if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
      const el=event.target instanceof Element?event.target.closest('[data-sb-journey]'):null;
      const step=el?.getAttribute('data-sb-journey');
      if(step==='signup_cta'||step==='login_cta'||step==='features_cta'||step==='pricing_cta')observe(step);
    }
    function attempted(event:Event){
      const step=(event as CustomEvent<unknown>).detail;
      if(step==='signup_submit'&&page==='signup'||step==='login_submit'&&page==='login'||step==='google_start'&&(page==='signup'||page==='login'))observe(step);
    }
    document.addEventListener('click',clicked,true);
    window.addEventListener('sb:prelogin-attempt',attempted);
    return()=>{document.removeEventListener('click',clicked,true);window.removeEventListener('sb:prelogin-attempt',attempted);};
  },[path,visitor,allowed]);
}
