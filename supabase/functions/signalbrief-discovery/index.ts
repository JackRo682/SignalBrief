import {createClient} from 'npm:@supabase/supabase-js@2.117.2';
import {DiscoveryError,parseSelection} from './core.ts';
import {discoveryRpc,discoverySecrets,refreshDirectory,hydrateCompany} from './service.ts';
import {obj} from '../signalbrief-api/us-core.ts';
const env=(k:string)=>Deno.env.get(k)??'';
const headers={'Content-Type':'application/json','Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});
export async function handleDiscovery(req:Request):Promise<Response>{
 try{
  if(!['GET','POST'].includes(req.method))return reply({error:{code:'method_not_allowed'}},405);
  const auth=req.headers.get('authorization')??'';
  if(!/^Bearer [A-Za-z0-9._-]{20,8192}$/.test(auth))throw new DiscoveryError('authentication_required',401);
  const reader=createClient(env('SUPABASE_URL'),env('SUPABASE_ANON_KEY'),{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:auth}}});
  const actor=await reader.auth.getUser();if(actor.error||!actor.data.user)throw new DiscoveryError('invalid_session',401);
  const mfa=await reader.rpc('sb_require_mfa');if(mfa.error)throw new DiscoveryError('mfa_required',403);
  const limited=await reader.rpc('sb_rate_limit');if(limited.error)throw new DiscoveryError('rate_limit_exceeded',429);
  const db=createClient(env('SUPABASE_URL'),env('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
  if(req.method==='GET'){
   const params=new URL(req.url).searchParams,q=(params.get('q')??'').trim();if(!q||q.length>100||!/[\p{L}\p{N}]/u.test(q))throw new DiscoveryError('invalid_query',422);
   const provider=params.get('provider')??'',market=(params.get('market')??'').trim().toUpperCase(),group=params.get('market_group')??'all';
   if(!['','sec','dart'].includes(provider)||!['all','kospi','kosdaq','overseas','unclassified'].includes(group)||market.length>32||(market&&!/^[A-Z0-9가-힣 :._-]+$/.test(market))||['q','provider','market','market_group'].some(key=>params.getAll(key).length>1))throw new DiscoveryError('invalid_filter',422);
   const secrets=await discoverySecrets(db);
   await Promise.allSettled((['sec','dart'] as const).map(provider=>refreshDirectory(db,secrets,provider)));
   const result=await reader.rpc('sb_company_discovery_filtered',{q,p:{provider,market,market_group:group}});if(result.error)throw new DiscoveryError('directory_unavailable',503);
   return reply(result.data);
  }
  if(!(req.headers.get('content-type')??'').startsWith('application/json'))throw new DiscoveryError('json_required',415);
  const readerBody=req.body?.getReader();let size=0;const parts:Uint8Array[]=[];
  if(readerBody)while(true){const next=await readerBody.read();if(next.done)break;size+=next.value.length;if(size>2048){await readerBody.cancel();throw new DiscoveryError('body_too_large',413);}parts.push(next.value);}
  const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
  let value:unknown;try{value=JSON.parse(new TextDecoder().decode(bytes));}catch{throw new DiscoveryError('invalid_json',422);}
  const selection=parseSelection(value),company=obj(await discoveryRpc(db,'activate',{...selection,actor:actor.data.user.id}));
  const result=await hydrateCompany(db,await discoverySecrets(db),company);
  return reply(result);
 }catch(error){return reply({error:{code:error instanceof DiscoveryError?error.code:'discovery_unavailable'}},error instanceof DiscoveryError?error.status:502);}
}
Deno.serve(handleDiscovery);
