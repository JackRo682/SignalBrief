import {obj,str,ProviderError,type Row} from '../signalbrief-api/us-core.ts';
import {sendNotification,retryableEmailError} from './core.ts';
type RpcClient={rpc(name:string,args:Row):PromiseLike<{data:unknown;error:unknown}>};
async function rpc(db:RpcClient,name:string,args:Row={}){const {data,error}=await db.rpc(name,args);if(error)throw new ProviderError('database','operation_failed');return data;}
export async function dispatchEmail(db:RpcClient,secrets:Row,config:Row):Promise<Row>{
 // Database readiness is the same gate used by settings, queueing and cron.
 // Check it before claiming work so unavailable delivery consumes no attempts.
 try{
  const readiness=obj(await rpc(db,'sb_email_readiness'));
  if(readiness.available!==true)return {status:'blocked',code:'email_unavailable'};
 }catch{return {status:'blocked',code:'email_readiness_unavailable'};}
 if(config.email_enabled!==true||config.resend_domain_verified!==true||!str(config.resend_from)||!str(secrets.RESEND_API_KEY))return {status:'blocked',code:'email_configuration_missing'};
 const task=obj(await rpc(db,'sb_email_claim'));if(!task.id)return {status:'idle'};
 try{
  if(await rpc(db,'sb_email_defer_if_quiet',{eid:task.id}))return {status:'deferred'};
  const permitted=await rpc(db,'sb_email_permitted',{eid:task.id});
  if(!permitted){await rpc(db,'sb_email_finish',{eid:task.id,message_id:null,error_code:'consent_or_publication_changed',retryable:false});return {status:'suppressed'};}
  await rpc(db,'sb_us_reserve',{p:'resend',amount:0,smoke:false});
  const message=await sendNotification(str(secrets.RESEND_API_KEY),str(config.resend_from),str(task.recipient),str(task.subject),str(task.body),'sb-email-'+str(task.id),fetch,str(task.unsubscribe_url)||undefined);
  await rpc(db,'sb_email_finish',{eid:task.id,message_id:message,error_code:null,retryable:false});
  return {status:'submitted',email_id:message};
 }catch(error){
  await rpc(db,'sb_email_finish',{eid:task.id,message_id:null,error_code:error instanceof ProviderError?error.code:'operation_failed',retryable:retryableEmailError(error)});
  return {status:'blocked',code:error instanceof ProviderError?error.code:'operation_failed'};
 }
}
