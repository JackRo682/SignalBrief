import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.117.2';
import {providerFetch,secSubmissions,ProviderError,obj,str,type Row} from '../signalbrief-api/us-core.ts';
import {dartRelay} from '../signalbrief-collector/dart-relay.ts';
import {dartPage,koreaDate} from '../signalbrief-collector/core.ts';
import {parseProfile,parseSecProfile,type CompanyIdentity} from '../signalbrief-profiles/core.ts';
import {parseSecDirectory,parseDartDirectoryResult,DiscoveryError} from './core.ts';

const env=(key:string)=>Deno.env.get(key)??'';
const sha=async(bytes:Uint8Array)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes)))].map(b=>b.toString(16).padStart(2,'0')).join('');
const code=(error:unknown)=>error instanceof DiscoveryError||error instanceof ProviderError?error.code:'provider_unavailable';
export async function discoveryRpc(db:SupabaseClient,op:string,p:Row):Promise<unknown>{
 const r=await db.rpc('sb_discovery_admin',{op,p});
 if(r.error)throw new DiscoveryError(/^PT/.test(r.error.code)&&/^[a-z_]{1,80}$/.test(r.error.message)?r.error.message:'directory_database_failed',/^PT\d{3}$/.test(r.error.code)?Number(r.error.code.slice(2)):500);
 return r.data;
}
async function rpc(db:SupabaseClient,name:string,p:Row={}){const r=await db.rpc(name,p);if(r.error)throw new DiscoveryError('provider_request_failed',503);return r.data;}
async function archive(db:SupabaseClient,path:string,bytes:Uint8Array,type:string){
 const r=await db.storage.from('signalbrief-raw').upload(path,bytes,{contentType:type,upsert:false});
 if(r.error&&!/duplicate|already exists/i.test(r.error.message))throw new DiscoveryError('archive_failed',500);
}
export async function discoverySecrets(db:SupabaseClient):Promise<Row>{
 const secrets=obj(await rpc(db,'sb_us_secrets'));
 for(const k of ['SEC_CONTACT_EMAIL','DART_API_KEY','DART_RELAY_SECRET'])if(env(k))secrets[k]=env(k);
 return secrets;
}
export async function refreshDirectory(db:SupabaseClient,secrets:Row,provider:'sec'|'dart'){
 const lease=crypto.randomUUID();
 if(await discoveryRpc(db,'claim',{provider,lease})!==true)return {provider,status:'cached_or_refreshing'};
 try{
  await rpc(db,'sb_us_reserve',{p:provider,amount:0,smoke:false});
  let bytes:Uint8Array,entries,digest:string,path:string;
  if(provider==='sec'){
   const contact=str(secrets.SEC_CONTACT_EMAIL);if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact))throw new DiscoveryError('sec_contact_required',503);
   const raw=await providerFetch(new URL('https://www.sec.gov/files/company_tickers_exchange.json'),'sec',{headers:{'User-Agent':`SignalBrief/0.3 ${contact}`,Accept:'application/json'}},fetch,10000000);
   bytes=new TextEncoder().encode(raw);entries=parseSecDirectory(raw);
   digest=await sha(bytes);path=`directory/sec/${digest}.json`;
   await archive(db,path,bytes,'application/json');
  }else{
   const key=str(secrets.DART_API_KEY);if(!/^[a-f0-9]{40}$/i.test(key))throw new DiscoveryError('dart_not_configured',503);
   const relaySecret=str(secrets.DART_RELAY_SECRET);
   bytes=await dartRelay({kind:'directory',key},relaySecret,15000);
   digest=await sha(bytes);path=`directory/dart/${digest}.zip`;
   // Archive immutable source bytes before parsing. The Node relay receives only
   // a short-lived read capability for this exact private object, never service keys.
   await archive(db,path,bytes,'application/zip');
   const signed=await db.storage.from('signalbrief-raw').createSignedUrl(path,60);
   if(signed.error||!signed.data?.signedUrl)throw new DiscoveryError('archive_signing_failed',500);
   const parsed=await dartRelay({kind:'directory_parse',source_url:signed.data.signedUrl,sha:digest},relaySecret,20000);
   entries=parseDartDirectoryResult(new TextDecoder('utf-8',{fatal:true}).decode(parsed),digest);
  }
  if(entries.length<100)throw new DiscoveryError('incomplete_official_directory');
  await discoveryRpc(db,'save',{provider,lease,sha:digest,object_key:path,items:entries});
  return {provider,status:'ready',count:entries.length};
 }catch(error){await discoveryRpc(db,'fail',{provider,lease,code:code(error)});return {provider,status:'unavailable',code:code(error)};}
}

/** A selected issuer is hydrated synchronously. No model calls or publication occur. */
export async function hydrateCompany(db:SupabaseClient,secrets:Row,company:Row){
 const id=str(company.id),lease=crypto.randomUUID(),claim=obj(await discoveryRpc(db,'hydration_claim',{company_id:id,lease}));
 if(claim.ready===true)return {company_id:id,hydration_status:'ready'};
 if(claim.claimed!==true)return {company_id:id,hydration_status:'unavailable',error:'collection_in_progress'};
 try{
  const identity=company as unknown as CompanyIdentity;
  await rpc(db,'sb_us_reserve',{p:company.provider,amount:0,smoke:false});
  if(company.provider==='sec'){
   const result=await secSubmissions(str(company.provider_company_id),str(secrets.SEC_CONTACT_EMAIL));
   if(!result.tickers.includes(str(company.ticker)))throw new DiscoveryError('company_identity_mismatch');
   const bytes=new TextEncoder().encode(result.raw),digest=await sha(bytes),stamp=new Date().toISOString();
   await archive(db,`us/sec/submissions/${digest}.json`,bytes,'application/json');
   const profile=parseSecProfile(result.raw,identity,stamp,digest);
   await rpc(db,'sb_us_cache',{k:`profile:sec:v1:${id}:${company.provider_company_id}:${company.ticker}`,v:profile,ttl:86400});
   if(result.filings.length){const saved=await db.from('us_filings').upsert(result.filings.map(f=>({...f,company_id:id,source_sha256:digest,fetched_at:stamp})),{onConflict:'company_id,accession',ignoreDuplicates:true});if(saved.error)throw new DiscoveryError('filing_save_failed',500);}
  }else{
   const key=str(secrets.DART_API_KEY),relaySecret=str(secrets.DART_RELAY_SECRET);
   // Two bounded network stages: profile + first list in parallel, then any remaining pages.
   // Never serially spend five provider timeout windows inside a 55-second web request.
   const first=koreaDate(new Date(Date.now()-90*86400000)),last=koreaDate();
   await rpc(db,'sb_us_reserve',{p:'dart',amount:0,smoke:false});
   const [bytes,firstList]=await Promise.all([
    dartRelay({kind:'company',key,corp_code:company.provider_company_id},relaySecret,15000),
    dartRelay({kind:'list',key,corp_code:company.provider_company_id,page:1,bgn_de:first,end_de:last},relaySecret,15000),
   ]),digest=await sha(bytes),stamp=new Date().toISOString();
   const raw=new TextDecoder().decode(bytes),profile=parseProfile(raw,identity,stamp,digest);
   if(profile.status!=='verified')throw new DiscoveryError('company_profile_unavailable');
   await archive(db,`dart/profiles/${digest}.json`,bytes,'application/json');
   await rpc(db,'sb_us_cache',{k:`profile:dart:v1:${id}:${company.provider_company_id}:${company.ticker}`,v:profile,ttl:86400});
   // OpenDART's overview explicitly identifies Y=KOSPI, K=KOSDAQ, N=KONEX.
   const cls=String(JSON.parse(raw).corp_cls??''),market:Record<string,string>={Y:'KOSPI',K:'KOSDAQ',N:'KONEX'};
   if(market[cls]){const updated=await db.from('companies').update({market:market[cls]}).eq('id',id).in('market',['KR','KRX']);if(updated.error)throw new DiscoveryError('company_save_failed',500);}
   const pageOne=dartPage(new TextDecoder().decode(firstList),str(company.provider_company_id));
   const pages=pageOne.pages;
   const remaining=await Promise.all(Array.from({length:Math.max(0,pages-1)},async(_,index)=>{
    await rpc(db,'sb_us_reserve',{p:'dart',amount:0,smoke:false});
    return dartRelay({kind:'list',key,corp_code:company.provider_company_id,page:index+2,bgn_de:first,end_de:last},relaySecret,15000);
   }));
   await Promise.all([firstList,...remaining].map(async listBytes=>{
    const parsed=dartPage(new TextDecoder().decode(listBytes),str(company.provider_company_id));
    if(pages!==parsed.pages)throw new DiscoveryError('pagination_changed_retry_later');
    const listHash=await sha(listBytes),path=`dart/lists/${listHash}.json`;await archive(db,path,listBytes,'application/json');
    if(parsed.items.length){const saved=await db.from('dart_filings').upsert(parsed.items.map(f=>({...f,company_id:id,source_sha256:listHash,source_object_key:path,publication_precision:'date',publication_timezone:'Asia/Seoul'})),{onConflict:'company_id,receipt',ignoreDuplicates:true});if(saved.error)throw new DiscoveryError('filing_save_failed',500);}
   }));
  }
  const updated=await db.from('companies').update({last_ingested_at:new Date().toISOString()}).eq('id',id);if(updated.error)throw new DiscoveryError('ingestion_timestamp_failed',500);
  await discoveryRpc(db,'hydration_finish',{company_id:id,lease,code:null});
  return {company_id:id,hydration_status:'ready'};
 }catch(error){await discoveryRpc(db,'hydration_finish',{company_id:id,lease,code:code(error)});return {company_id:id,hydration_status:'unavailable',error:code(error)};}
}
