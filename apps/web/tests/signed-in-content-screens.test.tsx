import '@testing-library/jest-dom/vitest';
import {render,screen,fireEvent,cleanup,within,waitFor} from '@testing-library/react';
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {SignedInHome} from '../src/components/signed-in-home';
import {CompanyWorkspace} from '../src/components/company-workspace';
import {ApprovedDocumentAnalyses} from '../src/components/approved-document-analyses';
import {FilingAnalysis} from '../src/components/filing-analysis';
import {defaults,type Resource,sourceOverviewSchema,companyDetailSchema,approvedFilingAnalysisSchema} from '../src/workspace/contracts';
const mocks=vi.hoisted(()=>({data:vi.fn(),reload:vi.fn(),push:vi.fn(),workspace:vi.fn(),request:vi.fn()}));
vi.mock('next/navigation',()=>({useRouter:()=>({push:mocks.push})}));
vi.mock('@/components/auth',()=>({useAuth:()=>({token:'test-content-token',me:{id:'owner',display_name:'Reader'}})}));
vi.mock('@/workspace/preferences',()=>({usePrefs:()=>({text:(_ko:string,en:string)=>en,date:(s:string|null)=>s??'Unavailable',value:{...defaults,locale:'en'}})}));
vi.mock('@/workspace/ui',async original=>({...await original<typeof import('../src/workspace/ui')>(),useData:(req:unknown)=>mocks.data(req)}));
vi.mock('@/workspace/client',()=>({workspace:(...args:unknown[])=>mocks.workspace(...args)}));
vi.mock('@/lib/api',async original=>({...await original<typeof import('../src/lib/api')>(),request:(...args:unknown[])=>mocks.request(...args)}));
vi.mock('@/components/company-profile',()=>({default:()=>null}));
vi.mock('@/components/company-news',()=>({CompanyNews:({companyId}:{companyId:string})=><p>News for {companyId}</p>}));
const companyId='22000000-0000-4000-8000-000000000001',filingId='33000000-0000-4000-8000-000000000001';
const company:Resource={id:companyId,kind:'company',company_id:companyId,company_name:'Synthetic Apple',title:'Synthetic Apple',ticker:'AAPL',market:'NASDAQ',source_url:null,published_at:null,publication_precision:'date',summary:'',category:'',is_saved:false};
const filing:Resource={...company,id:filingId,kind:'filing',title:'Synthetic official filing',source_url:'https://www.sec.gov/Archives/synthetic',published_at:'2026-05-01T00:00:00Z',category:'10-Q'};
const analysis:Resource={...filing,kind:'us_analysis',title:'Synthetic approved analysis',reviewed_at:'2026-10-31T08:00:00Z',coverage:'excerpt',filing_id:filingId};
const approved=approvedFilingAnalysisSchema.parse({resource:analysis,analysis:{filing_id:filingId,status:'approved',created_at:'2026-10-30T08:00:00Z',reviewed_at:analysis.reviewed_at,result:{claims:[{text:'Synthetic supported claim',quote:'Synthetic exact quotation'}],source_url:filing.source_url,uncertainty:'Limited to this excerpt.',validation:'quote_substring_and_numeric_check',coverage:'excerpt'}}});
let overview=sourceOverviewSchema.parse({companies:1,filing_count:1,published_count:1,filings:[filing],historical_events:[],calendar:[],analyses:[analysis],scope:'all',following_count:0,fallback_to_all:true,saved_count:2,unread_count:3});
let detail=companyDetailSchema.parse({company,events:[],documents:[filing],analyses:[analysis],facts:[],watching:false,holding:false});
let failed=false;
beforeEach(()=>{
 vi.clearAllMocks();window.history.replaceState({},'','/today');failed=false;
 overview=sourceOverviewSchema.parse({companies:1,filing_count:1,published_count:1,filings:[filing],historical_events:[],calendar:[],analyses:[analysis],scope:'all',following_count:0,fallback_to_all:true,saved_count:2,unread_count:3});
 detail=companyDetailSchema.parse({company,events:[],documents:[filing],analyses:[analysis],facts:[],watching:false,holding:false});
 mocks.workspace.mockResolvedValue({saved:true});mocks.request.mockResolvedValue({});
 mocks.data.mockImplementation((req:{action:string;p:Record<string,unknown>}|null)=>({data:req?.action==='source_overview'?(failed?null:overview):req?.action==='company'?detail:req?.action==='catalog'?{items:[company],total:1,counts:{company:1},markets:['NASDAQ'],next_offset:null}:null,loading:false,error:failed&&req?.action==='source_overview'?'Synthetic outage':'',reload:mocks.reload}));
});
afterEach(cleanup);
describe('signed-in content workspace',()=>{
 it('shows real zero/counts, new-account general content, and distinct source and review dates',()=>{
  render(<SignedInHome/>);const summary=screen.getByRole('region',{name:'Your monitoring overview'});
  expect(within(summary).getByText('0')).toBeVisible();expect(within(summary).getByText('2')).toBeVisible();expect(within(summary).getByText('3')).toBeVisible();
  expect(screen.getByText(/because you have not followed any yet/)).toBeVisible();expect(screen.getByRole('button',{name:'Following'})).toBeDisabled();
  expect(screen.getByText('Synthetic official filing')).toBeVisible();expect(screen.getByText('Synthetic approved analysis')).toBeVisible();
  expect(screen.getByText(/2026-10-31T08:00:00Z/)).toBeVisible();expect(screen.getAllByText('2026-05-01T00:00:00Z').length).toBeGreaterThan(0);
  expect(screen.queryByText(/Market indices|Portfolio valuation|gainers/)).not.toBeInTheDocument();
 });
 it('opens company-only search and updates scope/date requests',()=>{
  render(<SignedInHome mobile/>);fireEvent.change(screen.getByRole('textbox',{name:'Search company name or identifier'}),{target:{value:'애플'}});fireEvent.click(screen.getByRole('button',{name:'Find company'}));expect(mocks.push).toHaveBeenCalledWith('/search?kind=company&q=%EC%95%A0%ED%94%8C');
  fireEvent.change(screen.getByLabelText('Source date range'),{target:{value:'30'}});expect(mocks.data).toHaveBeenCalledWith({action:'source_overview',p:{scope:'following',days:30}});
 });
 it('does not turn load errors into zero metrics',()=>{
  failed=true;render(<SignedInHome/>);const summary=screen.getByRole('region',{name:'Your monitoring overview'});expect(within(summary).getAllByText('Unavailable')).toHaveLength(3);expect(within(summary).queryByText('0')).not.toBeInTheDocument();
 });
 it('provides five company tabs and a real follow operation, without portfolio or chart controls',async()=>{
  render(<CompanyWorkspace id={companyId}/>);expect(screen.getAllByRole('tab').map(item=>item.textContent)).toEqual(['Overview','Disclosures','Analyses','News','Events']);
  expect(screen.queryByRole('button',{name:/portfolio|chart/i})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Follow company'}));await waitFor(()=>expect(mocks.request).toHaveBeenCalledWith(`/v1/watchlist/${companyId}`,'test-content-token',expect.anything(),expect.objectContaining({method:'PUT'})));
  fireEvent.click(screen.getByRole('tab',{name:'Analyses'}));expect(screen.getByText('Synthetic approved analysis')).toBeVisible();expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby',`company-tab-${companyId}-analyses`);
  fireEvent.keyDown(screen.getByRole('tab',{name:'Analyses'}),{key:'ArrowRight'});expect(screen.getByRole('tab',{name:'News'})).toHaveAttribute('aria-selected','true');expect(screen.getByText(`News for ${companyId}`)).toBeVisible();
 });
 it('saves analysis using the canonical filing ID and displays the stored quotations',async()=>{
  render(<ApprovedDocumentAnalyses entries={[approved]}/>);expect(screen.getByText('Synthetic exact quotation')).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'Synthetic approved analysis Save'}));await waitFor(()=>expect(mocks.workspace).toHaveBeenCalledWith('test-content-token',{action:'save',p:{kind:'us_analysis',id:filingId,saved:true}},expect.anything()));expect(screen.getByRole('button',{name:'Synthetic approved analysis Unsave'})).toHaveAttribute('aria-pressed','true');
 });
 it('never displays a draft on the approved-only customer view, even with admin=true',()=>{
  render(<FilingAnalysis value={{...approved.analysis,status:'needs_review'}} admin busy={false} approvedOnly onReview={async()=>{}}/>);expect(screen.queryByText('Synthetic supported claim')).not.toBeInTheDocument();expect(screen.queryByRole('button')).not.toBeInTheDocument();
 });
});
