import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.117.2';
import {ProviderError,obj,str,type Row} from '../signalbrief-api/us-core.ts';
import {ProfileError} from '../signalbrief-profiles/core.ts';
import {dartProfileFilings} from '../signalbrief-profiles/enrichment-dart-core.ts';
import {dartList,dartPage,koreaDate} from './core.ts';
import {dartRelay} from './dart-relay.ts';

type Transport={now:()=>Date;relay:typeof dartRelay;list:typeof dartList};
const digest=async(bytes:Uint8Array)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes)))].map(x=>x.toString(16).padStart(2,'0')).join('');
const iso=(day:string)=>`${day.slice(0,4)}-${day.slice(4,6)}-${day.slice(6,8)}`;

/** An issuer's first collection gets complete, final periodic metadata before incremental polling. */
export async function collectDartFilings(db:SupabaseClient,company:Row,key:string,relaySecret:string,overrides:Partial<Transport>={}):Promise<Row>{
 const transport:Transport={now:()=>new Date(),relay:dartRelay,list:dartList,...overrides};
 const corpCode=str(company.provider_company_id),ticker=str(company.ticker),companyId=str(company.id),cold=company.last_ingested_at==null;
 if(!/^\d{8}$/.test(corpCode)||!/^[A-Z0-9]{6}$/.test(ticker)||!companyId||company.provider!==undefined&&company.provider!=='dart')throw new ProviderError('dart','invalid_filing_identity',422);
 if(!/^[a-f0-9]{40}$/i.test(key))throw new ProviderError('dart','missing_or_invalid_key',503);
 if(cold&&!/^[a-f0-9]{64}$/.test(relaySecret))throw new ProviderError('dart','relay_not_configured',503);
 const reserve=async()=>{
  const {error}=await db.rpc('sb_us_reserve',{p:'dart',amount:0,smoke:false});
  if(error)throw new ProviderError('database',/^PT/.test(error.code)?error.message:'operation_failed',500);
 };
 const save=async(bytes:Uint8Array,items:Row[])=>{
  const sha=await digest(bytes),path=`dart/lists/${sha}.json`;
  const archive=await db.storage.from('signalbrief-raw').upload(path,bytes,{contentType:'application/json',upsert:false});
  if(archive.error&&!/already exists|duplicate/i.test(archive.error.message))throw new ProviderError('storage','archive_failed');
  if(items.length){
   const saved=await db.from('dart_filings').upsert(items.map(item=>({...item,company_id:companyId,source_sha256:sha,source_object_key:path,publication_precision:'date',publication_timezone:'Asia/Seoul'})),{onConflict:'company_id,receipt',ignoreDuplicates:true});
   if(saved.error)throw new ProviderError('database','dart_save_failed');
  }
 };
 let total=0;
 if(cold){
  const now=transport.now(),end=koreaDate(now),start=koreaDate(new Date(now.getTime()-550*86400_000));
  await reserve();
  // The deployed signed relay fixes page=1, count=100, periodic type A and final reports Y.
  // A larger/incomplete response is an explicit failure, never a silently truncated success.
  const bytes=await transport.relay({kind:'periodic_list',key,corp_code:corpCode,bgn_de:start,end_de:end},relaySecret);
  let raw:string;
  try{raw=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new ProviderError('dart','invalid_json');}
  let data:Row;try{data=obj(JSON.parse(raw));}catch{throw new ProviderError('dart','invalid_json');}
  if(['010','011'].includes(str(data.status)))throw new ProviderError('dart','invalid_key');
  if(data.status==='013'&&(data.list!==undefined&&(!Array.isArray(data.list)||data.list.length!==0)||data.total_count!==undefined&&Number(data.total_count)!==0||data.total_page!==undefined&&Number(data.total_page)!==0))throw new ProviderError('dart','dart_periodic_list_incomplete');
  let items:Row[];
  try{
   items=dartProfileFilings(raw,{id:companyId,provider_company_id:corpCode,ticker},iso(end)).map(({receipt,title,filing_date,source_url})=>({receipt,title,filing_date,source_url}));
  }catch(error){
   if(error instanceof ProfileError)throw new ProviderError('dart',error.code==='profile_source_rate_limited'?'quota_exceeded':error.code);
   throw new ProviderError('dart','dart_periodic_list_invalid');
  }
  if(items.some(item=>str(item.filing_date)<iso(start)))throw new ProviderError('dart','dart_periodic_list_outside_window');
  await save(bytes,items);total=items.length;
 }else{
  // Preserve the previous seven-day, amendment-inclusive incremental contract.
  let pages=1;
  for(let page=1;page<=pages;page++){
   await reserve();
   const raw=await transport.list(corpCode,key,page,fetch,relaySecret),parsed=dartPage(raw,corpCode);
   if(page===1)pages=parsed.pages;
   else if(parsed.pages!==pages)throw new ProviderError('dart','pagination_changed_retry_later');
   await save(new TextEncoder().encode(raw),parsed.items);total+=parsed.items.length;
  }
 }
 const updated=await db.from('companies').update({last_ingested_at:transport.now().toISOString()}).eq('id',companyId);
 if(updated.error)throw new ProviderError('database','ingestion_timestamp_failed');
 return {symbol:ticker,filings:total,coverage:cold?'previous_550_days_final_periodic_metadata':'previous_seven_days_metadata',...(cold?{periodic_report_status:total?'available':'not_available'}:{}),document_analysis:'separate_document_stage'};
}
