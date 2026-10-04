import {createClient, type SupabaseClient} from 'npm:@supabase/supabase-js@2.117.2';
import {ProviderError,obj,arr,str,providerFetch,jsonFetch,websitePermission,usSymbol,fmpQuote,fmpHistory,frankfurter,secSubmissions,validateFilingURL,normalizeFiling,analyzeEvidence,openaiSmoke,resendDomains,sendVerifiedEmail,gnewsSearch,type Row} from './us-core.ts';
const env=(k:string)=>Deno.env.get(k)??'';
const admin=()=>createClient(env('SUPABASE_URL'),env('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
async function rpc(db:SupabaseClient,name:string,args:Row={}){const {data,error}=await db.rpc(name,args);if(error)throw new ProviderError('database',/^PT/.test(error.code)&&/^[a-z_]+$/.test(error.message)?error.message:'operation_failed',500);return data;}
const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
const hash=async(text:string)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(b=>b.toString(16).padStart(2,'0')).join('');
async function settings(db:SupabaseClient){const s=obj(await rpc(db,'sb_us_secrets'));for(const k of ['OPENAI_API_KEY','FMP_API_KEY','RESEND_API_KEY','GNEWS_API_KEY','SEC_CONTACT_EMAIL'])if(env(k))s[k]=env(k);return s;}
async function recordCheck(db:SupabaseClient,provider:string,action:()=>Promise<Row>){let result:Row;try{result={status:'verified',detail:await action()};}catch(e){result={status:'blocked',detail:{code:e instanceof ProviderError?e.code:'operation_failed'}};}await db.from('us_provider_checks').upsert({provider,...result,checked_at:new Date().toISOString()});return result;}
async function reserve(db:SupabaseClient,p:string,amount=0){await rpc(db,'sb_us_reserve',{p,amount,smoke:false});}
async function cached(db:SupabaseClient,k:string,fn:()=>Promise<unknown>,ttl=900){const stored=await rpc(db,'sb_us_cache',{k});if(stored!==null)return stored;const v=await fn();await rpc(db,'sb_us_cache',{k,v,ttl});return v;}
async function ingest(db:SupabaseClient,s:Row,symbol:string){
 const {data:company,error}=await db.from('companies').select('id,ticker,provider_company_id').eq('provider','sec').eq('ticker',usSymbol(symbol)).eq('is_demo',false).maybeSingle();if(error||!company)throw new ProviderError('sec','unsupported_company',422);
 await reserve(db,'sec');const result=await secSubmissions(company.provider_company_id,str(s.SEC_CONTACT_EMAIL)),sha=await hash(result.raw);
 if(!result.tickers.includes(symbol))throw new ProviderError('sec','ticker_cik_mismatch');
 // Archive the exact submissions response before storing normalized metadata.
 const object=`us/sec/submissions/${sha}.json`,upload=await db.storage.from('signalbrief-raw').upload(object,result.raw,{contentType:'application/json',upsert:false});
 if(upload.error&&!/already exists|duplicate/i.test(upload.error.message))throw new ProviderError('storage','archive_failed');
 const records=result.filings.map(f=>({...f,company_id:company.id,source_sha256:sha,fetched_at:new Date().toISOString()}));
 if(records.length){const saved=await db.from('us_filings').upsert(records,{onConflict:'company_id,accession'});if(saved.error)throw new ProviderError('database','filing_save_failed');}
 const checked=await db.from('companies').update({last_ingested_at:new Date().toISOString()}).eq('id',company.id);if(checked.error)throw new ProviderError('database','ingestion_timestamp_failed');
 return {symbol,filings:records.length,source_sha256:sha,source:'SEC submissions',analysis:'not_yet_reviewed'};
}
async function analyze(db:SupabaseClient,s:Row,id:string){
 if(!/^[a-f0-9-]{36}$/.test(id))throw new ProviderError('api','invalid_filing_id',422);
 if(!s.OPENAI_API_KEY)throw new ProviderError('openai','missing_key',503);
 const claim=crypto.randomUUID();if(!await rpc(db,'sb_us_claim_analysis',{fid:id,lease:claim}))throw new ProviderError('openai','analysis_running_or_complete',409);
 try{return await analyzeClaimed(db,s,id);}finally{await rpc(db,'sb_us_release_analysis',{fid:id,lease:claim});}
}
async function analyzeClaimed(db:SupabaseClient,s:Row,id:string){
 const {data:f,error}=await db.from('us_filings').select('*').eq('id',id).maybeSingle();if(error||!f)throw new ProviderError('sec','filing_not_found',404);
 const old=await db.from('us_analyses').select('status').eq('filing_id',id).maybeSingle();if(old.data)return {status:old.data.status,cached:true};
 const contact=str(s.SEC_CONTACT_EMAIL);if(!contact)throw new ProviderError('sec','contact_email_required',503);
 await reserve(db,'sec');const raw=await providerFetch(validateFilingURL(f.document_url),'sec',{headers:{'User-Agent':`SignalBrief/0.2 ${contact}`}},fetch,3_000_000),normalized=normalizeFiling(raw),source=normalized.slice(0,12000),sha=await hash(raw);
 // Reserve a conservative bound for UTF-8 input bytes plus capped output; no automatic retries.
 const amount=(new TextEncoder().encode(source).length+3000)*0.4/1e6+1800*1.6/1e6;
 const archive=await db.storage.from('signalbrief-raw').upload(`us/sec/filings/${sha}.html`,raw,{contentType:'text/html',upsert:false});if(archive.error&&!/already exists|duplicate/i.test(archive.error.message))throw new ProviderError('storage','archive_failed');
 await reserve(db,'openai',amount);const answer=await analyzeEvidence(source,str(s.OPENAI_API_KEY));
 const saved=await db.from('us_analyses').insert({filing_id:id,status:'needs_review',model:answer.model,source_sha256:sha,result:{...answer,source_url:f.document_url,normalized_excerpt:source},input_tokens:obj(answer.usage).prompt_tokens,output_tokens:obj(answer.usage).completion_tokens});if(saved.error)throw new ProviderError('database','analysis_save_failed');
 return {status:'needs_review',filing_id:id,usage:answer.usage,requires_human_review:true};
}
async function user(req:Request){const token=req.headers.get('authorization')??'';if(!/^Bearer [A-Za-z0-9._-]{20,8192}$/.test(token))throw new ProviderError('auth','authentication_required',401);
 const db=createClient(env('SUPABASE_URL'),env('SUPABASE_ANON_KEY'),{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:token}}});const r=await db.auth.getUser();if(r.error||!r.data.user)throw new ProviderError('auth','invalid_session',401);await rpc(db,'sb_rate_limit');return {db,identity:r.data.user};}
async function body(req:Request):Promise<Row>{
 if(!(req.headers.get('content-type')??'').startsWith('application/json'))throw new ProviderError('api','json_required',422);
 if(Number(req.headers.get('content-length')??0)>4096)throw new ProviderError('api','body_too_large',413);
 const reader=req.body?.getReader(),chunks:Uint8Array[]=[];let count=0;
 if(reader)while(true){const {done,value}=await reader.read();if(done)break;count+=value.length;if(count>4096){await reader.cancel();throw new ProviderError('api','body_too_large',413);}chunks.push(value);}
 const bytes=new Uint8Array(count);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.length;}
 try{const value=JSON.parse(new TextDecoder().decode(bytes));if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();return value;}catch{throw new ProviderError('api','invalid_json',422);}
}
export async function handleUS(req:Request):Promise<Response>{
 const url=new URL(req.url),i=url.pathname.indexOf('/signalbrief-us'),path=i>=0?url.pathname.slice(i+15):url.pathname;const db=admin();
 try{
  if(path==='/health'&&req.method==='GET')return reply({status:'ready',release:'us-providers-v1',korean_data:'deferred'});
  if(path==='/status'&&req.method==='GET'){
   const config=obj(await rpc(db,'sb_us_config')),s=await settings(db),checks=await db.from('us_provider_checks').select('provider,status,checked_at,detail');
   return reply({release:'us-providers-v1',market:'US',credentials:{sec_contact:!!s.SEC_CONTACT_EMAIL,fmp:!!s.FMP_API_KEY,openai:!!s.OPENAI_API_KEY,resend:!!s.RESEND_API_KEY,gnews:!!s.GNEWS_API_KEY},korea:{available:false,reason:'OpenDART_and_KRX_deferred'},fmp_display:websitePermission(config,'fmp'),gnews_deployed:websitePermission(config,'gnews'),ai_budget_enabled:Number(config.ai_daily_budget_usd)>0,scheduled_ingestion:config.scheduled_ingestion_enabled===true,checks:arr(checks.data).map(c=>({provider:c.provider,status:c.status,checked_at:c.checked_at,code:obj(c.detail).code??null}))});
  }
  if(path==='/auth-diagnostic'&&req.method==='GET'){return reply(await cached(db,'auth:diagnostic',async()=>{
   const base=env('SUPABASE_URL'),key=env('SUPABASE_ANON_KEY');const r=await fetch(`${base}/auth/v1/settings`,{headers:{apikey:key},signal:AbortSignal.timeout(10000)}),d=obj(await r.json());
   const response=await fetch(`${base}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent('https://signalbrief.online/auth/callback')}`,{headers:{apikey:key},redirect:'manual',signal:AbortSignal.timeout(10000)});let google=false,callback=false,client=false;try{const target=new URL(response.headers.get('location')??'');google=target.hostname==='accounts.google.com';callback=target.searchParams.get('redirect_uri')===`${base}/auth/v1/callback`;client=(target.searchParams.get('client_id')??'').endsWith('.apps.googleusercontent.com');}catch{}
   await response.body?.cancel();return {google_enabled:obj(d.external).google===true,provider_redirect_status:response.status,google_redirect:google,supabase_callback_matches:callback,client_id_format_valid:client,interactive_signin:'not_verified',checked_at:new Date().toISOString()};
  },300));}
  if(path==='/reference-rate'&&req.method==='GET')return reply(await cached(db,'fx:USD:KRW',async()=>{await reserve(db,'fx');return frankfurter('USD','KRW');},21600));
  const actor=await user(req),config=obj(await rpc(db,'sb_us_config'));
  if(path==='/filings'&&req.method==='GET'){
   const symbol=url.searchParams.get('symbol')??'';let q=actor.db.from('us_filings').select('*,companies!inner(name,ticker,provider)').eq('companies.provider','sec').order('filing_date',{ascending:false}).limit(60);
   if(symbol)q=q.eq('companies.ticker',usSymbol(symbol));const r=await q;if(r.error)throw new ProviderError('database','filings_read_failed');return reply({items:r.data,market:'US',coverage:'recent_SEC_submissions',korean_data:'deferred'});
  }
  if(path==='/analysis'&&req.method==='GET'){const id=url.searchParams.get('filing_id')??'';if(!/^[a-f0-9-]{36}$/.test(id))throw new ProviderError('api','invalid_filing_id',422);const r=await actor.db.from('us_analyses').select('*').eq('filing_id',id).maybeSingle();if(r.error)throw new ProviderError('database','analysis_read_failed');return reply(r.data??{status:'not_available_or_pending_review'});}
  if(path==='/quotes'&&req.method==='GET'){
   const symbols=[...new Set((url.searchParams.get('symbols')??'').split(',').filter(Boolean))];if(symbols.length>40)throw new ProviderError('market','max_forty_symbols',422);
   const period=url.searchParams.get('period')??'1y',periodDays:Record<string,number>={'1d':1,'1w':7,'1m':31,'3m':93,'6m':186,'1y':370,'3y':370};if(!(period in periodDays))throw new ProviderError('market','invalid_period',422);
   if(!websitePermission(config,'fmp'))return reply({quotes:[],available:false,reason:'fmp_display_license_unverified',korean_data:'deferred'});
   const s=await settings(db),quotes:Row[]=[],unavailable:Row[]=[];
   for(const [position,symbol] of symbols.entries()){try{if(position>=8)throw new ProviderError('market','per_request_provider_limit',429);const name=usSymbol(symbol),company=await db.from('companies').select('id').eq('ticker',name).eq('provider','sec').eq('is_demo',false).maybeSingle();if(!company.data)throw new ProviderError('market','unsupported_company',422);
    const q=obj(await cached(db,`fmp:q:${name}`,async()=>{await reserve(db,'fmp');return fmpQuote(name,str(s.FMP_API_KEY));}));
    let history:unknown=[];try{history=await cached(db,`fmp:h:${name}`,async()=>{await reserve(db,'fmp');return fmpHistory(name,str(s.FMP_API_KEY));},21600);}catch{}
    const cutoff=new Date(Date.now()-periodDays[period]*864e5).toISOString().slice(0,10);quotes.push({...q,history:arr(history).filter(x=>str(x.date)>=cutoff),history_resolution:'daily',history_coverage:period==='3y'?'up_to_one_year':'requested_daily_window'});
   }catch(e){unavailable.push({symbol,reason:e instanceof ProviderError?e.code:'provider_unavailable'});}}
   return reply({quotes,unavailable,available:quotes.length>0,korean_data:'deferred'});
  }
  if(path==='/fx'&&req.method==='GET'){const base=(url.searchParams.get('base')??'USD').toUpperCase(),quote=(url.searchParams.get('quote')??'KRW').toUpperCase();if(!['USD','KRW','EUR','JPY','GBP','CAD','AUD'].includes(base)||!['USD','KRW','EUR','JPY','GBP','CAD','AUD'].includes(quote))throw new ProviderError('fx','unsupported_currency',422);return reply(await cached(db,`fx:${base}:${quote}`,async()=>{await reserve(db,'fx');return frankfurter(base,quote);},21600));}
  if(path==='/news'&&req.method==='GET'){if(!websitePermission(config,'gnews'))return reply({articles:[],available:false,reason:'gnews_deployed_plan_unverified'});const s=await settings(db);return reply({articles:await cached(db,`news:${(url.searchParams.get('q')??'').slice(0,100)}`,async()=>{await reserve(db,'gnews');return gnewsSearch(url.searchParams.get('q')??'',str(s.GNEWS_API_KEY),config);}),available:true});}
  if(req.method==='POST'&&['/ingest','/analyze','/review','/email-test','/verify'].includes(path)){
   if(!await rpc(actor.db,'sb_is_admin'))throw new ProviderError('auth','admin_required',403);const p=await body(req),s=await settings(db);
   if(path==='/verify'){
    const result:Row={};
    result.fx=await recordCheck(db,'fx',async()=>{await reserve(db,'fx');return frankfurter('USD','KRW');});
    result.fmp=await recordCheck(db,'fmp',async()=>{await reserve(db,'fmp');const q=await fmpQuote('AAPL',str(s.FMP_API_KEY));return {quote_received:true,as_of:q.as_of,display_permitted:websitePermission(config,'fmp')};});
    result.openai=await recordCheck(db,'openai',async()=>{if(!s.OPENAI_API_KEY)throw new ProviderError('openai','missing_key',503);await reserve(db,'openai',0.0005);return openaiSmoke(str(s.OPENAI_API_KEY));});
    result.resend=await recordCheck(db,'resend',async()=>{await reserve(db,'resend');const domains=await resendDomains(str(s.RESEND_API_KEY));return {verified_sender:domains.some(d=>d.status==='verified'),email_sent:false};});
    result.sec=await recordCheck(db,'sec',async()=>{const c=await db.from('companies').select('provider_company_id').eq('ticker','AAPL').eq('provider','sec').single();if(!c.data)throw new ProviderError('sec','company_missing');await reserve(db,'sec');const f=await secSubmissions(c.data.provider_company_id,str(s.SEC_CONTACT_EMAIL));return {records:f.filings.length};});
    result.gnews={status:'not_called',reason:websitePermission(config,'gnews')?'run_news_query_separately':'deployed_plan_unverified'};
    return reply(result);
   }
   if(path==='/ingest')return reply(await ingest(db,s,str(p.symbol)));
   if(path==='/analyze')return reply(await analyze(db,s,str(p.filing_id)));
   if(path==='/review'){if(!['approved','rejected'].includes(str(p.status))||str(p.reason).trim().length<5)throw new ProviderError('api','review_reason_required',422);return reply(await rpc(actor.db,'sb_us_review',{fid:str(p.filing_id),decision:p.status,reason:str(p.reason)}));}
   const from=str(config.resend_from),domains=await resendDomains(str(s.RESEND_API_KEY));if(!actor.identity.email)throw new ProviderError('resend','recipient_missing',422);await reserve(db,'resend');return reply(await sendVerifiedEmail(str(s.RESEND_API_KEY),from,actor.identity.email,'SignalBrief connection test','This is the explicitly requested SignalBrief sender-verification test.',domains));
  }
  return reply({error:{code:'route_not_found'}},404);
 }catch(e){const status=e instanceof ProviderError?e.status:500;return reply({error:{code:e instanceof ProviderError?e.code:'internal_error'}},[401,403,404,409,413,422,429,503].includes(status)?status:502);}
}
