import {createClient} from '@supabase/supabase-js';
import {verifyRelay,dartEndpoint,downloadDart} from '@/server/dart-relay';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=35;
const headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
export async function POST(req:Request):Promise<Response>{
 try{
  if(Number(req.headers.get('content-length')??0)>4096)return Response.json({error:'body_too_large'},{status:413,headers});
  const reader=req.body?.getReader();let count=0;const chunks:Uint8Array[]=[];
  if(reader)while(true){const {done,value}=await reader.read();if(done)break;count+=value.length;if(count>4096){await reader.cancel();return Response.json({error:'body_too_large'},{status:413,headers});}chunks.push(value);}
  const body=Buffer.concat(chunks).toString('utf8'),timestamp=req.headers.get('x-sb-timestamp')??'',signature=req.headers.get('x-sb-signature')??'';
  const payload=verifyRelay(body,timestamp,signature,process.env.DART_RELAY_SECRET??'');
  const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
  const claim=await db.rpc('sb_dart_relay_claim',{body_text:body,request_timestamp:timestamp,signature});
  if(claim.error||claim.data!==true)return Response.json({error:'relay_unauthorized'},{status:401,headers});
  const result=await downloadDart(dartEndpoint(payload),payload.kind==='company'?128_000:payload.kind==='list'?2_000_000:20_000_000);
  return new Response(new Uint8Array(result.bytes),{headers:{...headers,'Content-Type':result.type}});
 }catch(error){
  const code=error instanceof Error?error.message:'';
  return Response.json({error:code==='relay_unauthorized'?'relay_unauthorized':code==='relay_invalid_request'?'relay_invalid_request':'dart_relay_failed'},{status:code==='relay_unauthorized'?401:code==='relay_invalid_request'?422:502,headers});
 }
}
