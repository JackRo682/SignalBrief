import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.117.2';
import {ProfileError,parseSecProfile,type CompanyIdentity} from './core.ts';
import {providerFetch} from '../signalbrief-api/us-core.ts';
import {collectSecProfileEnrichment,emptyEnrichment,profileFailureCode,type OfficialProfileSource,type ProfileTransport} from './enrichment-service.ts';
import type {ProfileEnrichment} from './enrichment-types.ts';
import {collectDartProfileEnrichment} from './enrichment-dart.ts';

type BasicProfile={status:string;profile:{name:string}|null};
type Environment={contact?:string;dartApiKey?:string;dartRelaySecret?:string;signal:AbortSignal};
const object=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const sha=async(bytes:Uint8Array)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes)))].map(value=>value.toString(16).padStart(2,'0')).join('');

/** A failed optional enrichment never discards a separately verified basic profile. */
export async function loadProfileEnrichment(db:SupabaseClient,company:CompanyIdentity,provider:'sec'|'dart',basic:BasicProfile,raw:string|undefined,environment:Environment):Promise<ProfileEnrichment>{
 const now=new Date().toISOString(),lease=crypto.randomUUID();let claimed=false;
 const rpc=async(op:string,p:Record<string,unknown>={})=>{
  const response=await db.rpc('sb_profile_enrichment_admin',{op,p:{company_id:company.id,...p}});
  if(response.error)throw new ProfileError('profile_persistence_unavailable');return response.data;
 };
 try{
  const state=object(await rpc('read')),cached=object(state.result);
  if(cached.schema==='signalbrief.company-profile.v1'&&cached.company_id===company.id&&typeof cached.next_refresh_at==='string'&&Date.parse(cached.next_refresh_at)>Date.now())return cached as ProfileEnrichment;
  if(basic.status!=='verified'||!basic.profile)return emptyEnrichment(company.id,now,'basic_profile_not_verified','not_available');
  if(await rpc('claim',{lease})!==true)return cached.schema==='signalbrief.company-profile.v1'?cached as ProfileEnrichment:emptyEnrichment(company.id,now,'profile_refresh_in_progress');
  claimed=true;
  const transport:ProfileTransport={signal:environment.signal,now:()=>new Date(),
   reserve:async p=>{const response=await db.rpc('sb_us_reserve',{p,amount:0,smoke:false});if(response.error)throw new ProfileError('profile_source_rate_limited');},
   archive:async(path,bytes,contentType)=>{const response=await db.storage.from('signalbrief-raw').upload(path,bytes,{contentType,upsert:false});if(response.error&&!/already exists|duplicate/i.test(response.error.message))throw new ProfileError('profile_archive_failed');},
  };
  if(provider==='sec'){
   let contact=environment.contact;
   if(!contact){const secrets=await db.rpc('sb_us_secrets');contact=typeof secrets.data?.SEC_CONTACT_EMAIL==='string'?secrets.data.SEC_CONTACT_EMAIL:undefined;}
   if(!contact||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact))throw new ProfileError('sec_contact_required');
   if(raw===undefined){
    await transport.reserve('sec');
    raw=await providerFetch(new URL(`https://data.sec.gov/submissions/CIK${company.provider_company_id.padStart(10,'0')}.json`),'sec',{headers:{'User-Agent':`SignalBrief profile/1.0 ${contact}`}},fetch,3_000_000);
    const bytes=new TextEncoder().encode(raw),digest=await sha(bytes);
    parseSecProfile(raw,company,new Date().toISOString(),digest);
    await transport.archive(`us/sec/submissions/${digest}.json`,bytes,'application/json');
   }
   const configured=Array.isArray(state.official_sources)?state.official_sources as OfficialProfileSource[]:[];
   const snapshot=await collectSecProfileEnrichment(company,raw,basic.profile.name,contact,configured,transport);
   const previous=cached.schema==='signalbrief.company-profile.v1'?cached as ProfileEnrichment:null;
   if(previous&&(
    previous.leadership.some(item=>item.basis==='official_page')&&!snapshot.result.leadership.some(item=>item.basis==='official_page')&&snapshot.result.limitations.includes('leadership_page_unavailable')
    ||previous.business.length>0&&snapshot.result.business.length===0
    ||previous.products.length>0&&snapshot.result.products.length===0
    ||previous.segments.length>0&&snapshot.result.segments.length===0
    ||previous.formation.length>0&&snapshot.result.formation.length===0
   ))throw new ProfileError('authoritative_profile_refresh_unavailable');
   return await rpc('save',{lease,...snapshot}) as ProfileEnrichment;
  }
  const secretResult=await db.rpc('sb_us_secrets');if(secretResult.error)throw new ProfileError('profile_source_unavailable');
  const storedSecrets=object(secretResult.data);
  const dartSecrets={
   DART_API_KEY:environment.dartApiKey||(typeof storedSecrets.DART_API_KEY==='string'?storedSecrets.DART_API_KEY:undefined),
   DART_RELAY_SECRET:(typeof storedSecrets.DART_RELAY_SECRET==='string'?storedSecrets.DART_RELAY_SECRET:undefined)||environment.dartRelaySecret,
  };
  const snapshot=await collectDartProfileEnrichment(db,company,basic.profile.name,dartSecrets,transport);
  const previous=cached.schema==='signalbrief.company-profile.v1'?cached as ProfileEnrichment:null;
  if(previous&&(previous.business.length>0&&snapshot.result.business.length===0||previous.products.length>0&&snapshot.result.products.length===0||previous.segments.length>0&&snapshot.result.segments.length===0))throw new ProfileError('authoritative_profile_refresh_unavailable');
  return await rpc('save',{lease,...snapshot}) as ProfileEnrichment;
 }catch(error){
  const code=profileFailureCode(error);
  if(claimed){try{return await rpc('fail',{lease,code}) as ProfileEnrichment;}catch{/* Keep basic metadata usable if optional persistence fails. */}}
  return emptyEnrichment(company.id,now,code);
 }
}
