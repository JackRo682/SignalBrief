import {createClient} from 'npm:@supabase/supabase-js@2.117.2';
import {dartRelay} from '../signalbrief-collector/dart-relay.ts';
import {parseProfile,parseSecProfile,ProfileError,type CompanyIdentity} from './core.ts';
import {providerFetch} from '../signalbrief-api/us-core.ts';
const env=(k:string)=>Deno.env.get(k)??'';
const sha=async(bytes:Uint8Array)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes)))].map(b=>b.toString(16).padStart(2,'0')).join('');
const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});
export async function handleProfiles(req:Request):Promise<Response>{
 const db=createClient(env('SUPABASE_URL'),env('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
 const rpc=async(name:string,args:Record<string,unknown>={})=>{const r=await db.rpc(name,args);if(r.error)throw new ProfileError('database_request_failed',500);return r.data;};
 try{
  if(!['GET','POST'].includes(req.method))return reply({error:{code:'method_not_allowed'}},405);
  let id='';let readerDb=db;
  if(req.method==='POST'){
   // Operations can warm the same cache without exposing an API key or issuing a user session.
   // Reuse the existing short-lived HMAC and database replay protection.
   const reader=req.body?.getReader();const chunks:Uint8Array[]=[];let size=0;
   if(reader)while(true){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>4096){await reader.cancel();throw new ProfileError('body_too_large',413);}chunks.push(r.value);}
   const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
   const body=new TextDecoder().decode(bytes);let p:Record<string,unknown>;try{p=JSON.parse(body);}catch{throw new ProfileError('invalid_json',422);}
   if(!p||p.kind!=='company-profile-refresh'||typeof p.company_id!=='string')throw new ProfileError('invalid_input',422);
   const valid=await rpc('sb_dart_relay_claim',{body_text:body,request_timestamp:req.headers.get('x-sb-timestamp')??'',signature:req.headers.get('x-sb-signature')??''});
   if(valid!==true)throw new ProfileError('authentication_required',401);id=p.company_id;
  }else{
   const authorization=req.headers.get('authorization')??'';
   if(!/^Bearer [A-Za-z0-9._-]{20,8192}$/.test(authorization))throw new ProfileError('authentication_required',401);
   readerDb=createClient(env('SUPABASE_URL'),env('SUPABASE_ANON_KEY'),{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:authorization}}});
   const actor=await readerDb.auth.getUser();if(actor.error||!actor.data.user)throw new ProfileError('invalid_session',401);
   const mfa=await readerDb.rpc('sb_require_mfa');if(mfa.error)throw new ProfileError('mfa_required',403);
   const limited=await readerDb.rpc('sb_rate_limit');if(limited.error)throw new ProfileError('rate_limit_exceeded',429);
   id=new URL(req.url).searchParams.get('company_id')??'';
  }
  if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id))throw new ProfileError('invalid_company_id',422);
  const result=await readerDb.from('companies').select('id,provider_company_id,ticker,provider').eq('id',id).eq('is_demo',false).maybeSingle();
  if(result.error)throw new ProfileError('company_read_failed',500);
  if(!result.data)throw new ProfileError('company_not_found',404);
  if(!['dart','sec'].includes(result.data.provider))return reply({status:'unsupported',profile:null});
  const company=result.data as CompanyIdentity;
  if(result.data.provider==='sec'){
   if(!/^\d{1,10}$/.test(company.provider_company_id)||!(/^[A-Z][A-Z0-9.-]{0,9}$/).test(company.ticker))throw new ProfileError('invalid_company_mapping',409);
   const cacheKey=`profile:sec:v1:${id}:${company.provider_company_id}:${company.ticker}`;
   const cached=await rpc('sb_us_cache',{k:cacheKey});if(cached)return reply(cached);
   const secrets=await rpc('sb_us_secrets'),contact=env('SEC_CONTACT_EMAIL')||secrets.SEC_CONTACT_EMAIL;
   if(typeof contact!=='string'||!(/^[^\s@]+@[^\s@]+\.[^\s@]+$/).test(contact))throw new ProfileError('sec_contact_required',503);
   const reserved=await db.rpc('sb_us_reserve',{p:'sec',amount:0,smoke:false});if(reserved.error)throw new ProfileError('provider_quota_exceeded',429);
   const raw=await providerFetch(`https://data.sec.gov/submissions/CIK${company.provider_company_id.padStart(10,'0')}.json`,'sec',{headers:{'User-Agent':`SignalBrief/0.2 ${contact}`}},fetch,3_000_000);
   const bytes=new TextEncoder().encode(raw),digest=await sha(bytes),profile=parseSecProfile(raw,company,new Date().toISOString(),digest);
   const archive=await db.storage.from('signalbrief-raw').upload(`us/sec/submissions/${digest}.json`,bytes,{contentType:'application/json',upsert:false});
   if(archive.error&&!/already exists|duplicate/i.test(archive.error.message))throw new ProfileError('archive_failed',500);
   await rpc('sb_us_cache',{k:cacheKey,v:profile,ttl:86400});return reply(profile);
  }
  if(!/^\d{8}$/.test(company.provider_company_id)||!/^\d{6}$/.test(company.ticker))throw new ProfileError('invalid_company_mapping',409);
  const cacheKey=`profile:dart:v1:${id}:${company.provider_company_id}:${company.ticker}`;
  const cached=await rpc('sb_us_cache',{k:cacheKey});if(cached)return reply(cached);
  const secrets=await rpc('sb_us_secrets');const key=env('DART_API_KEY')||secrets.DART_API_KEY;
  if(!/^[a-f0-9]{40}$/i.test(key??''))throw new ProfileError('provider_not_configured',503);
  const reserved=await db.rpc('sb_us_reserve',{p:'dart',amount:0,smoke:false});if(reserved.error)throw new ProfileError('provider_quota_exceeded',429);
  const bytes=await dartRelay({kind:'company',key,corp_code:company.provider_company_id},secrets.DART_RELAY_SECRET||env('DART_RELAY_SECRET'));
  if(bytes.length>128_000)throw new ProfileError('provider_response_too_large');
  const digest=await sha(bytes),fetchedAt=new Date().toISOString(),profile=parseProfile(new TextDecoder().decode(bytes),company,fetchedAt,digest);
  const archive=await db.storage.from('signalbrief-raw').upload(`dart/profiles/${digest}.json`,bytes,{contentType:'application/json',upsert:false});
  if(archive.error&&!/already exists|duplicate/i.test(archive.error.message))throw new ProfileError('archive_failed',500);
  await rpc('sb_us_cache',{k:cacheKey,v:profile,ttl:profile.status==='verified'?86400:600});
  return reply(profile);
 }catch(error){
  // Only fixed transport codes are surfaced; never an exception message or URL.
  const relayCodes=new Set(['relay_not_configured','relay_unauthorized','relay_upstream_failed','relay_network_failed','empty_response','response_too_large']);
  const code=typeof error==='object'&&error!==null&&'code' in error&&typeof error.code==='string'&&relayCodes.has(error.code)?error.code:'profile_unavailable';
  return reply({error:{code:error instanceof ProfileError?error.code:code}},error instanceof ProfileError?error.status:502);
 }
}
Deno.serve(handleProfiles);
