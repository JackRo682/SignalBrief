import '@testing-library/jest-dom/vitest';
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import MobileHelp from '../src/mobile/help';
import {defaults} from '../src/workspace/contracts';

const mock=vi.hoisted(()=>({workspace:vi.fn(),upload:vi.fn(),signed:vi.fn(),bucket:vi.fn(),text:(ko:string)=>ko,date:(value:string|null)=>value??'확인 전'}));
const userId='10000000-0000-4000-8000-000000000001',ticketId='10000000-0000-4000-8000-000000000002',stamp='2026-10-06T08:00:00Z';
const me={id:userId,is_admin:false};
type Ticket={id:string;title:string;message:string;category:string;state:'open'|'in_progress'|'resolved';created_at:string;attachments:{filename:string;object_path:string;mime_type:string}[]};
let tickets:Ticket[]=[];
vi.mock('../src/components/auth',()=>({useAuth:()=>({token:'synthetic-token',me})}));
vi.mock('../src/workspace/preferences',()=>({usePrefs:()=>({value:defaults,text:mock.text,date:mock.date})}));
vi.mock('../src/workspace/client',async original=>({...await original<typeof import('../src/workspace/client')>(),workspace:mock.workspace}));
vi.mock('../src/lib/supabase',()=>({initializeSupabase:async()=>({storage:{from:mock.bucket}})}));
beforeEach(()=>{
 vi.clearAllMocks();tickets=[];me.is_admin=false;
 Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:function(this:HTMLDialogElement){this.setAttribute('open','');}});
 mock.bucket.mockReturnValue({upload:mock.upload,createSignedUrl:mock.signed});mock.upload.mockResolvedValue({data:{path:'synthetic'},error:null});mock.signed.mockResolvedValue({data:{signedUrl:'https://example.invalid/synthetic-private-object?token=synthetic'},error:null});
 mock.workspace.mockImplementation(async(_token,request)=>{
  if(request.action==='tickets')return [...tickets];
  if(request.action==='ticket_create'){if(!tickets.length)tickets.push({id:ticketId,title:request.p.title,message:request.p.message,category:request.p.category,state:'open',created_at:stamp,attachments:[]});return tickets[0];}
  if(request.action==='ticket_attach'){tickets[0].attachments=[{filename:request.p.filename,object_path:request.p.object_path,mime_type:request.p.mime_type}];return {attached:true};}
  if(request.action==='ticket_update'){if(!me.is_admin)throw new Error('Synthetic denied');tickets[0]={...tickets[0],state:request.p.state};return {};}
  throw new Error(`Unexpected ${request.action}`);
 });
});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
function openForm(){fireEvent.click(screen.getByRole('button',{name:'문의하기'}));const dialog=screen.getByRole('dialog',{name:'문의하기'});fireEvent.change(within(dialog).getByLabelText('제목'),{target:{value:' Synthetic request '}});fireEvent.change(within(dialog).getByLabelText('문의 내용'),{target:{value:' Synthetic reproduction steps '}});return dialog;}
function png(mime='image/png'){
 const bytes=Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,0,0,0,0,0]),file=new File([bytes],'synthetic-evidence.png',{type:mime});
 // jsdom's File lacks Blob.arrayBuffer; only provide the bytes used by the real validator.
 vi.spyOn(file,'slice').mockImplementation(()=>({arrayBuffer:async()=>bytes.buffer}) as Blob);return file;
}
const stored=():Ticket=>({id:ticketId,title:'Stored synthetic request',message:'Stored private message',category:'general',state:'in_progress',created_at:stamp,attachments:[]});

describe('mobile help preserves authored answers and private support flows',()=>{
 it('opens the first of six authored FAQ entries and searches through real help content',()=>{
  const view=render(<MobileHelp/>);expect(view.container.querySelectorAll('.m-help-category')).toHaveLength(5);expect(view.container.querySelectorAll('.m-help-faq')).toHaveLength(6);expect(screen.getByRole('button',{name:'1 요금제는 어떻게 변경하나요?'})).toHaveAttribute('aria-expanded','true');expect(screen.getByText(/현재 공개 베타는 결제 기능이 활성화되어 있지 않습니다/)).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'데이터 출처'}));expect(screen.getByRole('button',{name:/데이터의 출처는 어디인가요/})).toBeVisible();fireEvent.change(screen.getByRole('textbox',{name:'도움말 검색'}),{target:{value:'synthetic-no-match-42'}});fireEvent.click(screen.getByRole('button',{name:'도움말 검색 실행'}));expect(screen.getByText('일치하는 도움말이 없습니다.')).toBeVisible();
 });
 it('supports category filtering and privacy requests without claiming account deletion',()=>{
  render(<MobileHelp initialCategory="privacy"/>);fireEvent.click(screen.getByRole('button',{name:/계정을 탈퇴하거나 데이터를 삭제하고 싶어요/}));fireEvent.click(screen.getByRole('button',{name:'삭제 요청 작성'}));const dialog=screen.getByRole('dialog',{name:'문의하기'});expect(within(dialog).getByRole('combobox',{name:'문의 유형'})).toHaveValue('privacy');expect(mock.workspace).not.toHaveBeenCalled();expect(screen.queryByText('탈퇴 완료')).not.toBeInTheDocument();
 });
 it('retries a lost create response with the same idempotency key',async()=>{
  const handler=mock.workspace.getMockImplementation()!;let fail=true;mock.workspace.mockImplementation(async(...args)=>{const result=await handler(...args);if(args[1].action==='ticket_create'&&fail){fail=false;throw new Error('Synthetic lost response');}return result;});
  render(<MobileHelp/>);const dialog=openForm();fireEvent.click(within(dialog).getByRole('button',{name:'문의 내용 제출하기'}));expect(await within(dialog).findByRole('alert')).toHaveTextContent('Synthetic lost response');fireEvent.click(within(dialog).getByRole('button',{name:'문의 내용 제출하기'}));const history=await screen.findByRole('dialog',{name:'내 문의 내역'});expect(await within(history).findByText('Synthetic request')).toBeVisible();expect(tickets).toHaveLength(1);const creates=mock.workspace.mock.calls.filter(([,request])=>request.action==='ticket_create');expect(creates).toHaveLength(2);expect(creates[0][1].p).toEqual(creates[1][1].p);expect(creates[0][1].p).toMatchObject({category:'general',title:'Synthetic request',message:'Synthetic reproduction steps'});expect(creates[0][0]).toBe('synthetic-token');
 });
 it('rejects a disguised attachment before creating or uploading anything',async()=>{
  render(<MobileHelp/>);const dialog=openForm();fireEvent.change(within(dialog).getByLabelText('파일 첨부 (선택)'),{target:{files:[png('application/pdf')]}});fireEvent.click(within(dialog).getByRole('button',{name:'문의 내용 제출하기'}));expect(await within(dialog).findByRole('alert')).toHaveTextContent('PNG, JPEG, WebP, PDF 파일만 첨부할 수 있습니다.');expect(mock.workspace).not.toHaveBeenCalled();expect(mock.upload).not.toHaveBeenCalled();
 });
 it('keeps the saved request when upload fails and retries with its existing request key',async()=>{
  mock.upload.mockResolvedValueOnce({data:null,error:new Error('Synthetic upload unavailable')});render(<MobileHelp/>);const dialog=openForm(),file=png();fireEvent.change(within(dialog).getByLabelText('파일 첨부 (선택)'),{target:{files:[file]}});fireEvent.click(within(dialog).getByRole('button',{name:'문의 내용 제출하기'}));expect(await within(dialog).findByRole('alert')).toHaveTextContent('문의는 저장되었지만 첨부 업로드가 실패했습니다.');expect(tickets).toHaveLength(1);expect(within(dialog).getByLabelText('제목')).toBeDisabled();fireEvent.click(within(dialog).getByRole('button',{name:'첨부 다시 전송'}));await screen.findByRole('dialog',{name:'내 문의 내역'});const creates=mock.workspace.mock.calls.filter(([,request])=>request.action==='ticket_create');expect(creates[0][1].p.request_key).toBe(creates[1][1].p.request_key);expect(mock.upload).toHaveBeenCalledTimes(2);expect(mock.bucket).toHaveBeenCalledWith('signalbrief-support');expect(tickets[0].attachments[0].object_path).toMatch(new RegExp(`^${userId}/${ticketId}/.+\\.png$`));expect(mock.upload).toHaveBeenLastCalledWith(expect.any(String),file,{contentType:'image/png',upsert:false});
 });
 it('retries attachment linking without uploading an already uploaded file again',async()=>{
  const handler=mock.workspace.getMockImplementation()!;let fail=true;mock.workspace.mockImplementation(async(...args)=>{if(args[1].action==='ticket_attach'&&fail){fail=false;return {attached:false};}return handler(...args);});render(<MobileHelp/>);const dialog=openForm();fireEvent.change(within(dialog).getByLabelText('파일 첨부 (선택)'),{target:{files:[png()]}});fireEvent.click(within(dialog).getByRole('button',{name:'문의 내용 제출하기'}));expect(await within(dialog).findByRole('alert')).toHaveTextContent('첨부 연결을 완료하지 못했습니다.');fireEvent.click(within(dialog).getByRole('button',{name:'첨부 다시 전송'}));await screen.findByRole('dialog',{name:'내 문의 내역'});expect(mock.upload).toHaveBeenCalledTimes(1);const attached=mock.workspace.mock.calls.filter(([,request])=>request.action==='ticket_attach');expect(attached).toHaveLength(2);expect(attached[0][1].p).toEqual(attached[1][1].p);expect(tickets).toHaveLength(1);
 });
 it('loads owned history and opens private attachments with a short-lived signed URL',async()=>{
  tickets=[{...stored(),attachments:[{filename:'synthetic-evidence.pdf',object_path:`${userId}/${ticketId}/synthetic.pdf`,mime_type:'application/pdf'}]}];const click=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});render(<MobileHelp/>);fireEvent.click(screen.getByRole('button',{name:'내 문의 내역'}));const dialog=screen.getByRole('dialog',{name:'내 문의 내역'});expect(await within(dialog).findByText('Stored private message')).toBeVisible();expect(within(dialog).getByText('처리 중')).toBeVisible();expect(mock.workspace).toHaveBeenCalledWith('synthetic-token',{action:'tickets',p:{admin:false}},expect.anything(),expect.any(AbortSignal));fireEvent.click(within(dialog).getByRole('button',{name:'synthetic-evidence.pdf'}));await waitFor(()=>expect(mock.signed).toHaveBeenCalledWith(`${userId}/${ticketId}/synthetic.pdf`,60));expect(mock.bucket).toHaveBeenCalledWith('signalbrief-support');await waitFor(()=>expect(click).toHaveBeenCalled());expect(within(dialog).queryByRole('button',{name:'운영자 관리'})).not.toBeInTheDocument();
 });
 it('does not open an attachment when the signed URL request fails',async()=>{
  tickets=[{...stored(),attachments:[{filename:'synthetic.png',object_path:'private/path.png',mime_type:'image/png'}]}];mock.signed.mockResolvedValue({data:null,error:new Error('Synthetic denied')});const click=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});render(<MobileHelp/>);fireEvent.click(screen.getByRole('button',{name:'내 문의 내역'}));const dialog=screen.getByRole('dialog',{name:'내 문의 내역'});fireEvent.click(await within(dialog).findByRole('button',{name:'synthetic.png'}));expect(await within(dialog).findByRole('alert')).toHaveTextContent('첨부파일을 열지 못했습니다.');expect(click).not.toHaveBeenCalled();
 });
 it('retains server-authorized admin status management for an actual admin',async()=>{
  me.is_admin=true;tickets=[stored()];render(<MobileHelp/>);fireEvent.click(screen.getByRole('button',{name:'내 문의 내역'}));fireEvent.click(within(screen.getByRole('dialog',{name:'내 문의 내역'})).getByRole('button',{name:'운영자 관리'}));const dialog=screen.getByRole('dialog',{name:'지원 요청 관리'}),select=await within(dialog).findByRole('combobox',{name:'Stored synthetic request 처리 상태'});fireEvent.change(select,{target:{value:'resolved'}});await waitFor(()=>expect(mock.workspace).toHaveBeenCalledWith('synthetic-token',{action:'ticket_update',p:{id:ticketId,state:'resolved'}},expect.anything()));await waitFor(()=>expect(within(dialog).getByRole('combobox',{name:'Stored synthetic request 처리 상태'})).toHaveValue('resolved'));expect(mock.workspace).toHaveBeenCalledWith('synthetic-token',{action:'tickets',p:{admin:true}},expect.anything(),expect.any(AbortSignal));
 });
 it('links to real diagnostics without assuming healthy status',()=>{
  render(<MobileHelp/>);expect(screen.getByRole('link',{name:'서비스 상태 보기'})).toHaveAttribute('href','/status');expect(screen.queryByText(/모든 서비스 정상/)).not.toBeInTheDocument();
 });
});
