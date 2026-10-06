import '@testing-library/jest-dom/vitest';
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {z} from 'zod';
import MobileDocument from '../src/mobile/document';
import MobileQuestions from '../src/mobile/questions';
import MobileTimeline from '../src/mobile/timeline';
import {defaults,documentDetailSchema,type Resource} from '../src/workspace/contracts';
import {answerSchema,detailSchema,type Answer,type EventCard} from '../src/lib/contracts';

const mocks=vi.hoisted(()=>({workspace:vi.fn(),request:vi.fn(),push:vi.fn(),replace:vi.fn(),historyEnabled:false,saved:false,watching:false,failSave:false,failLoad:false,failQuestion:false,text:(ko:string)=>ko,date:(value:string|null)=>value??'—',history:[] as {id:string;event_id:string;question:string;answer:Answer;created_at:string}[]}));
vi.mock('../src/components/auth',()=>({useAuth:()=>({token:'isolated-research-token',me:{id:'10000000-0000-4000-8000-000000000001'}})}));
vi.mock('../src/workspace/preferences',()=>({usePrefs:()=>({value:{...defaults,history_enabled:mocks.historyEnabled},text:mocks.text,date:mocks.date})}));
vi.mock('../src/workspace/client',()=>({workspace:mocks.workspace}));
vi.mock('../src/workspace/market',()=>({useQuotes:()=>({quotes:[],loading:false,reason:'not_configured'})}));
vi.mock('../src/lib/api',async original=>({...await original<typeof import('../src/lib/api')>(),request:mocks.request}));
vi.mock('next/navigation',()=>({useRouter:()=>({push:mocks.push,replace:mocks.replace}),useSearchParams:()=>new URLSearchParams(window.location.search)}));

const companyId='20000000-0000-4000-8000-000000000001',documentId='40000000-0000-4000-8000-000000000001',eventId='30000000-0000-4000-8000-000000000001';
const source='https://www.sec.gov/Archives/edgar/data/1/research-fixture.htm',stamp='2026-10-06T08:00:00Z';
const resource:Resource={id:documentId,kind:'document',title:'Synthetic reviewed filing',summary:'Persisted synthetic document summary',company_id:companyId,company_name:'Synthetic Company',ticker:'TEST',market:'NASDAQ',source_url:source,published_at:stamp,publication_precision:'date',category:'10-K',is_saved:false};
const eventResource:Resource={...resource,id:eventId,kind:'event',title:'Synthetic reviewed earnings',category:'earnings'};
const companyResource:Resource={...resource,id:companyId,kind:'company',title:'Synthetic Company'};
const event:EventCard={id:eventId,company:{id:companyId,name:'Synthetic Company',ticker:'TEST',market:'NASDAQ',provider:'sec',is_demo:false,last_ingested_at:null},event_type:'earnings',state:'published',headline:eventResource.title,what_happened:'Persisted source-backed synthetic event.',confidence:.8,materiality:.8,published_at:stamp,publication_precision:'date',is_demo:false,source_tier:1,source_provider:'sec',source_url:source,ranking:{score:.5,version:'synthetic',components:{P:1},effective_weights:{P:1},missing_components:[],reason:'Synthetic ranking',portfolio_weight_method:'membership_only',market_reaction:'unavailable'},change_count:0,fact_summary:'The complete persisted synthetic fact.',change_summary:[],interpretation:'Persisted reviewed interpretation only.',source_document:{id:documentId,title:resource.title,provider:'sec',source_url:source,published_at:stamp}};
const detail=detailSchema.parse({event,document:{id:documentId,title:resource.title,provider:'sec',source_url:source,download_url:source,published_at:stamp,publication_date:'2026-10-06',publication_precision:'date',publication_timezone:'UTC',ingested_at:stamp,raw_sha256:'a'.repeat(64),is_demo:false},facts:[],changes:[],evidence:[],brief:{headline:event.headline,what_happened:event.what_happened,interpretation:event.interpretation,uncertainty:'Synthetic uncertainty',monitor_next:'Synthetic monitoring',template_version:'synthetic'},validations:[],run:{id:'synthetic-run',stage:'published',model:'synthetic',model_version:null,prompt_version:'synthetic',pipeline_version:'synthetic',status:'completed',latency_ms:null,input_tokens:null,output_tokens:null,cost_usd:null,error_code:null,created_at:stamp,finished_at:stamp,validation_result:{}}});
const fullContent=`Synthetic full normalized source.\n${'Full content must remain available. '.repeat(200)}END OF SOURCE`;
const baseDocument=documentDetailSchema.parse({document:resource,metadata:{mime_type:null,size_bytes:null,page_count:null,provider:'sec',publication_timezone:'UTC',ingested_at:stamp,raw_sha256:'a'.repeat(64)},summaries:[{event_id:eventId,title:'Persisted reviewed headline',text:'The persisted reviewed summary remains unchanged.'}],facts:[{id:'fact-1',field:'revenue',value_raw:'12345678901234567890.12345678',unit:'USD million',period:'Synthetic FY2026',basis:'GAAP',quote:'Synthetic source quote <script>not executable</script>.',event_id:eventId,origin_event_id:eventId,source_url:source,location:'Section 1'}],sections:Array.from({length:12},(_,i)=>({id:`section-${i+1}`,title:`Synthetic section ${i+1}`,location:`normalized:${i+1}`,content:i===0?fullContent:`Full source ${i+1}`,page_start:null,page_end:null})),sections_total:13,next_section_offset:12,events:[eventResource],related:[{...resource,id:'40000000-0000-4000-8000-000000000002',title:'Related synthetic filing'}],counts:{summaries:1,facts:1,events:1,related:1}});
let currentDocument:z.infer<typeof documentDetailSchema>;
let timeline:EventCard[];
beforeEach(()=>{
 vi.clearAllMocks();mocks.historyEnabled=false;mocks.saved=false;mocks.watching=false;mocks.failSave=false;mocks.failLoad=false;mocks.failQuestion=false;mocks.history=[];currentDocument=structuredClone(baseDocument);timeline=[{...event,published_at:new Date(Date.now()-86400000).toISOString()}];
 window.history.replaceState({},'',`/questions?event=${eventId}`);
 Object.defineProperty(HTMLElement.prototype,'scrollIntoView',{configurable:true,value:vi.fn()});
 Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:function(this:HTMLDialogElement){this.setAttribute('open','');}});
 mocks.workspace.mockImplementation(async(_token,req)=>{
  if(req.action==='document_detail'){
   if(mocks.failLoad)throw new Error('Synthetic document denied');
   return documentDetailSchema.parse({...currentDocument,document:{...currentDocument.document,kind:req.p.kind,is_saved:mocks.saved},...(req.p.section_offset?{sections:[{id:'section-13',title:'Synthetic section 13',location:'normalized:13',content:'Last full source section.',page_start:null,page_end:null}],next_section_offset:null}:{})});
  }
  if(req.action==='save'){if(mocks.failSave)throw new Error('Synthetic save denied');mocks.saved=req.p.saved;return {saved:mocks.saved};}
  if(req.action==='visit')return {recorded:true};
  if(req.action==='company')return {company:companyResource,events:[eventResource],documents:[resource],facts:[],watching:mocks.watching,holding:false};
  if(req.action==='catalog')return {items:[companyResource],total:1,counts:{company:1},markets:['NASDAQ'],next_offset:null};
  throw new Error(`Unexpected workspace action ${req.action}`);
 });
 mocks.request.mockImplementation(async(path,_token,_schema,init)=>{
  if(path===`/v1/events/${eventId}`)return detail;
  if(path.startsWith('/v1/feed?'))return {items:[event],total:1,has_more:false,truncated:false,latest_ingested_at:stamp,stale:false,demo_mode:false,generated_at:stamp};
  if(path==='/v1/questions')return mocks.history;
  if(path.endsWith('/questions')){if(mocks.failQuestion)throw new Error('Synthetic question failed');return answerSchema.parse({status:'abstained',message:'Insufficient synthetic evidence.',evidence:[],run_id:null,mode:'extractive'});}
  if(path.includes('/timeline?'))return timeline;
  if(path===`/v1/watchlist/${companyId}`){if(mocks.failSave)throw new Error('Synthetic watch denied');mocks.watching=init.method==='PUT';return undefined;}
  throw new Error(`Unexpected request ${path}`);
 });
});
afterEach(()=>{cleanup();vi.restoreAllMocks();});

describe('mobile document detail uses published document data',()=>{
 it('keeps exact decimal facts, unmodified evidence, and truthful unknown file metadata',async()=>{
  render(<MobileDocument id={documentId}/>);
  await screen.findByRole('heading',{name:resource.title});
  expect(screen.queryByText('PDF')).toBeNull();expect(screen.queryByText(/12\.4\s?MB|32페이지/)).toBeNull();
  expect(screen.getByRole('link',{name:'원문 열기'})).toHaveAttribute('href',source);
  expect(screen.getByText('The persisted reviewed summary remains unchanged.')).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:/매출 12,345,678,901,234,567,890\.12345678 USD million/}));
  const dialog=screen.getByRole('dialog',{name:'매출 · 원문 근거'});
  expect(within(dialog).getByText('Synthetic source quote <script>not executable</script>.')).toBeVisible();
  expect(dialog.querySelector('script')).toBeNull();
  expect(within(dialog).getByRole('link',{name:'공식 원문 열기'})).toHaveAttribute('href',source);
  expect(within(dialog).getByRole('link',{name:'연결된 이벤트 근거'})).toHaveAttribute('href',`/events/${eventId}?panel=evidence`);
  expect(mocks.workspace.mock.calls.some(([,req])=>req.action==='visit')).toBe(false);
 });
 it('loads subsequent real sections and opens the entire stored source without inventing page ranges',async()=>{
  render(<MobileDocument id={documentId}/>);
  fireEvent.click(await screen.findByRole('button',{name:'1. Synthetic section 1 내용 열기'}));
  const dialog=screen.getByRole('dialog',{name:'Synthetic section 1'});
  expect(dialog.querySelector('.m-document-section-content')?.textContent).toBe(fullContent);
  fireEvent.click(within(dialog).getByRole('button',{name:'닫기'}));
  fireEvent.click(screen.getByRole('button',{name:'근거 구간 더 보기'}));
  await screen.findByRole('button',{name:'13. Synthetic section 13 내용 열기'});
  expect(mocks.workspace).toHaveBeenCalledWith('isolated-research-token',{action:'document_detail',p:{id:documentId,kind:'document',section_offset:12}},expect.anything());
  expect(screen.queryByRole('button',{name:'근거 구간 더 보기'})).toBeNull();
  expect(document.querySelectorAll('.m-document-toc>button')).toHaveLength(13);
 });
 it('persists document save state and does not claim success after a denied mutation',async()=>{
  const page=render(<MobileDocument id={documentId} kind="filing"/>);
  fireEvent.click(await screen.findByRole('button',{name:'문서 저장'}));
  expect(screen.getByText('SEC 제출 목록 SHA-256')).toBeInTheDocument();
  expect(screen.queryByText('원문 SHA-256')).toBeNull();
  expect(screen.getByText('a'.repeat(64))).toBeInTheDocument();
  await screen.findByRole('button',{name:'문서 저장 취소'});
  expect(mocks.workspace).toHaveBeenCalledWith('isolated-research-token',{action:'save',p:{id:documentId,kind:'filing',saved:true}},expect.anything());
  page.unmount();render(<MobileDocument id={documentId} kind="filing"/>);
  const saved=await screen.findByRole('button',{name:'문서 저장 취소'});mocks.failSave=true;fireEvent.click(saved);
  expect(await screen.findByRole('alert')).toHaveTextContent('Synthetic save denied');
  expect(saved).toHaveAttribute('aria-pressed','true');expect(mocks.saved).toBe(true);
 });
 it('records opted-in visits, selects the actual published event, and rejects unsafe source URLs',async()=>{
  mocks.historyEnabled=true;currentDocument.document.source_url='javascript:alert(1)';currentDocument.events.push({...eventResource,id:'30000000-0000-4000-8000-000000000002',title:'Second linked published event'});
  render(<MobileDocument id={documentId}/>);
  fireEvent.click(await screen.findByRole('button',{name:'이 문서로 AI에게 질문하기'}));
  expect(screen.queryByRole('link',{name:'원문 열기'})).toBeNull();
  const dialog=screen.getByRole('dialog',{name:'질문할 이벤트 선택'});
  expect(within(dialog).getByRole('link',{name:eventResource.title})).toHaveAttribute('href',`/questions?event=${eventId}`);
  await waitFor(()=>expect(mocks.workspace).toHaveBeenCalledWith('isolated-research-token',{action:'visit',p:{kind:'document',id:documentId}},expect.anything()));
 });
 it('states missing analyses and sections honestly and exposes neither invented AI responses nor an unsupported question link',async()=>{
  currentDocument={...currentDocument,summaries:[],facts:[],sections:[],sections_total:0,next_section_offset:null,events:[],related:[],counts:{summaries:0,facts:0,events:0,related:0}};
  render(<MobileDocument id={documentId}/>);
  await screen.findByText('게시된 요약이 없습니다');
  expect(screen.getByText('공개된 근거 구간이 없습니다')).toBeVisible();
  expect(screen.getByText('질문할 수 있는 게시된 이벤트가 아직 없습니다. 공식 원문을 확인해 주세요.')).toBeVisible();
  expect(screen.queryByRole('link',{name:'이 문서로 AI에게 질문하기'})).toBeNull();
  expect(screen.queryByLabelText('원문에서 확인한 지표')).toBeNull();
 });
 it('does not render private document contents or record a visit when loading is denied',async()=>{
  mocks.failLoad=true;mocks.historyEnabled=true;render(<MobileDocument id={documentId}/>);
  expect(await screen.findByRole('alert')).toHaveTextContent('Synthetic document denied');
  expect(screen.queryByText(resource.title)).toBeNull();
  expect(mocks.workspace.mock.calls.some(([,req])=>req.action==='visit')).toBe(false);
  mocks.failLoad=false;fireEvent.click(screen.getByRole('button',{name:'다시 시도'}));
  await screen.findByRole('heading',{name:resource.title});
 });
});

describe('numbered mobile conversation citations',()=>{
 it('renders every persisted citation with dynamic numbering, exact quotes and safe source links',async()=>{
  const evidence=Array.from({length:12},(_,i)=>({source_id:`source-${i+1}`,quote:`Verbatim synthetic quote ${i+1}.`,source_url:i===11?'javascript:alert(1)':source,location:`Persisted location ${i+1}`}));
  mocks.history=[{id:'saved-answer',event_id:eventId,question:'Stored synthetic question',answer:answerSchema.parse({status:'answered',message:'Stored answer text, without a generated forecast.',evidence,run_id:'synthetic-run',mode:'extractive'}),created_at:stamp}];
  render(<MobileQuestions eventId={eventId}/>);
  await screen.findByText('Stored answer text, without a generated forecast.');
  const answer=screen.getByRole('article',{name:'AI 근거 답변'});
  expect(within(answer).getAllByRole('listitem')).toHaveLength(12);
  expect(answer.querySelectorAll('.m-research-number')[11]).toHaveTextContent('12');
  expect(within(answer).getByText('Verbatim synthetic quote 12.')).toBeVisible();
  expect(within(answer).getAllByRole('link',{name:'원문 근거'})).toHaveLength(11);
  expect(within(answer).getByText('원문 링크 확인 필요')).toBeVisible();
 });
 it('puts a selected evidence prompt into the real composer and retains it after a request failure',async()=>{
  mocks.failQuestion=true;render(<MobileQuestions eventId={eventId}/>);
  const suggestion=screen.getByRole('button',{name:'매출 수치 근거'});await waitFor(()=>expect(suggestion).toBeEnabled());fireEvent.click(suggestion);
  const input=screen.getByLabelText('공시에 관한 질문');expect(input).toHaveValue('매출 수치의 근거를 보여줘');
  fireEvent.click(screen.getByRole('button',{name:'질문 보내기'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Synthetic question failed');expect(input).toHaveValue('매출 수치의 근거를 보여줘');
  expect(mocks.request).toHaveBeenCalledWith(`/v1/events/${eventId}/questions`,'isolated-research-token',expect.anything(),{method:'POST',body:JSON.stringify({question:'매출 수치의 근거를 보여줘'})});
 });
});

describe('timeline filters and persisted analysis',()=>{
 it('orders source dates, calculates real type counts, filters cards and keeps reviewed interpretations separate',async()=>{
  const recent=new Date(Date.now()-86400000).toISOString(),older=new Date(Date.now()-86400000*2).toISOString();
  timeline=[{...event,id:'event-old',headline:'Older product disclosure',event_type:'product',published_at:older,interpretation:null},{...event,headline:'Latest earnings disclosure',published_at:recent}];
  render(<MobileTimeline id={companyId}/>);
  await screen.findByRole('heading',{name:'Latest earnings disclosure'});
  expect(document.querySelector('.m-timeline-item h2')).toHaveTextContent('Latest earnings disclosure');
  expect(screen.getByRole('button',{name:'전체 (2)'})).toHaveAttribute('aria-pressed','true');
  fireEvent.click(screen.getByRole('button',{name:'제품/기술 (1)'}));
  expect(document.querySelectorAll('.m-timeline-item')).toHaveLength(1);expect(screen.queryByRole('heading',{name:'Latest earnings disclosure'})).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'분석 근거 보기'}));
  expect(screen.getByText('선택한 이벤트에 게시된 분석이 없습니다. 이벤트 상세에서 원문 사실을 확인하세요.')).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'전체 (2)'}));
  expect(screen.getByText('Persisted reviewed interpretation only.')).toBeVisible();
 });
 it('uses the existing watchlist mutation and preserves state when removal fails',async()=>{
  render(<MobileTimeline id={companyId}/>);
  fireEvent.click(await screen.findByRole('button',{name:'관심종목'}));
  const watching=await screen.findByRole('button',{name:'관심종목 등록됨'});
  expect(mocks.request).toHaveBeenCalledWith(`/v1/watchlist/${companyId}`,'isolated-research-token',expect.anything(),{method:'PUT'});
  mocks.failSave=true;fireEvent.click(watching);
  expect(await screen.findByRole('alert')).toHaveTextContent('Synthetic watch denied');
  expect(watching).toHaveAttribute('aria-pressed','true');expect(mocks.watching).toBe(true);
 });
});
