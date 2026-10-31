import '@testing-library/jest-dom/vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import Monitoring from '../src/workspace/monitoring';
import {ResearchDirectory,ResearchSearch} from '../src/workspace/research-search';
import {ResourceCard} from '../src/workspace/ui';
import ContentAlerts from '../src/workspace/content-alerts';
import ResearchOnboarding from '../src/workspace/research-onboarding';
import {defaults,type Resource} from '../src/workspace/contracts';
import {pageDataCache} from '../src/lib/page-data-cache';
import {disabledWorkspaceRoute,mobileWorkspaceNavigation,workspaceFeatures,workspaceNavigation} from '../src/lib/workspace-features';

const mocks=vi.hoisted(()=>({workspace:vi.fn(),request:vi.fn(),push:vi.fn(),replace:vi.fn(),refresh:vi.fn(),savePrefs:vi.fn()}));
vi.mock('next/navigation',()=>({useRouter:()=>({push:mocks.push,replace:mocks.replace})}));
vi.mock('@/components/auth',()=>({useAuth:()=>({token:'isolated-research-test-token',me:{id:'synthetic-user',display_name:'Synthetic Reader'},refresh:mocks.refresh,loading:false,error:null})}));
vi.mock('@/workspace/client',async original=>({...await original<typeof import('../src/workspace/client')>(),workspace:mocks.workspace}));
vi.mock('@/lib/api',async original=>({...await original<typeof import('../src/lib/api')>(),request:mocks.request}));
vi.mock('@/workspace/preferences',()=>({usePrefs:()=>({value:{...defaults,locale:'en'},text:(_ko:string,en:string)=>en,date:(date:string|null)=>date??'Unavailable',loaded:true,busy:false,error:'',save:mocks.savePrefs})}));

const companyId='20000000-0000-4000-8000-000000000001';
const filingId='40000000-0000-4000-8000-000000000001';
const company={id:companyId,name:'Synthetic Company',ticker:'TEST',market:'NASDAQ',provider:'sec',last_ingested_at:null,is_demo:false};
const resource:Resource={id:companyId,kind:'company',title:company.name,summary:'',company_id:companyId,company_name:company.name,ticker:'TEST',market:'NASDAQ',source_url:null,published_at:null,publication_precision:'date',category:'company',is_saved:false};
const filing:Resource={...resource,id:filingId,kind:'filing',title:'Synthetic collected disclosure',source_url:'https://www.sec.gov/Archives/synthetic.htm',published_at:'2026-10-01',category:'10-Q'};
const analysis:Resource={...filing,kind:'us_analysis',title:'Synthetic approved excerpt',summary:'Synthetic supported sentence.',reviewed_at:'2026-10-31T00:00:00Z'};
let watched:typeof company[],saved:boolean,failSave:boolean,failFollow:boolean,read:boolean,failRead:boolean;
beforeEach(()=>{
  vi.clearAllMocks();pageDataCache.reset();watched=[company];saved=false;failSave=failFollow=read=failRead=false;
  HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
  mocks.workspace.mockImplementation(async(_token,req)=>{
    if(req.action==='source_overview')return {companies:1,filing_count:1,published_count:1,following_count:watched.length,scope:req.p.scope??'all',fallback_to_all:false,filings:[filing],analyses:[analysis],historical_events:[],calendar:[],historical_calendar:[],monitoring:[{company_id:companyId,latest_filing:filing,latest_analysis:analysis,next_event:null,last_collected_at:'2026-10-31T00:00:00Z'}]};
    if(req.action==='catalog'){const all=[resource,filing,{...analysis,is_saved:saved}],items=all.filter(item=>!req.p.kind||item.kind===req.p.kind||req.p.kind==='analysis'&&item.kind==='us_analysis'||req.p.kind==='document'&&item.kind==='filing');return {items,total:items.length,counts:{company:1,filing:1,us_analysis:1},markets:['NASDAQ'],categories:['10-Q'],next_offset:null};}
    if(req.action==='save'){if(failSave)throw new Error('Synthetic save failed');saved=req.p.saved;return {saved};}
    if(req.action==='content_notifications')return {items:[{id:'80000000-0000-4000-8000-000000000001',created_at:'2026-10-31T00:00:00Z',read_at:read?'2026-10-31T01:00:00Z':null,resource:analysis}],unread_count:read?0:1};
    if(req.action==='content_notification_read'){if(failRead)throw new Error('Synthetic read failed');read=true;return {read:true};}
    if(req.action==='onboarding_complete')return {onboarding_completed:true};
    throw new Error(`Unexpected workspace action ${req.action}`);
  });
  mocks.request.mockImplementation(async(path,_token,_schema,init)=>{
    if(path==='/v1/watchlist')return {id:'synthetic-list',name:'Watchlist',items:[...watched]};
    if(path.startsWith('/v1/companies?'))return [company];
    if(path.startsWith('/v1/watchlist/')){if(failFollow)throw new Error('Synthetic follow failed');watched=init.method==='DELETE'?[]:[company];return undefined;}
    throw new Error(`Unexpected API request ${path}`);
  });
});
afterEach(cleanup);

describe('research workspace release',()=>{
  it('has the same supported navigation and intentionally handles retired URLs',()=>{
    expect(workspaceNavigation.map(item=>item[0])).toEqual(['/today','/explore','/watchlist','/calendar','/saved']);
    expect(mobileWorkspaceNavigation.map(item=>item[0])).toEqual(['/today','/explore','/watchlist','/more']);
    expect(workspaceFeatures.marketData).toBe(false);
    expect(disabledWorkspaceRoute('/portfolio')).toBe(true);
    expect(disabledWorkspaceRoute('/ops/evaluations')).toBe(false);
    expect(disabledWorkspaceRoute('/settings/security')).toBe(false);
  });

  it('shows monitoring records without requesting prices, holdings or short-window event feeds',async()=>{
    render(<Monitoring/>);
    expect(await screen.findByRole('link',{name:'Synthetic collected disclosure'})).toHaveAttribute('href',`/documents/${filingId}?kind=filing`);
    expect(await screen.findByRole('link',{name:'Synthetic approved excerpt'})).toHaveAttribute('href',`/documents/${filingId}?kind=filing&analysis=us`);
    expect(screen.getByText('No verified upcoming event.')).toBeVisible();
    expect(mocks.request.mock.calls.map(([path])=>path)).toEqual(['/v1/watchlist']);
    expect(screen.queryByText('Quote')).not.toBeInTheDocument();
  });

  it('keeps a failed unfollow visible and persists a successful unfollow across remount',async()=>{
    failFollow=true;const first=render(<Monitoring/>);
    fireEvent.click(await screen.findByRole('button',{name:'Synthetic Company unfollow'}));
    await screen.findByText('Synthetic follow failed');
    expect(screen.getByRole('button',{name:'Synthetic Company unfollow'})).toBeVisible();
    failFollow=false;fireEvent.click(screen.getByRole('button',{name:'Synthetic Company unfollow'}));
    await screen.findByText('Follow your first company.');
    first.unmount();render(<Monitoring/>);await screen.findByText('Follow your first company.');
  });

  it('identifies collected coverage in the company directory',async()=>{
    render(<ResearchDirectory/>);
    expect(await screen.findByText('Disclosures and approved analysis')).toBeVisible();
    expect(screen.getByRole('link',{name:/Synthetic Company TEST/})).toHaveAttribute('href',`/companies/${companyId}`);
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('retains query, source and company filters when changing search type, resetting pagination',async()=>{
    render(<ResearchSearch initial="Synthetic" initialKind="document" initialSource="sec" initialCompany={companyId} initialDays={30} initialOffset={20}/>);
    await screen.findByRole('link',{name:'Synthetic collected disclosure'});
    fireEvent.click(screen.getByRole('button',{name:'Approved analyses'}));
    const params=new URL(mocks.push.mock.calls.at(-1)![0],'https://test.invalid').searchParams;
    expect(Object.fromEntries(params)).toMatchObject({q:'Synthetic',kind:'analysis',source:'sec',company_id:companyId,days:'30'});
    expect(params.has('offset')).toBe(false);
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('saves the canonical analysis kind only after persistence succeeds and keeps both dates',async()=>{
    failSave=true;render(<ResourceCard item={analysis}/>);
    fireEvent.click(screen.getByRole('button',{name:'Synthetic approved excerpt Save'}));
    await screen.findByText('Synthetic save failed');
    expect(screen.getByRole('button',{name:'Synthetic approved excerpt Save'})).toHaveAttribute('aria-pressed','false');
    failSave=false;fireEvent.click(screen.getByRole('button',{name:'Synthetic approved excerpt Save'}));
    expect(await screen.findByRole('button',{name:'Synthetic approved excerpt Unsave'})).toHaveAttribute('aria-pressed','true');
    expect(mocks.workspace).toHaveBeenLastCalledWith('isolated-research-test-token',{action:'save',p:{id:filingId,kind:'us_analysis',saved:true}},expect.anything());
    expect(screen.getByText('Source · 2026-10-01')).toBeVisible();
    expect(screen.getByText('Reviewed · 2026-10-31T00:00:00Z')).toBeVisible();
  });

  it('lets new accounts browse the supported coverage without portfolio inputs or fake defaults',async()=>{
    render(<ResearchOnboarding/>);
    await screen.findByRole('button',{name:/Synthetic Company/});
    fireEvent.click(screen.getByRole('button',{name:'Browse all companies first'}));
    await waitFor(()=>expect(mocks.replace).toHaveBeenCalledWith('/today'));
    expect(mocks.workspace).toHaveBeenCalledWith('isolated-research-test-token',{action:'onboarding_complete',p:{company_ids:[],removed_company_ids:[],positions:[]}},expect.anything());
    expect(mocks.request.mock.calls.every(([path])=>!path.includes('portfolio'))).toBe(true);
  });
  it('keeps failed notification changes unread and persists read status across reload',async()=>{
    failRead=true;const first=render(<ContentAlerts/>);
    fireEvent.click(await screen.findByRole('button',{name:'Synthetic approved excerpt mark read'}));
    await screen.findByText('Synthetic read failed');
    expect(screen.getByRole('button',{name:'Synthetic approved excerpt mark read'})).toBeEnabled();
    expect(read).toBe(false);
    failRead=false;fireEvent.click(screen.getByRole('button',{name:'Synthetic approved excerpt mark read'}));
    expect(await screen.findByRole('button',{name:'Synthetic approved excerpt read'})).toBeDisabled();
    first.unmount();render(<ContentAlerts/>);
    expect(await screen.findByRole('button',{name:'Synthetic approved excerpt read'})).toBeDisabled();
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('marks all approved-content notifications read through the owner-scoped action',async()=>{
    render(<ContentAlerts/>);
    fireEvent.click(await screen.findByRole('button',{name:'Mark all read'}));
    await waitFor(()=>expect(read).toBe(true));
    expect(mocks.workspace).toHaveBeenCalledWith('isolated-research-test-token',{action:'content_notification_read',p:{all:true}},expect.anything());
  });

});
