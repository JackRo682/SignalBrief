import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const auth=vi.hoisted(()=>({token:'synthetic-admin-token' as string|null,me:{id:'synthetic-admin',is_admin:true},loading:false,error:null as string|null}));
vi.mock('@/components/auth',()=>({useAuth:()=>auth}));
import ComparisonPanel from '../src/acquisition/comparison-panel';
import SessionsPanel from '../src/acquisition/sessions-panel';
import AcquisitionPanel from '../src/acquisition/panel';
import type {TrafficSessions,TrafficSummary} from '../src/acquisition/contracts';

const range={from:'2026-11-20',to:'2026-11-26'};
const count={visitors:12,pageviews:30,starts:4,requests:2,signups:1,onboarded:1};
function summary(patch:Partial<TrafficSummary>={}):TrafficSummary{return {
 generated_at:'2026-11-28T00:00:00Z',totals:count,daily:[],sources:[{source:'kakao',...count}],
 journeys:[{source:'kakao',sessions:10,auth_cta:6,auth_arrived:5,auth_attempt:3,closed:8,closed_without_attempt:5,direct_auth_entries:0}],
 measurement:{first_acquisition_at:'2026-11-01T00:00:00Z',first_journey_at:'2026-11-01T00:00:00Z',first_surface_at:null,retained_from:'2026-08-29T00:00:00Z'},...patch,
};}
function session(index=0,patch:Partial<TrafficSessions['rows'][number]>={}):TrafficSessions['rows'][number]{return {
 session_id:`${(0x10000000+index).toString(16)}-1111-4111-8111-111111111111`,source:'kakao',device:'unknown',started_at:'2026-11-20T01:00:00Z',last_at:'2026-11-20T01:01:00Z',entry_page:'home',last_page:'signup',last_step:'signup_cta',events:2,closed:true,any_auth_attempt:false,
 steps:[{seq:1,page:'home',step:'view',at:'2026-11-20T01:00:00Z'},{seq:2,page:'home',step:'signup_cta',at:'2026-11-20T01:01:00Z'}],steps_truncated:false,...patch,
};}
const sessions=(rows:TrafficSessions['rows'],total=rows.length):TrafficSessions=>({generated_at:'2026-11-28T00:00:00Z',total,rows});
const requests=()=>vi.mocked(fetch).mock.calls.map(([,options])=>JSON.parse(String(options?.body)));
beforeEach(()=>{auth.token='synthetic-admin-token';auth.me={id:'synthetic-admin',is_admin:true};auth.loading=false;auth.error=null;vi.stubGlobal('fetch',vi.fn());});
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks();});

describe('analytics dashboard report lifecycle',()=>{
 it('loads real observed counts and separates session stages from browsers and completed signup',async()=>{
  let finish!:(response:Response)=>void;
  vi.mocked(fetch).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  render(<AcquisitionPanel {...range}/>);
  expect(screen.getByRole('status').textContent).toContain('불러오는 중');
  expect(screen.getByRole('button',{name:'CSV 저장'}).hasAttribute('disabled')).toBe(true);
  const data=summary({journey_daily:[{day:'2026-11-20',...summary().journeys![0]}],journey_devices:[{device:'unknown',sessions:7},{device:'mobile',sessions:3}]});
  await act(async()=>finish(Response.json(data)));
  expect(screen.getByRole('article',{name:'방문 브라우저'}).querySelector('strong')?.textContent).toBe('12개');
  expect(screen.getByRole('article',{name:'로그인 전 세션'}).querySelector('strong')?.textContent).toBe('10세션');
  expect(screen.getByRole('article',{name:'순차 인증 시도'}).querySelector('strong')?.textContent).toBe('3세션');
  expect(screen.getByRole('article',{name:'인증된 신규 가입'}).querySelector('strong')?.textContent).toBe('1브라우저');
  const stages=within(screen.getByRole('region',{name:'로그인 전 이용 흐름'})).getAllByRole('listitem');
  expect(stages.map(stage=>stage.querySelector('.traffic-flow-count')?.textContent)).toEqual(['10세션','6세션','5세션','3세션']);
  expect(stages[2].textContent).toContain('이전 단계 대비 83.3%');
  expect(screen.getByRole('list',{name:'날짜별 방문 세션'}).textContent).toContain('11/20');
  expect(screen.getByRole('region',{name:'접속 화면 크기'}).textContent).toContain('미측정');
  expect(screen.getByRole('button',{name:'CSV 저장'}).hasAttribute('disabled')).toBe(false);
  expect(requests()).toEqual([{action:'summary',...range}]);
 });
 it('renders missing historical journey measurements as unknown rather than zero',async()=>{
  vi.mocked(fetch).mockResolvedValue(Response.json(summary({journeys:undefined,measurement:undefined,daily:[{day:'2026-11-20',...count}]})));
  render(<AcquisitionPanel {...range}/>);
  expect((await screen.findByRole('article',{name:'로그인 전 세션'})).querySelector('strong')?.textContent).toBe('미측정');
  expect(screen.getByRole('article',{name:'순차 인증 시도'}).querySelector('strong')?.textContent).toBe('미측정');
  expect(screen.getByRole('list',{name:'날짜별 방문 브라우저'})).toBeTruthy();
  expect(screen.getByText('이 기간의 세션 측정 자료가 없습니다. 과거 방문에서 세션을 추정하지 않습니다.')).toBeTruthy();
 });
 it('hides stale metrics and disables CSV immediately when the selected range changes',async()=>{
  let finish!:(response:Response)=>void;
  vi.mocked(fetch).mockResolvedValueOnce(Response.json(summary())).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  const view=render(<AcquisitionPanel {...range}/>);
  await screen.findByRole('article',{name:'방문 브라우저'});
  view.rerender(<AcquisitionPanel from='2026-11-21' to='2026-11-26'/>);
  expect(screen.queryByRole('article',{name:'방문 브라우저'})).toBeNull();
  expect(screen.getByRole('button',{name:'CSV 저장'}).hasAttribute('disabled')).toBe(true);
  await act(async()=>finish(Response.json(summary({totals:{...count,visitors:2}}))));
  expect(screen.getByRole('article',{name:'방문 브라우저'}).querySelector('strong')?.textContent).toBe('2개');
  expect(requests().at(-1)).toEqual({action:'summary',from:'2026-11-21',to:'2026-11-26'});
 });
 it.each([401,403])('suppresses an old summary when refresh is rejected with %i',async status=>{
  vi.mocked(fetch).mockResolvedValueOnce(Response.json(summary())).mockResolvedValueOnce(Response.json({error:'synthetic-denial'},{status}));
  const view=render(<AcquisitionPanel {...range} revision={0}/>);
  await screen.findByRole('article',{name:'방문 브라우저'});
  view.rerender(<AcquisitionPanel {...range} revision={1}/>);
  expect(screen.queryByRole('article',{name:'방문 브라우저'})).toBeNull();
  await screen.findByRole('alert');
  expect(screen.getByRole('button',{name:'CSV 저장'}).hasAttribute('disabled')).toBe(true);
  expect(screen.queryByRole('article',{name:'인증된 신규 가입'})).toBeNull();
 });
 it.each([401,403])('invalidates the whole report when a child session query loses access with %i',async status=>{
  vi.mocked(fetch).mockResolvedValueOnce(Response.json(summary())).mockResolvedValueOnce(Response.json({error:'synthetic-denial'},{status}));
  render(<AcquisitionPanel {...range}/>);
  await screen.findByRole('article',{name:'방문 브라우저'});
  fireEvent.click(screen.getByRole('button',{name:'세션별 경로 보기'}));
  await screen.findByRole('alert');
  expect(screen.queryByRole('article',{name:'방문 브라우저'})).toBeNull();
  expect(screen.queryByRole('region',{name:'익명 세션 경로 목록'})).toBeNull();
  expect(screen.getByRole('button',{name:'CSV 저장'}).hasAttribute('disabled')).toBe(true);
 });
 it.each(['missing-token','non-admin','loading','auth-error'])('does not expose or request the report with %s',async condition=>{
  if(condition==='missing-token')auth.token=null;
  if(condition==='non-admin')auth.me.is_admin=false;
  if(condition==='loading')auth.loading=true;
  if(condition==='auth-error')auth.error='synthetic-auth-error';
  render(<AcquisitionPanel {...range}/>);
  expect(fetch).not.toHaveBeenCalled();expect(screen.queryByRole('region',{name:'사람들이 어디까지 이용했나요?'})).toBeNull();
 });
 it('drops the previous identity data immediately when the bearer token changes',async()=>{
  let finish!:(response:Response)=>void;
  vi.mocked(fetch).mockResolvedValueOnce(Response.json(summary())).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  const view=render(<AcquisitionPanel {...range}/>);
  await screen.findByRole('article',{name:'방문 브라우저'});
  auth.token='synthetic-new-admin-token';view.rerender(<AcquisitionPanel {...range}/>);
  expect(screen.queryByRole('article',{name:'방문 브라우저'})).toBeNull();
  await act(async()=>finish(Response.json(summary({totals:{...count,visitors:4}}))));
  expect(screen.getByRole('article',{name:'방문 브라우저'}).querySelector('strong')?.textContent).toBe('4개');
 });
});

describe('on-demand period comparison',()=>{
 it('waits for explicit expansion and requests the preceding equal period once',async()=>{
  const loaded=vi.fn(),denied=vi.fn(),prior=summary({totals:{...count,visitors:6}});
  vi.mocked(fetch).mockResolvedValue(Response.json(prior));
  render(<ComparisonPanel data={summary()} range={range} revision={0} onLoaded={loaded} onAccessDenied={denied}/>);
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'이전 기간 비교'}));
  await waitFor(()=>expect(loaded).toHaveBeenLastCalledWith(prior));
  expect(requests()).toEqual([{action:'summary',from:'2026-11-13',to:'2026-11-19'}]);
  const row=within(screen.getByRole('table',{name:'동일한 길이의 이전 기간과 현재 기간'})).getByRole('row',{name:'방문 브라우저 12 6 +100.0%'});
  expect(row).toBeTruthy();expect(denied).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'비교 접기'}));
  expect(screen.queryByRole('table',{name:'동일한 길이의 이전 기간과 현재 기간'})).toBeNull();
 });
 it.each([401,403])('clears prior data after changed dates and reports access denial %i',async status=>{
  const loaded=vi.fn(),denied=vi.fn();let finish!:(value:Response)=>void;
  vi.mocked(fetch).mockResolvedValueOnce(Response.json(summary())).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  const view=render(<ComparisonPanel data={summary()} range={range} revision={0} onLoaded={loaded} onAccessDenied={denied}/>);
  fireEvent.click(screen.getByRole('button',{name:'이전 기간 비교'}));
  await screen.findByRole('table',{name:'동일한 길이의 이전 기간과 현재 기간'});
  view.rerender(<ComparisonPanel data={summary()} range={{from:'2026-11-19',to:'2026-11-25'}} revision={0} onLoaded={loaded} onAccessDenied={denied}/>);
  expect(screen.queryByRole('table',{name:'동일한 길이의 이전 기간과 현재 기간'})).toBeNull();
  expect(loaded).toHaveBeenLastCalledWith(undefined);
  await act(async()=>finish(Response.json({error:'denied'},{status})));
  expect(await screen.findByRole('alert')).toBeTruthy();expect(denied).toHaveBeenCalledOnce();
  expect(screen.queryByRole('table',{name:'동일한 길이의 이전 기간과 현재 기간'})).toBeNull();
 });
 it('does not request a comparison for a non-admin identity',()=>{
  auth.me.is_admin=false;
  render(<ComparisonPanel data={summary()} range={range} revision={0} onLoaded={vi.fn()} onAccessDenied={vi.fn()}/>);
  fireEvent.click(screen.getByRole('button',{name:'이전 기간 비교'}));
  expect(fetch).not.toHaveBeenCalled();
 });
});

describe('private session paths',()=>{
 it('loads on demand and lets a bounded route expand and collapse without exposing an invented device',async()=>{
  const data=sessions([session(0,{events:103,steps_truncated:true,steps:Array.from({length:100},(_,index)=>({seq:index+1,page:'home',step:index?'signup_cta':'view',at:'2026-11-20T01:00:00Z'}))})]);
  vi.mocked(fetch).mockResolvedValue(Response.json(data));
  render(<SessionsPanel {...range} revision={0} onAccessDenied={vi.fn()}/>);
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'세션별 경로 보기'}));
  const table=await screen.findByRole('region',{name:'익명 세션 경로 목록'});
  expect(requests()).toEqual([{action:'sessions',...range,offset:0,limit:20}]);
  expect(table.textContent).toContain('미측정');expect(table.textContent).not.toContain('데스크톱');
  fireEvent.click(screen.getByRole('button',{name:'10000000 세션 경로 보기'}));
  const steps=screen.getByRole('list',{name:'세션의 관측 순서'});
  expect(within(steps).getAllByRole('listitem')).toHaveLength(100);
  expect(screen.getByText('이 세션의 처음 100개 행동을 표시합니다. 전체 관측 행동은 103회입니다.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'10000000 세션 경로 닫기'}));
  expect(screen.queryByRole('list',{name:'세션의 관측 순서'})).toBeNull();
 });
 it('paginates with real offsets and resets to the first page after a source filter changes',async()=>{
  const first=sessions(Array.from({length:20},(_,index)=>session(index)),21),second=sessions([session(20)],21);
  vi.mocked(fetch).mockResolvedValueOnce(Response.json(first)).mockResolvedValueOnce(Response.json(second)).mockResolvedValueOnce(Response.json(sessions([session(30,{source:'google'})])));
  render(<SessionsPanel {...range} revision={0} onAccessDenied={vi.fn()}/>);
  fireEvent.click(screen.getByRole('button',{name:'세션별 경로 보기'}));
  await screen.findByRole('button',{name:'10000000 세션 경로 보기'});
  expect(screen.getByRole('button',{name:'이전 세션'}).hasAttribute('disabled')).toBe(true);
  fireEvent.click(screen.getByRole('button',{name:'다음 세션'}));
  await screen.findByRole('button',{name:'10000014 세션 경로 보기'});
  expect(requests().at(-1)).toMatchObject({offset:20,limit:20});
  expect(screen.getByRole('button',{name:'다음 세션'}).hasAttribute('disabled')).toBe(true);
  fireEvent.change(screen.getByRole('combobox',{name:'세션의 최초 유입'}),{target:{value:'google'}});
  await screen.findByRole('button',{name:'1000001e 세션 경로 보기'});
  expect(requests().at(-1)).toEqual({action:'sessions',...range,source:'google',offset:0,limit:20});
  expect(screen.queryByRole('button',{name:'10000014 세션 경로 보기'})).toBeNull();
 });
 it('shows an honest empty state without an impossible 1-to-0 range',async()=>{
  vi.mocked(fetch).mockResolvedValue(Response.json(sessions([])));
  render(<SessionsPanel {...range} revision={0} onAccessDenied={vi.fn()}/>);
  fireEvent.click(screen.getByRole('button',{name:'세션별 경로 보기'}));
  await screen.findByText('선택한 기간과 유입 경로에 측정된 세션이 없습니다.');
  expect(screen.queryByText(/1 ~ 0번째/)).toBeNull();
  expect(screen.getByRole('button',{name:'다음 세션'}).hasAttribute('disabled')).toBe(true);
 });
 it.each([401,403])('suppresses stale session rows and notifies the parent on access denial %i',async status=>{
  const denied=vi.fn();let finish!:(value:Response)=>void;
  vi.mocked(fetch).mockResolvedValueOnce(Response.json(sessions([session()]))).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  const view=render(<SessionsPanel {...range} revision={0} onAccessDenied={denied}/>);
  fireEvent.click(screen.getByRole('button',{name:'세션별 경로 보기'}));
  await screen.findByRole('button',{name:'10000000 세션 경로 보기'});
  view.rerender(<SessionsPanel {...range} revision={1} onAccessDenied={denied}/>);
  expect(screen.queryByRole('region',{name:'익명 세션 경로 목록'})).toBeNull();
  await act(async()=>finish(Response.json({error:'denied'},{status})));
  await screen.findByRole('alert');expect(denied).toHaveBeenCalledOnce();
  expect(screen.queryByRole('button',{name:'10000000 세션 경로 보기'})).toBeNull();
 });
 it('abandons an outdated date response when a later request finishes first',async()=>{
  let resolveOld!:(value:Response)=>void;
  vi.mocked(fetch).mockImplementationOnce(()=>new Promise(resolve=>{resolveOld=resolve;})).mockResolvedValueOnce(Response.json(sessions([session(5)])));
  const denied=vi.fn(),view=render(<SessionsPanel {...range} revision={0} onAccessDenied={denied}/>);
  fireEvent.click(screen.getByRole('button',{name:'세션별 경로 보기'}));
  view.rerender(<SessionsPanel from='2026-11-21' to='2026-11-26' revision={0} onAccessDenied={denied}/>);
  await screen.findByRole('button',{name:'10000005 세션 경로 보기'});
  await act(async()=>resolveOld(Response.json(sessions([session()]))));
  expect(screen.queryByRole('button',{name:'10000000 세션 경로 보기'})).toBeNull();
  expect(screen.getByRole('button',{name:'10000005 세션 경로 보기'})).toBeTruthy();
 });
});
