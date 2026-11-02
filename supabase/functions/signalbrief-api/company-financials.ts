import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.117.2';
import {obj,str,ProviderError,transportCode,type Row,type Fetcher} from './us-core.ts';
import {dartRelay} from '../signalbrief-collector/dart-relay.ts';
import {parseSecFinancials,parseDartFinancials,dartFinancialReports,financialParserVersion,type FinancialSnapshot} from './company-financials-core.ts';

export async function financialAdmin(db:SupabaseClient,op:string,p:Row):Promise<Row>{
 const result=await db.rpc('sb_company_financial_admin',{op,p});
 if(result.error)throw new ProviderError('financials',/^PT/.test(result.error.code)&&/^[a-z0-9_]{1,80}$/.test(result.error.message)?result.error.message:'financial_database_failed',503);
 return obj(result.data);
}
const hash=async(bytes:Uint8Array)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes)))].map(x=>x.toString(16).padStart(2,'0')).join('');
const errorCode=(error:unknown)=>error instanceof ProviderError?error.code:'financial_provider_unavailable';
async function reserve(db:SupabaseClient,provider:string){const r=await db.rpc('sb_us_reserve',{p:provider,amount:0,smoke:false});if(r.error)throw new ProviderError(provider,'provider_budget_unavailable',429);}
async function archive(db:SupabaseClient,company:Row,bytes:Uint8Array){
 const sha=await hash(bytes),path=`financials/${company.provider}/${company.provider_company_id}/${sha}.json`;
 const saved=await db.storage.from('signalbrief-raw').upload(path,bytes,{contentType:'application/json',upsert:false});
 if(saved.error&&!/already exists|duplicate/i.test(saved.error.message))throw new ProviderError('financials','financial_archive_failed');
 return {sha,path};
}
export async function secFinancialBytes(cik:string,contact:string,fetcher:Fetcher=fetch):Promise<Uint8Array>{
 if(!/^\d{10}$/.test(cik))throw new ProviderError('sec','invalid_cik',422);
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact))throw new ProviderError('sec','contact_email_required',503);
 try{
  const response=await fetcher(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`,{redirect:'error',signal:AbortSignal.timeout(12000),headers:{'User-Agent':`SignalBrief/0.4 ${contact}`,Accept:'application/json'}});
  if(!response.ok){await response.body?.cancel();throw new ProviderError('sec',response.status===404?'companyfacts_not_available':response.status===429?'quota_exceeded':`http_${response.status}`,response.status);}
  if(Number(response.headers.get('content-length')??0)>12_000_000){await response.body?.cancel();throw new ProviderError('sec','financial_source_too_large');}
  const reader=response.body?.getReader();if(!reader)throw new ProviderError('sec','empty_response');
  const chunks:Uint8Array[]=[];let size=0;while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>12_000_000){await reader.cancel();throw new ProviderError('sec','financial_source_too_large');}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
 }catch(error){if(error instanceof ProviderError)throw error;throw new ProviderError('sec',transportCode(error));}
}
const decode=(bytes:Uint8Array)=>{try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new ProviderError('financials','invalid_source_encoding');}};

/** Only official structured values are collected here. Model approval is untouched. */
export async function collectCompanyFinancials(db:SupabaseClient,secrets:Row,company:Row){
 const company_id=str(company.id),lease=crypto.randomUUID();
 if(!['sec','dart'].includes(str(company.provider)))return {status:'unsupported'};
 const claim=await financialAdmin(db,'claim',{company_id,lease});if(claim.claimed!==true)return {status:claim.status};
 try{
  let snapshot:FinancialSnapshot,path:string;
  if(company.provider==='sec'){
   await reserve(db,'sec');const bytes=await secFinancialBytes(str(company.provider_company_id),str(secrets.SEC_CONTACT_EMAIL)),stored=await archive(db,company,bytes);
   snapshot=parseSecFinancials(decode(bytes),str(company.provider_company_id),stored.sha,new Date().toISOString());path=stored.path;
  }else{
   const reports=dartFinancialReports();
   const responses=await Promise.allSettled(reports.map(async report=>{
    await reserve(db,'dart');
    const bytes=await dartRelay({kind:'financials',key:str(secrets.DART_API_KEY),corp_code:company.provider_company_id,bsns_year:report.year,reprt_code:report.code},str(secrets.DART_RELAY_SECRET),12000);
    const stored=await archive(db,company,bytes);
    return {snapshot:parseDartFinancials(decode(bytes),str(company.provider_company_id),str(company.ticker),report,stored.sha,new Date().toISOString()),path:stored.path};
   }));
   let selected: {snapshot:FinancialSnapshot;path:string}|undefined;
   for(const response of responses){if(response.status==='rejected')throw response.reason;selected=response.value;if(selected.snapshot.items.length)break;}
   if(!selected)throw new ProviderError('dart','financial_source_unavailable');snapshot=selected.snapshot;path=selected.path;
  }
  return await financialAdmin(db,'save',{company_id,lease,snapshot,object_key:path,parser_version:financialParserVersion(snapshot.provider)});
 }catch(error){const code=errorCode(error);await financialAdmin(db,'fail',{company_id,lease,code});return {status:'unavailable',error_code:code};}
}
export async function requestCompanyFinancials(db:SupabaseClient,secrets:Row,company:Row){
 try{await financialAdmin(db,'request',{company_id:company.id});return await collectCompanyFinancials(db,secrets,company);}
 catch(error){return {status:'unavailable',error_code:errorCode(error)};}
}
