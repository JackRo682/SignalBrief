import {pageDataCache} from '../src/lib/page-data-cache';
import '@testing-library/jest-dom/vitest';
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import DesktopQuestions from '../src/desktop/questions';
import {answerSchema,type Answer} from '../src/lib/contracts';
import {defaults} from '../src/workspace/contracts';
import {APIError} from '../src/lib/api';
import {eventDetails,eventId,events,fixtureNow} from '../e2e/mobile-fixture';

const mock=vi.hoisted(()=>({request:vi.fn(),replace:vi.fn(),copy:vi.fn(),owner:'synthetic-owner-a',text:(ko:string)=>ko,date:(iso:string|null)=>iso??'확인 전'}));
vi.mock('../src/components/auth',()=>({useAuth:()=>({token:`token-${mock.owner}`,me:{id:mock.owner,demo_mode:false}})}));
vi.mock('../src/workspace/preferences',()=>({usePrefs:()=>({value:defaults,text:mock.text,date:mock.date})}));
vi.mock('../src/lib/api',async original=>({...await original<typeof import('../src/lib/api')>(),request:mock.request}));
vi.mock('next/navigation',()=>({useRouter:()=>({replace:mock.replace}),useSearchParams:()=>new URLSearchParams(window.location.search)}));
type History={id:string;event_id:string;question:string;answer:Answer;created_at:string};
let history:History[],failAsk:boolean,failHistory:boolean,failClear:boolean,failDetail:boolean;
const detail=eventDetails.get(eventId)!;
const evidence={source_id:detail.facts[0].id,quote:detail.facts[0].quote,source_url:detail.document.source_url,location:detail.evidence[0].location};
const answer=answerSchema.parse({status:'answered',message:'Persisted synthetic answer with exact evidence.',evidence:[evidence],run_id:null,mode:'extractive'});
function saved(id='saved-one',idOfEvent=eventId):History{return {id,event_id:idOfEvent,question:`Saved question ${id}`,answer,created_at:fixtureNow};}
beforeEach(()=>{
 pageDataCache.reset();
 vi.clearAllMocks();mock.owner='synthetic-owner-a';history=[];failAsk=false;failHistory=false;failClear=false;failDetail=false;
 window.history.replaceState({},'',`/questions?event=${eventId}`);
 Object.defineProperty(HTMLElement.prototype,'scrollIntoView',{configurable:true,value:vi.fn()});
 Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:function(this:HTMLDialogElement){this.setAttribute('open','');}});
 Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:mock.copy}});mock.copy.mockResolvedValue(undefined);
 mock.request.mockImplementation(async(path:string,_token:unknown,_schema:unknown,init?:RequestInit)=>{
  if(path.startsWith('/v1/feed?'))return {items:events,total:events.length,has_more:false,truncated:false,latest_ingested_at:fixtureNow,stale:false,demo_mode:false,generated_at:fixtureNow};
  if(path==='/v1/questions'){
   if(init?.method==='DELETE'){if(failClear)throw new Error('Synthetic history deletion denied');history=[];return undefined;}
   if(failHistory)throw new APIError(503,'history_unavailable');return structuredClone(history);
  }
  if(path.endsWith('/questions')){
   if(failAsk)throw new Error('Synthetic question request failed');
   const sent=JSON.parse(String(init?.body));history.unshift({...saved(`saved-${history.length+1}`,path.split('/')[3]),question:sent.question});return answer;
  }
  if(path.startsWith('/v1/events/')){if(failDetail)throw new APIError(403,'event_forbidden');return eventDetails.get(path.split('/')[3]);}
  throw new Error(`Unexpected request ${path}`);
 });
});
afterEach(cleanup);
async function ready(){render(<DesktopQuestions eventId={eventId}/>);await waitFor(()=>expect(screen.getByRole('textbox',{name:'공시에 관한 질문'})).toBeEnabled());}

describe('PC evidence follow-up uses persisted source material',()=>{
 it('renders all exact citations, dynamic numbering and only safe source links',async()=>{
  const citations=Array.from({length:12},(_,i)=>({...evidence,source_id:`source-${i}`,location:`Exact location ${i+1}`,quote:i===11?'Full quote preserved. '.repeat(180):`Source quote ${i+1}`,source_url:i===10?'javascript:alert(1)':evidence.source_url}));
  history=[{...saved(),answer:{...answer,evidence:citations}}];await ready();
  const article=screen.getByRole('article',{name:'AI 근거 답변'});
  expect(within(article).getAllByRole('listitem')).toHaveLength(12);
  expect(within(article).getByRole('button',{name:'근거 12 보기'})).toHaveTextContent('12');
  expect(within(article).getByText(citations[11].quote.trim())).toBeVisible();
  expect(within(article).getAllByRole('link',{name:'원문 근거'})).toHaveLength(11);
  expect(within(article).getByText('원문 링크 확인 필요')).toBeVisible();
  expect(document.querySelectorAll('.pc-question-sources li')).toHaveLength(12);
  expect(screen.getByRole('link',{name:'모든 출처 보기'})).toHaveAttribute('href',`/events/${eventId}?panel=evidence`);
  expect(screen.getByText('자료 업로드와 답변 평가는 현재 제공하지 않습니다.')).toBeVisible();
 });
 it('sends the real suggested question and reconciles persisted responses without duplicates',async()=>{
  await ready();fireEvent.click(screen.getByRole('button',{name:'매출 수치 근거'}));
  const input=screen.getByRole('textbox',{name:'공시에 관한 질문'});expect(input).toHaveValue('매출 수치의 근거를 보여줘');expect(input).toHaveFocus();
  fireEvent.click(screen.getByRole('button',{name:'질문 보내기'}));
  await waitFor(()=>expect(screen.getAllByRole('article',{name:'AI 근거 답변'})).toHaveLength(1));
  await waitFor(()=>expect(input).toBeEnabled());expect(input).toHaveValue('');
  expect(mock.request).toHaveBeenCalledWith(`/v1/events/${eventId}/questions`,'token-synthetic-owner-a',expect.anything(),{method:'POST',body:JSON.stringify({question:'매출 수치의 근거를 보여줘'})});
  fireEvent.click(screen.getByRole('button',{name:'매출 수치 근거'}));fireEvent.click(screen.getByRole('button',{name:'질문 보내기'}));
  await waitFor(()=>expect(history).toHaveLength(2));await waitFor(()=>expect(input).toBeEnabled());
  expect(screen.getAllByRole('article',{name:'AI 근거 답변'})).toHaveLength(2);
  cleanup();await ready();expect(screen.getAllByRole('article',{name:'AI 근거 답변'})).toHaveLength(2);
 });
 it('retains the composed question on failure and allows a successful retry',async()=>{
  failAsk=true;await ready();fireEvent.click(screen.getByRole('button',{name:'위험 요인 확인'}));fireEvent.click(screen.getByRole('button',{name:'질문 보내기'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Synthetic question request failed');expect(history).toHaveLength(0);
  expect(screen.getByRole('textbox',{name:'공시에 관한 질문'})).toHaveValue('위험 요인의 원문을 보여줘');
  failAsk=false;fireEvent.click(screen.getByRole('button',{name:'질문 보내기'}));await screen.findByRole('article',{name:'AI 근거 답변'});
 });
 it('loads a selected saved question for its own event without retaining the previous event context',async()=>{
  history=[saved('first'),{...saved('second',events[1].id),answer:{...answer,message:'Different event answer'}}];
  const view=render(<DesktopQuestions eventId={eventId}/>);await screen.findByText(answer.message);
  fireEvent.click(screen.getByRole('button',{name:'질문 기록'}));const dialog=screen.getByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button',{name:/Saved question second/}));
  expect(mock.replace).toHaveBeenCalledWith(`/questions?event=${events[1].id}&question=second`,{scroll:false});
  window.history.replaceState({},'',`/questions?event=${events[1].id}&question=second`);view.rerender(<DesktopQuestions eventId={events[1].id}/>);
  expect(screen.queryByText(answer.message)).not.toBeInTheDocument();
  expect(await screen.findByText('Different event answer')).toBeVisible();
  expect(screen.getByRole('heading',{name:events[1].headline})).toBeVisible();
  expect(document.getElementById('pc-question-second')).toHaveClass('selected');
 });
 it('requires explicit confirmation to delete history and preserves it when deletion fails',async()=>{
  history=[saved()];await ready();fireEvent.click(screen.getByRole('button',{name:'질문 기록'}));const dialog=screen.getByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button',{name:'기록 삭제'}));expect(mock.request.mock.calls.some(([path,,,init])=>path==='/v1/questions'&&init?.method==='DELETE')).toBe(false);
  failClear=true;fireEvent.click(within(dialog).getByRole('button',{name:'모든 질문 기록 삭제'}));expect(await within(dialog).findByRole('alert')).toHaveTextContent('Synthetic history deletion denied');expect(history).toHaveLength(1);
  failClear=false;fireEvent.click(within(dialog).getByRole('button',{name:'모든 질문 기록 삭제'}));await within(dialog).findByText('저장된 질문이 없습니다.');expect(screen.queryByRole('article',{name:'AI 근거 답변'})).toBeNull();
 });
 it('copies the exact answer and citations and reports clipboard failure honestly',async()=>{
  history=[saved()];await ready();fireEvent.click(screen.getByRole('button',{name:'복사하기'}));
  await screen.findByText('답변과 원문 근거를 복사했습니다.');expect(mock.copy).toHaveBeenCalledWith(`${answer.message}\n\n[1] ${evidence.location}\n${evidence.quote}\n${evidence.source_url}`);
  mock.copy.mockRejectedValueOnce(new Error('Denied'));fireEvent.click(screen.getByRole('button',{name:'복사하기'}));expect(await screen.findByRole('alert')).toHaveTextContent('복사하지 못했습니다.');
 });
 it('blocks questions when event authorization fails and retries the actual resource',async()=>{
  failDetail=true;render(<DesktopQuestions eventId={eventId}/>);expect(await screen.findByRole('alert')).toHaveTextContent('이 작업에 접근할 권한이 없습니다.');expect(screen.queryByRole('heading',{name:detail.event.headline})).toBeNull();expect(screen.getByRole('textbox',{name:'공시에 관한 질문'})).toBeDisabled();
  failDetail=false;fireEvent.click(screen.getByRole('button',{name:'다시 시도'}));await waitFor(()=>expect(screen.getByRole('textbox',{name:'공시에 관한 질문'})).toBeEnabled());
 });
 it('does not silently replace failed history with a new question',async()=>{
  failHistory=true;render(<DesktopQuestions eventId={eventId}/>);expect(await screen.findByRole('alert')).toHaveTextContent('요청을 처리하지 못했습니다 (history_unavailable)');expect(screen.getByRole('textbox',{name:'공시에 관한 질문'})).toBeDisabled();
  failHistory=false;fireEvent.click(screen.getByRole('button',{name:'다시 시도'}));await waitFor(()=>expect(screen.getByRole('textbox',{name:'공시에 관한 질문'})).toBeEnabled());
 });
 it('opens event selection from the context control and retains existing saved history for a new question',async()=>{
  history=[saved()];await ready();fireEvent.click(screen.getByRole('button',{name:'이벤트 선택 및 질문 기록'}));const dialog=screen.getByRole('dialog');
  fireEvent.change(within(dialog).getByRole('combobox',{name:'질문할 이벤트'}),{target:{value:events[1].id}});expect(mock.replace).toHaveBeenCalledWith(`/questions?event=${events[1].id}`,{scroll:false});
  fireEvent.click(screen.getByRole('button',{name:'새 대화'}));expect(mock.replace).toHaveBeenCalledWith('/questions',{scroll:false});expect(history).toHaveLength(1);expect(mock.request.mock.calls.some(([, , , init])=>init?.method==='DELETE')).toBe(false);
 });
 it('does not keep another account’s conversation after the authenticated owner changes',async()=>{
  history=[saved()];const view=render(<DesktopQuestions eventId={eventId}/>);await screen.findByText(answer.message);
  mock.owner='synthetic-owner-b';history=[];view.rerender(<DesktopQuestions eventId={eventId}/>);
  expect(screen.queryByText(answer.message)).toBeNull();await screen.findByText('어떤 근거가 궁금하신가요?');expect(screen.queryByRole('article',{name:'AI 근거 답변'})).toBeNull();
 });
});
