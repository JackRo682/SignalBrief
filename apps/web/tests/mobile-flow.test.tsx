import '@testing-library/jest-dom/vitest';
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import MobileEvent from '../src/mobile/event';
import MobileQuestions from '../src/mobile/questions';
import MobileTimeline from '../src/mobile/timeline';
import CompanyOverview,{DocumentView} from '../src/workspace/company';
import {defaults} from '../src/workspace/contracts';
import {type Answer,type EventDetail} from '../src/lib/contracts';

const mocks=vi.hoisted(()=>({request:vi.fn(),workspace:vi.fn(),push:vi.fn(),replace:vi.fn(),historyEnabled:false,saved:false,failSave:false,failHolding:false,failHistory:false,history:[] as {id:string;event_id:string;question:string;answer:Answer;created_at:string}[],text:(ko:string)=>ko,date:(value:string|null)=>value??'—'}));
vi.mock('../src/components/auth',()=>({useAuth:()=>({token:'isolated-synthetic-token',me:{id:'10000000-0000-4000-8000-000000000001'}})}));
vi.mock('../src/workspace/preferences',()=>({usePrefs:()=>({value:{...defaults,history_enabled:mocks.historyEnabled},text:mocks.text,date:mocks.date})}));
vi.mock('../src/workspace/client',()=>({workspace:mocks.workspace}));
vi.mock('../src/workspace/market',()=>({useQuotes:()=>({quotes:[],loading:false,reason:'provider_not_configured'})}));
vi.mock('../src/lib/api',async original=>({...await original<typeof import('../src/lib/api')>(),request:mocks.request}));
vi.mock('next/navigation',()=>({useRouter:()=>({push:mocks.push,replace:mocks.replace}),usePathname:()=>'/today',useSearchParams:()=>new URLSearchParams(window.location.search)}));

const id='20000000-0000-4000-8000-000000000001',eventId='30000000-0000-4000-8000-000000000001',documentId='40000000-0000-4000-8000-000000000001',factId='50000000-0000-4000-8000-000000000001';
const company={id,name:'Synthetic Company',ticker:'TEST',market:'NASDAQ',provider:'sec',is_demo:false,last_ingested_at:null};
const source='https://www.sec.gov/Archives/edgar/data/1/synthetic.htm',stamp='2026-10-01T00:00:00Z';
const resource={id:eventId,kind:'event' as const,title:'Synthetic source-backed change',summary:'Synthetic disclosed revenue',company_id:id,company_name:company.name,ticker:company.ticker,market:company.market,source_url:source,published_at:stamp,publication_precision:'date',category:'earnings',is_saved:false};
const companyResource={...resource,id,kind:'company' as const,title:company.name,summary:'',source_url:null,published_at:null,category:'company'};
const detail:EventDetail={
 event:{id:eventId,company,event_type:'earnings',state:'published',headline:resource.title,what_happened:resource.summary,confidence:.8,materiality:.6,published_at:stamp,publication_precision:'date',is_demo:false,source_tier:1,source_provider:'sec',source_url:source,ranking:{score:.5,version:'synthetic',components:{P:1},effective_weights:{P:1},missing_components:['A'],reason:'Synthetic held-company relevance',portfolio_weight_method:'membership_only',market_reaction:'unavailable'},change_count:1,fact_summary:'Synthetic evidence quote',change_summary:[{field:'revenue',previous_value:'90',current_value:'100'}],interpretation:'Synthetic reviewed interpretation',source_document:{id:documentId,title:'Synthetic 10-K',provider:'sec',source_url:source,published_at:stamp}},
 document:{id:documentId,title:'Synthetic 10-K',provider:'sec',source_url:source,download_url:source,published_at:stamp,publication_date:'2026-10-01',publication_precision:'date',publication_timezone:'UTC',ingested_at:stamp,raw_sha256:'a'.repeat(64),is_demo:false},
 facts:[{id:factId,field:'revenue',quote:'Synthetic evidence quote, kept verbatim and complete.',chunk_id:'chunk',value_raw:'100',unit:'USD million',period:'Synthetic FY',scope:'consolidated',basis:'GAAP',validation_status:'supported'}],
 changes:[{id:'60000000-0000-4000-8000-000000000001',field:'revenue',current_fact_id:factId,previous_fact_id:null,change_type:'increased',comparison_kind:'year_over_year',previous_value:'90',current_value:'100',absolute_change:'10',percentage_change:'11.11111111',materiality:.6,confidence:.8}],
 evidence:[{fact_id:factId,chunk_id:'chunk',document_id:documentId,quote:'Synthetic evidence quote, kept verbatim and complete.',location:'Synthetic section 1',source_url:source,source_name:'SEC EDGAR',source_tier:1,published_at:stamp,publication_precision:'date',is_demo:false,role:'current'}],
 brief:{headline:resource.title,what_happened:resource.summary,interpretation:'Synthetic reviewed interpretation',uncertainty:'Synthetic uncertainty is retained',monitor_next:'Synthetic next source to inspect',template_version:'synthetic'},
 validations:[],run:{id:'70000000-0000-4000-8000-000000000001',stage:'synthetic',model:'synthetic',model_version:null,prompt_version:'synthetic',pipeline_version:'synthetic',status:'succeeded',latency_ms:null,input_tokens:null,output_tokens:null,cost_usd:null,error_code:null,created_at:stamp,finished_at:stamp,validation_result:{}},
};

const otherEventId='30000000-0000-4000-8000-000000000002',otherCompanyId='20000000-0000-4000-8000-000000000002';
const returnedAnswer:Answer={status:'abstained',message:'Synthetic evidence is insufficient for this question.',evidence:[],run_id:null,mode:'extractive'};

beforeEach(()=>{
 vi.clearAllMocks();mocks.historyEnabled=false;mocks.saved=false;mocks.failSave=false;mocks.failHolding=false;mocks.failHistory=false;mocks.history=[];
 window.history.replaceState({},'',`/events/${eventId}`);
 Object.defineProperty(HTMLElement.prototype,'scrollIntoView',{configurable:true,value:vi.fn()});
 Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:function(this:HTMLDialogElement){this.setAttribute('open','');}});
 mocks.workspace.mockImplementation(async(_token,req)=>{
  if(req.action==='resource')return {...resource,id:req.p.id,kind:req.p.kind,is_saved:mocks.saved};
  if(req.action==='company')return {company:companyResource,events:[],documents:[],facts:[],watching:false,holding:true};
  if(req.action==='catalog')return {items:[companyResource],total:1,counts:{company:1},markets:['NASDAQ'],next_offset:null};
  if(req.action==='visit')return {recorded:mocks.historyEnabled};
  if(req.action==='save'){if(mocks.failSave)throw new Error('저장을 완료하지 못했습니다.');mocks.saved=req.p.saved;return {saved:mocks.saved};}
  throw new Error(`Unexpected synthetic workspace action: ${req.action}`);
 });
 mocks.request.mockImplementation(async(path,_token,_schema,init)=>{
  if(path==='/v1/portfolio'){
   if(mocks.failHolding)throw new Error('Synthetic unavailable holding');
   return {id:'portfolio',name:'Synthetic portfolio',weighting_note:'Membership only',positions:[{id:'position',company,quantity:'1E+3',average_cost:'9.950000001E+1',currency:'EUR'}]};
  }
  if(path===`/v1/events/${eventId}`)return detail;
  if(path===`/v1/events/${otherEventId}`)return {...detail,event:{...detail.event,id:otherEventId,headline:'Another synthetic published event'}};
  if(path.startsWith('/v1/feed?'))return {items:[detail.event],total:1,has_more:false,truncated:false,latest_ingested_at:stamp,stale:false,demo_mode:false,generated_at:stamp};
  if(path==='/v1/questions'){
   if(init?.method==='DELETE'){mocks.history=[];return undefined;}
   if(mocks.failHistory)throw new Error('질문 기록을 불러오지 못했습니다.');
   return [...mocks.history];
  }
  if(path.endsWith('/questions')){const value=JSON.parse(String(init.body));mocks.history.unshift({id:`synthetic-history-${mocks.history.length+1}`,event_id:path.split('/')[3],question:value.question,answer:returnedAnswer,created_at:new Date().toISOString()});return returnedAnswer;}
  if(path.includes('/timeline?'))return [{...detail.event,published_at:new Date().toISOString()}];
  if(path.startsWith('/v1/portfolio/positions/')&&init?.method==='PUT')return undefined;
  throw new Error(`Unexpected synthetic API route: ${path}`);
 });
});
afterEach(()=>{cleanup();vi.restoreAllMocks();});

describe('mobile event actions use owned, persisted responses',()=>{
 it('saves and restores an event bookmark without recording disabled history',async()=>{
  const page=render(<MobileEvent id={eventId}/>);
  await screen.findByRole('heading',{level:1,name:resource.title});
  const save=await screen.findByRole('button',{name:'이벤트 저장'});
  await waitFor(()=>expect(save).toBeEnabled());fireEvent.click(save);
  await screen.findByRole('button',{name:'이벤트 저장 취소'});
  expect(mocks.workspace).toHaveBeenCalledWith('isolated-synthetic-token',{action:'save',p:{kind:'event',id:eventId,saved:true}},expect.anything());
  expect(mocks.workspace.mock.calls.some(([,req])=>req.action==='visit')).toBe(false);
  page.unmount();render(<MobileEvent id={eventId}/>);
  await screen.findByRole('button',{name:'이벤트 저장 취소'});
 });
 it('does not report a saved bookmark after a failed mutation',async()=>{
  mocks.failSave=true;render(<MobileEvent id={eventId}/>);
  await screen.findByRole('heading',{level:1,name:resource.title});
  const save=screen.getByRole('button',{name:'이벤트 저장'});await waitFor(()=>expect(save).toBeEnabled());fireEvent.click(save);
  expect(await screen.findByRole('alert')).toHaveTextContent('저장을 완료하지 못했습니다.');
  expect(save).toHaveAttribute('aria-pressed','false');expect(mocks.saved).toBe(false);
 });
 it('opens the evidence deep link, preserves the quote and records an opted-in visit',async()=>{
  mocks.historyEnabled=true;window.history.replaceState({},'',`/events/${eventId}?panel=evidence`);
  render(<MobileEvent id={eventId}/>);
  await screen.findByRole('heading',{name:'원문 인용과 검증 근거'});
  expect(document.querySelector('#mobile-event-evidence blockquote')).toHaveTextContent(detail.evidence[0].quote);
  expect(screen.getByRole('link',{name:'Synthetic 10-K'})).toHaveAttribute('href',`/documents/${documentId}?kind=document`);
  await waitFor(()=>expect(mocks.workspace).toHaveBeenCalledWith('isolated-synthetic-token',{action:'visit',p:{kind:'event',id:eventId}},expect.anything()));
 });
 it('posts the entered follow-up and displays a real abstention response',async()=>{
  render(<MobileEvent id={eventId}/>);await screen.findByRole('heading',{level:1,name:resource.title});
  fireEvent.click(screen.getByRole('button',{name:'AI 후속 질문하기'}));
  const dialog=screen.getByRole('dialog',{name:'AI 후속 질문'});
  fireEvent.change(within(dialog).getByLabelText('질문',{exact:true}),{target:{value:'Synthetic evidence question'}});
  fireEvent.click(within(dialog).getByRole('button',{name:'질문 보내기'}));
  expect(await within(dialog).findByText('Synthetic evidence is insufficient for this question.')).toBeVisible();
  expect(mocks.request).toHaveBeenCalledWith(`/v1/events/${eventId}/questions`,'isolated-synthetic-token',expect.anything(),{method:'POST',body:JSON.stringify({question:'Synthetic evidence question'})});
 });
});

describe('desktop holding and direct-document regressions',()=>{
 it('prefills and preserves exact holding decimals and the existing currency',async()=>{
  render(<CompanyOverview id={id}/>);fireEvent.click(await screen.findByRole('button',{name:'보유 정보 수정'}));
  await waitFor(()=>expect(screen.getByLabelText('보유 수량')).toHaveValue('1000'));
  expect(screen.getByLabelText('평균 단가 (선택)')).toHaveValue('99.50000001');
  expect(screen.getByLabelText('통화')).toHaveValue('EUR');
  fireEvent.click(screen.getByRole('button',{name:'저장'}));
  await waitFor(()=>expect(mocks.request).toHaveBeenCalledWith(`/v1/portfolio/positions/${id}`,'isolated-synthetic-token',expect.anything(),{method:'PUT',body:JSON.stringify({quantity:'1000',average_cost:'99.50000001',currency:'EUR'})}));
 });
 it('blocks a holding overwrite if existing data could not load',async()=>{
  mocks.failHolding=true;render(<CompanyOverview id={id}/>);fireEvent.click(await screen.findByRole('button',{name:'보유 정보 수정'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('기존 보유 정보를 불러오지 못했습니다');
  expect(screen.getByRole('button',{name:'저장'})).toBeDisabled();
  expect(mocks.request.mock.calls.some(([path])=>path.startsWith('/v1/portfolio/positions/'))).toBe(false);
 });
 it.each([false,true])('records a direct document visit only when history is enabled: %s',async enabled=>{
  mocks.historyEnabled=enabled;render(<DocumentView id={documentId} kind="filing"/>);
  await screen.findByRole('link',{name:resource.title});
  await waitFor(()=>expect(mocks.workspace.mock.calls.filter(([,req])=>req.action==='visit')).toHaveLength(enabled?1:0));
  if(enabled)expect(mocks.workspace).toHaveBeenCalledWith('isolated-synthetic-token',{action:'visit',p:{kind:'filing',id:documentId}},expect.anything());
 });
});

describe('persisted mobile question conversations',()=>{
 it('loads the selected event conversation and restores a history item after navigation',async()=>{
  const first={id:'history-a',event_id:eventId,question:'Synthetic saved question A',answer:{...returnedAnswer,message:'Stored answer A'},created_at:stamp};
  const second={id:'history-b',event_id:otherEventId,question:'Synthetic saved question B',answer:{...returnedAnswer,message:'Stored answer B'},created_at:stamp};
  mocks.history=[second,first];
  const page=render(<MobileQuestions eventId={eventId}/>);
  expect(await screen.findByText('Stored answer A')).toBeVisible();expect(screen.queryByText('Stored answer B')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:/Synthetic saved question B/}));
  expect(mocks.replace).toHaveBeenCalledWith(`/questions?event=${otherEventId}&question=history-b`,{scroll:false});
  window.history.replaceState({},'',`/questions?event=${otherEventId}&question=history-b`);page.rerender(<MobileQuestions eventId={otherEventId}/>);
  expect(await screen.findByText('Stored answer B')).toBeVisible();expect(screen.queryByText('Stored answer A')).toBeNull();
  expect(document.getElementById('mobile-question-history-b')).toHaveClass('is-selected');
  expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();
 });
 it('does not duplicate a returned answer after history refresh or collapse separate repeated questions',async()=>{
  const page=render(<MobileQuestions eventId={eventId}/>);
  for(let count=1;count<=2;count++){
   const input=screen.getByLabelText('공시에 관한 질문');await waitFor(()=>expect(input).toBeEnabled());
   fireEvent.change(input,{target:{value:'Synthetic repeated question'}});fireEvent.click(screen.getByRole('button',{name:'질문 보내기'}));
   await waitFor(()=>expect(screen.getAllByText(returnedAnswer.message)).toHaveLength(count));
   await waitFor(()=>expect(mocks.history).toHaveLength(count));
   await waitFor(()=>expect(input).toBeEnabled());
  }
  expect(document.querySelectorAll('.m-conversation .m-question-user')).toHaveLength(2);
  page.unmount();render(<MobileQuestions eventId={eventId}/>);
  await waitFor(()=>expect(screen.getAllByText(returnedAnswer.message)).toHaveLength(2));
 });
 it('keeps successfully deleted history removed even if the subsequent refresh fails',async()=>{
  mocks.history=[{id:'history-a',event_id:eventId,question:'Synthetic saved question',answer:{...returnedAnswer,message:'Answer being deleted'},created_at:stamp}];
  vi.spyOn(window,'confirm').mockReturnValue(true);render(<MobileQuestions eventId={eventId}/>);
  await screen.findByText('Answer being deleted');mocks.failHistory=true;fireEvent.click(screen.getByRole('button',{name:'기록 삭제'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('질문 기록을 불러오지 못했습니다.');
  expect(screen.queryByText('Answer being deleted')).toBeNull();expect(mocks.history).toHaveLength(0);
 });
 it('cannot put a pending answer from one event into the next event conversation',async()=>{
  const original=mocks.request.getMockImplementation()!;let resolveAnswer!:(answer:Answer)=>void;
  mocks.request.mockImplementation((path,...args)=>path===`/v1/events/${eventId}/questions`?new Promise<Answer>(resolve=>{resolveAnswer=resolve;}):original(path,...args));
  const page=render(<MobileQuestions eventId={eventId}/>);const input=screen.getByLabelText('공시에 관한 질문');
  await waitFor(()=>expect(input).toBeEnabled());fireEvent.change(input,{target:{value:'Synthetic pending question'}});fireEvent.click(screen.getByRole('button',{name:'질문 보내기'}));
  await waitFor(()=>expect(resolveAnswer).toBeTypeOf('function'));
  page.rerender(<MobileQuestions eventId={otherEventId}/>);await screen.findByRole('heading',{name:'Another synthetic published event'});
  resolveAnswer({...returnedAnswer,message:'Previous event late answer'});
  await waitFor(()=>expect(screen.getByLabelText('공시에 관한 질문')).toBeEnabled());
  expect(screen.queryByText('Previous event late answer')).toBeNull();
 });
});

describe('mobile timeline route and period scoping',()=>{
 it('skips a nullable company selection and searches the supported catalog with the actual query',async()=>{
  render(<MobileTimeline/>);await screen.findByText('변화를 확인할 기업을 선택하세요');
  expect(mocks.request.mock.calls.some(([path])=>path.includes('/timeline?'))).toBe(false);
  expect(mocks.workspace.mock.calls.some(([,req])=>req.action==='company')).toBe(false);
  fireEvent.change(screen.getByLabelText('기업명 또는 종목코드 검색'),{target:{value:'엔비디아'}});
  await waitFor(()=>expect(mocks.workspace).toHaveBeenCalledWith('isolated-synthetic-token',{action:'catalog',p:{q:'엔비디아',kind:'company',limit:50}},expect.anything(),expect.anything()));
  await waitFor(()=>expect(screen.getByLabelText('타임라인 기업 선택')).toBeEnabled());
  fireEvent.change(screen.getByLabelText('타임라인 기업 선택'),{target:{value:id}});
  expect(mocks.push).toHaveBeenCalledWith(`/companies/${id}/timeline`);
 });
 it('removes stale events while a new period loads and keeps the selected range truthful',async()=>{
  const recent={...detail.event,headline:'Synthetic recent change',published_at:new Date(Date.now()-86400000).toISOString()};
  const old={...detail.event,id:otherEventId,headline:'Synthetic older change',published_at:new Date(Date.now()-120*86400000).toISOString()};
  const original=mocks.request.getMockImplementation()!;let resolvePeriod!:(items:EventDetail['event'][])=>void;
  mocks.request.mockImplementation((path,...args)=>path.includes('/timeline?days=180')?Promise.resolve([old]):path.includes('/timeline?days=90')?new Promise(resolve=>{resolvePeriod=resolve;}):original(path,...args));
  render(<MobileTimeline id={id}/>);await screen.findByRole('heading',{name:old.headline});
  fireEvent.change(screen.getByLabelText('기간'),{target:{value:'90'}});
  expect(screen.queryByRole('heading',{name:old.headline})).toBeNull();
  await waitFor(()=>expect(resolvePeriod).toBeTypeOf('function'));resolvePeriod([old,recent]);
  await screen.findByRole('heading',{name:recent.headline});expect(screen.queryByRole('heading',{name:old.headline})).toBeNull();
 });
 it('does not display the previous company while a different company route loads',async()=>{
  const original=mocks.workspace.getMockImplementation()!;
  mocks.workspace.mockImplementation((token,req,...args)=>req.action==='company'&&req.p.id===otherCompanyId?new Promise(()=>{}):original(token,req,...args));
  const originalRequest=mocks.request.getMockImplementation()!;
  mocks.request.mockImplementation((path,...args)=>path.startsWith(`/v1/companies/${otherCompanyId}/timeline`)?new Promise(()=>{}):originalRequest(path,...args));
  const page=render(<MobileTimeline id={id}/>);await screen.findByRole('link',{name:'Synthetic Company TEST · NASDAQ'});
  page.rerender(<MobileTimeline id={otherCompanyId}/>);
  expect(screen.queryByRole('link',{name:'Synthetic Company TEST · NASDAQ'})).toBeNull();
  expect(screen.queryByRole('heading',{name:detail.event.headline})).toBeNull();
 });
});
