import {createClient,type SupabaseClient} from 'npm:@supabase/supabase-js@2.117.2';
import {obj,str,ProviderError,type Row} from '../signalbrief-api/us-core.ts';
import {verifyDeliveryWebhook,sendNotification,retryableEmailError} from './core.ts';
async function rpc(db:SupabaseClient,name:string,args:Row={}){const {data,error}=await db.rpc(name,args);if(error)throw new ProviderError('database','operation_failed');return data;}
export async function dispatchEmail(db:SupabaseClient,secrets:Row,config:Row):Promise<Row>{
 if(config.email_enabled!==true||config.resend_domain_verified!==true||!secrets.RESEND_API_KEY)return {status:'blocked',code:'email_configuration_missing'};
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
export async function deliveryWebhook(req:Request):Promise<Response>{
 const response=(status:number,code:string)=>new Response(JSON.stringify({status:code}),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
 if(req.method!=='POST')return response(405,'method_not_allowed');
 try{
  const reader=req.body?.getReader(),chunks:Uint8Array[]=[];let length=0;
  if(reader)while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>65536){await reader.cancel();return response(413,'body_too_large');}chunks.push(value);}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  const db=createClient(Deno.env.get('SUPABASE_URL')??'',Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'',{auth:{persistSession:false,autoRefreshToken:false}});
  const secret=obj(await rpc(db,'sb_us_secrets')).RESEND_WEBHOOK_SECRET;
  const event=await verifyDeliveryWebhook(new TextDecoder().decode(bytes),req.headers,str(secret));
  await rpc(db,'sb_email_event',event);return response(200,'recorded');
 }catch(error){return response(error instanceof ProviderError&&error.status===401?401:502,error instanceof ProviderError?error.code:'operation_failed');}
}
