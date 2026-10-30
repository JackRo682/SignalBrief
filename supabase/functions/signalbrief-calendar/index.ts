import {createClient} from 'npm:@supabase/supabase-js@2.117.2';
import {CalendarError,fetchSource,parseSource,sha256,type Source} from './core.ts';
export async function handleCalendar(req:Request):Promise<Response>{
 const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
 if(req.method!=='POST')return reply({error:'method_not_allowed'},405);
 const token=req.headers.get('x-signalbrief-task')??'';
 if(!/^[a-f0-9]{64}$/.test(token))return reply({error:'unauthorized'},401);
 const db=createClient(Deno.env.get('SUPABASE_URL')??'',Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'',{auth:{persistSession:false,autoRefreshToken:false}});
 const rpc=async(name:string,args:Record<string,unknown>={})=>{const r=await db.rpc(name,args);if(r.error)throw new CalendarError('database_operation_failed');return r.data;};
 const h=await sha256(new TextEncoder().encode(token));let claimed=false;
 try{
  if(!await rpc('sb_calendar_claim',{h}))return reply({error:'invalid_or_replayed_task'},401);claimed=true;
  const sources=await rpc('sb_calendar_sources') as Source[],results=[];
  for(const source of sources){
   try{
    const bytes=await fetchSource(source),sha=await sha256(bytes),parsed=parseSource(source,new TextDecoder('utf-8',{fatal:true}).decode(bytes),new Date().toISOString().slice(0,10));
    const path=`calendar/${source.key}/${sha}.html`;
    const archive=await db.storage.from('signalbrief-raw').upload(path,bytes,{contentType:'text/html',upsert:false});
    if(archive.error&&!/already exists|duplicate/i.test(archive.error.message))throw new CalendarError('archive_failed');
    const count=await rpc('sb_calendar_ingest',{source:source.key,raw_sha:sha,object_key:path,normalized_text:parsed.text,entries:parsed.entries});
    results.push({source:source.key,status:'verified',items:count});
   }catch(error){
    const code=error instanceof CalendarError?error.message:'source_fetch_failed';
    await rpc('sb_calendar_source_error',{source:source.key,code});results.push({source:source.key,status:'failed',code});
   }
  }
  await rpc('sb_calendar_finish',{h,summary:results});return reply({results});
 }catch{
  if(claimed)try{await rpc('sb_calendar_finish',{h,summary:[{status:'failed',code:'calendar_operation_failed'}]});}catch{/* original failure */}
  return reply({error:'calendar_operation_failed'},502);
 }
}
Deno.serve(handleCalendar);
