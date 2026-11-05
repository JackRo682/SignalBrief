import {createClient} from 'npm:@supabase/supabase-js@2.117.2';
import {sha256,UniverseError,verifyUniversePayload,type UniversePayload} from './core.ts';

export async function handleUniverse(req:Request):Promise<Response>{
 const reply=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
 if(req.method!=='POST')return reply({error:'method_not_allowed'},405);
 const token=req.headers.get('x-signalbrief-task')??'';
 if(!/^[a-f0-9]{64}$/.test(token))return reply({error:'unauthorized'},401);
 const db=createClient(Deno.env.get('SUPABASE_URL')??'',Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'',{
  auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init={})=>fetch(input,{...init,signal:AbortSignal.timeout(35000)})},
 });
 const rpc=async(name:string,args:Record<string,unknown>)=>{const {data,error}=await db.rpc(name,args);if(error)throw new UniverseError(/^PT\d{3}$/.test(error.code)&&/^[a-z0-9_]{1,80}$/.test(error.message)?error.message:'universe_database_failed');return data;};
 const h=await sha256(new TextEncoder().encode(token));let claimed=false;
 try{
  const payload=await rpc('sb_universe_claim',{h}) as UniversePayload|null;
  if(!payload)return reply({error:'invalid_or_replayed_task'},401);claimed=true;
  const checked=await verifyUniversePayload(payload);
  const bucket=db.storage.from('signalbrief-raw');
  const archive=async(path:string,bytes:Uint8Array,contentType:string,digest:string)=>{
   const result=await bucket.upload(path,bytes,{contentType,upsert:false});
   if(!result.error)return;
   if(!/already exists|duplicate/i.test(result.error.message))throw new UniverseError('universe_archive_failed');
   const previous=await bucket.download(path);
   if(previous.error||!previous.data||previous.data.size!==bytes.length||await sha256(new Uint8Array(await previous.data.arrayBuffer()))!==digest)throw new UniverseError('universe_archive_conflict');
  };
  await archive(checked.raw_object_key,checked.raw,'application/octet-stream',checked.raw_sha256);
  await archive(checked.manifest_object_key,checked.manifestBytes,'application/json',checked.manifest_sha256);
  const result=await rpc('sb_universe_finish',{h,raw_sha256:checked.raw_sha256,raw_object_key:checked.raw_object_key,manifest_sha256:checked.manifest_sha256,manifest_object_key:checked.manifest_object_key});
  return reply(result);
 }catch(error){
  const code=error instanceof UniverseError?error.message:'universe_operation_failed';
  if(claimed)try{await rpc('sb_universe_fail',{h,code});}catch{/* Keep the original failure; the task lease remains bounded. */}
  return reply({error:code},502);
 }
}
Deno.serve(handleUniverse);
