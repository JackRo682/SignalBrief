import {createClient} from '@supabase/supabase-js';
import {workspaceRequest} from '@/workspace/contracts';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const fail=(status:number,code:string)=>Response.json({error:{code}},{status,headers});
export async function POST(req:Request){
 const auth=req.headers.get('authorization')??'';
 if(!/^Bearer [A-Za-z0-9._-]{20,8192}$/.test(auth))return fail(401,'authentication_required');
 const origin=req.headers.get('origin');if(origin&&origin!==new URL(req.url).origin)return fail(403,'origin_not_allowed');
 if(!(req.headers.get('content-type')??'').startsWith('application/json'))return fail(415,'json_required');
 if(Number(req.headers.get('content-length')??0)>32768)return fail(413,'body_too_large');
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
 if(!url||!key)return fail(503,'workspace_configuration_missing');
 try{const target=new URL(url);if(target.protocol!=='https:'||!target.hostname.endsWith('.supabase.co')||target.username||target.password||target.port)return fail(503,'invalid_configuration');}catch{return fail(503,'invalid_configuration');}
 try{
  const reader=req.body?.getReader(),chunks:Uint8Array[]=[];let size=0;
  if(reader)while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>32768){await reader.cancel();return fail(413,'body_too_large');}chunks.push(value);}
  const bytes=new Uint8Array(size);let cursor=0;for(const part of chunks){bytes.set(part,cursor);cursor+=part.length;}
  let raw:unknown;try{raw=JSON.parse(new TextDecoder().decode(bytes));}catch{return fail(422,'invalid_json');}
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(k=>k!=='action'&&k!=='p'))return fail(422,'invalid_input');
  const parsed=workspaceRequest.safeParse(raw);if(!parsed.success)return fail(422,'invalid_input');
  // Only the existing public project key. Every SQL operation also binds auth.uid().
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:auth},fetch:(input,init)=>fetch(input,{...init,cache:'no-store',signal:AbortSignal.timeout(20000)})}});
  const user=await db.auth.getUser();if(user.error||!user.data.user)return fail(401,'invalid_or_expired_session');
  // Search-list controls have a dedicated, bounded RPC so clearing searches
  // never invokes the older operation that also deletes browsing history.
  const rpcName=parsed.data.action==='search_delete'||parsed.data.action==='searches_clear'?'sb_workspace_searches':'sb_workspace';
  const {data,error}=await (parsed.data.action==='onboarding_complete'
   ?db.rpc('sb_mobile_onboarding',{p:parsed.data.p})
   :db.rpc(rpcName,parsed.data));
  if(error){const status=/^PT\d{3}$/.test(error.code)?Number(error.code.slice(2)):error.code==='42501'?403:error.code==='PGRST202'?503:422;
   return fail(status,/^[a-z_0-9]{1,80}$/.test(error.message)?error.message:'workspace_request_failed');}
  return Response.json(data,{headers});
 }catch{return fail(502,'workspace_unreachable');}
}
