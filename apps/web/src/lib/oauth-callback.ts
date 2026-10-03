import type {SupabaseClient} from '@supabase/supabase-js';
let flight:{code:string;promise:Promise<string>}|null=null;
export function completeOAuth(db:SupabaseClient,url:string):Promise<string>{
 const params=new URL(url).searchParams;
 if(params.has('error'))return Promise.reject(new Error(params.get('error')==='access_denied'?'oauth_consent_denied':'oauth_provider_error'));
 const code=params.get('code');if(!code)return Promise.reject(new Error('oauth_code_missing'));
 if(flight?.code===code)return flight.promise;
 const flowId=params.get('sb_flow_id');
 const promise=(async()=>{
  const exchange=await db.auth.exchangeCodeForSession(code,flowId?{flowId}:undefined);
  if(exchange.error)throw new Error('oauth_code_exchange_failed');
  const verified=await db.auth.getUser();if(verified.error||!verified.data.user)throw new Error('oauth_session_verification_failed');
  return params.get('next')==='reset-password'?'/reset-password':'/today';
 })();flight={code,promise};return promise;
}
export function resetOAuthForTests(){flight=null;}
