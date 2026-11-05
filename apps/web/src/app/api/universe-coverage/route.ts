import {createClient} from '@supabase/supabase-js';
import {universeCoverageSchema} from '@/lib/universe-coverage-contract';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const fail=(code:string,status:number)=>Response.json({error:{code}},{status,headers});
export async function GET(req:Request){
 const authorization=req.headers.get('authorization')??'';
 if(!/^Bearer [A-Za-z0-9._-]{20,8192}$/.test(authorization))return fail('authentication_required',401);
 const origin=req.headers.get('origin');if(origin&&origin!==new URL(req.url).origin)return fail('origin_not_allowed',403);
 if(new URL(req.url).search)return fail('invalid_input',422);
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
 if(!url||!key)return fail('workspace_configuration_missing',503);
 try{const endpoint=new URL(url);if(endpoint.protocol!=='https:'||!endpoint.hostname.endsWith('.supabase.co')||endpoint.username||endpoint.password||endpoint.port)return fail('invalid_configuration',503);}catch{return fail('invalid_configuration',503);}
 try{
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:authorization},fetch:(input,init)=>fetch(input,{...init,cache:'no-store',signal:AbortSignal.timeout(20000)})}});
  const user=await db.auth.getUser();if(user.error||!user.data.user)return fail('invalid_or_expired_session',401);
  const result=await db.rpc('sb_universe_coverage');
  if(result.error){const error=result.error,status=/^PT\d{3}$/.test(error.code)?Number(error.code.slice(2)):error.code==='42501'?403:503;return fail(/^[a-z_0-9]{1,80}$/.test(error.message)?error.message:'coverage_unavailable',status);}
  const parsed=universeCoverageSchema.safeParse(result.data);if(!parsed.success)return fail('invalid_coverage_response',502);
  return Response.json(parsed.data,{headers});
 }catch{return fail('coverage_unavailable',502);}
}
