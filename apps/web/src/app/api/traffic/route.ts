import {createClient} from '@supabase/supabase-js';
import {trafficRequest} from '@/acquisition/contracts';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=15;
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const fail=(status:number,code:string)=>Response.json({error:code},{status,headers});
export async function POST(req:Request){
 if(req.headers.get('origin')!==new URL(req.url).origin||req.headers.get('sec-fetch-site')==='cross-site')return fail(403,'origin_not_allowed');
 if(!(req.headers.get('content-type')??'').startsWith('application/json'))return fail(415,'json_required');
 if(process.env.VERCEL_ENV==='preview')return fail(409,'preview_tracking_disabled');
 if(Number(req.headers.get('content-length')??0)>4096)return fail(413,'body_too_large');
 try{
  const reader=req.body?.getReader();let size=0;const chunks:Uint8Array[]=[];
  if(reader)while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>4096){await reader.cancel();return fail(413,'body_too_large');}chunks.push(value);}
  let raw:unknown;try{raw=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return fail(422,'invalid_json');}
  const parsed=trafficRequest.safeParse(raw);if(!parsed.success)return fail(422,'invalid_input');
  const p=parsed.data,authorization=req.headers.get('authorization');
  const required=p.action==='summary'||p.action==='record'&&['signup_complete','onboarding_complete'].includes(p.kind);
  if(required&&!authorization)return fail(401,'authentication_required');
  if(authorization&&!/^Bearer [A-Za-z0-9._-]{20,8192}$/.test(authorization))return fail(401,'invalid_session');
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if(!url||!key)return fail(503,'traffic_configuration_missing');
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:authorization?{Authorization:authorization}:{},fetch:(input,init)=>fetch(input,{...init,cache:'no-store',signal:AbortSignal.any([req.signal,AbortSignal.timeout(8000)])})}});
  if(authorization){const user=await db.auth.getUser();if(user.error||!user.data.user)return fail(401,'invalid_session');}
  const {data,error}=await db.rpc('sb_traffic',{p});
  if(error)return fail(/^PT[0-9]{3}$/.test(error.code)?Number(error.code.slice(2)):error.code==='42501'?403:502,'traffic_request_failed');
  return Response.json(data,{headers});
 }catch{return fail(502,'traffic_unavailable');}
}
