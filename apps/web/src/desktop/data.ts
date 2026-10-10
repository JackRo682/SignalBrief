'use client';
import {useCallback,useEffect,useState} from 'react';
import {z} from 'zod';
import {useAuth} from '@/components/auth';
import {errorMessage,request} from '@/lib/api';
import {pageDataCache} from '@/lib/page-data-cache';

export function usePcResource<T>(path:string|null,schema:z.ZodType<T>){
 const {token}=useAuth(),[revision,setRevision]=useState(0);
 const [state,setState]=useState<{path:string|null;scope:string|null;data:T|null;loading:boolean;error:string|null}>({path:null,scope:null,data:null,loading:true,error:null});
 const snapshot=token&&path?pageDataCache.peek<T>(token,path):undefined;
 const current=state.path===path&&state.scope===token;
 const data=current&&state.data!==null?state.data:snapshot??null;
 const loading=Boolean(token&&path&&!data&&(!current||state.loading));
 const reload=useCallback(()=>{pageDataCache.reset(token);setRevision(v=>v+1);},[token]);
 useEffect(()=>{
  if(!token||!path){setState({path,scope:token,data:null,loading:false,error:null});return;}
  let active=true;const controller=new AbortController();
  const saved=pageDataCache.peek<T>(token,path);
  setState({path,scope:token,data:saved??null,loading:saved===undefined,error:null});
  const shared=/^\/v1\/(feed|companies|watchlist|portfolio|calendar|notifications)([/?]|$)/.test(path)||path.startsWith('/market?');
  void Promise.resolve().then(()=>{
   if(!active)return;
   return pageDataCache.request(token,path,'GET',()=>request(path,token,schema,shared?{}:{signal:controller.signal}).then(value=>schema.parse(value)))
     .then(value=>{if(active)setState({path,scope:token,data:schema.parse(value),loading:false,error:null});})
     .catch(error=>{if(active)setState({path,scope:token,data:pageDataCache.peek<T>(token,path)??null,loading:false,error:errorMessage(error)});});
  });
  return()=>{active=false;controller.abort();};
 },[path,token,schema,revision]);
 return {data,loading,error:current?state.error:null,reload};
}
