// Only explicit public routes and fixed event names cross the Google boundary.
export const CONSENT_KEY='sb.public.analytics.v1';
const SIGNUP_KEY='sb.public.signup.v1';
const PENDING_KEY='sb.public.signup-confirmed.v1';
const ORIGIN='https://signalbrief.online';
export const publicScreens:Record<string,string>={'/':'home','/features':'features','/about':'about','/pricing':'pricing','/privacy':'privacy','/terms':'terms','/signup':'signup','/login':'login'};
type AnalyticsWindow=Window & {dataLayer?:unknown[];gtag?:(...args:unknown[])=>void};
function browser(){return typeof window==='undefined'?null:window as AnalyticsWindow;}
export function measurementId(){const id=process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID??'';return /^G-[A-Z0-9]+$/.test(id)?id:null;}
export function consentChoice():string|null{try{return browser()?.localStorage.getItem(CONSENT_KEY)??null;}catch{return null;}}
function optedOut(){const w=browser();return !w||w.navigator.doNotTrack==='1'||(w.navigator as Navigator & {globalPrivacyControl?:boolean}).globalPrivacyControl===true;}
export function mayMeasure(){return !optedOut()&&consentChoice()==='granted';}
function store(key:string,value:string|null){try{if(value===null)browser()?.localStorage.removeItem(key);else browser()?.localStorage.setItem(key,value);}catch{/* Storage denial fails closed. */}}
export function setMeasurementConsent(granted:boolean){
 store(CONSENT_KEY,granted?'granted':'denied');
 if(!granted){store(SIGNUP_KEY,null);store(PENDING_KEY,null);}
 const w=browser(),id=measurementId();if(w&&id){Reflect.set(w,'ga-disable-'+id,!granted);
  w.gtag?.('consent','update',{analytics_storage:granted?'granted':'denied',ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'});
  if(!granted)for(const cookie of document.cookie.split(';')){const name=cookie.split('=')[0].trim();if(name==='_ga'||name.startsWith('_ga_'))document.cookie=name+'=; Max-Age=0; Path=/; SameSite=Lax';}
 }
}
export function pauseMeasurement(){const w=browser(),id=measurementId();if(w&&id)Reflect.set(w,'ga-disable-'+id,true);}
function start(){
 const w=browser(),id=measurementId();if(!w||!id||!mayMeasure())return null;
 Reflect.set(w,'ga-disable-'+id,false);
 if(!document.getElementById('sb-google-analytics')){
  w.dataLayer=w.dataLayer??[];
  // Keep Google's command-queue protocol (Arguments objects).
  w.gtag=function(){w.dataLayer?.push(arguments);};
  w.gtag('consent','default',{analytics_storage:'granted',ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'});
  w.gtag('js',new Date());
  w.gtag('config',id,{send_page_view:false,allow_google_signals:false,allow_ad_personalization_signals:false,cookie_domain:'none',page_location:ORIGIN+'/',page_referrer:'',page_title:'SignalBrief'});
  const script=document.createElement('script');script.id='sb-google-analytics';script.async=true;script.src='https://www.googletagmanager.com/gtag/js?id='+id;document.head.appendChild(script);
 }
 return w.gtag??null;
}
export function safeReferrer(value:string){try{const u=new URL(value);return u.protocol==='https:'||u.protocol==='http:'?u.origin+'/':'';}catch{return '';}}
export function trackPublicPage(path:string,referrer:string){
 const screen=publicScreens[path];if(!screen){pauseMeasurement();return;}
 start()?.('event','page_view',{page_location:ORIGIN+path,page_title:'SignalBrief · '+screen,page_referrer:safeReferrer(referrer)});
}
export function trackSignupClick(){start()?.('event','signup_click',{page_location:ORIGIN+'/signup',page_title:'SignalBrief · signup',page_referrer:''});}
export function markSignupAttempt(){if(mayMeasure())store(SIGNUP_KEY,String(Date.now()));}
export function isNewSignup(createdAt:string|undefined,attempt:number,now:number){
 const created=Date.parse(createdAt??'');return Number.isFinite(attempt)&&attempt>0&&Number.isFinite(created)&&attempt<=now&&now-attempt<=7*86400000&&created>=attempt-1000&&created<=now;
}
// Call only after Supabase has returned a verified session/user, never on a CTA.
export function recordVerifiedSignup(user:{created_at?:string}|null|undefined){
 if(!user||!mayMeasure())return;
 let attempt=0;try{attempt=Number(browser()?.localStorage.getItem(SIGNUP_KEY));}catch{return;}
 if(!isNewSignup(user.created_at,attempt,Date.now())){store(SIGNUP_KEY,null);return;}
 store(SIGNUP_KEY,null);store(PENDING_KEY,'1');
}
export function flushVerifiedSignup(pauseAfter=false){
 if(!mayMeasure())return false;let pending=false;try{pending=browser()?.localStorage.getItem(PENDING_KEY)==='1';}catch{return false;}
 if(!pending)return false;const send=start();if(!send)return false;
 store(PENDING_KEY,null);send('event','sign_up',{method:'supabase',page_location:ORIGIN+'/signup',page_title:'SignalBrief · signup',page_referrer:'',...(pauseAfter?{event_callback:pauseMeasurement,event_timeout:1000}:{})});return true;
}
