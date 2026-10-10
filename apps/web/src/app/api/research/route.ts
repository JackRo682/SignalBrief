import {createClient} from '@supabase/supabase-js';
import {researchRequest} from '@/research/contracts';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=180;
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const fail=(status:number,code:string)=>Response.json({error:{code}},{status,headers});
export async function POST(req:Request){
 const auth=req.headers.get('authorization')??'';
 if(!/^Bearer [A-Za-z0-9._-]{20,8192}$/.test(auth))return fail(401,'authentication_required');
 if(req.headers.get('origin')&&req.headers.get('origin')!==new URL(req.url).origin)return fail(403,'origin_not_allowed');
 if(!(req.headers.get('content-type')??'').startsWith('application/json'))return fail(415,'json_required');
 if(Number(req.headers.get('content-length')??0)>64000)return fail(413,'body_too_large');
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
 if(!url||!key)return fail(503,'research_configuration_missing');
 try{const target=new URL(url);if(target.protocol!=='https:'||!target.hostname.endsWith('.supabase.co')||target.username||target.password||target.port)return fail(503,'invalid_configuration');}catch{return fail(503,'invalid_configuration');}
 try{
  const reader=req.body?.getReader(),chunks:Uint8Array[]=[];let size=0;
  if(reader)while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>64000){await reader.cancel();return fail(413,'body_too_large');}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  let raw:unknown;try{raw=JSON.parse(new TextDecoder().decode(bytes));}catch{return fail(422,'invalid_json');}
  const parsed=researchRequest.safeParse(raw);if(!parsed.success)return fail(422,'invalid_input');
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:auth},fetch:(input,init)=>fetch(input,{...init,cache:'no-store',signal:AbortSignal.timeout(20000)})}});
  const user=await db.auth.getUser();if(user.error||!user.data.user)return fail(401,'invalid_or_expired_session');
  if(parsed.data.action==='evaluation_execute'){
   // The Edge worker independently checks admin membership and MFA before accessing secrets.
   const target=new URL('/functions/v1/signalbrief-research',url);
   const result=await fetch(target,{method:'POST',headers:{apikey:key,Authorization:auth,'Content-Type':'application/json'},body:JSON.stringify(parsed.data.p),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(145000)});
   return new Response(result.body,{status:result.status,headers:{...headers,'Content-Type':'application/json'}});
  }
  const {data,error}=await db.rpc('sb_research',parsed.data);
  if(error){const status=/^PT\d{3}$/.test(error.code)?Number(error.code.slice(2)):error.code==='42501'?403:error.code==='PGRST202'?503:422;return fail(status,/^[a-z_0-9]{1,80}$/.test(error.message)?error.message:'research_request_failed');}
  return Response.json(data,{headers});
 }catch{return fail(502,'research_unreachable');}
}
