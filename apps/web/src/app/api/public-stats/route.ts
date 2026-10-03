import { createClient } from "@supabase/supabase-js";
export const dynamic="force-dynamic";
export async function GET(){
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
 if(!url||!key)return Response.json({documents:null,companies:null,users:null,uptime_pct:null},{headers:{"Cache-Control":"no-store"}});
 const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data,error}=await db.rpc("sb_reference_public_stats");
 return Response.json(error?{documents:null,companies:null,users:null,uptime_pct:null}:data,{headers:{"Cache-Control":"public, max-age=60","X-Content-Type-Options":"nosniff"}});
}
