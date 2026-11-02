import {createClient} from '@supabase/supabase-js';
import {verifyCalendarSource,downloadCalendarSource} from '@/server/calendar-source';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=20;
const headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
const diagnostics=new Set(['source_url_invalid','source_timeout','source_dns_failed','source_non_public_address','source_hostname_mismatch','source_http_error','source_redirect_invalid','source_redirect_limit','source_content_type_invalid','source_too_large','source_interrupted','source_transport_failed']);

export async function POST(req:Request):Promise<Response>{
 let authorized=false;
 try{
  if(Number(req.headers.get('content-length')??0)>4096)return Response.json({error:'body_too_large'},{status:413,headers});
  const reader=req.body?.getReader(),chunks:Uint8Array[]=[];let count=0;
  if(reader)while(true){const {done,value}=await reader.read();if(done)break;count+=value.length;
   if(count>4096){await reader.cancel();return Response.json({error:'body_too_large'},{status:413,headers});}chunks.push(value);}
  const body=Buffer.concat(chunks).toString('utf8'),timestamp=req.headers.get('x-sb-timestamp')??'',signature=req.headers.get('x-sb-signature')??'';
  const payload=verifyCalendarSource(body,timestamp,signature,process.env.DART_RELAY_SECRET??'');
  const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{
   auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.any([req.signal,AbortSignal.timeout(4000)])})},
  });
  const claim=await db.rpc('sb_dart_relay_claim',{body_text:body,request_timestamp:timestamp,signature});
  if(claim.error||claim.data!==true)return Response.json({error:'relay_unauthorized'},{status:401,headers});
  authorized=true;
  const result=await downloadCalendarSource(payload.url,{signal:req.signal});
  return new Response(new Uint8Array(result.bytes),{headers:{...headers,'Content-Type':result.type}});
 }catch(error){
  const code=error instanceof Error?error.message:'';
  const upstreamStatus=code==='source_http_error'&&error instanceof Error&&'upstreamStatus' in error?error.upstreamStatus:null;
  if(authorized)console.error('CALENDAR_SOURCE_FAILURE',{operation:'calendar_source',code:diagnostics.has(code)?code:'source_unavailable',
   ...(typeof upstreamStatus==='number'&&Number.isInteger(upstreamStatus)&&upstreamStatus>=100&&upstreamStatus<=599?{upstream_status:upstreamStatus}:{})});
  return Response.json({error:code==='relay_unauthorized'?'relay_unauthorized':code==='relay_invalid_request'?'relay_invalid_request':'calendar_source_failed'},
   {status:code==='relay_unauthorized'?401:code==='relay_invalid_request'?422:502,headers});
 }
}
