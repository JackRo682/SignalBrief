import {sources,trafficSource,type TrafficKind,type TrafficPage} from './contracts';
export const CONSENT_KEY='sb.acquisition.v1';
const MAX_AGE=90*86400000;
type Identity={visitor_id:string;secret:string};
export type Consent={choice:'yes';at:number;identity:Identity;source:typeof sources[number]}|{choice:'no';at:number;erase?:Identity};
export const privacySignal=()=>typeof navigator!=='undefined'&&(navigator.doNotTrack==='1'||(navigator as Navigator&{globalPrivacyControl?:boolean}).globalPrivacyControl===true);
const validIdentity=(v:unknown):v is Identity=>!!v&&typeof v==='object'&&'visitor_id' in v&&'secret' in v&&typeof v.visitor_id==='string'&&typeof v.secret==='string'&&/^[a-f0-9-]{36}$/i.test(v.visitor_id)&&/^[a-f0-9]{64}$/.test(v.secret);
export function readConsent():Consent|null{
 try{const v=JSON.parse(localStorage.getItem(CONSENT_KEY)??'null');
  if(!v||!Number.isFinite(v.at)||v.at>Date.now()||Date.now()-v.at>=MAX_AGE)return null;
  if(v.choice==='yes'&&validIdentity(v.identity)&&(sources as readonly string[]).includes(v.source))return v;
  if(v.choice==='no'&&(!v.erase||validIdentity(v.erase)))return v;
 }catch{}return null;
}
function save(value:Consent){try{localStorage.setItem(CONSENT_KEY,JSON.stringify(value));window.dispatchEvent(new Event('sb:traffic-consent'));return true;}catch{return false;}}
export async function erasePending(){
 const value=readConsent();if(value?.choice!=='no'||!value.erase)return;
 try{const response=await fetch('/api/traffic',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'erase',...value.erase}),keepalive:true,signal:AbortSignal.timeout(4000)});
  if(response.ok){const current=readConsent();if(current?.choice==='no'&&current.erase?.visitor_id===value.erase.visitor_id)save({choice:'no',at:current.at});}
 }catch{}
}
export function chooseConsent(allow:boolean):boolean{
 const before=readConsent();
 if(!allow){const identity=before?.choice==='yes'?before.identity:before?.erase;const saved=save({choice:'no',at:Date.now(),...(identity?{erase:identity}:{})});void erasePending();return saved;}
 if(privacySignal())return false;
 if(before?.choice==='yes')return true;
 const bytes=crypto.getRandomValues(new Uint8Array(32)),secret=Array.from(bytes,v=>v.toString(16).padStart(2,'0')).join('');
 return save({choice:'yes',at:Date.now(),identity:{visitor_id:crypto.randomUUID(),secret},source:trafficSource(location.href,document.referrer)});
}
let queue:Promise<unknown>=Promise.resolve();
export function recordAcquisition(kind:TrafficKind,page:TrafficPage,token?:string|null):Promise<boolean>{
 const initial=readConsent();if(initial?.choice!=='yes'||privacySignal())return Promise.resolve(false);
 const event={action:'record',...initial.identity,id:crypto.randomUUID(),kind,page,source:initial.source};
 const task=queue.then(async()=>{
  const current=readConsent();if(current?.choice!=='yes'||current.identity.visitor_id!==initial.identity.visitor_id||privacySignal())return false;
  try{const response=await fetch('/api/traffic',{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(event),keepalive:true,signal:AbortSignal.timeout(2500)});return response.ok;}catch{return false;}
 });queue=task.catch(()=>false);return task;
}
