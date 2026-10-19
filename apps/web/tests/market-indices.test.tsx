import '@testing-library/jest-dom/vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {MarketIndexCards,MarketIndicesStatus,parseIndices,useMarketIndices} from '../src/components/market-indices';
const session=vi.hoisted(()=>({token:'synthetic-session'}));
vi.mock('@/components/auth',()=>({useAuth:()=>session}));
vi.mock('@/workspace/preferences',()=>({usePrefs:()=>({value:{locale:'ko'},text:(ko:string)=>ko,date:(v:string)=>v})}));
const stamp=new Date().toISOString();
const quote={symbol:'NASDAQ',price:23456.78,currency:'POINTS',change_pct:-1.25,as_of:stamp,source:'FMP',timestamp_kind:'provider_timestamp'};
const response=(indices:unknown[]=[quote],unavailable:unknown[]=[] )=>({indices,unavailable,available:indices.length>0});
function Harness({mobile=false}:{mobile?:boolean}){const state=useMarketIndices();return <><MarketIndexCards state={state} mobile={mobile}/><MarketIndicesStatus state={state}/></>;}
beforeEach(()=>{session.token='synthetic-session';vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json(response())));});
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.useRealTimers();});

describe('homepage market index contract',()=>{
 it('rejects invalid prices, dates and provider metadata independently',()=>{
  for(const patch of [{price:0},{price:-1},{price:'23456'},{price:Infinity},{as_of:'yesterday'},{as_of:new Date(Date.now()+600000).toISOString()},{source:'KIS'},{timestamp_kind:'unknown'}]){
   const result=parseIndices(response([{...quote,...patch},{symbol:'KOSPI',price:2600,currency:'POINTS',change_pct:null,as_of:stamp,source:'KIS',timestamp_kind:'request_observed_at_not_exchange_timestamp'}]));
   expect(result.quotes.NASDAQ).toBeUndefined();expect(result.reasons.NASDAQ).toBe('invalid_response');expect(result.quotes.KOSPI?.price).toBe(2600);
  }
 });
 it('rejects stale, duplicated and conflicting entries, and names missing coverage',()=>{
  expect(parseIndices(response([{...quote,as_of:new Date(Date.now()-8*86400000).toISOString()}])).reasons.NASDAQ).toBe('stale_quote');
  expect(parseIndices(response([quote,quote])).quotes.NASDAQ).toBeUndefined();
  expect(parseIndices(response([quote],[{symbol:'NASDAQ',reason:'index_entitlement_unverified'}])).quotes.NASDAQ).toBeUndefined();
  expect(parseIndices(response()).reasons.KOSPI).toBe('missing_index');
  expect(()=>parseIndices({indices:'bad'})).toThrow();
 });
 for(const mobile of [false,true])it(`loads authenticated indices in the ${mobile?'mobile':'desktop'} cards with provenance`,async()=>{
  const korean={symbol:'KOSPI',price:2600.12,currency:'POINTS',change_pct:null,as_of:stamp,source:'KIS',timestamp_kind:'request_observed_at_not_exchange_timestamp'};
  vi.mocked(fetch).mockResolvedValueOnce(Response.json(response([quote,korean],[{symbol:'KOSDAQ',reason:'missing_credentials'},{symbol:'S&P500',reason:'index_entitlement_unverified'}])));
  render(<Harness mobile={mobile}/>);
  expect(await screen.findByText('23,456.78')).toBeVisible();expect(screen.getByText('-1.25% · FMP')).toBeVisible();
  expect(screen.getByText('등락률 미제공 · KIS')).toBeVisible();expect(screen.getByText('REST 스냅샷 · 거래소 시각 아님')).toBeVisible();
  expect(screen.getByText(/시세 기준/).querySelector('time')).toHaveAttribute('datetime',stamp);
  expect(screen.getByText(/조회 시각/).querySelector('time')).toHaveAttribute('datetime',stamp);
  expect(screen.getByText('공급자 계정 연결 필요')).toBeVisible();expect(screen.getByText('시세 표시 권한 확인 대기')).toBeVisible();
  expect(screen.getAllByRole('link')).toHaveLength(4);
  expect(fetch).toHaveBeenCalledWith('/api/us/indices',expect.objectContaining({headers:{Authorization:'Bearer synthetic-session'},cache:'no-store',signal:expect.any(AbortSignal)}));
 });
 it('shows HTTP failures and retries to actual data',async()=>{
  vi.mocked(fetch).mockResolvedValueOnce(new Response('',{status:502}));render(<Harness/>);
  expect(await screen.findByRole('alert')).toHaveTextContent('HTTP 502');
  fireEvent.click(screen.getByRole('button',{name:'지수 다시 조회'}));
  expect(await screen.findByText('23,456.78')).toBeVisible();expect(screen.queryByRole('alert')).toBeNull();
 });
 it('explains invalid JSON and network failures without fabricating values',async()=>{
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({indices:[]}));const view=render(<Harness/>);
  expect(await screen.findByRole('alert')).toHaveTextContent('지수 응답 형식 오류');
  vi.mocked(fetch).mockRejectedValueOnce(new TypeError('network'));fireEvent.click(screen.getByRole('button',{name:'지수 다시 조회'}));
  await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('지수 API 연결 실패'));
  expect(view.container.querySelectorAll('b')).toHaveLength(4);expect(screen.queryByText('23,456.78')).toBeNull();
 });
 it('identifies malformed JSON as a response error',async()=>{
  vi.mocked(fetch).mockResolvedValueOnce(new Response('<html>upstream failure</html>'));
  render(<Harness/>);expect(await screen.findByRole('alert')).toHaveTextContent('지수 응답 형식 오류');
 });
 it('cancels after 55 seconds and exposes a retry action',async()=>{
  vi.useFakeTimers();vi.mocked(fetch).mockImplementationOnce((_url,init)=>new Promise((_resolve,reject)=>init?.signal?.addEventListener('abort',()=>reject(new DOMException('timeout','AbortError')))));
  render(<Harness/>);await vi.advanceTimersByTimeAsync(55000);vi.useRealTimers();
  expect(await screen.findByRole('alert')).toHaveTextContent('지수 요청 시간 초과');expect(screen.getByRole('button',{name:'지수 다시 조회'})).toBeEnabled();
 });
 it('drops old data on account changes and ignores late responses after logout',async()=>{
  const view=render(<Harness/>);await screen.findByText('23,456.78');
  let resolve!:(r:Response)=>void;vi.mocked(fetch).mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
  session.token='second-session';view.rerender(<Harness/>);expect(screen.queryByText('23,456.78')).toBeNull();
  session.token='';view.rerender(<Harness/>);resolve(Response.json(response()));
  await waitFor(()=>expect(screen.getAllByText('로그인이 필요합니다').length).toBeGreaterThan(0));expect(screen.queryByText('23,456.78')).toBeNull();
 });
 it('does not fetch without a session and reports session expiration',async()=>{
  session.token='';const view=render(<Harness/>);expect(fetch).not.toHaveBeenCalled();
  const expired=vi.fn();window.addEventListener('signalbrief:unauthorized',expired);
  try{session.token='expired';vi.mocked(fetch).mockResolvedValueOnce(new Response('',{status:401}));view.rerender(<Harness/>);await waitFor(()=>expect(expired).toHaveBeenCalledTimes(1));expect(screen.getByRole('alert')).toHaveTextContent('로그인이 필요합니다');}finally{window.removeEventListener('signalbrief:unauthorized',expired);}
 });
});
