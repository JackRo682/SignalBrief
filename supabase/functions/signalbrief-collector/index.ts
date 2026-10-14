import {createClient} from 'npm:@supabase/supabase-js@2.117.2';
import {ingest,analyze} from '../signalbrief-api/us-handler.ts';
import {ProviderError,obj,str,type Row} from '../signalbrief-api/us-core.ts';
import {taskToken,dartList,dartPage} from './core.ts';
const env=(key:string)=>Deno.env.get(key)??'';
const db=createClient(env('SUPABASE_URL'),env('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
const hash=async(value:string)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join('');
const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
const code=(error:unknown)=>error instanceof ProviderError?error.code:'operation_failed';
async function rpc(name:string,args:Row={}){
 const {data,error}=await db.rpc(name,args);
 if(error)throw new ProviderError('database',/^PT/.test(error.code)?error.message:'operation_failed',500);
 return data;
}
async function check(provider:string,status:string,detail:Row){
 const result=await db.from('us_provider_checks').upsert({provider,status,detail,checked_at:new Date().toISOString()});
 if(result.error)throw new ProviderError('database','check_save_failed');
}
async function dartIngest(company:Row,key:string){
 let pages=1,total=0;
 for(let page=1;page<=pages;page++){
  await rpc('sb_us_reserve',{p:'dart',amount:0,smoke:false});
  const raw=await dartList(str(company.provider_company_id),key,page),parsed=dartPage(raw,str(company.provider_company_id)),sha=await hash(raw);
  if(page===1)pages=parsed.pages;
  else if(parsed.pages!==pages)throw new ProviderError('dart','pagination_changed_retry_later');
  const path=`dart/lists/${sha}.json`,archive=await db.storage.from('signalbrief-raw').upload(path,raw,{contentType:'application/json',upsert:false});
  if(archive.error&&!/already exists|duplicate/i.test(archive.error.message))throw new ProviderError('storage','archive_failed');
  if(parsed.items.length){
   const result=await db.from('dart_filings').upsert(parsed.items.map(item=>({...item,company_id:company.id,source_sha256:sha,source_object_key:path,publication_precision:'date',publication_timezone:'Asia/Seoul'})),{onConflict:'company_id,receipt',ignoreDuplicates:true});
   if(result.error)throw new ProviderError('database','dart_save_failed');
  }
  total+=parsed.items.length;
 }
 const updated=await db.from('companies').update({last_ingested_at:new Date().toISOString()}).eq('id',company.id);
 if(updated.error)throw new ProviderError('database','ingestion_timestamp_failed');
 return {symbol:company.ticker,filings:total,coverage:'previous_seven_days_metadata',document_analysis:'not_implemented'};
}
export async function handleCollector(req:Request):Promise<Response>{
 if(req.method!=='POST')return reply({error:{code:'method_not_allowed'}},405);
 let taskHash='',claimed=false;
 try{
  taskHash=await hash(taskToken(req.headers.get('x-signalbrief-task')??''));
  const task=obj(await rpc('sb_collector_claim',{h:taskHash}));
  if(!task.id)return reply({error:{code:'invalid_or_replayed_task'}},401);
  claimed=true;
  const config=obj(await rpc('sb_us_config'));
  if(config.scheduled_ingestion_enabled!==true)throw new ProviderError('collector','schedule_disabled',409);
  const secrets=obj(await rpc('sb_us_secrets'));
  for(const key of ['OPENAI_API_KEY','FMP_API_KEY','RESEND_API_KEY','GNEWS_API_KEY','SEC_CONTACT_EMAIL','DART_API_KEY'])if(env(key))secrets[key]=env(key);
  const result:Row={};
  const selected=await db.from('companies').select('id,ticker,provider,provider_company_id').eq('is_demo',false).in('provider',['sec','dart']).order('last_ingested_at',{ascending:true,nullsFirst:true});
  if(selected.error)throw new ProviderError('database','company_read_failed');
  const companies=selected.data??[];
  for(const provider of ['sec','dart']){
   const company=companies.find(c=>c.provider===provider);if(!company)continue;
   try{
    const detail=provider==='sec'?await ingest(db,secrets,company.ticker):await dartIngest(company,str(secrets.DART_API_KEY));
    result[provider]={status:'verified',...detail};await check(provider,'verified',detail);
   }catch(error){result[provider]={status:'blocked',code:code(error)};await check(provider,'blocked',{code:code(error)});}
  }
  if(Number(config.ai_daily_budget_usd)>0&&secrets.OPENAI_API_KEY){
   const filing=await rpc('sb_collector_analysis_pick');
   if(filing)try{
    result.openai=await analyze(db,secrets,str(filing));
    await rpc('sb_collector_analysis_finish',{fid:filing,result_status:'needs_review',result_code:null});
    await check('openai','verified',{analysis_saved:true,requires_human_review:true});
   }catch(error){
    result.openai={status:'blocked',code:code(error)};
    await rpc('sb_collector_analysis_finish',{fid:filing,result_status:'blocked',result_code:code(error)});
    await check('openai','blocked',{code:code(error)});
   }else result.openai={status:'idle',reason:'no_unattempted_filings_in_90_day_window'};
  }else {result.openai={status:'blocked',code:secrets.OPENAI_API_KEY?'ai_budget_not_approved':'missing_key'};}
  await rpc('sb_collector_finish',{h:taskHash,summary:result,failed:false});
  return reply(result);
 }catch(error){
  if(claimed)try{await rpc('sb_collector_finish',{h:taskHash,summary:{code:code(error)},failed:true});}catch{}
  return reply({error:{code:code(error)}},error instanceof ProviderError&&[401,409,503].includes(error.status)?error.status:502);
 }
}
Deno.serve(handleCollector);
