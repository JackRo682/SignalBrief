import {createClient} from 'npm:@supabase/supabase-js@2.117.2';
import {CalendarError,fetchSource,parseSource,sha256,type Source} from './core.ts';
import {collectQ4} from './micron-q4.ts';
import {collectDartIR,type DartIRSource} from './dart-ir.ts';
import {dartRelay} from '../signalbrief-collector/dart-relay.ts';
import {koreaDate} from '../signalbrief-collector/core.ts';
import {collectSecIR,type SecIRSource} from './sec-ir.ts';
import {createCalendarSourceFetch} from './source-relay.ts';
import {archiveNotice,type NoticePayload} from './curated-notice.ts';
export async function handleCalendar(req:Request):Promise<Response>{
 const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
 if(req.method!=='POST')return reply({error:'method_not_allowed'},405);
 const token=req.headers.get('x-signalbrief-task')??'';
 if(!/^[a-f0-9]{64}$/.test(token))return reply({error:'unauthorized'},401);
 // Leave nine seconds for failure recording and queue handoff inside pg_net's 60s request.
 const started=Date.now();let cleanup=false;
 const remaining=()=>Math.max(1,(cleanup?53000:44000)-(Date.now()-started));
 const deadlineFetch=(input:RequestInfo|URL,init:RequestInit={},requestMs=10000)=>{
  if(Date.now()-started>=(cleanup?53000:44000))throw new CalendarError('calendar_deadline_exceeded');
  const signal=AbortSignal.timeout(Math.min(requestMs,remaining()));
  return fetch(input,{...init,signal:init.signal?AbortSignal.any([init.signal,signal]):signal});
 };
 const boundedFetch:typeof fetch=(input,init={})=>deadlineFetch(input,init);
 const db=createClient(Deno.env.get('SUPABASE_URL')??'',Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:boundedFetch}});
 const rpc=async(name:string,args:Record<string,unknown>={})=>{const r=await db.rpc(name,args);if(r.error)throw new CalendarError(/^PT\d{3}$/.test(r.error.code)&&/^[a-z_]{1,80}$/.test(r.error.message)?r.error.message:'database_operation_failed');return r.data;};
 // Count each actual regulator request, including calendar discovery. Storage and
 // first-party RPCs use boundedFetch directly and never recursively reserve quota.
 const regulatorFetch:typeof fetch=async(input,init={})=>{
  if(Date.now()-started>=44000)throw new CalendarError('calendar_deadline_exceeded');
  const host=new URL(input instanceof Request?input.url:String(input)).hostname;
  const provider=['www.sec.gov','data.sec.gov'].includes(host)?'sec':['dart.fss.or.kr','opendart.fss.or.kr'].includes(host)?'dart':null;
  if(provider)await rpc('sb_calendar_provider_reserve',{p:provider});
  return boundedFetch(input,init);
 };
 const h=await sha256(new TextEncoder().encode(token));let claimed=false;
 try{
  if(!await rpc('sb_calendar_claim',{h}))return reply({error:'invalid_or_replayed_task'},401);claimed=true;
  const sources=await rpc('sb_calendar_task_sources',{h}) as Source[],results=[];
  if(!Array.isArray(sources)||sources.length>1)throw new CalendarError('invalid_task_scope');
  const archive=async(path:string,bytes:Uint8Array,contentType:string)=>{
   const archived=await db.storage.from('signalbrief-raw').upload(path,bytes,{contentType,upsert:false});
   if(archived.error&&!/already exists|duplicate/i.test(archived.error.message))throw new CalendarError('archive_failed');
  };
  for(const source of sources){
   try{
    if(source.adapter==='curated-notice'){
     const payload=await rpc('sb_calendar_notice_payload',{source:source.key,h}) as NoticePayload;
     const snapshot=await archiveNotice(source,payload,archive);
     const count=snapshot.completed?snapshot.count:await rpc('sb_calendar_ingest_notice',{source:source.key,h,raw_sha:snapshot.raw_sha,object_key:snapshot.object_key,manifest_text:snapshot.manifest_text});
     results.push({source:source.key,status:'verified',items:count});continue;
    }
    if(source.adapter==='sec-ir'){
     const secrets=await rpc('sb_us_secrets') as Record<string,unknown>;
     const contact=Deno.env.get('SEC_CONTACT_EMAIL')||String(secrets?.SEC_CONTACT_EMAIL??'');
     const relaySecret=Deno.env.get('DART_RELAY_SECRET')||String(secrets?.DART_RELAY_SECRET??'');
     const officialFetch=createCalendarSourceFetch(relaySecret,(input,init={})=>deadlineFetch(input,init,12000));
     const snapshot=await collectSecIR(source as SecIRSource,new Date().toISOString().slice(0,10),contact,archive,regulatorFetch,
      officialFetch);
     const count=await rpc('sb_calendar_ingest_sec_ir',{source:source.key,raw_sha:snapshot.raw_sha,object_key:snapshot.object_key,manifest_text:snapshot.manifest_text});
     results.push({source:source.key,status:'verified',items:count});continue;
    }
    if(source.adapter==='micron-q4'||source.adapter==='q4-events'){
     const snapshot=await collectQ4(source,new Date().toISOString().slice(0,10),archive,boundedFetch);
     const count=await rpc('sb_calendar_ingest_q4',{source:source.key,raw_sha:snapshot.raw_sha,object_key:snapshot.object_key,manifest_text:snapshot.manifest_text});
     results.push({source:source.key,status:'verified',items:count});continue;
    }
    if(source.adapter==='dart-ir'){
     // Keys are read only for this source. A DART configuration failure never blocks a Q4 worker.
     const secrets=await rpc('sb_us_secrets') as Record<string,unknown>;
     const key=Deno.env.get('DART_API_KEY')||String(secrets?.DART_API_KEY??''),relaySecret=Deno.env.get('DART_RELAY_SECRET')||String(secrets?.DART_RELAY_SECRET??'');
     if(!/^[a-f0-9]{40}$/i.test(key)||!/^[a-f0-9]{64}$/.test(relaySecret))throw new CalendarError('dart_not_configured');
     const day=koreaDate(),today=`${day.slice(0,4)}-${day.slice(4,6)}-${day.slice(6,8)}`;
     const snapshot=await collectDartIR(source as DartIRSource,today,archive,async(corpCode,page,start,end,signal)=>{
      if(signal.aborted||Date.now()-started>=44000)throw new CalendarError('calendar_deadline_exceeded');
      await rpc('sb_calendar_provider_reserve',{p:'dart'});
      return await dartRelay({kind:'list',key,corp_code:corpCode,page,bgn_de:start,end_de:end},relaySecret,Math.min(12000,remaining()));
     },regulatorFetch);
     const count=await rpc('sb_calendar_ingest_dart_ir',{source:source.key,raw_sha:snapshot.raw_sha,object_key:snapshot.object_key,manifest_text:snapshot.manifest_text});
     results.push({source:source.key,status:'verified',items:count});continue;
    }
    const bytes=await fetchSource(source,boundedFetch),sha=await sha256(bytes),parsed=parseSource(source,new TextDecoder('utf-8',{fatal:true}).decode(bytes),new Date().toISOString().slice(0,10));
    const path=`calendar/${source.key}/${sha}.html`;
    await archive(path,bytes,'text/html');
    const count=await rpc('sb_calendar_ingest',{source:source.key,raw_sha:sha,object_key:path,normalized_text:parsed.text,entries:parsed.entries});
    results.push({source:source.key,status:'verified',items:count});
   }catch(error){
    cleanup=true;
    const code=error instanceof CalendarError?error.message:'source_fetch_failed';
    await rpc('sb_calendar_source_error',{source:source.key,code});results.push({source:source.key,status:'failed',code});
   }
  }
  cleanup=true;
  await rpc('sb_calendar_finish',{h,summary:results});return reply({results});
 }catch{
  cleanup=true;
  if(claimed)try{await rpc('sb_calendar_finish',{h,summary:[{status:'failed',code:'calendar_operation_failed'}]});}catch{/* original failure */}
  return reply({error:'calendar_operation_failed'},502);
 }
}
Deno.serve(handleCalendar);
