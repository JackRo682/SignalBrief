import {createClient,type SupabaseClient} from '@supabase/supabase-js';
let client:SupabaseClient|null=null,initialization:Promise<SupabaseClient>|null=null;
let runtime:{url:string;publishableKey:string}|null=null;
export function resolvedPublicAuth(){return {url:runtime?.url??process.env.NEXT_PUBLIC_SUPABASE_URL,key:runtime?.publishableKey??process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY};}
function publicConfig(url:string,key:string){
 const parsed=new URL(url);let publicKey=key.startsWith('sb_publishable_');
 if(!publicKey){try{publicKey=JSON.parse(atob(key.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).role==='anon';}catch{publicKey=false;}}
 if(parsed.protocol!=='https:'||!parsed.hostname.endsWith('.supabase.co')||parsed.username||parsed.password||parsed.port||!publicKey)throw new Error('invalid_public_auth_configuration');
 return createClient(url,key,{auth:{flowType:'pkce',autoRefreshToken:true,persistSession:true,detectSessionInUrl:false}});
}
export function getSupabase():SupabaseClient{
 if(client)return client;const url=runtime?.url??process.env.NEXT_PUBLIC_SUPABASE_URL,key=runtime?.publishableKey??process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
 if(!url||!key)throw new Error('auth_public_configuration_missing');return client=publicConfig(url,key);
}
export async function initializeSupabase():Promise<SupabaseClient>{
 if(client)return client;
 if(process.env.NEXT_PUBLIC_SUPABASE_URL&&process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)return getSupabase();
 initialization??=fetch('/api/auth-config',{cache:'no-store',signal:AbortSignal.timeout(10000)}).then(async r=>{if(!r.ok)throw new Error('auth_public_configuration_missing');const data=await r.json();if(typeof data.url!=='string'||typeof data.publishableKey!=='string')throw new Error('invalid_public_auth_configuration');runtime=data;return getSupabase();}).catch(e=>{initialization=null;throw e;});return initialization;
}
export function resetClientForTests(){client=null;initialization=null;runtime=null;}
