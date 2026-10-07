import {pageDataCache} from '../src/lib/page-data-cache';
import {cleanup, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {DesktopExplore, DesktopSearchResults} from '../src/desktop/search';
import DesktopWatchlist from '../src/desktop/watchlist';
import {WorkspacePreferences} from '../src/workspace/preferences';
import {defaults, type Preferences, type Resource} from '../src/workspace/contracts';
import type {Company} from '../src/lib/contracts';

// Synthetic responses are isolated UI test fixtures and never reach production.
const mocks=vi.hoisted(()=>({workspace:vi.fn(),request:vi.fn(),push:vi.fn(),noDaily:false}));
vi.mock('next/navigation',()=>({useRouter:()=>({push:mocks.push})}));
vi.mock('@/components/auth',()=>({useAuth:()=>({token:'desktop-fixture-token',me:{id:'desktop-user',display_name:'테스트'}})}));
vi.mock('@/workspace/client',async original=>({...await original<typeof import('../src/workspace/client')>(),workspace:mocks.workspace}));
vi.mock('@/lib/api',async original=>({...await original<typeof import('../src/lib/api')>(),request:mocks.request}));
vi.mock('@/workspace/market',()=>({useQuotes:()=>({loading:false,reason:'partial_provider_unavailable',quotes:[{symbol:'NVDA',price:102,currency:'USD',change_pct:mocks.noDaily?null:2,as_of:'2026-10-06T20:00:00Z',source:'Synthetic provider',history:[{date:'2026-10-05',close:100},{date:'2026-10-06',close:102}]},{symbol:'AAPL',price:97,currency:'USD',change_pct:mocks.noDaily?null:-3,as_of:'2026-10-06T20:00:00Z',source:'Synthetic provider',history:[]}]})}));
const companyId='20000000-0000-4000-8000-000000000001',secondId='20000000-0000-4000-8000-000000000002',thirdId='20000000-0000-4000-8000-000000000003';
const company:Resource={id:companyId,kind:'company',title:'Synthetic Alpha',summary:'Verified synthetic company description',company_id:companyId,company_name:'Synthetic Alpha',ticker:'NVDA',market:'NASDAQ',source_url:null,published_at:null,publication_precision:'timestamp',category:'company',is_saved:false};
const event:Resource={...company,id:'30000000-0000-4000-8000-000000000001',kind:'event',title:'Synthetic reviewed event',summary:'Synthetic evidence summary',category:'earnings',published_at:'2026-10-01T00:00:00Z',publication_precision:'date'};
const filing:Resource={...company,id:'40000000-0000-4000-8000-000000000001',kind:'filing',title:'Synthetic original filing',category:'10-K',published_at:'2026-10-01T00:00:00Z',source_url:'https://www.sec.gov/Archives/synthetic.htm'};
const companies:Company[]=[{id:companyId,name:'Synthetic Alpha',ticker:'NVDA',market:'NASDAQ',provider:'sec',is_demo:true,last_ingested_at:null},{id:secondId,name:'Synthetic Beta',ticker:'AAPL',market:'NYSE',provider:'sec',is_demo:true,last_ingested_at:null},{id:thirdId,name:'Synthetic Gamma',ticker:'MSFT',market:'NASDAQ',provider:'sec',is_demo:true,last_ingested_at:null}];
let preferences:Preferences,version:number,searches:{query:string;searched_at:string}[],watched:Company[],saved:boolean;
let failSearch=false,failBookmark=false,failPreferences=false,failAdd=false,failRemove='';
function mount(node:React.ReactNode){return render(<WorkspacePreferences><div className="sb-pc">{node}</div></WorkspacePreferences>);}
beforeEach(()=>{
 pageDataCache.reset();
 vi.clearAllMocks();mocks.noDaily=false;preferences={...defaults,history_enabled:true,muted_companies:[]};version=0;searches=[{query:'NVDA',searched_at:'2026-10-01T00:00:00Z'},{query:'10-K',searched_at:'2026-10-01T00:00:00Z'}];watched=companies.slice(0,2);saved=false;failSearch=failBookmark=failPreferences=failAdd=false;failRemove='';
 mocks.workspace.mockImplementation(async(_token,req)=>{
  if(req.action==='preferences')return {value:{...preferences},version};
  if(req.action==='preferences_save'){if(failPreferences)throw new Error('Synthetic preference write failed');expect(req.p.version).toBe(version);preferences={...preferences,...req.p.value};version++;return {value:{...preferences},version};}
  if(req.action==='catalog'){const resources=[company,{...event,is_saved:saved},filing],items=resources.filter(item=>(!req.p.kind||item.kind===req.p.kind||req.p.kind==='document'&&item.kind==='filing')&&(!req.p.market||item.market===req.p.market));return {items:items.slice(req.p.offset??0,(req.p.offset??0)+(req.p.limit??50)),total:items.length,counts:{company:1,event:1,filing:1},markets:['NASDAQ','NYSE'],next_offset:null};}
  if(req.action==='searches')return [...searches];
  if(req.action==='search_delete'){if(failSearch)throw new Error('Synthetic history write failed');searches=searches.filter(item=>item.query!==req.p.query);return {deleted:true};}
  if(req.action==='searches_clear'){searches=[];return {cleared:true};}
  if(req.action==='save'){if(failBookmark)throw new Error('Synthetic bookmark write failed');saved=req.p.saved;return {saved};}
  return {recorded:true};
 });
 mocks.request.mockImplementation(async(path,_token,_schema,options)=>{
  if(path==='/v1/watchlist')return {id:'fixture-watchlist',name:'Watchlist',items:[...watched]};
  if(path.startsWith('/v1/watchlist/')){const id=path.split('/').at(-1);if(options?.method==='PUT'){if(failAdd)throw new Error('Synthetic add failed');watched=[...watched,...companies.filter(item=>item.id===id&&!watched.some(current=>current.id===id))];}else if(options?.method==='DELETE'){if(failRemove===id)throw new Error('Synthetic remove failed');watched=watched.filter(item=>item.id!==id);}return undefined;}
  if(path.startsWith('/v1/companies?'))return companies;
  if(path.startsWith('/v1/feed?'))return {items:[],total:0,has_more:false,truncated:false};
  if(path.startsWith('/v1/notifications?'))return [];
  throw new Error(`Unexpected fixture request: ${path}`);
 });
 HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
});
afterEach(cleanup);

describe('desktop exploration and search',()=>{
 it('searches actual selected markets and identifies unsupported metric filters',async()=>{
  mount(<DesktopExplore/>);await screen.findByRole('button',{name:'NVDA 검색 기록 삭제'});
  fireEvent.change(screen.getByLabelText('시장 필터'),{target:{value:'NASDAQ'}});
  fireEvent.change(screen.getByLabelText('기업, 키워드 또는 산업 검색'),{target:{value:' NVDA '}});
  fireEvent.click(screen.getByRole('button',{name:'검색'}));
  let params=new URL(mocks.push.mock.calls.at(-1)![0],'https://fixture.example').searchParams;
  expect(params.get('q')).toBe('NVDA');expect(params.get('market')).toBe('NASDAQ');
  fireEvent.click(screen.getByRole('button',{name:'반도체'}));
  params=new URL(mocks.push.mock.calls.at(-1)![0],'https://fixture.example').searchParams;
  expect(params.get('q')).toBe('semiconductor');expect(params.get('market')).toBe('NASDAQ');
  expect((screen.getByRole('button',{name:'PER ⌄'}) as HTMLButtonElement).disabled).toBe(true);
 });

 it('keeps failed history deletions visible, and persists successful deletion across remounts',async()=>{
  failSearch=true;const first=mount(<DesktopExplore/>);fireEvent.click(await screen.findByRole('button',{name:'NVDA 검색 기록 삭제'}));
  await screen.findByText('Synthetic history write failed');expect(screen.getByRole('button',{name:'NVDA 검색 기록 삭제'})).toBeTruthy();
  failSearch=false;fireEvent.click(screen.getByRole('button',{name:'NVDA 검색 기록 삭제'}));
  await waitFor(()=>expect(screen.queryByRole('button',{name:'NVDA 검색 기록 삭제'})).toBeNull());
  first.unmount();mount(<DesktopExplore/>);await screen.findByRole('button',{name:'10-K 검색 기록 삭제'});expect(screen.queryByRole('button',{name:'NVDA 검색 기록 삭제'})).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'전체 삭제'}));await screen.findByText('최근 검색어가 없습니다');
  expect(mocks.workspace.mock.calls.some(([,req])=>req.action==='history_clear')).toBe(false);
 });

 it('shows separate event and filing groups and preserves filters when switching result type',async()=>{
  mount(<DesktopSearchResults initial="NVDA" initialKind="" initialMarket="NASDAQ" initialDays={30} initialSort="newest"/>);
  const eventLink=await screen.findByRole('link',{name:'Synthetic reviewed event'}),documentLink=await screen.findByRole('link',{name:'Synthetic original filing'});
  expect(eventLink.getAttribute('href')).toBe(`/events/${event.id}`);expect(documentLink.getAttribute('href')).toBe(`/documents/${filing.id}?kind=filing`);
  const nav=screen.getByRole('navigation',{name:'검색 결과 유형'});fireEvent.click(within(nav).getByRole('button',{name:'문서 (1)'}));
  const params=new URL(mocks.push.mock.calls.at(-1)![0],'https://fixture.example').searchParams;
  expect(Object.fromEntries(params)).toEqual({q:'NVDA',kind:'document',market:'NASDAQ',days:'30',sort:'newest'});
  expect(screen.queryByText('PDF')).toBeNull();
 });

 it('resets pagination when market changes without dropping the query or date filter',async()=>{
  mount(<DesktopSearchResults initial="NVDA" initialKind="event" initialMarket="NASDAQ" initialDays={30} initialOffset={12}/>);
  await screen.findByText("'NVDA'에 대한 3개의 검색 결과를 찾았습니다.");fireEvent.change(screen.getByLabelText('시장 필터'),{target:{value:'NYSE'}});
  const params=new URL(mocks.push.mock.calls.at(-1)![0],'https://fixture.example').searchParams;
  expect(params.get('offset')).toBeNull();expect(params.get('q')).toBe('NVDA');expect(params.get('days')).toBe('30');expect(params.get('kind')).toBe('event');expect(params.get('market')).toBe('NYSE');
 });

 it('shows a custom URL duration in both controls and preserves it when sorting',async()=>{
  mount(<DesktopSearchResults initial="NVDA" initialKind="event" initialDays={14}/>);
  await screen.findByRole('link',{name:'Synthetic reviewed event'});
  const period=screen.getByLabelText('기간 필터') as HTMLSelectElement;
  expect(period.value).toBe('14');expect(period.selectedOptions[0].text).toBe('최근 14일');
  expect((screen.getByRole('radio',{name:'최근 14일'}) as HTMLInputElement).checked).toBe(true);
  fireEvent.change(screen.getByLabelText('정렬 기준'),{target:{value:'newest'}});
  const params=new URL(mocks.push.mock.calls.at(-1)![0],'https://fixture.example').searchParams;
  expect(params.get('days')).toBe('14');expect(params.get('kind')).toBe('event');expect(params.get('q')).toBe('NVDA');
  expect(mocks.workspace.mock.calls.some(([,req])=>req.action==='catalog'&&req.p.days===14&&req.p.kind==='event')).toBe(true);
 });

 it('keeps filing-only URLs distinct from the combined document filter and counts',async()=>{
  const original=mocks.workspace.getMockImplementation()!;
  mocks.workspace.mockImplementation(async(token,req)=>{
   const result=await original(token,req);
   return req.action==='catalog'?{...result,counts:{company:1,event:1,document:2,filing:1}}:result;
  });
  mount(<DesktopSearchResults initial="NVDA" initialKind="filing" initialDays={14} initialMarket="NASDAQ"/>);
  await screen.findByRole('link',{name:'Synthetic original filing'});
  expect((screen.getByLabelText('자료 유형') as HTMLSelectElement).value).toBe('filing');
  const nav=screen.getByRole('navigation',{name:'검색 결과 유형'});
  const tab=within(nav).getByRole('button',{name:'공시 문서 (1)'});
  expect(tab.getAttribute('aria-pressed')).toBe('true');expect(screen.getByRole('heading',{name:'공시 문서 1개'})).toBeTruthy();
  expect((screen.getByRole('radio',{name:'공시 문서 1'}) as HTMLInputElement).checked).toBe(true);
  expect((screen.getByRole('radio',{name:'문서 3'}) as HTMLInputElement).checked).toBe(false);
  fireEvent.change(screen.getByLabelText('시장 필터'),{target:{value:'NYSE'}});
  let params=new URL(mocks.push.mock.calls.at(-1)![0],'https://fixture.example').searchParams;
  expect(params.get('kind')).toBe('filing');expect(params.get('days')).toBe('14');
  expect(mocks.workspace.mock.calls.some(([,req])=>req.action==='catalog'&&req.p.kind==='filing')).toBe(true);
  fireEvent.change(screen.getByLabelText('자료 유형'),{target:{value:'document'}});
  params=new URL(mocks.push.mock.calls.at(-1)![0],'https://fixture.example').searchParams;
  expect(params.get('kind')).toBe('document');expect(params.get('q')).toBe('NVDA');expect(params.get('days')).toBe('14');
 });

 it('records searches only with history consent, and keeps failed bookmarks unchanged',async()=>{
  preferences.history_enabled=false;failBookmark=true;const first=mount(<DesktopSearchResults initial="NVDA" initialKind=""/>);
  const save=await screen.findByRole('button',{name:'Synthetic reviewed event 저장'});fireEvent.click(save);await screen.findByText('Synthetic bookmark write failed');expect(save.getAttribute('aria-pressed')).toBe('false');
  expect(mocks.workspace.mock.calls.some(([,req])=>req.action==='search_record')).toBe(false);
  failBookmark=false;fireEvent.click(save);await screen.findByRole('button',{name:'Synthetic reviewed event 저장 취소'});
  first.unmount();preferences.history_enabled=true;mount(<DesktopSearchResults initial="NVDA" initialKind=""/>);
  expect((await screen.findByRole('button',{name:'Synthetic reviewed event 저장 취소'})).getAttribute('aria-pressed')).toBe('true');
  await waitFor(()=>expect(mocks.workspace.mock.calls.filter(([,req])=>req.action==='search_record')).toHaveLength(1));
 });
});

describe('desktop watchlist persistence and quote truthfulness',()=>{
 it('filters and sorts actual daily changes while leaving unavailable quotes unknown',async()=>{
  watched=[{...companies[0],name:'Synthetic Zeta'},companies[1],companies[2]];mount(<DesktopWatchlist/>);await screen.findByRole('link',{name:'Synthetic Gamma MSFT · NASDAQ'});
  const table=screen.getByRole('table');expect(within(table).getAllByRole('row')).toHaveLength(4);
  const gamma=within(table).getByRole('link',{name:'Synthetic Gamma MSFT · NASDAQ'}).closest('tr')!;expect(gamma.textContent).toContain('—');expect(gamma.textContent).toContain('추이 미제공');
  fireEvent.change(screen.getByLabelText('관심종목 정렬'),{target:{value:'change'}});expect(within(table).getAllByRole('row')[1].textContent).toContain('Synthetic Zeta');
  fireEvent.change(screen.getByLabelText('관심종목 시장 필터'),{target:{value:'NYSE'}});expect(within(table).getAllByRole('row')).toHaveLength(2);expect(within(table).getByText('Synthetic Beta')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('관심종목 시장 필터'),{target:{value:''}});fireEvent.click(screen.getByRole('button',{name:/상승 종목 1 종목/}));expect(within(table).getAllByRole('row')).toHaveLength(2);expect(within(table).getByText('Synthetic Zeta')).toBeTruthy();
  expect(screen.queryByText('평균 수익률')).toBeNull();
 });

 it('does not present zero rising or falling stocks when prices lack daily-change coverage',async()=>{
  mocks.noDaily=true;mount(<DesktopWatchlist/>);await screen.findByRole('link',{name:'Synthetic Alpha NVDA · NASDAQ'});
  expect(screen.getByRole('button',{name:/상승 종목 — 종목/})).toBeTruthy();expect(screen.getByRole('button',{name:/하락 종목 — 종목/})).toBeTruthy();
  expect(screen.getByText('US$102.00')).toBeTruthy();
 });

 it('does not add on failure and reloads the persisted watchlist after success',async()=>{
  failAdd=true;const first=mount(<DesktopWatchlist/>);await screen.findByRole('link',{name:'Synthetic Alpha NVDA · NASDAQ'});fireEvent.click(screen.getByRole('button',{name:'종목 추가'}));
  fireEvent.click(await screen.findByRole('button',{name:'Synthetic Gamma 추가'}));await screen.findAllByText('Synthetic add failed');expect(within(screen.getByRole('table')).queryByText('Synthetic Gamma')).toBeNull();
  failAdd=false;fireEvent.click(screen.getByRole('button',{name:'Synthetic Gamma 추가'}));await waitFor(()=>expect(within(screen.getByRole('table')).getByText('Synthetic Gamma')).toBeTruthy());
  expect(mocks.request.mock.calls.some(([path,,,options])=>path===`/v1/watchlist/${thirdId}`&&options?.method==='PUT')).toBe(true);
  first.unmount();mount(<DesktopWatchlist/>);expect(await screen.findByRole('link',{name:'Synthetic Gamma MSFT · NASDAQ'})).toBeTruthy();
 });

 it('persists company mutes only after a successful preference write',async()=>{
  failPreferences=true;const first=mount(<DesktopWatchlist/>);const bell=await screen.findByRole('button',{name:'Synthetic Alpha 알림'});await waitFor(()=>expect((bell as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(bell);await screen.findAllByText('Synthetic preference write failed');expect(bell.getAttribute('aria-pressed')).toBe('true');
  failPreferences=false;fireEvent.click(bell);await waitFor(()=>expect(bell.getAttribute('aria-pressed')).toBe('false'));expect(preferences.muted_companies).toEqual([companyId]);
  first.unmount();mount(<DesktopWatchlist/>);await waitFor(()=>expect(screen.getByRole('button',{name:'Synthetic Alpha 알림'}).getAttribute('aria-pressed')).toBe('false'));
 });

 it('retains the failed remainder after a partially successful bulk removal',async()=>{
  failRemove=secondId;mount(<DesktopWatchlist/>);await screen.findByRole('link',{name:'Synthetic Alpha NVDA · NASDAQ'});
  fireEvent.click(screen.getByRole('checkbox',{name:'표시된 관심종목 전체 선택'}));fireEvent.click(screen.getByRole('button',{name:'선택 삭제'}));await screen.findByText('Synthetic remove failed');
  await waitFor(()=>expect(screen.queryByRole('link',{name:'Synthetic Alpha NVDA · NASDAQ'})).toBeNull());
  expect(screen.getByRole('link',{name:'Synthetic Beta AAPL · NYSE'})).toBeTruthy();expect((screen.getByRole('checkbox',{name:'Synthetic Beta 선택'}) as HTMLInputElement).checked).toBe(true);expect(screen.queryByText('선택한 관심종목을 삭제했습니다.')).toBeNull();
  failRemove='';fireEvent.click(screen.getByRole('button',{name:'선택 삭제'}));await screen.findByText('첫 관심종목을 추가해 보세요.');
 });
});
