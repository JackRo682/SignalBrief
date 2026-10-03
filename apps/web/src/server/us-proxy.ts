// Server-side route adapter. Never forwards cookies or arbitrary destinations.
const methods:Record<string,string[]>={status:['GET'],'reference-rate':['GET'],verify:['POST'],'auth-diagnostic':['GET'],filings:['GET'],analysis:['GET'],quotes:['GET'],fx:['GET'],news:['GET'],ingest:['POST'],analyze:['POST'],review:['POST'],'email-test':['POST']};
export async function proxyUS(req:Request,path:string):Promise<Response>{
 const fail=(code:string,status:number)=>Response.json({error:{code}},{status,headers:{'Cache-Control':'no-store'}});
 if(!methods[path]?.includes(req.method))return fail('route_not_found',404);
 const publicRoute=['status','auth-diagnostic','reference-rate'].includes(path),authorization=req.headers.get('authorization');if(!publicRoute&&!authorization)return fail('authentication_required',401);
 const base=process.env.NEXT_PUBLIC_SUPABASE_URL||process.env.SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY||process.env.SUPABASE_PUBLISHABLE_KEY;
 if(!base||!key)return fail('supabase_configuration_missing',503);
 try{
  const target=new URL(base);if(target.protocol!=='https:'||!target.hostname.endsWith('.supabase.co')||target.username||target.password||target.port)return fail('invalid_supabase_url',503);
  target.pathname=`/functions/v1/signalbrief-us/${path}`;target.search=new URL(req.url).search;
  let payload:string|undefined;
  if(req.method==='POST'){
   if(!(req.headers.get('content-type')??'').startsWith('application/json'))return fail('json_required',415);
   if(Number(req.headers.get('content-length')??0)>4096)return fail('body_too_large',413);
   const reader=req.body?.getReader(),chunks:Uint8Array[]=[];let size=0;if(reader)while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>4096){await reader.cancel();return fail('body_too_large',413);}chunks.push(value);}
   const bytes=new Uint8Array(size);let p=0;for(const c of chunks){bytes.set(c,p);p+=c.length;}payload=new TextDecoder().decode(bytes);
  }
  const r=await fetch(target,{method:req.method,redirect:'error',cache:'no-store',headers:{apikey:key,...(authorization?{Authorization:authorization}:{}),...(payload?{'Content-Type':'application/json'}:{})},body:payload,signal:AbortSignal.timeout(50000)});
  return new Response(r.body,{status:r.status,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});
 }catch{return fail('us_provider_api_unreachable',502);}
}
