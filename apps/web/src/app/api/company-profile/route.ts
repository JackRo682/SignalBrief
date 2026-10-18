export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=45;
export async function GET(req:Request){
 const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
 const fail=(code:string,status:number)=>Response.json({error:{code}},{status,headers});
 const auth=req.headers.get('authorization')??'';
 if(!/^Bearer [A-Za-z0-9._-]{20,8192}$/.test(auth))return fail('authentication_required',401);
 const id=new URL(req.url).searchParams.get('company_id')??'';
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id))return fail('invalid_company_id',422);
 const base=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
 if(!base||!key)return fail('profile_configuration_missing',503);
 try{
  const target=new URL(base);if(target.protocol!=='https:'||!target.hostname.endsWith('.supabase.co')||target.username||target.password||target.port)return fail('invalid_configuration',503);
  target.pathname='/functions/v1/signalbrief-profiles';target.search=new URLSearchParams({company_id:id}).toString();
  const response=await fetch(target,{headers:{apikey:key,Authorization:auth},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(40000)});
  return new Response(response.body,{status:response.status,headers:{...headers,'Content-Type':'application/json'}});
 }catch{return fail('profile_unavailable',502);}
}
