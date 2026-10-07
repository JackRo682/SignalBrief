import {pageDataCache} from '../src/lib/page-data-cache';
import '@testing-library/jest-dom/vitest';
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {DesktopToday} from '../src/desktop/today';
import {defaults} from '../src/workspace/contracts';
import {companies,events,fixtureNow} from '../e2e/mobile-fixture';
import {type Company} from '../src/lib/contracts';

const mocks=vi.hoisted(()=>({request:vi.fn(),quotes:[] as {symbol:string;price:number|null;currency:string;change_pct:number|null;as_of:string;source:string;history:{date:string;close:number}[]}[],reason:'',reload:vi.fn(),text:(ko:string)=>ko,date:(v:string|null)=>v??'확인 전'}));
vi.mock('../src/components/auth',()=>({useAuth:()=>({token:'isolated-desktop-test',me:{id:'synthetic-owner',display_name:'소스검증',onboarding_completed:true}})}));
vi.mock('../src/workspace/preferences',()=>({usePrefs:()=>({value:defaults,text:mocks.text,date:mocks.date})}));
vi.mock('../src/lib/api',async original=>({...await original<typeof import('../src/lib/api')>(),request:mocks.request}));
vi.mock('../src/workspace/market',()=>({useQuotes:()=>({quotes:mocks.quotes,loading:false,reason:mocks.reason})}));
let failFeed:boolean,watched:Company[],calendar:{id:string;title:string;occurs_on:string;company_id:string|null;event_id:string|null;origin:string;quote:string|null;source_url:string|null;is_demo:boolean}[];
const holding={id:'position',company:companies[0],quantity:'32.00000000',average_cost:'120.00000000',currency:'USD'};
beforeEach(()=>{
 pageDataCache.reset();
 vi.clearAllMocks();vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date(fixtureNow));failFeed=false;watched=companies.slice(0,2);mocks.reason='';
 mocks.quotes=[{symbol:'NVDA',price:146.76,currency:'USD',change_pct:3.47,as_of:fixtureNow,source:'Synthetic quote',history:[]},{symbol:'AAPL',price:231.48,currency:'USD',change_pct:-1.23,as_of:fixtureNow,source:'Synthetic quote',history:[]}];
 calendar=[{id:'calendar-event',title:'Synthetic dated event',occurs_on:'2026-10-06',company_id:companies[0].id,event_id:events[0].id,origin:'official',quote:'Synthetic date evidence',source_url:events[0].source_url,is_demo:false}];
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({base:'USD',quote:'KRW',rate:1350,date:'2026-10-06',source:'Synthetic daily reference',kind:'daily_reference'})}));
 mocks.request.mockImplementation(async(path:string)=>{
  if(path==='/v1/watchlist')return {id:'watch',name:'Synthetic watchlist',items:watched};
  if(path==='/v1/portfolio')return {id:'portfolio',name:'Synthetic portfolio',weighting_note:'Membership only',positions:[holding]};
  if(path==='/v1/notifications')return events.slice(0,3).map((event,index)=>({id:`notice-${index}`,event,read_at:index===0?null:fixtureNow,created_at:fixtureNow}));
  if(path.startsWith('/v1/calendar?'))return calendar;
  if(path.startsWith('/v1/feed?')){if(failFeed)throw new Error('Synthetic feed unavailable');return {items:events.slice(0,5),total:events.length,has_more:true,truncated:false,latest_ingested_at:fixtureNow,stale:false,demo_mode:false,generated_at:fixtureNow};}
  throw new Error(`Unexpected desktop dashboard request ${path}`);
 });
});
afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals();});

describe('PC dashboard uses account data and explicit provider coverage',()=>{
 it('values real positions exactly, shows actual unread counts, and never fills missing market indices',async()=>{
  render(<DesktopToday/>);await screen.findByText('6,340,032원');
  expect(screen.getByText(/소스검증님/)).toBeVisible();
  const summaries=document.querySelectorAll('.pc-today-summary');
  expect(summaries[1]).toHaveTextContent('2개');expect(summaries[2]).toHaveTextContent('1개');
  expect(screen.getAllByText('지수 데이터 미연결')).toHaveLength(4);
  expect(screen.queryByText('2,687.24')).not.toBeInTheDocument();
  expect(screen.getByText(/2026-10-06 · 일일 기준/)).toBeVisible();
  expect(document.querySelector('.pc-today-gainers')).toHaveTextContent('NVDA');
  expect(document.querySelector('.pc-today-gainers')).not.toHaveTextContent('AAPL');
 });
 it('keeps the total unavailable when a holding has no quote instead of displaying zero or a partial total',async()=>{
  mocks.quotes=[];mocks.reason='license_required';render(<DesktopToday/>);
  await screen.findByText('2개');
  expect(document.querySelector('.pc-today-summary-main>b')).toHaveTextContent('—');
  expect(screen.queryByText('6,340,032원')).not.toBeInTheDocument();
  expect(screen.getByText(/전체 시세가 없으면 총 평가액을 계산하지 않습니다/)).toBeVisible();
  expect(screen.getByText('확인된 상승 종목이 없습니다.')).toBeVisible();
 });
 it('uses verified event and company destinations and the user timezone for the calendar request',async()=>{
  calendar.push({...calendar[0],id:'company-only',title:'Synthetic company event',event_id:null});
  calendar.push({...calendar[0],id:'personal',title:'Synthetic personal event',event_id:null,company_id:null,origin:'personal'});
  render(<DesktopToday/>);const event=await screen.findByRole('link',{name:/Synthetic dated event/});
  expect(event).toHaveAttribute('href',`/events/${events[0].id}`);
  expect(screen.getByRole('link',{name:/Synthetic company event/})).toHaveAttribute('href',`/companies/${companies[0].id}`);
  expect(screen.getByRole('link',{name:/Synthetic personal event/})).toHaveAttribute('href','/calendar');
  expect(mocks.request.mock.calls.some(([path])=>path==='/v1/calendar?from_date=2026-10-06&until_date=2026-11-05')).toBe(true);
 });
 it('shows an API error, preserves the retry action, and resolves to the actual event list',async()=>{
  failFeed=true;render(<DesktopToday/>);const error=await screen.findByRole('alert');expect(error).toHaveTextContent('서버에 연결하지 못했습니다');
  failFeed=false;fireEvent.click(within(error).getByRole('button',{name:'다시 시도'}));
  await waitFor(()=>expect(document.querySelectorAll('.pc-today-change')).toHaveLength(5));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(document.querySelector('.pc-today-event-title')).toHaveAttribute('href',`/events/${events[0].id}`);
 });
 it('excludes old, invalid and out-of-range calendar dates when the hosted API returns a broad collection',async()=>{
  const source=calendar[0];calendar=[['2026-10-05','Past event'],['2026-10-06','Today event'],['2026-11-05','Thirty-day boundary'],['2026-11-06','Beyond thirty days'],['invalid-date','Invalid date']].map(([occurs_on,title],index)=>({...source,id:`calendar-${index}`,occurs_on,title}));
  render(<DesktopToday/>);await screen.findByRole('link',{name:/Today event/});
  expect(screen.getByRole('link',{name:/Thirty-day boundary/})).toBeVisible();
  expect(screen.queryByText('Past event')).not.toBeInTheDocument();expect(screen.queryByText('Beyond thirty days')).not.toBeInTheDocument();expect(screen.queryByText('Invalid date')).not.toBeInTheDocument();
  expect(document.querySelectorAll('.pc-today-calendar-row')).toHaveLength(2);
 });
 it('does not derive watchlist performance from missing prices or user sample data',async()=>{
  watched=[];render(<DesktopToday/>);await screen.findByText('0개');
  const summary=document.querySelectorAll('.pc-today-summary')[1];
  expect(summary).toHaveTextContent('—');expect(summary).toHaveTextContent('기업 추가');
  expect(summary).not.toHaveTextContent('+4.1%');
  expect(screen.getByRole('link',{name:/시장의 중요한 변화를 놓치지 마세요/})).toHaveAttribute('href','/settings/notifications');
 });
});
