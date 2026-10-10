'use client';
import {useEffect} from 'react';
import {usePathname} from 'next/navigation';
import {useAuth} from '@/components/auth';
import {research} from './client';
export function analyticsScreen(path:string){if(/^\/companies\//.test(path))return 'company';if(/^\/events\//.test(path))return 'event';if(/^\/documents\//.test(path))return 'document';const p=path.split('/')[1];return ['today','explore','search','watchlist','portfolio','timeline','questions','calendar','alerts','saved','settings','onboarding','help'].includes(p)?p:null;}
export default function ResearchTracker(){
 const {token,me}=useAuth(),path=usePathname(),screen=analyticsScreen(path),consent=me?.analytics_consent===true,identity=me?.id;
 useEffect(()=>{if(!token||!consent||!screen||!identity)return;
  const key=`sb.research.session.${identity}`;let session=sessionStorage.getItem(key);if(!session){session=crypto.randomUUID();sessionStorage.setItem(key,session);}
  const page=crypto.randomUUID(),device=matchMedia('(max-width:767px)').matches?'mobile':'desktop';let last=performance.now(),input=last,active=0,lastClick=0;
  const controllers=new Set<AbortController>();
  const send=(kind:string,active_ms=0)=>{const controller=new AbortController();controllers.add(controller);void research(token,'track',{id:crypto.randomUUID(),session_id:session,page_id:page,screen,device,kind,active_ms},controller.signal).catch(()=>{}).finally(()=>controllers.delete(controller));};
  send('view');
  const tick=()=>{const now=performance.now();if(document.visibilityState==='visible'&&document.hasFocus()&&now-input<30000)active+=Math.min(now-last,2000);last=now;};
  const interact=()=>{input=performance.now();};
  const click=()=>{interact();if(performance.now()-lastClick>1000){lastClick=performance.now();send('click');}};
  const flushActive=()=>{tick();if(active>0){const value=Math.min(15000,Math.floor(active));active=0;void fetch('/api/research',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({action:'track',p:{id:crypto.randomUUID(),session_id:session,page_id:page,screen,device,kind:'heartbeat',active_ms:value}}),keepalive:true}).catch(()=>{});}};
  const tickTimer=setInterval(tick,1000),flush=setInterval(flushActive,15000);
  const hidden=()=>{if(document.visibilityState==='hidden')flushActive();};document.addEventListener('visibilitychange',hidden);
  window.addEventListener('pointerdown',click);window.addEventListener('keydown',interact);window.addEventListener('scroll',interact,{passive:true});
  return()=>{clearInterval(tickTimer);clearInterval(flush);document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pointerdown',click);window.removeEventListener('keydown',interact);window.removeEventListener('scroll',interact);for(const c of controllers)c.abort();flushActive();};
 },[token,consent,screen,path,identity]);
 return null;
}
