import {dispatchEmail} from '../signalbrief-delivery/index.ts';
import {processDartDocument} from './dart-document.ts';
import {createClient} from 'npm:@supabase/supabase-js@2.117.2';
import {ingest,analyze} from '../signalbrief-api/us-handler.ts';
import {collectCompanyFinancials} from '../signalbrief-api/company-financials.ts';
import {ProviderError,obj,str,type Row} from '../signalbrief-api/us-core.ts';
import {taskToken} from './core.ts';
import {collectDartFilings} from './dart-ingest.ts';
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
  for(const key of ['OPENAI_API_KEY','FMP_API_KEY','RESEND_API_KEY','GNEWS_API_KEY','SEC_CONTACT_EMAIL','DART_API_KEY','RESEND_WEBHOOK_SECRET','KIS_APP_KEY','KIS_APP_SECRET'])if(env(key))secrets[key]=env(key);
  const result:Row={};
  const companies=await rpc('sb_collection_candidates') as Row[];
  for(const provider of ['sec','dart']){
   const company=companies.find(c=>c.provider===provider);if(!company)continue;
   try{
    const detail=provider==='sec'?await ingest(db,secrets,str(company.ticker)):await collectDartFilings(db,company,str(secrets.DART_API_KEY),str(secrets.DART_RELAY_SECRET));
    result[provider]={status:'verified',...detail};await check(provider,'verified',detail);
   }catch(error){result[provider]={status:'blocked',code:code(error)};await check(provider,'blocked',{code:code(error)});}
   const outcome=obj(result[provider]);
   await rpc('sb_collection_finish',{company_id:company.id,result_status:outcome.status,result_code:outcome.code??null,lease_id:company.collection_lease_id});
  }
  const financialCompany=obj(await rpc('sb_financial_collection_pick'));
  if(financialCompany.id)result.financials=await collectCompanyFinancials(db,secrets,financialCompany);
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
   }else result.openai={status:'idle',reason:'no_eligible_analysis_under_current_limits'};
  }else {result.openai={status:'blocked',code:secrets.OPENAI_API_KEY?'ai_budget_not_approved':'missing_key'};}
  result.dart_documents=await processDartDocument(db,secrets,config);
  result.email=await dispatchEmail(db,secrets,config);
  await rpc('sb_collector_finish',{h:taskHash,summary:result,failed:false});
  return reply(result);
 }catch(error){
  if(claimed)try{await rpc('sb_collector_finish',{h:taskHash,summary:{code:code(error)},failed:true});}catch{}
  return reply({error:{code:code(error)}},error instanceof ProviderError&&[401,409,503].includes(error.status)?error.status:502);
 }
}
Deno.serve(handleCollector);
