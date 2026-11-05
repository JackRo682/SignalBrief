"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { request, body, errorMessage, emptySchema, API_URL, APIError } from "@/lib/api";
import { meSchema, tokenSchema, type Me, type RuntimeConfig } from "@/lib/contracts";
import { getSupabase, initializeSupabase, resolvedPublicAuth } from "@/lib/supabase";
import { assertRuntimeAuth,localDemoAllowed } from "@/lib/auth-policy";
import { siteOrigin, startGoogleLogin } from "@/lib/site-url";
import { signInReturnFromUrl } from "@/lib/auth-return";
import { pageDataCache } from "@/lib/page-data-cache";
import { runtimeConfig } from "@/lib/runtime-config";
import MfaChallenge from "./mfa-challenge";
const DEMO_KEY="signalbrief.demo.token";
type Context = {token:string|null;me:Me|null;config:RuntimeConfig|null;loading:boolean;error:string|null;refresh:()=>Promise<void>;demoLogin:(admin?:boolean)=>Promise<void>;googleLogin:()=>Promise<void>;logout:()=>Promise<void>;track:(name:string,properties?:Record<string,string|number|boolean>)=>void;};
const AuthContext = createContext<Context|null>(null);
export function AuthProvider({children}:{children:ReactNode}) {
  const [token,setToken]=useState<string|null>(null),[me,setMe]=useState<Me|null>(null),[config,setConfig]=useState<RuntimeConfig|null>(null);
  const [mfaRequired,setMfaRequired]=useState(false);
  const [initializing,setInitializing]=useState(true),[profileLoading,setProfileLoading]=useState(false),[error,setError]=useState<string|null>(null);
  const currentToken=useRef<string|null>(null);
  const profileRevision=useRef(0);
  const changeToken=useCallback((next:string|null)=>{
    if(currentToken.current===next)return;
    currentToken.current=next;
    profileRevision.current++;
    pageDataCache.reset(next);
    setMe(null);
    setProfileLoading(next!==null);
    setMfaRequired(false);
    setError(null);
    setToken(next);
  },[]);
  useEffect(()=> {
    let alive=true; let unsubscribe:(()=>void)|undefined;
    runtimeConfig().then(async c=>{
      if(!alive)return;
      if(c.auth_mode==="supabase"&&!c.demo_mode)await initializeSupabase();
      if(!alive)return;
      const publicAuth=resolvedPublicAuth();
      assertRuntimeAuth(c,location.hostname,process.env.NODE_ENV === "production",API_URL,publicAuth.url,publicAuth.key);
      setConfig(c);
      if(c.demo_mode && c.auth_mode==="demo") {changeToken(sessionStorage.getItem(DEMO_KEY));}
      else {
        sessionStorage.removeItem(DEMO_KEY);
        const supabase=await initializeSupabase();
        if(!alive)return;
        let sessionRevision=0;
        const listener=supabase.auth.onAuthStateChange((_event,session)=>{sessionRevision++;if(alive)changeToken(session?.access_token??null);});
        unsubscribe=()=>listener.data.subscription.unsubscribe();
        const initialRevision=sessionRevision;
        const result=await supabase.auth.getSession();
        if(!alive||sessionRevision!==initialRevision)return;
        if(result.error)throw result.error;
        if(alive)changeToken(result.data.session?.access_token??null);
      }
    }).catch(e=>{if(alive)setError(e instanceof Error && e.message.includes("Supabase") ? e.message : errorMessage(e));})
      .finally(()=>{if(alive)setInitializing(false);});
    return ()=>{alive=false;unsubscribe?.();};
  },[changeToken]);
  useEffect(()=>{pageDataCache.reset(token);},[token]);
  const refresh=useCallback(async()=>{
    if(currentToken.current!==token)return;
    if(!token){setMe(null);return;}
    const revision=++profileRevision.current;
    setProfileLoading(true);setError(null);
    try{const user=await request("/v1/me",token,meSchema);if(currentToken.current===token&&profileRevision.current===revision){setMe(user);setMfaRequired(false);}}
    catch(e){if(currentToken.current===token&&profileRevision.current===revision){setMe(null);if(e instanceof APIError&&e.code==='mfa_required'){setMfaRequired(true);setError(null);}else setError(errorMessage(e));}throw e;}
    finally{if(currentToken.current===token&&profileRevision.current===revision)setProfileLoading(false);}
  },[token]);
  useEffect(()=>{let alive=true;if(!token){setMe(null);setMfaRequired(false);return;}setProfileLoading(true);setError(null);
    const revision=++profileRevision.current;
    request("/v1/me",token,meSchema).then(user=>{if(alive&&currentToken.current===token&&profileRevision.current===revision){setMe(user);setMfaRequired(false);}}).catch(e=>{if(alive&&currentToken.current===token&&profileRevision.current===revision){setMe(null);if(e instanceof APIError && e.code === "mfa_required"){setMfaRequired(true);setError(null);}else setError(errorMessage(e));}}).finally(()=>{if(alive&&currentToken.current===token&&profileRevision.current===revision)setProfileLoading(false);});return ()=>{alive=false;};
  },[token]);
  useEffect(()=>{const clear=()=>{pageDataCache.reset();changeToken(null);setMe(null);setProfileLoading(false);setMfaRequired(false);setError(null);sessionStorage.removeItem(DEMO_KEY);};window.addEventListener("signalbrief:unauthorized",clear);return ()=>window.removeEventListener("signalbrief:unauthorized",clear);},[changeToken]);
  useEffect(()=>{const requireMfa=()=>{profileRevision.current++;pageDataCache.reset(currentToken.current);setMe(null);setProfileLoading(false);setMfaRequired(true);};window.addEventListener("signalbrief:mfa-required",requireMfa);return()=>window.removeEventListener("signalbrief:mfa-required",requireMfa);},[]);
  const demoLogin=useCallback(async(admin=false)=>{
    if(!localDemoAllowed(location.hostname,process.env.NODE_ENV === "production") || !config?.demo_mode)throw new Error("demo_disabled");
    const result=await request(`/v1/auth/demo?admin=${admin}`,null,tokenSchema,body("POST"));sessionStorage.setItem(DEMO_KEY,result.access_token);changeToken(result.access_token);
  },[config,changeToken]);
  const googleLogin=useCallback(async()=>{
    const canonical=siteOrigin(location.href,process.env.NEXT_PUBLIC_SITE_URL,process.env.NODE_ENV === "production");
    await startGoogleLogin(location.href,canonical,url=>location.assign(url),async redirectTo=>{
      const supabase=await initializeSupabase();
      const next=signInReturnFromUrl(redirectTo);
      const chooseAccount=next==='/ops'||next.startsWith('/ops/');
      const result=await supabase.auth.signInWithOAuth({provider:"google",options:{redirectTo,...(chooseAccount?{queryParams:{prompt:'select_account'}}:{})}});
      if(result.error)throw result.error;
    });
  },[]);
  useEffect(()=>{pageDataCache.reset(token);},[token]);
  const logout=useCallback(async()=>{
    pageDataCache.reset(currentToken.current);
    if(config?.auth_mode==="supabase") {const result=await getSupabase().auth.signOut({scope:"local"});if(result.error)throw result.error;}
    sessionStorage.removeItem(DEMO_KEY);changeToken(null);setMe(null);setProfileLoading(false);setMfaRequired(false);
  },[config,changeToken]);
  const track=useCallback((name:string,properties:Record<string,string|number|boolean>={})=>{
    if(me?.analytics_consent&&token)void request("/v1/analytics",token,emptySchema,body("POST",{event_name:name,properties})).catch(()=>{});
  },[me?.analytics_consent,token]);
  return <AuthContext.Provider value={{token,me,config,loading:initializing||profileLoading,error,refresh,demoLogin,googleLogin,logout,track}}>{mfaRequired?<MfaChallenge onCancel={logout}/>:children}</AuthContext.Provider>;
}
export function useAuth():Context {const ctx=useContext(AuthContext);if(!ctx)throw new Error("AuthProvider missing");return ctx;}
