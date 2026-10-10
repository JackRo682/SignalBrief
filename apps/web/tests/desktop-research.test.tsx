import '@testing-library/jest-dom/vitest';
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {z} from 'zod';
import {APIError} from '../src/lib/api';
import {pageDataCache} from '../src/lib/page-data-cache';
import {DesktopCompany,DesktopDocument,DesktopEvent,DesktopTimeline} from '../src/desktop/research';
import {defaults,documentDetailSchema,type Resource} from '../src/workspace/contracts';
import {detailSchema,portfolioSchema,type EventCard} from '../src/lib/contracts';

const mocks=vi.hoisted(()=>({workspace:vi.fn(),request:vi.fn(),push:vi.fn(),historyEnabled:false,saved:false,watching:false,failSave:false,failLoad:false,failPosition:false,text:(ko:string)=>ko,date:(value:string|null)=>value??'—'}));
vi.mock('../src/components/auth',()=>({useAuth:()=>({token:'isolated-desktop-research-token',me:{id:'10000000-0000-4000-8000-000000000001'}})}));
vi.mock('../src/workspace/preferences',()=>({usePrefs:()=>({value:{...defaults,history_enabled:mocks.historyEnabled},text:mocks.text,date:mocks.date})}));
vi.mock('../src/workspace/client',()=>({workspace:mocks.workspace}));
vi.mock('../src/workspace/market',()=>({useQuotes:()=>({quotes:[],loading:false,reason:'not_configured'})}));
vi.mock('../src/lib/api',async original=>({...await original<typeof import('../src/lib/api')>(),request:mocks.request}));
vi.mock('next/navigation',()=>({useRouter:()=>({push:mocks.push})}));

// Synthetic responses are isolated test data and are never written to a service.
const companyId='20000000-0000-4000-8000-000000000001',documentId='40000000-0000-4000-8000-000000000001',eventId='30000000-0000-4000-8000-000000000001';
const source='https://www.sec.gov/Archives/edgar/data/1/desktop-fixture.htm',stamp='2026-10-06T08:00:00Z',raw='12345678901234567890.12345678';
const resource:Resource={id:documentId,kind:'document',title:'Synthetic reviewed filing',summary:'Persisted synthetic document summary',company_id:companyId,company_name:'Synthetic Company',ticker:'TEST',market:'NASDAQ',source_url:source,published_at:stamp,publication_precision:'date',category:'10-K',is_saved:false};
const eventResource:Resource={...resource,id:eventId,kind:'event',title:'Synthetic reviewed earnings',category:'earnings'};
const companyResource:Resource={...resource,id:companyId,kind:'company',title:'Synthetic Company'};
const event:EventCard={id:eventId,company:{id:companyId,name:'Synthetic Company',ticker:'TEST',market:'NASDAQ',provider:'sec',is_demo:false,last_ingested_at:null},event_type:'earnings',state:'published',headline:eventResource.title,what_happened:'Persisted source-backed synthetic event.',confidence:.8,materiality:.8,published_at:stamp,publication_precision:'date',is_demo:false,source_tier:1,source_provider:'sec',source_url:source,ranking:{score:.5,version:'synthetic',components:{P:1},effective_weights:{P:1},missing_components:[],reason:'Synthetic ranking',portfolio_weight_method:'membership_only',market_reaction:'unavailable'},change_count:1,fact_summary:'The complete persisted synthetic fact.',change_summary:[{field:'revenue',previous_value:'99.00000001',current_value:raw}],interpretation:'Persisted reviewed interpretation only.',source_document:{id:documentId,title:resource.title,provider:'sec',source_url:source,published_at:stamp}};
const fullQuote='Synthetic quote <script>not executable</script>. '+('Exact source content. '.repeat(100))+'END OF QUOTE';
const fact={id:'fact-current',field:'revenue',quote:fullQuote,chunk_id:'chunk-current',value_raw:raw,unit:'USD million',period:'Synthetic FY2026',scope:'consolidated',basis:'GAAP',validation_status:'valid'};
const evidence={fact_id:fact.id,chunk_id:fact.chunk_id,document_id:documentId,quote:fullQuote,location:'Section 1',source_url:source,source_name:'SEC',source_tier:1,published_at:stamp,publication_precision:'date',is_demo:false,role:'current'};
const baseDetail=detailSchema.parse({event,document:{id:documentId,title:resource.title,provider:'sec',source_url:source,download_url:source,published_at:stamp,publication_date:'2026-10-06',publication_precision:'date',publication_timezone:'UTC',ingested_at:stamp,raw_sha256:'a'.repeat(64),is_demo:false},facts:[fact],changes:[{id:'change-current',field:'revenue',current_fact_id:fact.id,previous_fact_id:'fact-previous',change_type:'numeric',comparison_kind:'year_over_year',previous_value:'99.00000001',current_value:raw,absolute_change:null,percentage_change:null,materiality:.8,confidence:.8}],evidence:[evidence,{...evidence,fact_id:'fact-previous',chunk_id:'chunk-previous',document_id:'40000000-0000-4000-8000-000000000002',quote:'Synthetic previous exact quote 99.00000001.',location:'Prior section',source_url:'https://www.sec.gov/Archives/prior-fixture.htm',published_at:'2025-10-01T00:00:00Z',role:'previous'}],brief:{headline:event.headline,what_happened:event.what_happened,interpretation:event.interpretation,uncertainty:'Synthetic uncertainty remains visible.',monitor_next:'Synthetic next evidence to review.',template_version:'synthetic'},validations:[{claim_key:fact.id,status:'valid',reason:'Synthetic validation',validator_version:'synthetic'}],run:{id:'synthetic-run',stage:'published',model:'synthetic',model_version:null,prompt_version:'synthetic',pipeline_version:'synthetic',status:'completed',latency_ms:null,input_tokens:null,output_tokens:null,cost_usd:null,error_code:null,created_at:stamp,finished_at:stamp,validation_result:{}}});
const fullContent='Full normalized synthetic source.\n'+('Unchanged source section. '.repeat(200))+'END OF SECTION';
const baseDocument=documentDetailSchema.parse({document:resource,metadata:{mime_type:null,size_bytes:null,page_count:null,provider:'sec',publication_timezone:'UTC',ingested_at:stamp,raw_sha256:'a'.repeat(64)},summaries:[{event_id:eventId,title:'Persisted reviewed headline',text:'The persisted reviewed summary remains unchanged.'}],facts:[{...fact,event_id:eventId,origin_event_id:eventId,source_url:source,location:'Section 1'}],sections:Array.from({length:12},(_,i)=>({id:`section-${i+1}`,title:`Synthetic section ${i+1}`,location:`normalized:${i+1}`,content:i===0?fullContent:`Full source ${i+1}`,page_start:null,page_end:null})),sections_total:13,next_section_offset:12,events:[eventResource],related:[{...resource,id:'40000000-0000-4000-8000-000000000002',title:'Related synthetic filing'}],counts:{summaries:1,facts:1,events:1,related:1}});
let currentDocument:z.infer<typeof documentDetailSchema>,timeline:EventCard[];
let holding={quantity:'1.234567890123456789012345678e19',average_cost:'0.00000001',currency:'USD'};
const mount=(node:React.ReactNode)=>render(<div className="sb-pc">{node}</div>);
beforeEach(()=>{
 pageDataCache.reset();vi.clearAllMocks();mocks.historyEnabled=false;mocks.saved=false;mocks.watching=false;mocks.failSave=false;mocks.failLoad=false;mocks.failPosition=false;currentDocument=structuredClone(baseDocument);holding={quantity:'1.234567890123456789012345678e19',average_cost:'0.00000001',currency:'USD'};
 timeline=[{...event,published_at:new Date(Date.now()-86400000).toISOString()},{...event,id:'30000000-0000-4000-8000-000000000002',headline:'Older synthetic product event',event_type:'product',published_at:new Date(Date.now()-90*86400000).toISOString()}];
 window.history.replaceState({},'','/today');Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:function(this:HTMLDialogElement){this.setAttribute('open','');}});
 mocks.workspace.mockImplementation(async(_token,req)=>{
  if(req.action==='document_detail'){if(mocks.failLoad)throw new Error('Synthetic detail denied');return documentDetailSchema.parse({...currentDocument,document:{...currentDocument.document,kind:req.p.kind,is_saved:mocks.saved},...(req.p.section_offset?{sections:[currentDocument.sections[11],{id:'section-13',title:'Synthetic section 13',location:'normalized:13',content:'Last full source section.',page_start:null,page_end:null}],next_section_offset:null}:{})});}
  if(req.action==='resource')return {...eventResource,is_saved:mocks.saved};
  if(req.action==='save'){if(mocks.failSave)throw new Error('Synthetic save denied');mocks.saved=req.p.saved;return {saved:mocks.saved};}
  if(req.action==='visit')return {recorded:true};
  if(req.action==='company')return {company:companyResource,events:[{...eventResource,is_saved:mocks.saved}],documents:[resource],facts:currentDocument.facts,watching:mocks.watching,holding:true};
  if(req.action==='catalog')return {items:[companyResource],total:1,counts:{company:1},markets:['NASDAQ'],next_offset:null};
  throw new Error(`Unexpected workspace action ${req.action}`);
 });
 mocks.request.mockImplementation(async(path,_token,_schema,init)=>{
  if(path===`/v1/events/${eventId}`){if(mocks.failLoad)throw new APIError(403,'synthetic_detail_denied');return baseDetail;}
  if(path.includes('/timeline?'))return timeline;if(path.startsWith('/v1/calendar?'))return [];
  if(path===`/v1/watchlist/${companyId}`){if(mocks.failSave)throw new Error('Synthetic watch denied');mocks.watching=init.method==='PUT';return undefined;}
  if(path==='/v1/portfolio')return portfolioSchema.parse({id:'synthetic-portfolio',name:'Synthetic portfolio',weighting_note:'Synthetic exact quantities',positions:[{id:'synthetic-position',company:event.company,...holding}]});
  if(path===`/v1/portfolio/positions/${companyId}`){if(mocks.failPosition)throw new Error('Synthetic holding denied');holding=JSON.parse(init.body);return undefined;}
  throw new Error(`Unexpected request ${path}`);
 });
});
afterEach(()=>{cleanup();vi.restoreAllMocks();});

describe('desktop company and timeline',()=>{
 it('prefills exponent amounts exactly and keeps a denied edit until the API saves it',async()=>{
  mount(<DesktopCompany id={companyId}/>);fireEvent.click(await screen.findByRole('button',{name:'보유 정보 수정'}));
  const dialog=screen.getByRole('dialog',{name:'보유 정보 입력'}),quantity=await within(dialog).findByLabelText('보유 수량');expect(quantity).toHaveValue(raw);expect(within(dialog).getByLabelText('평균 단가 (선택)')).toHaveValue('0.00000001');
  fireEvent.change(quantity,{target:{value:'99999999999999999999.12345678'}});mocks.failPosition=true;fireEvent.click(within(dialog).getByRole('button',{name:'저장'}));expect(await within(dialog).findByRole('alert')).toHaveTextContent('Synthetic holding denied');expect(quantity).toHaveValue('99999999999999999999.12345678');
  mocks.failPosition=false;fireEvent.click(within(dialog).getByRole('button',{name:'저장'}));await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());expect(holding).toEqual({quantity:'99999999999999999999.12345678',average_cost:'0.00000001',currency:'USD'});expect(screen.getByText('12,345,678,901,234,567,890.12345678')).toBeVisible();
 });
 it('does not mark denied watch as success and persists actual monitoring bookmarks',async()=>{
  const page=mount(<DesktopCompany id={companyId}/>),watch=await screen.findByRole('button',{name:'관심종목'});mocks.failSave=true;fireEvent.click(watch);expect(await screen.findByRole('alert')).toHaveTextContent('Synthetic watch denied');expect(watch).toHaveAttribute('aria-pressed','false');
  mocks.failSave=false;fireEvent.click(watch);await waitFor(()=>expect(screen.getByRole('button',{name:'관심종목'})).toHaveAttribute('aria-pressed','true'));
  const monitoring=screen.getByRole('checkbox',{name:eventResource.title+' 모니터링 저장'});fireEvent.click(monitoring);await waitFor(()=>expect(monitoring).toHaveAttribute('aria-checked','true'));page.unmount();mount(<DesktopCompany id={companyId}/>);expect(await screen.findByRole('checkbox',{name:eventResource.title+' 모니터링 저장'})).toHaveAttribute('aria-checked','true');expect(screen.getByText('연결된 시세가 없습니다.')).toBeVisible();expect(screen.queryByText(/PER|시가총액/)).toBeNull();
 });
 it('filters actual dated events by date and type, preserving navigation semantics',async()=>{
  mount(<DesktopTimeline companyId={companyId}/>);await screen.findByRole('heading',{name:event.headline});expect(document.querySelectorAll('.pc-timeline-item')).toHaveLength(2);
  fireEvent.click(within(screen.getByRole('group',{name:'이벤트 유형'})).getByRole('button',{name:'제품 (1)'}));expect(document.querySelectorAll('.pc-timeline-item')).toHaveLength(1);expect(screen.getByRole('heading',{name:'Older synthetic product event'})).toBeVisible();
  fireEvent.change(screen.getByLabelText('타임라인 시작일'),{target:{value:new Date(Date.now()-30*86400000).toISOString().slice(0,10)}});fireEvent.click(screen.getByRole('button',{name:'기간 적용'}));await screen.findByRole('heading',{name:event.headline});expect(document.querySelectorAll('.pc-timeline-item')).toHaveLength(1);expect(screen.queryByRole('heading',{name:'Older synthetic product event'})).toBeNull();
  fireEvent.change(screen.getByRole('combobox',{name:'타임라인 기업 선택'}),{target:{value:''}});expect(mocks.push).toHaveBeenCalledWith('/timeline');expect(screen.getByRole('link',{name:'주가 차트'})).toHaveAttribute('href',`/companies/${companyId}?tab=chart`);
 });
});

describe('desktop event and source lineage',()=>{
 it('shows exact comparisons and the entire unmodified source quote',async()=>{
  mount(<DesktopEvent id={eventId}/>);await screen.findByRole('heading',{name:event.headline});expect(screen.getByText('99.00000001')).toBeVisible();expect(screen.getByText('Synthetic uncertainty remains visible.')).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'매출 12,345,678,901,234,567,890.12345678 USD million · Synthetic FY2026 · GAAP'}));const dialog=screen.getByRole('dialog',{name:'원문 근거'});expect(dialog.querySelector('blockquote')?.textContent).toBe(fullQuote);expect(dialog.querySelector('script')).toBeNull();expect(within(dialog).getByRole('link',{name:'공식 원문 열기'})).toHaveAttribute('href',source);expect(mocks.workspace.mock.calls.some(([,req])=>req.action==='visit')).toBe(false);
 });
 it('persists event save, honors history consent and distinguishes previous evidence',async()=>{
  mocks.historyEnabled=true;const page=mount(<DesktopEvent id={eventId}/>);fireEvent.click(await screen.findByRole('button',{name:'이벤트 저장'}));await screen.findByRole('button',{name:'이벤트 저장 취소'});await waitFor(()=>expect(mocks.workspace.mock.calls.some(([,req])=>req.action==='visit'&&req.p.id===eventId)).toBe(true));page.unmount();mount(<DesktopEvent id={eventId} panel="evidence"/>);
  await screen.findByRole('heading',{name:'근거 / 출처'});expect(document.querySelectorAll('.pc-evidence-source')).toHaveLength(2);fireEvent.change(screen.getByLabelText('근거 시점 필터'),{target:{value:'previous'}});expect(document.querySelectorAll('.pc-evidence-source')).toHaveLength(1);expect(screen.getByText('Synthetic previous exact quote 99.00000001.')).toBeVisible();expect(document.querySelectorAll('.pc-evidence-claim')).toHaveLength(1);expect(within(document.querySelector('.pc-evidence-claim') as HTMLElement).getByRole('button',{name:'SEC · Prior section'})).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'인용 전문 보기'}));const dialog=screen.getByRole('dialog',{name:'원문 근거'});expect(within(dialog).getByRole('link',{name:'공식 원문 열기'})).toHaveAttribute('href','https://www.sec.gov/Archives/prior-fixture.htm');expect(within(dialog).queryByText('a'.repeat(64))).toBeNull();
 });
 it('does not reveal or record a visit to denied detail content',async()=>{
  mocks.failLoad=true;mocks.historyEnabled=true;mount(<DesktopEvent id={eventId}/>);expect(await screen.findByRole('alert')).toHaveTextContent('이 작업에 접근할 권한이 없습니다.');expect(screen.queryByRole('heading',{name:event.headline})).toBeNull();expect(mocks.workspace.mock.calls.some(([,req])=>req.action==='visit')).toBe(false);
 });
});

describe('desktop document data and mutations',()=>{
 it('keeps full source text and exact metrics while deduplicating subsequent sections',async()=>{
  mount(<DesktopDocument id={documentId}/>);await screen.findByRole('heading',{name:resource.title});expect(screen.queryByText('PDF')).toBeNull();expect(document.querySelectorAll('.pc-document-toc>button')).toHaveLength(4);
  fireEvent.click(screen.getByRole('button',{name:'1. Synthetic section 1 내용 열기'}));const dialog=screen.getByRole('dialog',{name:'Synthetic section 1'});expect(dialog.querySelector('.pc-document-section-content')?.textContent).toBe(fullContent);fireEvent.click(within(dialog).getByRole('button',{name:'닫기'}));
  fireEvent.click(screen.getByRole('button',{name:'목차 전체 보기 ›'}));expect(document.querySelectorAll('.pc-document-toc>button')).toHaveLength(12);fireEvent.click(screen.getByRole('button',{name:'근거 구간 더 보기'}));await screen.findByRole('button',{name:'13. Synthetic section 13 내용 열기'});expect(document.querySelectorAll('.pc-document-toc>button')).toHaveLength(13);expect(mocks.workspace).toHaveBeenCalledWith('isolated-desktop-research-token',{action:'document_detail',p:{id:documentId,kind:'document',section_offset:12}},expect.anything());
  fireEvent.click(screen.getByRole('button',{name:'매출 12,345,678,901,234,567,890.12345678 USD million · Synthetic FY2026 · GAAP'}));const factDialog=screen.getByRole('dialog',{name:'매출 · 원문 근거'});expect(factDialog.querySelector('blockquote')?.textContent).toBe(fullQuote);expect(within(factDialog).getByRole('link',{name:'연결된 이벤트 근거'})).toHaveAttribute('href',`/events/${eventId}?panel=evidence`);
 });
 it('preserves filing checksum scope and saves only after a successful backend response',async()=>{
  const page=mount(<DesktopDocument id={documentId} kind="filing"/>);fireEvent.click(await screen.findByRole('button',{name:'문서 저장'}));await screen.findByRole('button',{name:'문서 저장 취소'});expect(screen.getByText('SEC 제출 목록 SHA-256')).toBeInTheDocument();expect(screen.queryByText('원문 SHA-256')).toBeNull();page.unmount();mount(<DesktopDocument id={documentId} kind="filing"/>);
  const save=await screen.findByRole('button',{name:'문서 저장 취소'});mocks.failSave=true;fireEvent.click(save);expect(await screen.findByRole('alert')).toHaveTextContent('Synthetic save denied');expect(save).toHaveAttribute('aria-pressed','true');expect(mocks.saved).toBe(true);
 });
 it('does not fabricate absent file metadata, sections, summaries, or unsupported AI links',async()=>{
  currentDocument={...currentDocument,document:{...resource,source_url:'javascript:alert(1)'},summaries:[],facts:[],sections:[],sections_total:0,next_section_offset:null,events:[],related:[],counts:{summaries:0,facts:0,events:0,related:0}};mount(<DesktopDocument id={documentId}/>);await screen.findByText('게시된 요약이 없습니다');expect(screen.getByText('공개된 근거 구간이 없습니다')).toBeVisible();expect(screen.queryByRole('link',{name:'원문 보기'})).toBeNull();expect(screen.queryByRole('link',{name:'AI에게 질문하기'})).toBeNull();expect(screen.getByText('질문할 수 있는 게시된 이벤트가 아직 없습니다. 공식 원문을 확인해 주세요.')).toBeVisible();expect(screen.queryByText('PDF')).toBeNull();expect(document.querySelectorAll('a[href^="javascript:"]')).toHaveLength(0);
 });
});
