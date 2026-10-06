'use client';
import {createContext,useCallback,useContext,useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {useAuth} from '@/components/auth';
import {workspace} from './client';
import {defaults,preferenceSchema,type Preferences} from './contracts';
type Context={value:Preferences;version:number;loaded:boolean;busy:boolean;error:string;save:(patch:Partial<Preferences>)=>Promise<void>;reload:()=>void;text:(ko:string,en:string)=>string;date:(v:string|null,precision?:string)=>string};
const Prefs=createContext<Context|null>(null);
export function WorkspacePreferences({children}:{children:ReactNode}){
 const {me}=useAuth();
 // Re-mount account-bound state (including pending forms) on identity changes.
 return <PreferenceSession key={me?.id??'anonymous'}>{children}</PreferenceSession>;
}
function PreferenceSession({children}:{children:ReactNode}){
 const {token,me}=useAuth(),[state,setState]=useState({value:defaults,version:0}),[loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[revision,setRevision]=useState(0);
 const owner=me?.id,scope=useRef(token),saving=useRef(false);useEffect(()=>{scope.current=token;},[token]);
 useEffect(()=>{if(!token||!owner){setState({value:defaults,version:0});setLoaded(false);return;}let alive=true;const ctrl=new AbortController();
  workspace(token,{action:'preferences',p:{}},preferenceSchema,ctrl.signal).then(x=>{if(alive){setState(x);setLoaded(true);setError('');}}).catch(e=>{if(alive)setError(e instanceof Error?e.message:'설정을 불러오지 못했습니다.');});
  return()=>{alive=false;ctrl.abort();};},[token,owner,revision]);
 useEffect(()=>{const html=document.documentElement;html.dataset.sbTheme=state.value.theme;html.dataset.sbDensity=state.value.ui_density;html.dataset.sbMotion=state.value.reduced_motion?'reduced':'normal';html.dataset.sbChart=state.value.chart_animation?'on':'off';html.style.setProperty('--sb-font-scale',String([.94,1,1.08,1.16][state.value.font_scale]));if(owner)html.lang=state.value.locale;
  return()=>{delete html.dataset.sbTheme;delete html.dataset.sbDensity;delete html.dataset.sbMotion;delete html.dataset.sbChart;html.style.removeProperty('--sb-font-scale');html.lang='ko';};},[state.value,owner]);
 const save=useCallback(async(patch:Partial<Preferences>)=>{if(saving.current)throw new Error('이전 설정을 저장하고 있습니다.');if(!loaded)throw new Error('설정을 먼저 불러와 주세요.');saving.current=true;setBusy(true);setError('');
  try{const x=await workspace(token,{action:'preferences_save',p:{value:patch,version:state.version}},preferenceSchema);if(scope.current===token)setState(x);}catch(e){if(scope.current===token)setError(e instanceof Error?e.message:'설정을 저장하지 못했습니다.');throw e;}finally{saving.current=false;setBusy(false);}},[token,loaded,state.version]);
 const text=useCallback((ko:string,en:string)=>state.value.locale==='en'?en:ko,[state.value.locale]);
 const date=useCallback((value:string|null,precision='timestamp')=>{if(!value)return text('확인 전','Not available');const d=new Date(value);if(Number.isNaN(+d))return text('날짜 미확인','Unknown date');return new Intl.DateTimeFormat(state.value.locale==='ko'?'ko-KR':'en-US',{timeZone:['date','date_only'].includes(precision)?'UTC':state.value.timezone,year:'numeric',month:'short',day:'numeric',...(['date','date_only'].includes(precision)?{}:{hour:'2-digit',minute:'2-digit'})}).format(d);},[state.value.locale,state.value.timezone,text]);
 const value=useMemo(()=>({...state,loaded,busy,error,save,reload:()=>setRevision(x=>x+1),text,date}),[state,loaded,busy,error,save,text,date]);
 return <Prefs.Provider value={value}>{children}</Prefs.Provider>;
}
export function usePrefs(){const c=useContext(Prefs);if(!c)throw new Error('WorkspacePreferences missing');return c;}
