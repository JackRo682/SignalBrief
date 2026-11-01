export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
const fail=(code:string,status:number)=>Response.json({error:{code}},{status,headers});
async function proxy(req:Request){
 const authorization=req.headers.get('authorization')??'';
 if(!/^Bearer [A-Za-z0-9._-]{20,8192}$/.test(authorization))return fail('authentication_required',401);
 const origin=req.headers.get('origin');if(origin&&origin!==new URL(req.url).origin)return fail('origin_not_allowed',403);
 const base=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
 if(!base||!key)return fail('discovery_configuration_missing',503);
 let target:URL;try{target=new URL(base);if(target.protocol!=='https:'||!target.hostname.endsWith('.supabase.co')||target.username||target.password||target.port)throw new Error();}catch{return fail('invalid_configuration',503);}
 target.pathname='/functions/v1/signalbrief-discovery';target.search='';
 let body:string|undefined;
 if(req.method==='GET'){
  const params=new URL(req.url).searchParams,q=(params.get('q')??'').trim();if(!q||q.length>100||!/[\p{L}\p{N}]/u.test(q))return fail('invalid_query',422);
  const provider=params.get('provider')??'',market=(params.get('market')??'').trim().toUpperCase(),group=params.get('market_group')??'all';
  if(!['','sec','dart'].includes(provider)||!['all','kospi','kosdaq','overseas','unclassified'].includes(group)||market.length>32||(market&&!/^[A-Z0-9가-힣 :._-]+$/.test(market))||['q','provider','market','market_group'].some(key=>params.getAll(key).length>1))return fail('invalid_filter',422);
  const validated=new URLSearchParams({q});if(provider)validated.set('provider',provider);if(market)validated.set('market',market);if(group!=='all')validated.set('market_group',group);
  target.search=validated.toString();
 }else{
  if(!(req.headers.get('content-type')??'').startsWith('application/json'))return fail('json_required',415);
  if(Number(req.headers.get('content-length')??0)>2048)return fail('body_too_large',413);
  const reader=req.body?.getReader(),parts:Uint8Array[]=[];let size=0;
  if(reader)while(true){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>2048){await reader.cancel();return fail('body_too_large',413);}parts.push(r.value);}
  const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}body=new TextDecoder().decode(bytes);
 }
 try{
  const result=await fetch(target,{method:req.method,body,headers:{apikey:key,Authorization:authorization,...(body!==undefined?{'Content-Type':'application/json'}:{})},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(55000)});
  return new Response(result.body,{status:result.status,headers:{...headers,'Content-Type':'application/json'}});
 }catch{return fail('discovery_unavailable',502);}
}
export const GET=proxy;
export const POST=proxy;
