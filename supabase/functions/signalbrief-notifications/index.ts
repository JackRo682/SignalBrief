import {createClient} from 'npm:@supabase/supabase-js@2.117.2';
import {dispatchEmail} from '../signalbrief-delivery/index.ts';
import {obj,str} from '../signalbrief-api/us-core.ts';
const db=createClient(Deno.env.get('SUPABASE_URL')??'',Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'',{auth:{persistSession:false,autoRefreshToken:false}});
async function rpc(name:string,args:Record<string,unknown>={}){const {data,error}=await db.rpc(name,args);if(error)throw new Error('database_operation_failed');return data;}
export async function handleNotifications(req:Request):Promise<Response>{
 const url=new URL(req.url),headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
 const reply=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{...headers,'Content-Type':'application/json'}});
 try{
  if(url.pathname.endsWith('/unsubscribe')){
   const token=url.searchParams.get('token')??'';
   if(!/^[a-f0-9]{64}$/.test(token))return reply({error:'invalid_link'},400);
   if(req.method==='GET')return new Response(null,{status:303,headers:{...headers,Location:'https://signalbrief.online/email/unsubscribe?token='+token}});
   if(req.method!=='POST')return reply({error:'method_not_allowed'},405);
   const ok=await rpc('sb_email_unsubscribe',{token});
   return reply({status:ok?'unsubscribed':'invalid_link'},ok?200:400);
  }
  if(req.method!=='POST')return reply({error:'method_not_allowed'},405);
  const token=req.headers.get('x-signalbrief-task')??'';
  if(!/^[a-f0-9]{64}$/.test(token))return reply({error:'unauthorized'},401);
  const h=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)))].map(x=>x.toString(16).padStart(2,'0')).join('');
  if(!await rpc('sb_notifications_authorize',{h}))return reply({error:'unauthorized'},401);
  const config=obj(await rpc('sb_us_config')),secrets=obj(await rpc('sb_us_secrets'));
  if(Deno.env.get('RESEND_API_KEY'))secrets.RESEND_API_KEY=Deno.env.get('RESEND_API_KEY');
  const queued=await rpc('sb_digest_enqueue'),results=[];
  for(let i=0;i<10;i++){const result=await dispatchEmail(db,secrets,config);results.push(result);if(['idle','blocked'].includes(str(result.status)))break;}
  return reply({queued,results});
 }catch{return reply({error:'notification_operation_failed'},502);}
}
Deno.serve(handleNotifications);
