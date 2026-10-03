export const dynamic='force-dynamic';
export function GET(){
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL||process.env.SUPABASE_URL;
 const publishableKey=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY||process.env.SUPABASE_PUBLISHABLE_KEY;
 // Public configuration only: never fall back to SERVICE_ROLE_KEY or secret API keys.
 if(!url||!publishableKey)return Response.json({error:{code:'auth_public_configuration_missing'}},{status:503,headers:{'Cache-Control':'no-store'}});
 try{const u=new URL(url);if(u.protocol!=='https:'||!u.hostname.endsWith('.supabase.co')||u.username||u.password)throw new Error();if(publishableKey.startsWith('sb_secret_'))throw new Error();if(!publishableKey.startsWith('sb_publishable_')){const p=JSON.parse(Buffer.from(publishableKey.split('.')[1]??'','base64url').toString());if(p.role!=='anon')throw new Error();}}catch{return Response.json({error:{code:'invalid_public_auth_config'}},{status:503});}
 return Response.json({url,publishableKey},{headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}
