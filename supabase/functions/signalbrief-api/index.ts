import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.117.2";

// Production web API. Every private request verifies the bearer token with Auth;
// all reads and mutations then execute under that user's PostgreSQL RLS identity.
type Row = Record<string, unknown>;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const PUBLIC_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SITE = "https://signalbrief-beta.vercel.app";
const DOC_FIELDS = "id,company_id,provider,external_id,title,form_type,source_url,published_at,publication_date,publication_precision,publication_timezone,ingested_at,raw_sha256,state,is_demo,created_at";
const COMPANY_FIELDS = "id,name,ticker,market,provider,is_demo,last_ingested_at";
const RUN_FIELDS = "id,stage,model,model_version,prompt_version,pipeline_version,status,latency_ms,input_tokens,output_tokens,cost_usd,error_code,created_at,finished_at,validation_result";
const ALLOWED_ORIGINS = new Set([SITE,"https://signalbrief-acme-c4f4.vercel.app","http://localhost:3000","http://127.0.0.1:3000"]);
const s = (x: unknown): string => typeof x === "string" ? x : "";
const row = (x: unknown): Row => x && typeof x === "object" && !Array.isArray(x) ? x as Row : {};
const rows = (x: unknown): Row[] => Array.isArray(x) ? x.map(row) : [];
const number = (x: unknown): number => Number.isFinite(Number(x)) ? Number(x) : 0;
const unique = (items: string[]): string[] => [...new Set(items.filter(Boolean))];
class Fault extends Error { constructor(public status: number, public code: string) { super(code); } }
function check(value: unknown, status=422, code="invalid_input"): asserts value { if (!value) throw new Fault(status,code); }
function identity(value: string): string { check(/^[a-f0-9-]{36}$/i.test(value),404,"not_found"); return value; }
function client(token?: string): SupabaseClient { return createClient(SUPABASE_URL,PUBLIC_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:token?{headers:{Authorization:`Bearer ${token}`}}:undefined}); }
async function unwrap<T>(query: PromiseLike<{data:T;error:unknown}>): Promise<T> {
  const {data,error}=await query;
  if(error){const e=row(error);const code=s(e.code);const status=/^PT\d{3}$/.test(code)?Number(code.slice(2)):code==="42501"?403:code==="23505"?409:code.startsWith("22")||code.startsWith("23")?422:500;
    // Do not reflect SQL, credentials, constraint payloads or provider internals.
    throw new Fault(status,status===500?"database_request_failed":/^[a-z0-9_]{1,100}$/.test(s(e.message))?s(e.message):"request_rejected");}
  return data;
}
async function rpc(db:SupabaseClient,name:string,args:Row={}):Promise<unknown>{return unwrap(db.rpc(name,args));}
async function getRows(db:SupabaseClient,table:string,field:string,ids:string[],select="*"):Promise<Row[]>{
  if(!ids.length)return []; return rows(await unwrap(db.from(table).select(select).in(field,unique(ids))));
}
function index(items:Row[]):Map<string,Row>{return new Map(items.map(x=>[s(x.id),x]));}
function required(map:Map<string,Row>,id:string):Row{const value=map.get(id);check(value,404,"evidence_not_available");return value;}
function ranking(e:Row,watched:boolean,held:boolean,provider:string,changed:boolean){
  const age=Math.max(0,(Date.now()-Date.parse(s(e.published_at)))/3600000);
  const components:Record<string,number|null>={P:held?1:watched?.6:0,M:Math.max(0,Math.min(1,number(e.materiality))),N:changed?1:.3,S:["sec","dart"].includes(provider)?1:.5,A:null,T:Math.exp(-Math.LN2*age/48)};
  const weights:Record<string,number>={P:.3/.9,M:.2/.9,N:.15/.9,S:.15/.9,T:.1/.9};
  return {score:Math.round(Object.entries(weights).reduce((v,[k,w])=>v+number(components[k])*w,0)*1e6)/1e6,version:"ranking-v1",components,effective_weights:weights,missing_components:["A"],reason:held?"보유 기업의 변화":watched?"관심종목의 변화":"선택한 기업의 공시",portfolio_weight_method:"membership_only_no_live_prices_or_fx",market_reaction:"unavailable"};
}
async function memberships(db:SupabaseClient){
  const [watch,portfolio]=await Promise.all([rpc(db,"sb_watchlist"),rpc(db,"sb_portfolio")]);
  return {watched:new Set(rows(row(watch).items).map(c=>s(c.id))),held:new Set(rows(row(portfolio).positions).map(p=>s(row(p.company).id)))};
}
async function cards(db:SupabaseClient,events:Row[],member?:Awaited<ReturnType<typeof memberships>>){
  if(!events.length)return [];
  const [companies,documents,briefs,changes,m]=await Promise.all([getRows(db,"companies","id",events.map(e=>s(e.company_id)),COMPANY_FIELDS),getRows(db,"documents","id",events.map(e=>s(e.document_id)),DOC_FIELDS),getRows(db,"briefs","event_id",events.map(e=>s(e.id))),getRows(db,"changes","event_id",events.map(e=>s(e.id))),member??memberships(db)]);
  const cm=index(companies),dm=index(documents),bm=new Map(briefs.map(b=>[s(b.event_id),b]));
  return events.flatMap(e=>{const c=cm.get(s(e.company_id)),d=dm.get(s(e.document_id)),b=bm.get(s(e.id));if(!c||!d||!b||d.is_demo)return [];
    const changed=changes.filter(x=>x.event_id===e.id&&["increased","decreased","wording_changed"].includes(s(x.change_type))).length;
    return [{id:e.id,company:c,event_type:e.event_type,state:e.state,headline:b.headline,what_happened:b.what_happened,confidence:number(e.confidence),materiality:number(e.materiality),published_at:e.published_at,publication_precision:d.publication_precision,is_demo:false,source_tier:1,source_provider:d.provider,source_url:d.source_url,ranking:ranking(e,m.watched.has(s(c.id)),m.held.has(s(c.id)),s(d.provider),changed>0),change_count:changed}];});
}
async function detail(db:SupabaseClient,id:string){
  const e=rows(await unwrap(db.from("events").select("*").eq("id",identity(id)).limit(1)))[0];check(e,404,"event_not_found");
  const [eventCards,docs,facts,changes,briefs,validations,runs]=await Promise.all([cards(db,[e]),getRows(db,"documents","id",[s(e.document_id)],DOC_FIELDS),getRows(db,"facts","event_id",[id]),getRows(db,"changes","event_id",[id]),getRows(db,"briefs","event_id",[id]),getRows(db,"validations","event_id",[id]),getRows(db,"ai_runs","id",[s(e.run_id)],RUN_FIELDS)]);
  check(eventCards[0]&&docs[0]&&briefs[0]&&runs[0],404,"evidence_not_available");
  const previous=await getRows(db,"facts","id",changes.map(c=>s(c.previous_fact_id)));
  const allFacts=[...facts,...previous],chunks=await getRows(db,"document_chunks","id",allFacts.map(f=>s(f.chunk_id)));
  const evidenceDocs=await getRows(db,"documents","id",chunks.map(c=>s(c.document_id)),DOC_FIELDS),cm=index(chunks),dm=index(evidenceDocs);
  const evidence=allFacts.map(f=>{const c=required(cm,s(f.chunk_id)),d=required(dm,s(c.document_id));return {fact_id:f.id,chunk_id:c.id,document_id:d.id,quote:f.quote,location:c.location,source_url:d.source_url,source_name:d.provider==="dart"?"OpenDART":"SEC EDGAR",source_tier:1,published_at:d.published_at,publication_precision:d.publication_precision,is_demo:false,role:previous.includes(f)?"previous":"current"};});
  return {event:eventCards[0],document:{...docs[0],download_url:docs[0].source_url},facts,changes,evidence,brief:briefs[0],validations,run:runs[0]};
}
const escapeICS=(v:unknown)=>s(v).replace(/\\/g,"\\\\").replace(/\r?\n/g,"\\n").replace(/;/g,"\\;").replace(/,/g,"\\,");
function ics(items:Row[]):string{
  const stamp=new Date().toISOString().replace(/[-:]/g,"").split(".")[0]+"Z";
  const lines=["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//SignalBrief//Evidence Calendar//EN","CALSCALE:GREGORIAN","METHOD:PUBLISH","X-WR-CALNAME:SignalBrief"];
  for(const x of items){const date=s(x.occurs_on);if(!/^\d{4}-\d{2}-\d{2}$/.test(date))continue;const end=new Date(`${date}T00:00:00Z`);end.setUTCDate(end.getUTCDate()+1);lines.push("BEGIN:VEVENT",`UID:${s(x.id)}@signalbrief`,`DTSTAMP:${stamp}`,`DTSTART;VALUE=DATE:${date.replace(/-/g,"")}`,`DTEND;VALUE=DATE:${end.toISOString().slice(0,10).replace(/-/g,"")}`,`SUMMARY:${escapeICS(x.title)}`,"END:VEVENT");}lines.push("END:VCALENDAR");
  // RFC 5545 octet-aware line folding; never split UTF-8 characters.
  return lines.map(line=>{let out="",len=0;for(const c of line){const size=new TextEncoder().encode(c).length;if(len+size>73){out+="\r\n ";len=1;}out+=c;len+=size;}return out;}).join("\r\n")+"\r\n";
}
async function calendar(db:SupabaseClient){
  const m=await memberships(db),ids=new Set([...m.watched,...m.held]);
  const items=rows(await unwrap(db.from("calendar_items").select("*").order("occurs_on").limit(500))).filter(x=>x.origin==="user"||ids.has(s(x.company_id)));
  const chunks=await getRows(db,"document_chunks","id",items.map(x=>s(x.chunk_id))),cm=index(chunks),docs=index(await getRows(db,"documents","id",chunks.map(x=>s(x.document_id)),DOC_FIELDS));
  return items.map(x=>({...x,source_url:docs.get(s(cm.get(s(x.chunk_id))?.document_id))?.source_url??null,is_demo:false}));
}
async function body(req:Request):Promise<Row>{const text=await req.text();check(new TextEncoder().encode(text).length<=131072,413,"body_too_large");let value:unknown;try{value=JSON.parse(text||"{}");}catch{throw new Fault(422,"invalid_json");}check(value&&typeof value==="object"&&!Array.isArray(value));return row(value);}
function limit(url:URL,max=100,defaultValue=50):number{const value=Number(url.searchParams.get("limit")??defaultValue);check(Number.isInteger(value)&&value>=1&&value<=max);return value;}
function json(value:unknown,status=200):Response{return new Response(status===204?null:JSON.stringify(value),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});}
function calendarResponse(items:Row[]){return new Response(ics(items),{headers:{"Content-Type":"text/calendar; charset=utf-8","Content-Disposition":"attachment; filename=signalbrief.ics","Cache-Control":"private, no-store","Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff"}});}

Deno.serve(async(req:Request)=>{
  const requestId=crypto.randomUUID();let response:Response;
  try{
    const url=new URL(req.url),prefix="/signalbrief-api",start=url.pathname.indexOf(prefix);
    const path=start>=0?url.pathname.slice(start+prefix.length)||"/":url.pathname;
    const origin=req.headers.get("origin");check(!origin||ALLOWED_ORIGINS.has(origin),403,"origin_not_allowed");
    if(req.method==="OPTIONS")return new Response(null,{status:204,headers:{"Access-Control-Allow-Origin":origin??SITE,"Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info","Access-Control-Allow-Methods":"GET,POST,PUT,PATCH,DELETE,OPTIONS","Vary":"Origin"}});
    check(SUPABASE_URL&&PUBLIC_KEY,503,"server_configuration_missing");
    if(req.method==="GET"&&["/","/health","/health/ready","/v1/config"].includes(path)){
      const health=row(await rpc(client(),"sb_health"));
      response=json(path==="/v1/config"?{demo_mode:false,demo_admin_enabled:false,auth_mode:"supabase",...health,release:"hosted-v1",capabilities:{accounts:true,portfolio:true,calendar:true,questions:"evidence_search",live_ingestion:false,generative_ai:false,email_delivery:false,background_push:false},setup_note:"Financial ingestion and paid AI remain inactive until server credentials and budgets are approved."}:{status:health.database_ready?"ready":"not_ready",...health});
    }else if(req.method==="GET"&&path.startsWith("/v1/calendar/feed/")){
      const token=path.split("/").pop()?.replace(/\.ics$/,"")??"";check(/^[a-f0-9]{64}$/.test(token),404,"subscription_not_found");
      const feed=await rpc(client(),"sb_calendar_subscription_feed",{token});check(feed!==null,404,"subscription_not_found");response=calendarResponse(rows(feed));
    }else{
      const header=req.headers.get("authorization")??"";check(/^Bearer [A-Za-z0-9._-]{20,8192}$/.test(header),401,"authentication_required");
      const db=client(header.slice(7)),{data:auth,error:authError}=await db.auth.getUser();check(!authError&&auth.user,401,"invalid_or_expired_session");
      await rpc(db,"sb_rate_limit");
      const method=req.method,parts=path.split("/").filter(Boolean);
      if(path==="/v1/me"&&method==="GET")response=json(await rpc(db,"sb_initialize_profile"));
      else if(path==="/v1/me"&&method==="PATCH")response=json(await rpc(db,"sb_user_action",{action:"profile",p:await body(req)}));
      else if(path==="/v1/preferences"&&method==="GET")response=json(rows(await unwrap(db.from("user_preferences").select("*").eq("user_id",auth.user.id)))[0]??{});
      else if(path==="/v1/preferences"&&method==="PATCH")response=json(await rpc(db,"sb_user_action",{action:"preferences",p:await body(req)}));
      else if(path==="/v1/notification-settings"&&method==="PATCH")response=json(await rpc(db,"sb_notification_settings",{p:await body(req)}));
      else if(path==="/v1/onboarding"&&method==="POST")response=json(await rpc(db,"sb_user_action",{action:"onboarding",p:await body(req)}));
      else if(path==="/v1/companies"&&method==="GET"){
        const term=(url.searchParams.get("q")??"").trim();check(term.length<=100);let query=db.from("companies").select(COMPANY_FIELDS).eq("is_demo",false).order("name").limit(limit(url,100));
        // Escape pattern metacharacters and PostgREST grammar. No client-supplied SQL/filter expressions.
        const safe=term.replace(/[%_*,.()\\"']/g," ").trim();if(safe)query=query.or(`name.ilike.%${safe}%,ticker.ilike.%${safe}%`);
        const market=url.searchParams.get("market");if(market&&["KOSPI","KOSDAQ","NASDAQ","NYSE"].includes(market))query=query.eq("market",market);
        response=json(await unwrap(query));
      }else if(path==="/v1/watchlist"&&method==="GET")response=json(await rpc(db,"sb_watchlist"));
      else if(parts[1]==="watchlist"&&parts.length===3&&["PUT","DELETE"].includes(method)){await rpc(db,"sb_user_action",{action:method==="PUT"?"watch_add":"watch_remove",p:{company_id:identity(parts[2])}});response=json(null,204);}
      else if(path==="/v1/portfolio"&&method==="GET")response=json(await rpc(db,"sb_portfolio"));
      else if(parts[1]==="portfolio"&&parts[2]==="positions"&&parts.length===4&&["PUT","DELETE"].includes(method)){
        const company_id=identity(parts[3]);await rpc(db,"sb_user_action",{action:method==="DELETE"?"position_remove":"positions",p:method==="DELETE"?{company_id}:{rows:[{...await body(req),company_id}]}});response=json(null,204);
      }else if(path==="/v1/portfolio/import"&&method==="POST"){await rpc(db,"sb_user_action",{action:"positions",p:await body(req)});response=json(await rpc(db,"sb_portfolio"));}
      else if(path==="/v1/feed"&&method==="GET"||parts[1]==="companies"&&parts[3]==="timeline"&&parts.length===4&&method==="GET"){
        const m=await memberships(db),company=parts[1]==="companies"?identity(parts[2]):null,ids=company?[company]:unique([...m.watched,...m.held]);
        const days=Number(url.searchParams.get("days")??90),offset=Number(url.searchParams.get("offset")??0),size=limit(url,100,12);check(Number.isInteger(days)&&days>=1&&days<=3650&&Number.isInteger(offset)&&offset>=0&&offset<=1000);
        const events=ids.length?rows(await unwrap(db.from("events").select("*").eq("state","published").in("company_id",ids).gte("published_at",new Date(Date.now()-days*864e5).toISOString()).order("published_at",{ascending:false}).limit(1000))):[];
        const result=await cards(db,events,m);if(!company)result.sort((a,b)=>b.ranking.score-a.ranking.score||s(b.published_at).localeCompare(s(a.published_at)));
        const catalog=ids.length?await getRows(db,"companies","id",ids,COMPANY_FIELDS):[];const dates=catalog.map(c=>s(c.last_ingested_at)).filter(Boolean).sort();const latest=dates.at(-1)??null;
        response=json(company?result.slice(offset,offset+size):{items:result.slice(offset,offset+size),total:result.length,has_more:offset+size<result.length,truncated:events.length===1000,latest_ingested_at:latest,stale:!latest||Date.now()-Date.parse(latest)>72*36e5,demo_mode:false,generated_at:new Date().toISOString()});
      }else if(parts[1]==="events"&&parts.length===3&&method==="GET")response=json(await detail(db,parts[2]));
      else if(parts[1]==="events"&&parts[3]==="questions"&&parts.length===4&&method==="POST"){
        const p=await body(req),question=s(p.question).trim();check(question.length>0&&question.length<=2000);const d=await detail(db,parts[2]);
        const advice=/매수|매도|목표\s*주가|목표가|살까|팔까|사야|팔아야|\bbuy\b|\bsell\b|price\s*target|guaranteed/i.test(question);
        const aliases:Record<string,string>={매출:"revenue",배당:"dividend",설비:"capex",투자:"capex",위험:"risk",리스크:"risk",경영진:"management",전망:"guidance",영업:"operating"};
        const words=unique([...(question.toLowerCase().match(/[a-z가-힣]{2,}/g)??[]),...Object.entries(aliases).filter(([k])=>question.includes(k)).map(([,v])=>v)]);
        const changed=/변화|바뀐|달라|이전|비교|change|previous|compare/i.test(question);
        const fields=new Map(d.facts.map(f=>[s(f.id),s(f.field)]));
        const evidence=d.evidence.filter(x=>changed||words.some(w=>(s(x.quote)+" "+fields.get(s(x.fact_id))).toLowerCase().includes(w))).slice(0,6);
        response=json(await rpc(db,"sb_save_answer",{eid:identity(parts[2]),question,reason:advice?"advice":evidence.length?changed?"changes":"current":"no_evidence",fact_ids:advice?[]:evidence.map(x=>x.fact_id)}));
      }else if(path==="/v1/questions"&&method==="GET")response=json(await unwrap(db.from("question_history").select("id,event_id,question,answer,created_at").eq("user_id",auth.user.id).order("created_at",{ascending:false}).limit(100)));
      else if(path==="/v1/questions"&&method==="DELETE"){await rpc(db,"sb_clear_history");response=json(null,204);}
      else if(path==="/v1/calendar"&&method==="GET")response=json(await calendar(db));
      else if(path==="/v1/calendar"&&method==="POST")response=json(await rpc(db,"sb_user_action",{action:"calendar_add",p:await body(req)}));
      else if(path==="/v1/calendar/export"&&method==="GET")response=calendarResponse(await calendar(db));
      else if(path==="/v1/calendar/subscription"&&method==="POST"){
        const token=[...crypto.getRandomValues(new Uint8Array(32))].map(x=>x.toString(16).padStart(2,"0")).join("");await rpc(db,"sb_user_action",{action:"subscription_create",p:{token}});response=json({url:`${SITE}/api/v1/calendar/feed/${token}.ics`,expires_in_days:90,warning:"Anyone with this URL can read these calendar events. Revoke it to remove access."});
      }else if(path==="/v1/calendar/subscription"&&method==="DELETE"){await rpc(db,"sb_user_action",{action:"subscription_revoke"});response=json(null,204);}
      else if(parts[1]==="calendar"&&parts.length===3&&method==="DELETE"){await rpc(db,"sb_user_action",{action:"calendar_remove",p:{id:identity(parts[2])}});response=json(null,204);}
      else if(path==="/v1/alerts"&&method==="GET")response=json(await unwrap(db.from("alerts").select("id,name,event_types,min_score,enabled,created_at").eq("user_id",auth.user.id).order("created_at",{ascending:false})));
      else if(path==="/v1/alerts"&&method==="POST"||parts[1]==="alerts"&&parts.length===3&&method==="PUT")response=json(await rpc(db,"sb_user_action",{action:"alert_save",p:{...await body(req),...(parts.length===3?{id:identity(parts[2])}:{})}}));
      else if(parts[1]==="alerts"&&parts.length===3&&method==="DELETE"){await rpc(db,"sb_user_action",{action:"alert_remove",p:{id:identity(parts[2])}});response=json(null,204);}
      else if(path==="/v1/notifications"&&method==="GET"){
        const notices=rows(await unwrap(db.from("notifications").select("id,event_id,read_at,created_at").eq("user_id",auth.user.id).order("created_at",{ascending:false}).limit(100))),ev=await getRows(db,"events","id",notices.map(x=>s(x.event_id))),mapped=index(await cards(db,ev));
        response=json(notices.filter(x=>mapped.has(s(x.event_id))).map(x=>({...x,event:mapped.get(s(x.event_id))})));
      }else if(parts[1]==="notifications"&&parts[3]==="read"&&method==="PUT"){await rpc(db,"sb_user_action",{action:"notification_read",p:{id:parts[2]==="all"?"all":identity(parts[2])}});response=json(null,204);}
      else if(parts[1]==="events"&&parts[3]==="feedback"&&method==="POST"){
        const p=await body(req);await rpc(db,"sb_user_action",{action:"feedback",p:{...p,event_id:identity(parts[2]),rating:p.rating==="unclear"?"not_helpful":p.rating==="wrong_evidence"?"report":p.rating}});response=json(null,204);
      }else if(path==="/v1/analytics"&&method==="POST"){const p=await body(req);await rpc(db,"sb_track",{event_name:p.event_name,properties:p.properties??{}});response=json(null,204);}
      else if(path.startsWith("/v1/ops/")){
        check(await rpc(db,"sb_is_admin"),403,"admin_required");
        if(path==="/v1/ops/dashboard"&&method==="GET")response=json(await rpc(db,"sb_ops_dashboard"));
        else if(path==="/v1/ops/readiness"&&method==="GET")response=json({database:true,private_storage:true,web_api:true,worker:false,dart:false,sec:false,openai:false,email:false,note:"The Python worker and provider credentials have not been deployed. Queued ingestion is not processed until an operator connects the worker."});
        else if(path==="/v1/ops/queues"&&method==="GET"){
          const [events,jobs,runs,reports]=await Promise.all([unwrap(db.from("events").select("*").neq("state","published").order("created_at",{ascending:false}).limit(100)),unwrap(db.from("jobs").select("*").order("created_at",{ascending:false}).limit(100)),unwrap(db.from("ai_runs").select(RUN_FIELDS).in("status",["failed","validation_failed"]).order("created_at",{ascending:false}).limit(50)),unwrap(db.from("feedback").select("*").eq("state","open").order("created_at",{ascending:false}).limit(100))]);response=json({events,jobs,failed_runs:runs,reports,source_conflicts:[]});
        }else if(path==="/v1/ops/documents"&&method==="GET")response=json(await unwrap(db.from("documents").select(DOC_FIELDS).order("ingested_at",{ascending:false}).limit(limit(url))));
        else if(path==="/v1/ops/audit"&&method==="GET")response=json(await unwrap(db.from("audit_logs").select("*").order("created_at",{ascending:false}).limit(limit(url))));
        else if(parts[2]==="documents"&&parts.length===4&&method==="GET"){
          const [docs,chunks,events,runs]=await Promise.all([getRows(db,"documents","id",[identity(parts[3])],DOC_FIELDS),getRows(db,"document_chunks","document_id",[parts[3]]),getRows(db,"events","document_id",[parts[3]]),getRows(db,"ai_runs","document_id",[parts[3]],RUN_FIELDS)]);check(docs[0],404,"document_not_found");response=json({document:docs[0],chunks,events,runs});
        }else if(parts[2]==="runs"&&parts.length===4&&method==="GET"){const runs=await getRows(db,"ai_runs","id",[identity(parts[3])],RUN_FIELDS);check(runs[0],404,"run_not_found");response=json(runs[0]);}
        else if(parts[2]==="documents"&&parts[4]==="raw"&&method==="GET"){
          const docs=await getRows(db,"documents","id",[identity(parts[3])],DOC_FIELDS);check(docs[0],404,"document_not_found");const blobs=rows(await unwrap(db.from("raw_blobs").select("*").eq("sha256",docs[0].raw_sha256).limit(1)));check(blobs[0],404,"raw_not_found");const blob=await unwrap(db.storage.from("signalbrief-raw").download(s(blobs[0].object_key)));check(blob,404,"raw_not_found");const bytes=await blob.arrayBuffer(),hash=[...new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))].map(x=>x.toString(16).padStart(2,"0")).join("");check(hash===docs[0].raw_sha256,409,"raw_integrity_mismatch");response=new Response(bytes,{headers:{"Content-Type":"application/octet-stream","Content-Disposition":`attachment; filename=source-${parts[3]}.bin`,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
        }else if(parts[2]==="events"&&parts[4]==="action"&&method==="POST"){const p=await body(req);response=json(await rpc(db,"sb_admin_action",{kind:p.action,p:{...p,id:identity(parts[3])}}));}
        else if(parts[2]==="jobs"&&parts[4]==="retry"&&method==="POST")response=json(await rpc(db,"sb_admin_action",{kind:"retry_job",p:{id:identity(parts[3]),reason:"Operator requested a failed-job retry"}}));
        else if(parts[2]==="reports"&&parts[4]==="resolve"&&method==="POST"){await rpc(db,"sb_admin_action",{kind:"resolve_report",p:{id:identity(parts[3]),reason:"Operator reviewed the user report"}});response=json(null,204);}
        else if(path==="/v1/ops/ingest"&&method==="POST"){const p=await body(req);const result=await rpc(db,"sb_admin_action",{kind:"ingest",p:{id:identity(s(p.company_id)),reason:"Operator queued an official disclosure collection"}});response=json({...row(result),processing_active:false,note:"Saved in the durable queue. Worker setup is still required."},202);}
        else throw new Fault(404,"route_not_found");
      }else throw new Fault(404,"route_not_found");
    }
  }catch(error){const fault=error instanceof Fault?error:new Fault(500,"internal_error");console.error(JSON.stringify({requestId,code:fault.code,status:fault.status}));response=json({error:{code:fault.code,request_id:requestId}},fault.status);}
  response.headers.set("X-Request-Id",requestId);response.headers.set("Referrer-Policy","no-referrer");response.headers.set("Vary","Origin");const origin=req.headers.get("origin");if(origin&&ALLOWED_ORIGINS.has(origin))response.headers.set("Access-Control-Allow-Origin",origin);return response;
});
