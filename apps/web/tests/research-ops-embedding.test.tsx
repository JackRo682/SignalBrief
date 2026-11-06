import '@testing-library/jest-dom/vitest';
import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {ComponentProps,ReactNode} from 'react';
import {OpsWorkspaceProvider,type OpsWorkspace} from '../src/admin-logs/workspace-context';
import Experiments from '../src/research/experiments';
import Evaluations,{DatasetDetail} from '../src/research/evaluations';
import {Quality,Reliability,Reports} from '../src/research/operations';
import EvaluationSetup from '../src/research/evaluation-setup';
import {Heading,Panel} from '../src/research/ui';
import type {Row} from '../src/research/contracts';

const mocks=vi.hoisted(()=>({fetch:vi.fn(),push:vi.fn(),rpc:vi.fn()}));
vi.mock('@/components/auth',()=>({useAuth:()=>({token:'synthetic-research-admin',me:{id:'synthetic-admin'}})}));
vi.mock('@/lib/supabase',()=>({getSupabase:()=>({rpc:mocks.rpc})}));
vi.mock('next/navigation',()=>({useRouter:()=>({push:mocks.push}),usePathname:()=>'/ops'}));
vi.mock('next/link',()=>({default:({scroll, ...props}:ComponentProps<'a'>&{scroll?:boolean})=>{void scroll;return <a {...props}/>;}}));

const experimentId='10000000-0000-4000-8000-000000000001';
const datasetId='20000000-0000-4000-8000-000000000002';
const evaluationId='30000000-0000-4000-8000-000000000003';
const runId='40000000-0000-4000-8000-000000000004';
const caseId='50000000-0000-4000-8000-000000000005';
const createdId='60000000-0000-4000-8000-000000000006';
const response=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
let payloads:Record<string,Row>;
let failures:Record<string,{status:number;code:string}>;
let workspace:OpsWorkspace;

function embedded(children:ReactNode){return render(<OpsWorkspaceProvider value={workspace}>{children}</OpsWorkspaceProvider>);}

beforeEach(()=>{
  vi.clearAllMocks();
  failures={};
  payloads={
    experiments:{items:[{id:experimentId,name:'Synthetic experiment',hypothesis:'A synthetic hypothesis',status:'draft',design:'between',ratio:50,version:1}]},
    datasets:{daily_budget_usd:0,items:[{id:datasetId,name:'Synthetic dataset',split:'review',cases:1,approved:0,version:1}],filings:[]},
    evaluations:{runs:[{id:evaluationId,dataset_id:datasetId,method:'A',model:'Synthetic model',status:'queued',created_at:'2026-11-06T01:00:00Z'}]},
    quality:{analyses:[{filing_id:caseId,ticker:'SYNTHETIC',model:'Synthetic model',status:'needs_review',result:{validation:'quote_substring_and_numeric_check'}}],reports:[]},
    reliability:{jobs:[],runs:[{id:runId,status:'failed',error_code:'synthetic_failure'}],checks:[],provider_checks:[]},
    reports:{generated_at:'2026-11-06T01:00:00Z',method_version:'synthetic-v1',experiments:[],evaluations:[],checks:[]},
    dataset:{dataset:{name:'Synthetic review cases',split:'review'},cases:[{id:caseId,created_by:'different-admin',ticker:'SYNTHETIC',field:'Sample',status:'pending',quote:'Synthetic current excerpt',previous_quote:'Synthetic previous excerpt',expected:'2',previous_expected:'1',answerable:true}]},
    experiment_create:{id:createdId},dataset_create:{id:createdId},evaluation_create:{id:createdId},case_review:{saved:true},
  };
  mocks.fetch.mockImplementation(async(url:string,init:RequestInit)=>{
    if(url==='/api/us/ingest')return response({error:{code:'mfa_required'}},403);
    const {action}=JSON.parse(String(init.body)) as {action:string};
    if(failures[action])return response({error:{code:failures[action].code}},failures[action].status);
    if(!payloads[action])throw new Error(`Unexpected synthetic action: ${action}`);
    return response(payloads[action]);
  });
  mocks.rpc.mockResolvedValue({data:{saved:true},error:null,status:200});
  vi.stubGlobal('fetch',mocks.fetch);
  workspace={refreshVersion:0,refreshAll:vi.fn(),deny:vi.fn(),openDetail:vi.fn()};
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();document.body.classList.remove('ops-print-report');});

describe('research sections within one operations page',()=>{
  it('keeps all five sections visible with one page heading and canonical inline detail links',async()=>{
    embedded(<><h1>운영 현황</h1><section aria-label="Experiments"><Experiments/></section><section aria-label="Evaluations"><Evaluations/></section><Quality/><section aria-label="Reliability"><Reliability/></section><Reports/></>);
    const experiment=await within(screen.getByRole('region',{name:'Experiments'})).findByRole('link',{name:'Synthetic experiment'});
    const dataset=await screen.findByRole('link',{name:'Synthetic dataset'});
    const evaluation=await screen.findByRole('link',{name:'A · Synthetic model'});
    const run=await within(screen.getByRole('region',{name:'Reliability'})).findByRole('link',{name:runId.slice(0,8)});
    expect(screen.getAllByRole('heading',{level:1})).toHaveLength(1);
    for(const title of ['A/B 실험 관리','AI 금융정보 평가','금융정보 품질 검수','장애·안전성 관리','실험·평가 보고서'])expect(screen.getByRole('heading',{level:2,name:title})).toBeVisible();
    expect(screen.getByRole('heading',{level:3,name:'실험 목록'})).toBeVisible();
    expect(screen.queryByRole('button',{name:'새로고침'})).not.toBeInTheDocument();
    for(const [link,kind,id] of [[experiment,'experiment',experimentId],[dataset,'dataset',datasetId],[evaluation,'evaluation',evaluationId],[run,'run',runId]] as const){
      expect(link).toHaveAttribute('href',`/ops?detail=${kind}&id=${id}#operations-detail`);
      fireEvent.click(link);
      expect(workspace.openDetail).toHaveBeenLastCalledWith({kind,id});
    }
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('retains standalone heading semantics outside the unified provider',()=>{
    render(<><Heading tag="SYNTHETIC" title="Standalone screen" description="Synthetic test"/><Panel title="Standalone panel">Content</Panel></>);
    expect(screen.getByRole('heading',{level:1,name:'Standalone screen'})).toBeVisible();
    expect(screen.getByRole('heading',{level:2,name:'Standalone panel'})).toBeVisible();
  });

  it('opens newly persisted datasets and evaluation runs inline and refreshes the shared page',async()=>{
    embedded(<Evaluations/>);
    await screen.findByRole('link',{name:'Synthetic dataset'});
    fireEvent.click(screen.getByRole('button',{name:'＋ 데이터셋 등록'}));
    fireEvent.change(screen.getByLabelText('데이터셋 이름'),{target:{value:'Synthetic new dataset'}});
    fireEvent.submit(screen.getByRole('button',{name:'저장하고 공시 추가'}).closest('form')!);
    await waitFor(()=>expect(workspace.openDetail).toHaveBeenCalledWith({kind:'dataset',id:createdId}));
    expect(workspace.refreshAll).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText('데이터셋 이름')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('동일 데이터셋으로 비교'),{target:{value:datasetId}});
    fireEvent.click(screen.getByRole('button',{name:'평가 실행 준비'}));
    await waitFor(()=>expect(workspace.openDetail).toHaveBeenLastCalledWith({kind:'evaluation',id:createdId}));
    expect(workspace.refreshAll).toHaveBeenCalledTimes(2);
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('opens a newly persisted experiment inline while keeping its list on the page',async()=>{
    embedded(<Experiments/>);
    await screen.findByRole('link',{name:'Synthetic experiment'});
    fireEvent.click(screen.getByRole('button',{name:'＋ 새 실험'}));
    fireEvent.change(screen.getByLabelText('실험명'),{target:{value:'Synthetic new experiment'}});
    fireEvent.change(screen.getByLabelText('가설'),{target:{value:'A synthetic hypothesis for this isolated test'}});
    for(const field of screen.getAllByLabelText('금융정보 본문'))fireEvent.change(field,{target:{value:'A sufficiently long synthetic passage for an isolated component test.'}});
    for(const field of screen.getAllByLabelText('SEC 원문 URL'))fireEvent.change(field,{target:{value:'https://www.sec.gov/Archives/synthetic-test'}});
    for(const field of screen.getAllByLabelText('과제 질문'))fireEvent.change(field,{target:{value:'Synthetic question'}});
    for(const field of screen.getAllByLabelText('정답 (앞뒤 공백·대소문자 제외 일치)'))fireEvent.change(field,{target:{value:'Synthetic answer'}});
    fireEvent.submit(screen.getByRole('button',{name:'실험 초안 저장'}).closest('form')!);
    await waitFor(()=>expect(workspace.openDetail).toHaveBeenCalledWith({kind:'experiment',id:createdId}));
    expect(workspace.refreshAll).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('link',{name:'Synthetic experiment'})).toBeVisible();
    expect(screen.queryByLabelText('실험명')).not.toBeInTheDocument();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('shows an independent-review rejection locally without hiding the workspace or reporting success',async()=>{
    failures.case_review={status:403,code:'independent_reviewer_required'};
    embedded(<><h1>운영 현황</h1><DatasetDetail id={datasetId}/></>);
    fireEvent.change(screen.getByLabelText('검수 사유 · 승인·반려·보류 공통'),{target:{value:'Synthetic independent review reason'}});
    fireEvent.click(await screen.findByRole('button',{name:'승인'}));
    expect(await screen.findByText('등록자와 다른 관리자가 정답을 검수해야 합니다.')).toBeVisible();
    expect(screen.getByRole('heading',{name:'운영 현황'})).toBeVisible();
    expect(screen.getByText('Synthetic current excerpt')).toBeVisible();
    expect(workspace.deny).not.toHaveBeenCalled();
    expect(workspace.refreshAll).not.toHaveBeenCalled();
    expect(screen.queryByText('검수 판단을 기록했습니다.')).not.toBeInTheDocument();
  });

  it.each([{status:404,code:'validated_analysis_not_found',denials:0},{status:403,code:'mfa_required',denials:1}])('preserves failed quality approval for $code',async({status,code,denials})=>{
    mocks.rpc.mockResolvedValue({error:{message:code,code:`PT${status}`},status});
    embedded(<Quality/>);
    fireEvent.change(screen.getByLabelText('판단 사유 (5자 이상)'),{target:{value:'Synthetic review reason'}});
    fireEvent.click(await screen.findByRole('button',{name:'발행 승인'}));
    expect(await screen.findByText('검증된 분석만 승인할 수 있습니다. 근거와 권한을 확인해 주세요.')).toBeVisible();
    expect(workspace.deny).toHaveBeenCalledTimes(denials);
    expect(workspace.refreshAll).not.toHaveBeenCalled();
  });

  it('propagates ingestion MFA failures through the same access boundary',async()=>{
    const reload=vi.fn();
    embedded(<EvaluationSetup budget={0} reload={reload}/>);
    fireEvent.click(screen.getByRole('button',{name:'AAPL 공시 불러오기'}));
    await waitFor(()=>expect(workspace.deny).toHaveBeenCalledWith(expect.objectContaining({status:403,code:'mfa_required'})));
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('reports printed from the single operations page',()=>{
  it('prints a freshly authorized snapshot with report-only scope and clears it after the dialog closes',async()=>{
    const print=vi.spyOn(window,'print').mockImplementation(()=>{
      expect(document.body).toHaveClass('ops-print-report');
      expect(screen.getByText(/2026-11-06T02:00:00Z/)).toBeVisible();
    });
    embedded(<Reports/>);
    await screen.findByText(/2026-11-06T01:00:00Z/);
    payloads.reports={...payloads.reports,generated_at:'2026-11-06T02:00:00Z'};
    fireEvent.click(screen.getByRole('button',{name:'PDF로 저장 / 인쇄'}));
    await waitFor(()=>expect(print).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button',{name:'PDF로 저장 / 인쇄'})).toBeDisabled();
    act(()=>window.dispatchEvent(new Event('afterprint')));
    expect(document.body).not.toHaveClass('ops-print-report');
    expect(screen.getByRole('button',{name:'PDF로 저장 / 인쇄'})).toBeEnabled();
    expect(workspace.refreshAll).toHaveBeenCalledTimes(1);
  });

  it('never prints the previous report when fresh export authorization fails',async()=>{
    const print=vi.spyOn(window,'print').mockImplementation(()=>{});
    embedded(<Reports/>);
    await screen.findByText(/2026-11-06T01:00:00Z/);
    failures.reports={status:403,code:'admin_required'};
    fireEvent.click(screen.getByRole('button',{name:'PDF로 저장 / 인쇄'}));
    await waitFor(()=>expect(workspace.deny).toHaveBeenCalledWith(expect.objectContaining({status:403,code:'admin_required'})));
    expect(print).not.toHaveBeenCalled();
    expect(document.body).not.toHaveClass('ops-print-report');
  });

  it('clears print scope if access changes or the report unmounts while the dialog is open',async()=>{
    const print=vi.spyOn(window,'print').mockImplementation(()=>{});
    const view=embedded(<Reports/>);
    await screen.findByText(/2026-11-06T01:00:00Z/);
    fireEvent.click(screen.getByRole('button',{name:'PDF로 저장 / 인쇄'}));
    await waitFor(()=>expect(print).toHaveBeenCalledTimes(1));
    expect(document.body).toHaveClass('ops-print-report');
    view.unmount();
    expect(document.body).not.toHaveClass('ops-print-report');
  });
});
