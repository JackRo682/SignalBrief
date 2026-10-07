'use client';
import {useCallback,useEffect,useState} from 'react';
import {z} from 'zod';
import {useAuth} from '@/components/auth';
import {errorMessage,request} from '@/lib/api';
import {pageDataCache} from '@/lib/page-data-cache';

/** Keep the existing PC navigation cache without changing the mobile data hooks. */
export function usePcResource<T>(path:string|null,schema:z.ZodType<T>){
 const {token}=useAuth(),[revision,setRevision]=useState(0);
 const [state,setState]=useState<{path:string|null;scope:string|null;data:T|null;loading:boolean;error:string|null}>({path:null,scope:null,data:null,loading:!!token&&!!path,error:null});
 useEffect(()=>{
  if(!token||!path){setState({path,scope:token,data:null,loading:false,error:null});return;}
  let active=true;const controller=new AbortController();
  setState({path,scope:token,data:null,loading:true,error:null});
  // A primary GET promise is shared for the existing 15-second, token-scoped TTL.
  // Unmounting one reader must not cancel another reader's shared request.
  const shared=/^\/v1\/(feed|companies|watchlist|portfolio|calendar)([/?]|$)/.test(path);
  pageDataCache.request(token,path,'GET',()=>request(path,token,schema,shared?{}:{signal:controller.signal})).then(value=>{
   if(active)setState({path,scope:token,data:schema.parse(value),loading:false,error:null});
  }).catch(error=>{if(active)setState({path,scope:token,data:null,loading:false,error:errorMessage(error)});});
  return()=>{active=false;controller.abort();};
 },[path,token,schema,revision]);
 const reload=useCallback(()=>{pageDataCache.reset(token);setRevision(value=>value+1);},[token]);
 const current=state.path===path&&state.scope===token;
 return {data:current?state.data:null,loading:current?state.loading:!!token&&!!path,error:current?state.error:null,reload};
}
