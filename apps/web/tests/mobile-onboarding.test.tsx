// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {z} from 'zod';
import type {AnchorHTMLAttributes} from 'react';
import MobileOnboarding from '../src/mobile/onboarding';
import {defaults} from '../src/workspace/contracts';

const mocks=vi.hoisted(()=>({request:vi.fn(),workspace:vi.fn(),replace:vi.fn(),refresh:vi.fn(),reload:vi.fn(),resource:vi.fn(),reset:vi.fn(),profile: {} as Record<string,unknown>,completion:{} as Record<string,unknown>}));
vi.mock('next/link',()=>({default:({children,href,...rest}:AnchorHTMLAttributes<HTMLAnchorElement>)=><a href={href} {...rest}>{children}</a>}));
vi.mock('next/navigation',()=>({useRouter:()=>({replace:mocks.replace})}));
vi.mock('@/components/auth',()=>({useAuth:()=>({token:'isolated-onboarding-test',me:mocks.profile,refresh:mocks.refresh})}));
vi.mock('@/components/ui',()=>({useResource:(path:string)=>mocks.resource(path)}));
vi.mock('@/workspace/preferences',()=>({usePrefs:()=>({value:defaults,text:(ko:string)=>ko,date:(input:string)=>input})}));
vi.mock('@/workspace/client',()=>({workspace:(...args:unknown[])=>mocks.workspace(...args)}));
vi.mock('@/lib/page-data-cache',()=>({pageDataCache:{reset:(...args:unknown[])=>mocks.reset(...args)}}));
vi.mock('@/lib/api',async original=>({...await original<typeof import('../src/lib/api')>(),request:(...args:unknown[])=>mocks.request(...args)}));
vi.mock('@/mobile/ui',()=>({
 MIcon:()=>null,CompanyLogo:()=>null,
 ActionNotice:({action}:{action:{error:string;success?:string}})=><>{action.error&&<p role="alert">{action.error}</p>}{action.success&&<p role="status">{action.success}</p>}</>,
 EmptyState:({title,description}:{title:string;description?:string})=><section><strong>{title}</strong><p>{description}</p></section>,
 LoadState:({loading,error}:{loading:boolean;error?:string})=><>{loading&&<span role="status">Loading</span>}{error&&<span role="alert">{error}</span>}</>,
}));

const a={id:'20000000-0000-4000-8000-000000000001',name:'Synthetic Alpha',ticker:'TESTA',market:'NASDAQ',provider:'sec',is_demo:false,last_ingested_at:null};
const b={...a,id:'20000000-0000-4000-8000-000000000002',name:'Synthetic Beta',ticker:'TESTB'};
const c={...a,id:'20000000-0000-4000-8000-000000000003',name:'Synthetic Gamma',ticker:'TESTC'};
let watched=[a];
const positions=[{id:'p1',company:a,quantity:'1E+1',average_cost:'1.25E+2',currency:'EUR'},{id:'p2',company:b,quantity:'7',average_cost:'90',currency:'USD'}];

beforeEach(()=>{
 vi.clearAllMocks();watched=[a];
 mocks.profile={id:'10000000-0000-4000-8000-000000000001',display_name:'Synthetic investor',density:'beginner',onboarding_completed:false,analytics_consent:true,is_admin:false,demo_mode:false};
 mocks.completion={...mocks.profile,onboarding_completed:true};
 mocks.refresh.mockResolvedValue(undefined);
 mocks.request.mockImplementation(async(_path,_token,schema:z.ZodType<unknown>)=>schema.parse({}));
 mocks.workspace.mockImplementation(async(_token,_request,schema:z.ZodType<unknown>)=>schema.parse(mocks.completion));
 mocks.resource.mockImplementation((path:string)=>({data:path==='/v1/watchlist'?{id:'w',name:'관심종목',items:watched}:path==='/v1/portfolio'?{id:'p',name:'내 포트폴리오',weighting_note:'Synthetic fixture',positions}:path==='/v1/preferences'?{experience:'professional',markets:['KR','US'],sectors:['AI 반도체'],alert_frequency:'normal'}:[a,b,c],loading:false,error:null,reload:mocks.reload}));
 vi.stubGlobal('scrollTo',vi.fn());
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});

async function next(){fireEvent.click(screen.getByRole('button',{name:'다음'}));}
async function holdingStep(){await next();await screen.findByRole('heading',{name:'보유종목을 설정해주세요.'});}
async function finish(){await next();await screen.findByRole('heading',{name:'맞춤 설정을 확인해주세요.'});fireEvent.click(screen.getByRole('button',{name:'오늘의 변화 시작하기'}));}

describe('mobile onboarding persistence and transitions',()=>{
 it('prefills exact stored holdings but sends no unedited positions',async()=>{
  render(<MobileOnboarding/>);await holdingStep();
  expect((screen.getByLabelText('Synthetic Alpha 보유 수량') as HTMLInputElement).value).toBe('10');
  expect((screen.getByLabelText('Synthetic Alpha 평균 매수가') as HTMLInputElement).value).toBe('125');
  expect((screen.getByLabelText('Synthetic Alpha 통화') as HTMLSelectElement).value).toBe('EUR');
  await finish();await waitFor(()=>expect(mocks.replace).toHaveBeenCalledWith('/today'));
  expect(mocks.workspace.mock.calls[0][1]).toEqual({action:'onboarding_complete',p:{company_ids:[],removed_company_ids:[],positions:[],analytics_consent:true}});
  const preferenceWrites=mocks.request.mock.calls.filter(call=>call[0]==='/v1/preferences');
  expect(preferenceWrites.every(call=>JSON.parse(call[3].body).markets.join(',')==='KR,US')).toBe(true);
  expect(mocks.refresh).toHaveBeenCalledOnce();
 });
 it('sends only an explicitly edited holding and preserves unspecified holdings',async()=>{
  render(<MobileOnboarding/>);await holdingStep();
  fireEvent.change(screen.getByLabelText('Synthetic Alpha 보유 수량'),{target:{value:'11.25'}});
  await finish();await waitFor(()=>expect(mocks.replace).toHaveBeenCalledWith('/today'));
  expect(mocks.workspace.mock.calls[0][1].p.positions).toEqual([{company_id:a.id,quantity:'11.25',average_cost:'125',currency:'EUR'}]);
 });
 it('does not replay a field changed back to its stored value',async()=>{
  render(<MobileOnboarding/>);await holdingStep();
  const input=screen.getByLabelText('Synthetic Alpha 보유 수량');fireEvent.change(input,{target:{value:'11'}});fireEvent.change(input,{target:{value:'10'}});
  await finish();await waitFor(()=>expect(mocks.replace).toHaveBeenCalledWith('/today'));expect(mocks.workspace.mock.calls[0][1].p.positions).toEqual([]);
 });
 it('submits explicit watchlist additions/removals without deleting held positions',async()=>{
  render(<MobileOnboarding/>);
  fireEvent.click(screen.getByRole('button',{name:'Synthetic Alpha TESTA'}));fireEvent.click(screen.getByRole('button',{name:'Synthetic Gamma TESTC'}));
  await holdingStep();await finish();await waitFor(()=>expect(mocks.replace).toHaveBeenCalledWith('/today'));
  expect(mocks.workspace.mock.calls[0][1].p).toMatchObject({company_ids:[c.id],removed_company_ids:[a.id],positions:[]});
 });
 it('skip sends empty deltas and does not overwrite analytics consent or preferences',async()=>{
  render(<MobileOnboarding/>);fireEvent.click(screen.getByRole('button',{name:'나중에 설정'}));
  await waitFor(()=>expect(mocks.replace).toHaveBeenCalledWith('/today'));
  expect(mocks.workspace.mock.calls[0][1]).toEqual({action:'onboarding_complete',p:{company_ids:[],removed_company_ids:[],positions:[]}});expect(mocks.request).not.toHaveBeenCalled();
 });
 it('completes an empty selection without manufacturing watchlist or holding records',async()=>{
  watched=[];render(<MobileOnboarding/>);await holdingStep();await finish();await waitFor(()=>expect(mocks.replace).toHaveBeenCalledWith('/today'));expect(mocks.workspace.mock.calls[0][1].p.positions).toEqual([]);expect(mocks.workspace.mock.calls[0][1].p.company_ids).toEqual([]);
 });
 it('does not advance past a failed preferences save',async()=>{
  mocks.request.mockRejectedValueOnce(new Error('설정을 저장하지 못했습니다.'));render(<MobileOnboarding/>);await next();
  await screen.findByRole('alert');expect(screen.queryByRole('heading',{name:'보유종목을 설정해주세요.'})).toBeNull();expect(mocks.workspace).not.toHaveBeenCalled();expect(mocks.replace).not.toHaveBeenCalled();
 });
 it('rejects invalid quantity before the review/complete transition',async()=>{
  render(<MobileOnboarding/>);await holdingStep();fireEvent.change(screen.getByLabelText('Synthetic Alpha 보유 수량'),{target:{value:'0'}});await next();
  await screen.findByRole('alert');expect(screen.queryByRole('heading',{name:'맞춤 설정을 확인해주세요.'})).toBeNull();expect(mocks.workspace).not.toHaveBeenCalled();
 });
 it.each(['legacy_saved_flag','incomplete_profile'])('does not claim completion for %s',async response=>{
  mocks.completion=response==='legacy_saved_flag'?{saved:true}:{...mocks.profile,onboarding_completed:false};render(<MobileOnboarding/>);fireEvent.click(screen.getByRole('button',{name:'나중에 설정'}));
  await screen.findByRole('alert');expect(mocks.refresh).not.toHaveBeenCalled();expect(mocks.replace).not.toHaveBeenCalled();
 });
 it('stays on review after a failed atomic completion and allows retry',async()=>{
  mocks.workspace.mockRejectedValueOnce(new Error('일시적인 저장 오류입니다.'));render(<MobileOnboarding/>);await holdingStep();await finish();
  await screen.findByRole('alert');expect(mocks.replace).not.toHaveBeenCalled();expect(mocks.refresh).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'오늘의 변화 시작하기'}));await waitFor(()=>expect(mocks.replace).toHaveBeenCalledWith('/today'));expect(mocks.workspace).toHaveBeenCalledTimes(2);
 });
});
