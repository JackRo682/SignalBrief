import {templates} from './templates.js';
import {mountReference} from './controller.js';
import {polishReference} from './publication.js';
const clone=x=>JSON.parse(JSON.stringify(x));
const id=n=>`${String(n).padStart(8,'0')}-0000-4000-8000-000000000001`;
const companies=[{id:id(1),name:'예시 반도체',ticker:'TEST1',market:'KOSPI',provider:'dart',is_demo:false},{id:id(2),name:'Example Cloud',ticker:'TEST2',market:'NASDAQ',provider:'sec',is_demo:false},{id:id(3),name:'Example Mobility',ticker:'TEST3',market:'NASDAQ',provider:'sec',is_demo:false}];
const now=new Date().toISOString();const date=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
const events=companies.map((company,i)=>({id:id(11+i),company,event_type:['earnings','guidance','capex'][i],headline:['분기 공시에서 확인한 새로운 변화','새로운 투자 계획과 비교 기준','공식 발표에서 확인한 사업 변경'][i],what_happened:'이 설명은 인터랙션을 검증하기 위한 합성 자료입니다. 실제 기업의 사실이나 시세가 아닙니다.',published_at:now,source_provider:company.provider,source_tier:1,source_url:'https://example.com/evidence',confidence:.9,materiality:.75,ranking:{score:.8,reason:i===0?'보유종목과 관련':'관심종목과 관련'},change_count:1,is_demo:false}));
const details=events.map((event,i)=>({event,document:{id:id(41+i),title:'화면 테스트용 공시',source_url:'https://example.com/evidence',published_at:now},facts:[{id:id(51+i),field:'revenue',quote:'이것은 로컬 테스트를 위한 원문 인용입니다.',value_raw:'12.3',unit:'테스트 단위',period:'테스트 기간',validation_status:'supported'}],changes:[{id:id(61+i),field:'revenue',previous_value:'10 테스트 단위',current_value:'12.3 테스트 단위',percentage_change:'23'}],brief:{what_happened:event.what_happened,interpretation:'예시 해석입니다. 실제 투자 판단에 사용하지 마세요.',uncertainty:'미래 상황은 알 수 없으며 이 데이터는 합성 테스트입니다.',monitor_next:'다음 실제 공시의 기간과 단위를 확인합니다.'},evidence:[{fact_id:id(51+i),source_name:companyProvider(i),source_tier:1,quote:'이것은 로컬 테스트를 위한 원문 인용입니다.',source_url:'https://example.com/evidence',location:'테스트 본문 1절',published_at:now}]}));
for(const detail of details){Object.assign(detail.event,{fact_summary:detail.facts[0].quote,change_summary:detail.changes.slice(0,2).map(x=>({field:x.field,previous_value:x.previous_value,current_value:x.current_value})),interpretation:detail.brief.interpretation,source_document:detail.document});}
function companyProvider(i){return i===0?'OpenDART':'SEC EDGAR';}
const initial={user:{id:id(100),display_name:'테스트 투자자',density:'advanced',is_admin:true,onboarding_completed:true},prefs:{experience:'beginner',markets:['KR'],sectors:['반도체'],has_holdings:true,alert_frequency:'essential',realtime_enabled:true,notify_min_score:.4,browser_notifications:false},watch:[companies[0]],positions:[],calendar:[{id:id(80),user_id:id(100),title:'합성 확인 일정',occurs_on:date,origin:'user',event_id:null,company_id:null},{id:id(81),title:'테스트 공식 일정',occurs_on:date,origin:'official',event_id:events[0].id,company_id:companies[0].id,source_url:'https://example.com/evidence'}],reminders:[],rules:[{id:id(90),name:'기본 테스트 규칙',min_score:.4,event_types:[],enabled:true}],notifications:events.map((event,i)=>({id:id(110+i),event,created_at:now,read_at:null})),history:[],calls:[]};
window.fixture=clone(initial);window.lastNavigation='';
window.resetFixture=()=>{window.fixture=clone(initial)};
function mutateCall(path,method,payload){window.fixture.calls.push({path,method,payload:clone(payload??{})});}
const api=async(path,method='GET',payload)=>{const state=window.fixture;mutateCall(path,method,payload);const p=path.split('?')[0];const params=new URLSearchParams(path.split('?')[1]??'');await new Promise(r=>setTimeout(r,12));
 if(p==='/market')return {quotes:[],available:false};
 if(p==='/v1/public/stats')return {documents:0,companies:3,users:null,uptime_pct:null};
 if(p==='/v1/me'){if(method==='PATCH')Object.assign(state.user,payload);return clone(state.user);}
 if(p==='/v1/preferences')return clone(state.prefs);
 if(p==='/v1/companies'){const q=(params.get('q')??'').toLowerCase();return clone(companies.filter(c=>(c.name+c.ticker).toLowerCase().includes(q)));}
 if(p==='/v1/watchlist')return {id:id(130),items:clone(state.watch)};
 if(p.startsWith('/v1/watchlist/')){const c=companies.find(c=>c.id===p.split('/')[3]);if(method==='PUT'&&c&&!state.watch.some(w=>w.id===c.id))state.watch.push(c);if(method==='DELETE')state.watch=state.watch.filter(w=>w.id!==c?.id);return null;}
 if(p==='/v1/portfolio')return {id:id(140),positions:clone(state.positions)};
 if(p==='/v1/feed')return {items:clone(events),total:events.length,latest_ingested_at:now,stale:false};
 if(p.startsWith('/v1/companies/')&&p.endsWith('/timeline'))return clone(events.filter(e=>e.company.id===p.split('/')[3]));
 if(p.startsWith('/v1/events/')&&p.endsWith('/questions')){const ev=p.split('/')[3];const answer={status:'answered',mode:'extractive',message:'아래는 이 격리 테스트에서 검증하는 원문 근거입니다.',evidence:[{source_id:id(51),quote:'이것은 로컬 테스트를 위한 원문 인용입니다.',source_url:'https://example.com/evidence',location:'테스트 본문 1절'}]};state.history.unshift({id:id(160+state.history.length),event_id:ev,question:payload.question,answer,created_at:now});return clone(answer);}
 if(p.startsWith('/v1/events/')&&p.endsWith('/feedback'))return null;
 if(p.startsWith('/v1/events/'))return clone(details.find(d=>d.event.id===p.split('/')[3]));
 if(p==='/v1/questions'){if(method==='DELETE')state.history=[];return clone(state.history);}
 if(p==='/v1/calendar/subscription')return {url:'https://example.com/private-calendar-token.ics'};
 if(p==='/v1/calendar'){if(method==='POST'){const item={id:id(170+state.calendar.length),...payload,origin:'user',user_id:state.user.id,event_id:null,company_id:null};state.calendar.push(item);return clone(item);}return clone(state.calendar);}
 if(p.startsWith('/v1/calendar/')&&method==='DELETE'){state.calendar=state.calendar.filter(x=>x.id!==p.split('/')[3]);return null;}
 if(p==='/v1/alerts'){if(method==='POST'){const r={id:id(180+state.rules.length),...payload};state.rules.push(r);return clone(r);}return clone(state.rules);}
 if(p.startsWith('/v1/alerts/')){if(method==='DELETE')state.rules=state.rules.filter(x=>x.id!==p.split('/')[3]);else Object.assign(state.rules.find(x=>x.id===p.split('/')[3]),payload);return null;}
 if(p==='/v1/notifications')return clone(state.notifications);
 if(p.startsWith('/v1/notifications/')){state.notifications.forEach(n=>{if(p.split('/')[3]==='all'||n.id===p.split('/')[3])n.read_at=now;});return null;}
 if(p.startsWith('/v1/ops/'))return p.endsWith('/queues')?{failed_runs:[]} : [];
 throw new Error('Unmocked API path: '+path);
};
const rpc=async(name,args={})=>{mutateCall(name,'RPC',args);const s=window.fixture,p=args.p??{};
 if(name==='sb_reference_preferences'){Object.assign(s.prefs,p);return clone(s.prefs);}
 if(name==='sb_reference_setup'){s.watch=companies.filter(c=>p.company_ids.includes(c.id));s.positions=p.positions.map((x,i)=>({id:id(200+i),...x,company:companies.find(c=>c.id===x.company_id)}));return {saved:true};}
 if(name==='sb_resolve_companies')return clone(companies.filter(c=>args.tickers.includes(c.ticker)));
 if(name==='sb_reference_reminders'){if(p.action==='set'){s.reminders=s.reminders.filter(x=>x.calendar_id!==p.calendar_id);if(p.enabled)s.reminders.push({calendar_id:p.calendar_id});}return clone(s.reminders);}
 if(name==='sb_reference_users')return [clone(s.user)];
 if(name==='sb_reference_ops'){const metrics=Object.fromEntries(['documents','events','ai_runs','ai_failures','low_confidence','citation_failures','number_mismatch','duplicates','pipeline_latency','ai_cost'].map(k=>[k,{value:0,delta:null,note:'격리 테스트',spark:[]} ]));return {metrics,review:[{id:events[0].id,document_id:id(41),title:'검토 테스트 이벤트',symbol:'TEST1',state:'needs_review',created_at:now}],failures:[],citations:[],duplicates:[],reports:[]};}
 throw new Error('Unmocked RPC: '+name);
};
let dispose;window.renderScreen=(screen,empty=false)=>{dispose?.();if(empty){window.fixture.notifications=[];window.fixture.calendar=[];window.fixture.watch=[];}const root=document.querySelector('#root');root.className='reference-ui screen-'+screen;root.innerHTML=templates[screen];const ctx={user:screen==='landing'?null:window.fixture.user,id:screen==='detail'||screen==='chat'?events[0].id:screen==='timeline'?companies[0].id:undefined,api,rpc,go:url=>{window.lastNavigation=url},auth:async(kind,fields)=>{mutateCall(kind,'AUTH',fields);return {};},download:async(path,name)=>mutateCall(path,'DOWNLOAD',{name}),demo:false};const unmount=mountReference(root,screen,ctx),unpolish=polishReference(root,screen,ctx);dispose=()=>{unpolish();unmount();};};
window.renderScreen(new URLSearchParams(location.search).get('screen')??'landing');
