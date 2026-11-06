import '@testing-library/jest-dom/vitest';
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import Saved from '../src/redesign/saved';
import AnalysisDetail from '../src/redesign/analysis';
import {SaveButton} from '../src/redesign/ui';
import {defaults,resourceHref,type Resource,type WorkspaceRequest} from '../src/workspace/contracts';

const session=vi.hoisted(()=>({token:'synthetic-saved-owner-a',fetch:vi.fn(),rpc:vi.fn(),savePrefs:vi.fn()}));
vi.mock('@/components/auth',()=>({useAuth:()=>({token:session.token,me:{id:session.token}})}));
vi.mock('@/workspace/preferences',()=>({usePrefs:()=>({value:{...defaults,locale:'en'},text:(_ko:string,en:string)=>en,date:(value:string|null)=>value??'Unknown',save:session.savePrefs})}));
vi.mock('@/lib/supabase',()=>({initializeSupabase:async()=>({rpc:session.rpc,from:()=>{throw new Error('Unexpected calendar data request');}})}));
vi.mock('next/navigation',()=>({useRouter:()=>({push:vi.fn(),replace:vi.fn()}),useSearchParams:()=>new URLSearchParams(window.location.search),usePathname:()=>'/saved'}));

const companyId='20000000-0000-4000-8000-000000000011';
const company:Resource={id:companyId,kind:'company',title:'Synthetic saved issuer',summary:'',company_id:companyId,company_name:'Synthetic saved issuer',ticker:'TEST',market:'NASDAQ',source_url:null,published_at:null,publication_precision:'date',category:'company',is_saved:false};
const source='https://www.sec.gov/Archives/edgar/data/11/synthetic-saved.htm';
const secFiling:Resource={...company,id:'40000000-0000-4000-8000-000000000011',kind:'filing',title:'Synthetic SEC filing',category:'10-Q',source_url:source,published_at:'2026-10-31',provider:'sec'};
const dartFiling:Resource={...secFiling,id:'40000000-0000-4000-8000-000000000012',title:'Synthetic DART filing',category:'DART',provider:'dart',source_url:'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20261031000011'};
const secAnalysis:Resource={...secFiling,kind:'us_analysis',filing_id:secFiling.id,title:'Synthetic SEC approved analysis',coverage:'excerpt',reviewed_at:'2026-10-31T08:00:00Z'};
const dartAnalysis:Resource={...dartFiling,kind:'dart_analysis',filing_id:dartFiling.id,title:'Synthetic DART approved analysis',coverage:'excerpt',reviewed_at:'2026-10-31T08:00:00Z'};
const legacyDocument:Resource={...secFiling,id:'40000000-0000-4000-8000-000000000013',kind:'document',title:'Synthetic reviewed document'};
const reviewedEvent:Resource={...secFiling,id:'30000000-0000-4000-8000-000000000011',kind:'event',title:'Synthetic reviewed change analysis',coverage:'event'};
const resources=[secFiling,dartFiling,secAnalysis,dartAnalysis,legacyDocument,reviewedEvent];
const key=(item:Pick<Resource,'id'|'kind'>)=>`${item.kind}:${item.id}`;
let records:Map<string,Set<string>>,failRead:boolean,failWrite:boolean,saveGate:Promise<void>|null;
function owned(token=session.token){if(!records.has(token))records.set(token,new Set());return records.get(token)!;}
function resource(item:Resource,token:string){return {...item,is_saved:owned(token).has(key(item))};}
function section(id:string){return within(document.getElementById(`rd-saved-${id}`)!);}
const labels={analysis:'저장한 분석',document:'북마크 문서',event:'저장한 일정',history:'최근 본 항목'} as const;
function selectTab(id:keyof typeof labels){fireEvent.click(screen.getByRole('tab',{name:labels[id]}));}

beforeEach(()=>{
 window.history.replaceState(null,'','/saved');
 vi.clearAllMocks();session.token='synthetic-saved-owner-a';records=new Map();failRead=failWrite=false;saveGate=null;
 session.rpc.mockImplementation((name:string,{p}:{p:{action:string}})=>{
  expect(name).toBe('sb_reference_reminders');expect(p.action).toBe('list');
  return {abortSignal:async()=>({data:[],error:null})};
 });
 session.fetch.mockImplementation(async(input:RequestInfo|URL,init?:RequestInit)=>{
  expect(input).toBe('/api/workspace');expect(init?.method).toBe('POST');
  const token=new Headers(init?.headers).get('Authorization')?.replace(/^Bearer /,'')??'';
  expect(['synthetic-saved-owner-a','synthetic-saved-owner-b']).toContain(token);
  const req=JSON.parse(String(init?.body)) as WorkspaceRequest;
  if(req.action==='saved_list'){
   if(failRead&&req.p.kind!=='history')return Response.json({error:{code:'temporarily_unavailable'}},{status:503});
   const all=resources.filter(item=>owned(token).has(key(item)));
   const items=req.p.kind==='history'?[]:all.filter(item=>(!req.p.company||item.company_id===req.p.company)&&(!req.p.q||item.title.toLowerCase().includes(req.p.q.toLowerCase()))).map(item=>resource(item,token));
   return Response.json({items,counts:{analysis:all.filter(x=>x.kind.endsWith('analysis')).length,event:all.filter(x=>x.kind==='event').length,document:all.filter(x=>['filing','document'].includes(x.kind)).length,history:0}});
  }
  if(req.action==='catalog')return Response.json({items:[company],total:1,counts:{company:1},markets:['NASDAQ'],categories:[],next_offset:null});
  if(req.action==='save'){
   if(saveGate)await saveGate;
   if(failWrite)return Response.json({error:{code:'permission_denied'}},{status:403});
   const selected=resources.find(x=>x.id===req.p.id&&x.kind===req.p.kind);
   expect(selected).toBeDefined();
   if(req.p.saved)owned(token).add(key(selected!));else owned(token).delete(key(selected!));
   return Response.json({saved:req.p.saved});
  }
  if(req.action==='document_detail'){
   const document=resources.find(x=>x.id===req.p.id&&x.kind===req.p.kind)!;
   expect(document).toBeDefined();
   const analyses=resources.filter(x=>x.filing_id===document.id&&x.kind.endsWith('analysis'));
   return Response.json({document:resource(document,token),approved_analyses:analyses.map(item=>({resource:resource(item,token),analysis:{filing_id:document.id,status:'approved',created_at:'2026-10-31T07:00:00Z',reviewed_at:'2026-10-31T08:00:00Z',result:{claims:[{text:'Synthetic supported claim',quote:'Synthetic original source quotation'}],source_url:document.source_url,uncertainty:'Synthetic source only',validation:'quote_substring_and_numeric_check',coverage:'excerpt'}}})),metadata:{mime_type:null,size_bytes:null,page_count:null,provider:document.provider??'sec',publication_timezone:'UTC',ingested_at:null,raw_sha256:null},summaries:[],facts:[],sections:[],sections_total:0,next_section_offset:null,events:[],related:[],counts:{summaries:0,facts:0,events:0,related:0}});
  }
  if(req.action==='company')return Response.json({company,documents:[secFiling,dartFiling],analyses:[secAnalysis,dartAnalysis],events:[],facts:[],watching:false,holding:false});
  throw new Error(`Unexpected workspace action: ${req.action}`);
 });
 vi.stubGlobal('fetch',session.fetch);
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});

describe('saved-resource journey uses canonical identities and owned responses',()=>{
 it.each(resources)('persists $kind $title from the source button, lists it in its proper section, and removes it durably',async item=>{
  const sourceView=render(<SaveButton item={item}/>);
  fireEvent.click(screen.getByRole('button',{name:`${item.title} 저장`}));
  expect(await screen.findByRole('button',{name:`${item.title} 저장 취소`})).toHaveAttribute('aria-pressed','true');
  expect([...owned()]).toEqual([key(item)]);sourceView.unmount();
  const savedView=render(<Saved/>);
  const expectedSection=item.kind==='event'||item.kind.endsWith('analysis')?'analysis':'document';
  selectTab(expectedSection);
  expect(await section(expectedSection).findByRole('link',{name:item.title})).toHaveAttribute('href',resourceHref(item));
  if(item.kind==='event')expect(section('event').queryByRole('link',{name:item.title})).not.toBeInTheDocument();
  fireEvent.click(section(expectedSection).getByRole('button',{name:`${item.title} 저장 취소`}));
  await waitFor(()=>expect(screen.queryByRole('link',{name:item.title})).not.toBeInTheDocument());
  expect(owned().size).toBe(0);savedView.unmount();render(<Saved/>);
  await section(expectedSection).findByText(expectedSection==='analysis'?'저장한 분석이 없습니다.':'북마크한 문서가 없습니다.');
  expect(screen.queryByRole('link',{name:item.title})).not.toBeInTheDocument();
  expect(session.savePrefs).not.toHaveBeenCalled();
 });

 it('offers direct browse actions for a genuinely empty account without enabling or recording history',async()=>{
  render(<Saved/>);
  expect(await screen.findByRole('link',{name:'분석 찾아보기'})).toHaveAttribute('href','/search?kind=analysis');
  selectTab('document');
  expect(screen.getByRole('link',{name:'공시 찾아보기'})).toHaveAttribute('href','/search?kind=filing');
  selectTab('event');
  expect(await screen.findByRole('link',{name:'캘린더 열기'})).toHaveAttribute('href','/calendar');
  selectTab('history');
  expect(screen.getByText(/방문 기록 저장이 꺼져 있습니다/)).toBeVisible();
  expect(session.savePrefs).not.toHaveBeenCalled();
  expect(session.fetch.mock.calls.every(([,init])=>['saved_list','catalog'].includes(JSON.parse(String(init?.body)).action))).toBe(true);
 });

 it('distinguishes filtered emptiness and restores the persisted bookmarks when filters are cleared',async()=>{
  owned().add(key(secAnalysis));render(<Saved/>);
  await screen.findByRole('link',{name:secAnalysis.title});
  fireEvent.change(screen.getByLabelText('저장 항목 키워드'),{target:{value:'no synthetic match'}});
  fireEvent.click(screen.getByRole('button',{name:'검색'}));
  await screen.findByText('조건에 맞는 저장한 분석이 없습니다.');
  fireEvent.click(screen.getByRole('button',{name:'저장 필터 초기화'}));
  expect(await screen.findByRole('link',{name:secAnalysis.title})).toBeVisible();
  expect(screen.getByLabelText('저장 항목 키워드')).toHaveValue('');expect(owned().size).toBe(1);
 });

 it('keeps a failed save unselected and retries the same identity only after the server accepts it',async()=>{
  failWrite=true;render(<SaveButton item={dartAnalysis}/>);
  fireEvent.click(screen.getByRole('button',{name:`${dartAnalysis.title} 저장`}));
  expect(await screen.findByRole('alert')).toBeVisible();
  expect(screen.getByRole('button',{name:`${dartAnalysis.title} 저장`})).toHaveAttribute('aria-pressed','false');expect(owned().size).toBe(0);
  failWrite=false;fireEvent.click(screen.getByRole('button',{name:`${dartAnalysis.title} 저장`}));
  await screen.findByRole('button',{name:`${dartAnalysis.title} 저장 취소`});expect([...owned()]).toEqual([key(dartAnalysis)]);
 });

 it('shows a failed list request as an error and recovers on retry without a false empty result',async()=>{
  owned().add(key(secFiling));failRead=true;render(<Saved/>);
  const error=await screen.findByRole('alert');
  expect(screen.queryByText('북마크한 문서가 없습니다.')).not.toBeInTheDocument();
  failRead=false;fireEvent.click(within(error).getByRole('button',{name:'Retry'}));
  selectTab('document');
  expect(await screen.findByRole('link',{name:secFiling.title})).toBeVisible();
 });

 it.each([secFiling,secAnalysis,dartAnalysis])('restores $kind saved state on detail reload and shows the identical resource in Saved',async item=>{
  const props={id:item.filing_id??item.id,kind:'filing',...(item.kind==='us_analysis'?{analysis:'us'}:item.kind==='dart_analysis'?{analysis:'dart'}:{})};
  const first=render(<AnalysisDetail {...props}/>);
  fireEvent.click(await screen.findByRole('button',{name:'Save'}));
  expect(await screen.findByRole('button',{name:'Saved'})).toHaveAttribute('aria-pressed','true');
  expect([...owned()]).toEqual([key(item)]);first.unmount();
  const reloaded=render(<AnalysisDetail {...props}/>);
  expect(await screen.findByRole('button',{name:'Saved'})).toHaveAttribute('aria-pressed','true');
  reloaded.unmount();render(<Saved/>);
  selectTab(item.kind==='filing'?'document':'analysis');
  expect(await screen.findByRole('link',{name:item.title})).toHaveAttribute('href',resourceHref(item));
 });

 it('does not carry a detail saved state into another authenticated account',async()=>{
  const page=render(<AnalysisDetail id={secFiling.id} kind="filing" analysis="us"/>);
  fireEvent.click(await screen.findByRole('button',{name:'Save'}));
  await screen.findByRole('button',{name:'Saved'});
  session.token='synthetic-saved-owner-b';page.rerender(<AnalysisDetail id={secFiling.id} kind="filing" analysis="us"/>);
  expect(await screen.findByRole('button',{name:'Save'})).toHaveAttribute('aria-pressed','false');
  expect(owned().size).toBe(0);expect(owned('synthetic-saved-owner-a').size).toBe(1);
 });

 it('scopes a source save button to its current authenticated account and resource',async()=>{
  const page=render(<SaveButton item={secAnalysis}/>);
  fireEvent.click(screen.getByRole('button',{name:`${secAnalysis.title} 저장`}));
  await screen.findByRole('button',{name:`${secAnalysis.title} 저장 취소`});
  session.token='synthetic-saved-owner-b';page.rerender(<SaveButton item={secAnalysis}/>);
  expect(await screen.findByRole('button',{name:`${secAnalysis.title} 저장`})).toHaveAttribute('aria-pressed','false');
  fireEvent.click(screen.getByRole('button',{name:`${secAnalysis.title} 저장`}));
  await screen.findByRole('button',{name:`${secAnalysis.title} 저장 취소`});
  page.rerender(<SaveButton item={dartAnalysis}/>);
  expect(await screen.findByRole('button',{name:`${dartAnalysis.title} 저장`})).toHaveAttribute('aria-pressed','false');
  expect([...owned()]).toEqual([key(secAnalysis)]);expect([...owned('synthetic-saved-owner-a')]).toEqual([key(secAnalysis)]);
 });

 it.each(['source','detail'] as const)('ignores an old account save response arriving after an account change in the %s view',async view=>{
  let finish!:()=>void;saveGate=new Promise<void>(resolve=>{finish=resolve;});
  const component=()=>view==='source'?<SaveButton item={secAnalysis}/>:<AnalysisDetail id={secFiling.id} kind="filing" analysis="us"/>;
  const label=view==='source'?`${secAnalysis.title} 저장`:'Save';
  const page=render(component());fireEvent.click(await screen.findByRole('button',{name:label}));
  await waitFor(()=>expect(session.fetch.mock.calls.some(([,init])=>JSON.parse(String(init?.body)).action==='save')).toBe(true));
  session.token='synthetic-saved-owner-b';page.rerender(component());
  await screen.findByRole('button',{name:label});finish();
  await waitFor(()=>expect(screen.getByRole('button',{name:label})).toBeEnabled());
  expect(screen.getByRole('button',{name:label})).toHaveAttribute('aria-pressed','false');
  expect(owned().size).toBe(0);expect([...owned('synthetic-saved-owner-a')]).toEqual([key(secAnalysis)]);
 });
});
