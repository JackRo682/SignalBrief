import {createClient} from 'npm:@supabase/supabase-js@2.117.2';
import {normalize,prompt,score,type Row} from './core.ts';
const env=(key:string)=>Deno.env.get(key)??'';
const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const asRow=(value:unknown):Row=>value&&typeof value==='object'&&!Array.isArray(value)?value as Row:{};
const sha=async(value:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(value).buffer))).map(b=>b.toString(16).padStart(2,'0')).join('');
async function bounded(response:Response,max:number){if(!response.ok)throw new Error(`provider_http_${response.status}`);const reader=response.body?.getReader();if(!reader)throw new Error('empty_source');const chunks:Uint8Array[]=[];let size=0;while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw new Error('source_too_large');}chunks.push(value);}const result=new Uint8Array(size);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length;}return result;}
Deno.serve(async(req:Request)=>{
 if(req.method!=='POST')return reply({error:{code:'method_not_allowed'}},405);
 const authorization=req.headers.get('authorization')??'';
 if(!/^Bearer [A-Za-z0-9._-]{20,8192}$/.test(authorization))return reply({error:{code:'authentication_required'}},401);
 const actor=createClient(env('SUPABASE_URL'),env('SUPABASE_ANON_KEY'),{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:authorization}}});
 const identity=await actor.auth.getUser();if(identity.error||!identity.data.user)return reply({error:{code:'invalid_session'}},401);
 const mfa=await actor.rpc('sb_require_mfa');if(mfa.error)return reply({error:{code:'mfa_required'}},403);
 const role=await actor.rpc('sb_is_admin');if(role.error||role.data!==true)return reply({error:{code:'admin_required'}},403);
 const rate=await actor.rpc('sb_rate_limit');if(rate.error)return reply({error:{code:'rate_limit'}},429);
 let payload:Row;try{const bytes=await bounded(new Response(req.body),2048);payload=asRow(JSON.parse(new TextDecoder().decode(bytes)));}catch{return reply({error:{code:'invalid_input'}},422);}
 if(!/^[0-9a-f-]{36}$/i.test(String(payload.id)))return reply({error:{code:'invalid_id'}},422);
 const db=createClient(env('SUPABASE_URL'),env('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
 const secrets=await db.rpc('sb_us_secrets');if(secrets.error)return reply({error:{code:'provider_configuration_unavailable'}},503);
 const key=env('OPENAI_API_KEY')||asRow(secrets.data).OPENAI_API_KEY,contact=env('SEC_CONTACT_EMAIL')||asRow(secrets.data).SEC_CONTACT_EMAIL;
 if(!key||!contact)return reply({error:{code:!key?'missing_openai_key':'sec_contact_required'}},503);
 const claimed=await db.rpc('sb_research_worker',{action:'claim',p:{id:payload.id}});
 if(claimed.error)return reply({error:{code:'run_already_claimed'}},409);
 const run=asRow(claimed.data),cases=Array.isArray(run.cases)?run.cases.map(asRow):[],results:Row[]=[],cache=new Map<string,Promise<{text:string;sha:string}>>();const begun=Date.now();
 async function source(url:unknown){
  const u=new URL(String(url));if(u.protocol!=='https:'||u.hostname!=='www.sec.gov'||!u.pathname.startsWith('/Archives/edgar/data/')||u.username||u.password||u.port)throw new Error('invalid_sec_source');
  if(!cache.has(u.href))cache.set(u.href,(async()=>{const reserve=await db.rpc('sb_us_reserve',{p:'sec',amount:0});if(reserve.error)throw new Error('sec_request_limit');const bytes=await bounded(await fetch(u,{headers:{'User-Agent':`SignalBrief Research ${contact}`},redirect:'error',signal:AbortSignal.timeout(15000)}),5_000_000);const hash=await sha(bytes);const stored=await db.storage.from('signalbrief-raw').upload(`research/sec/${hash}.html`,bytes,{contentType:'text/html',upsert:false});if(stored.error&&!/already exists|duplicate/i.test(stored.error.message))throw new Error('source_archive_failed');return {text:normalize(new TextDecoder().decode(bytes)),sha:hash};})());
  return await cache.get(u.href)!;
 }
 for(const c of cases){const start=Date.now();let evidence:Row={};try{
  if(Date.now()-begun>105000)throw new Error('execution_time_budget_exceeded');
  const current=await source(c.source_url),previous=await source(c.previous_source_url);
  evidence={source_sha256:current.sha,previous_source_sha256:previous.sha,source_url:c.source_url,previous_source_url:c.previous_source_url};
  if(!current.text.includes(normalize(String(c.quote)))||!previous.text.includes(normalize(String(c.previous_quote))))throw new Error('approved_excerpt_not_in_source');
  const reserve=await db.rpc('sb_us_reserve',{p:'openai',amount:0.04});if(reserve.error)throw new Error('ai_budget_or_daily_limit');
  const response=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({model:run.model,temperature:0,max_completion_tokens:1000,response_format:{type:'json_object'},messages:[{role:'user',content:prompt(c,String(run.method))}]}),signal:AbortSignal.timeout(20000)});
  const bytes=await bounded(response,100000),model=asRow(JSON.parse(new TextDecoder().decode(bytes))),choices=Array.isArray(model.choices)?model.choices:[],choice=asRow(choices[0]),usage=asRow(model.usage),message=asRow(choice.message);
  evidence={...evidence,input_tokens:usage.prompt_tokens??null,output_tokens:usage.completion_tokens??null,model_version:model.model??null};
  if(choice.finish_reason!=='stop'||typeof message.content!=='string')throw new Error('incomplete_model_response');
  const answer=asRow(JSON.parse(message.content));if(typeof answer.refused!=='boolean')throw new Error('invalid_model_output');
  results.push({case_id:c.id,...score(c,answer,String(run.method)),output:answer,...evidence,model_version:model.model,prompt_version:run.prompt_version,latency_ms:Date.now()-start,input_tokens:usage.prompt_tokens??null,output_tokens:usage.completion_tokens??null,cost_usd:null,cost_note:'No verified billing price configured; reservation is a budget ceiling, not measured cost.'});
 }catch(e){const code=e instanceof Error&&/^[a-z_0-9]+$/.test(e.message)?e.message:'provider_execution_failed';results.push({case_id:c.id,input_tokens:null,output_tokens:null,...evidence,error:code,numeric_correct:c.answerable?false:null,comparison_correct:c.answerable?false:null,citation_correct:c.answerable?false:null,useful_completion:false,safe_refusal:c.answerable?null:false,cost_usd:null,latency_ms:Date.now()-start});}}
 const status=results.some(r=>!r.output)?'failed':'completed';
 const finished=await db.rpc('sb_research_worker',{action:'finish',p:{id:run.id,status,results,error:status==='failed'?'one_or_more_cases_failed':null}});
 if(finished.error)return reply({error:{code:'result_persistence_failed'}},503);
 return reply({id:run.id,status,cases:results.length});
});
