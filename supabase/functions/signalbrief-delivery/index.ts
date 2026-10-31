import {createClient,type SupabaseClient} from 'npm:@supabase/supabase-js@2.117.2';
import {obj,str,ProviderError,type Row} from '../signalbrief-api/us-core.ts';
import {verifyDeliveryWebhook} from './core.ts';
async function rpc(db:SupabaseClient,name:string,args:Row={}){const {data,error}=await db.rpc(name,args);if(error)throw new ProviderError('database','operation_failed');return data;}
export {dispatchEmail} from './dispatch.ts';
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
