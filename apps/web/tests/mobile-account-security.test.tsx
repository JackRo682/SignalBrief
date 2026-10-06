import '@testing-library/jest-dom/vitest';
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import MobileAccount from '../src/mobile/account';
import MobileSecurity,{sessionDevice} from '../src/mobile/security';
import {defaults} from '../src/workspace/contracts';

const mock=vi.hoisted(()=>({workspace:vi.fn(),download:vi.fn(),request:vi.fn(),save:vi.fn(),refresh:vi.fn(),logout:vi.fn(),replace:vi.fn(),getUser:vi.fn(),listFactors:vi.fn(),enroll:vi.fn(),verify:vi.fn(),unenroll:vi.fn(),signIn:vi.fn(),update:vi.fn(),unlink:vi.fn(),signOut:vi.fn(),text:(ko:string)=>ko,date:(value:string|null)=>value??'확인 전'}));
const userId='10000000-0000-4000-8000-000000000001';
const me={id:userId,display_name:'Synthetic Reader',density:'beginner',onboarding_completed:true,analytics_consent:false,is_admin:false,demo_mode:false};
const stamp='2026-10-06T08:00:00Z';
const google={identity_id:'google-identity',id:'synthetic-google',user_id:userId,provider:'google',identity_data:{email:'synthetic-google@example.invalid'}};
const email={identity_id:'email-identity',id:'synthetic-email',user_id:userId,provider:'email',identity_data:{email:'synthetic@example.invalid'}};
let preferences={...defaults},user={id:userId,email:'synthetic@example.invalid',email_confirmed_at:stamp,last_sign_in_at:stamp,identities:[email,google]};
let factors:{id:string;status:string;factor_type:'totp';friendly_name:string}[]=[];
const factor={id:'synthetic-factor',status:'verified',factor_type:'totp' as const,friendly_name:'Synthetic authenticator'};
const security={sessions:[{id:'synthetic-session',created_at:stamp,last_seen:stamp,user_agent:null,aal:'aal1',current:true}],history:[{created_at:stamp,action:'synthetic.profile.updated'}]};
vi.mock('../src/components/auth',()=>({useAuth:()=>({token:'synthetic-token',me,refresh:mock.refresh,logout:mock.logout})}));
vi.mock('../src/workspace/preferences',()=>({usePrefs:()=>({value:preferences,loaded:true,busy:false,error:'',save:mock.save,reload:vi.fn(),text:mock.text,date:mock.date})}));
vi.mock('../src/workspace/client',()=>({workspace:mock.workspace,downloadJSON:mock.download}));
vi.mock('../src/lib/api',async original=>({...await original<typeof import('../src/lib/api')>(),request:mock.request}));
vi.mock('next/navigation',()=>({useRouter:()=>({replace:mock.replace}),usePathname:()=>'/settings/account'}));
vi.mock('../src/lib/supabase',()=>({initializeSupabase:async()=>({auth:{getUser:mock.getUser,mfa:{listFactors:mock.listFactors,enroll:mock.enroll,challengeAndVerify:mock.verify,unenroll:mock.unenroll},signInWithPassword:mock.signIn,updateUser:mock.update,unlinkIdentity:mock.unlink,signOut:mock.signOut}})}));

beforeEach(()=>{
 vi.clearAllMocks();preferences={...defaults};me.display_name='Synthetic Reader';me.analytics_consent=false;user={id:userId,email:'synthetic@example.invalid',email_confirmed_at:stamp,last_sign_in_at:stamp,identities:[email,google]};factors=[];
 Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:function(this:HTMLDialogElement){this.setAttribute('open','');}});
 mock.getUser.mockImplementation(async()=>({data:{user},error:null}));
 mock.listFactors.mockImplementation(async()=>({data:{all:[...factors],totp:[...factors],phone:[]},error:null}));
 mock.enroll.mockImplementation(async()=>{factors=[{...factor,status:'unverified'}];return {data:{id:factor.id,totp:{qr_code:'data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22/%3E',secret:'SYNTHETIC-SETUP-KEY'}},error:null};});
 mock.verify.mockImplementation(async()=>{factors=factors.map(f=>({...f,status:'verified'}));return {data:{},error:null};});
 mock.unenroll.mockImplementation(async()=>{factors=[];return {data:{id:factor.id},error:null};});
 mock.signIn.mockImplementation(async()=>({data:{user},error:null}));mock.update.mockResolvedValue({data:{user},error:null});mock.unlink.mockResolvedValue({data:{},error:null});mock.signOut.mockResolvedValue({error:null});
 mock.logout.mockResolvedValue(undefined);mock.refresh.mockResolvedValue(undefined);mock.save.mockImplementation(async patch=>{preferences={...preferences,...patch};});
 mock.request.mockImplementation(async(_path,_token,_schema,init)=>{Object.assign(me,JSON.parse(init.body));return me;});
 mock.workspace.mockImplementation(async(_token,req)=>{if(req.action==='account')return {created_at:stamp,bio:preferences.bio,tickets:[]};if(req.action==='security')return security;if(req.action==='export')return {profile:me,preferences};throw new Error(`Unexpected action ${req.action}`);});
});
afterEach(()=>cleanup());
async function readySecurity(){render(<MobileSecurity/>);const control=screen.getByRole('switch',{name:'2단계 인증'});await waitFor(()=>expect(control).toBeEnabled());return control;}
async function passwordForm(){await readySecurity();fireEvent.click(screen.getByRole('button',{name:'현재 비밀번호 현재 사용 중인 비밀번호를 입력하세요.'}));const dialog=screen.getByRole('dialog',{name:'비밀번호 변경'});fireEvent.change(within(dialog).getByLabelText('현재 비밀번호',{exact:true}),{target:{value:'synthetic-current-password'}});fireEvent.change(within(dialog).getByLabelText('새 비밀번호',{exact:true}),{target:{value:'synthetic-new-password-42'}});fireEvent.change(within(dialog).getByLabelText('새 비밀번호 확인',{exact:true}),{target:{value:'synthetic-new-password-42'}});return dialog;}

describe('mobile account settings use authenticated owned data',()=>{
 it('shows actual identity and persists a profile without a fabricated email',async()=>{
  render(<MobileAccount/>);expect(await screen.findByText(user.email)).toBeVisible();expect(screen.queryByText('kimtuja@signalbrief.com')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'프로필 수정'}));const dialog=screen.getByRole('dialog',{name:'프로필 수정'});
  fireEvent.change(within(dialog).getByLabelText('이름'),{target:{value:' Updated Reader '}});fireEvent.change(within(dialog).getByLabelText('한 줄 소개'),{target:{value:'Synthetic bio'}});fireEvent.click(within(dialog).getByRole('button',{name:'저장'}));
  await waitFor(()=>expect(dialog).not.toBeInTheDocument());expect(mock.save).toHaveBeenCalledWith({bio:'Synthetic bio'});expect(mock.request).toHaveBeenCalledWith('/v1/me','synthetic-token',expect.anything(),{method:'PATCH',body:JSON.stringify({display_name:'Updated Reader'})});expect(mock.refresh).toHaveBeenCalled();
 });
 it('persists a timezone selection through the existing versioned preferences hook',async()=>{
  render(<MobileAccount/>);fireEvent.click(screen.getByRole('button',{name:/^시간대 /}));const dialog=screen.getByRole('dialog',{name:'시간대'});fireEvent.click(within(dialog).getByRole('button',{name:'뉴욕, 미국 America/New_York'}));await waitFor(()=>expect(mock.save).toHaveBeenCalledWith({timezone:'America/New_York'}));await waitFor(()=>expect(dialog).not.toBeInTheDocument());
 });
 it('retains the preference dialog when persistence fails',async()=>{
  mock.save.mockRejectedValue(new Error('Synthetic preference conflict'));render(<MobileAccount/>);fireEvent.click(screen.getByRole('button',{name:/^언어 및 지역 설정 /}));const dialog=screen.getByRole('dialog',{name:'언어 및 지역 설정'});fireEvent.click(within(dialog).getByRole('button',{name:'English (United States)'}));expect(await within(dialog).findByRole('alert')).toHaveTextContent('Synthetic preference conflict');expect(preferences.locale).toBe('ko');
 });
 it('downloads only a successful authenticated export response',async()=>{
  render(<MobileAccount/>);fireEvent.click(screen.getByRole('button',{name:/^내 데이터 내보내기 /}));await waitFor(()=>expect(mock.download).toHaveBeenCalledWith({profile:me,preferences},expect.stringMatching(/^SignalBrief-my-data-.*\.json$/)));expect(mock.workspace).toHaveBeenCalledWith('synthetic-token',{action:'export',p:{}},expect.anything());
 });
 it('does not produce a download on a rejected export',async()=>{
  mock.workspace.mockImplementation(async(_token,req)=>{if(req.action==='account')return {created_at:stamp,bio:'',tickets:[]};throw new Error('Synthetic export denied');});render(<MobileAccount/>);fireEvent.click(screen.getByRole('button',{name:/^내 데이터 내보내기 /}));expect(await screen.findByRole('alert')).toHaveTextContent('Synthetic export denied');expect(mock.download).not.toHaveBeenCalled();
 });
 it('confirms local logout and keeps the account open after a failed sign-out',async()=>{
  mock.logout.mockRejectedValueOnce(new Error('Synthetic sign-out unavailable'));render(<MobileAccount/>);fireEvent.click(screen.getByRole('button',{name:/^로그아웃 /}));expect(mock.logout).not.toHaveBeenCalled();const dialog=screen.getByRole('dialog',{name:'로그아웃할까요?'});fireEvent.click(within(dialog).getByRole('button',{name:'현재 기기에서 로그아웃'}));expect(await within(dialog).findByRole('alert')).toHaveTextContent('Synthetic sign-out unavailable');expect(mock.replace).not.toHaveBeenCalled();fireEvent.click(within(dialog).getByRole('button',{name:'현재 기기에서 로그아웃'}));await waitFor(()=>expect(mock.replace).toHaveBeenCalledWith('/login'));
 });
 it('keeps history and analytics controls available inside privacy settings',async()=>{
  render(<MobileAccount/>);fireEvent.click(screen.getByRole('button',{name:'개인정보 및 기록 설정'}));const dialog=screen.getByRole('dialog',{name:'개인정보 및 기록 설정'});fireEvent.click(within(dialog).getByRole('switch',{name:'방문·검색 기록 저장'}));await waitFor(()=>expect(mock.save).toHaveBeenCalledWith({history_enabled:true}));await waitFor(()=>expect(within(dialog).getByRole('switch',{name:'선택적 이용 통계'})).toBeEnabled());fireEvent.click(within(dialog).getByRole('switch',{name:'선택적 이용 통계'}));await waitFor(()=>expect(mock.request).toHaveBeenCalledWith('/v1/me','synthetic-token',expect.anything(),{method:'PATCH',body:JSON.stringify({analytics_consent:true})}));expect(within(dialog).getByRole('link',{name:'개인정보 삭제 / 계정 탈퇴 요청'})).toHaveAttribute('href','/help?category=privacy');
 });
});

describe('mobile security verifies before changing authentication',()=>{
 it('keeps MFA off until successful enrollment verification and preserves failed setup',async()=>{
  const control=await readySecurity();fireEvent.click(control);const dialog=await screen.findByRole('dialog',{name:'인증 앱 연결'});expect(control).toHaveAttribute('aria-checked','false');expect(within(dialog).getByRole('img',{name:'인증 앱 등록 QR 코드'})).toHaveAttribute('src',expect.stringContaining('data:image/svg+xml'));
  fireEvent.change(within(dialog).getByLabelText('인증 코드'),{target:{value:'123456'}});mock.verify.mockResolvedValueOnce({data:null,error:new Error('Synthetic invalid code')});fireEvent.click(within(dialog).getByRole('button',{name:'인증 후 활성화'}));expect(await within(dialog).findByRole('alert')).toHaveTextContent('인증 코드가 잘못되었거나 만료되었습니다.');expect(control).toHaveAttribute('aria-checked','false');
  fireEvent.click(within(dialog).getByRole('button',{name:'인증 후 활성화'}));await waitFor(()=>expect(dialog).not.toBeInTheDocument());await waitFor(()=>expect(control).toHaveAttribute('aria-checked','true'));expect(mock.verify).toHaveBeenCalledWith({factorId:factor.id,code:'123456'});
 });
 it('requires a valid current code before unenrolling a verified factor',async()=>{
  factors=[factor];const control=await readySecurity();fireEvent.click(control);const manage=screen.getByRole('dialog',{name:'2단계 인증 관리'});fireEvent.click(within(manage).getByRole('button',{name:'해제'}));const dialog=screen.getByRole('dialog',{name:'2단계 인증 해제'});fireEvent.change(within(dialog).getByLabelText('인증 코드'),{target:{value:'654321'}});mock.verify.mockResolvedValueOnce({data:null,error:new Error('Synthetic invalid code')});fireEvent.click(within(dialog).getByRole('button',{name:'인증 후 해제'}));await within(dialog).findByRole('alert');expect(mock.unenroll).not.toHaveBeenCalled();expect(control).toHaveAttribute('aria-checked','true');fireEvent.click(within(dialog).getByRole('button',{name:'인증 후 해제'}));await waitFor(()=>expect(mock.unenroll).toHaveBeenCalledWith({factorId:factor.id}));await waitFor(()=>expect(control).toHaveAttribute('aria-checked','false'));
 });
 it('disables security mutation controls if MFA state cannot be verified',async()=>{
  mock.listFactors.mockResolvedValue({data:null,error:new Error('Synthetic unavailable')});render(<MobileSecurity/>);expect(await screen.findByRole('alert')).toHaveTextContent('2단계 인증 상태를 확인하지 못했습니다.');expect(screen.getByRole('switch',{name:'2단계 인증'})).toBeDisabled();expect(screen.getByRole('button',{name:'현재 비밀번호 현재 사용 중인 비밀번호를 입력하세요.'})).toBeDisabled();expect(mock.update).not.toHaveBeenCalled();
 });
 it('blocks password updates when current-password reauthentication fails',async()=>{
  const dialog=await passwordForm();mock.signIn.mockResolvedValue({data:{user:null},error:new Error('Synthetic invalid password')});fireEvent.click(within(dialog).getByRole('button',{name:'비밀번호 저장'}));expect(await within(dialog).findByRole('alert')).toHaveTextContent('현재 비밀번호를 확인해 주세요.');expect(mock.update).not.toHaveBeenCalled();
 });
 it('reauthenticates password and MFA before updating a password',async()=>{
  factors=[factor];const dialog=await passwordForm();fireEvent.change(within(dialog).getByLabelText('인증 앱 코드'),{target:{value:'123456'}});mock.verify.mockResolvedValueOnce({data:null,error:new Error('Synthetic invalid MFA')});fireEvent.click(within(dialog).getByRole('button',{name:'비밀번호 저장'}));await within(dialog).findByRole('alert');expect(mock.update).not.toHaveBeenCalled();fireEvent.click(within(dialog).getByRole('button',{name:'비밀번호 저장'}));await waitFor(()=>expect(mock.update).toHaveBeenCalledWith({password:'synthetic-new-password-42'}));expect(mock.signIn).toHaveBeenCalledWith({email:user.email,password:'synthetic-current-password'});expect(mock.signIn.mock.invocationCallOrder.at(-1)!).toBeLessThan(mock.verify.mock.invocationCallOrder.at(-1)!);expect(mock.verify.mock.invocationCallOrder.at(-1)!).toBeLessThan(mock.update.mock.invocationCallOrder[0]);
 });
 it('routes OAuth-only password setup through verified email recovery',async()=>{
  user={...user,identities:[google]};await readySecurity();fireEvent.click(screen.getByRole('button',{name:'새 비밀번호 새 비밀번호를 입력하세요.'}));const dialog=screen.getByRole('dialog',{name:'비밀번호 변경'});expect(within(dialog).getByRole('link',{name:'비밀번호 재설정 메일 받기'})).toHaveAttribute('href','/forgot-password');expect(within(dialog).queryByRole('button',{name:'비밀번호 저장'})).not.toBeInTheDocument();expect(mock.update).not.toHaveBeenCalled();
 });
 it('blocks unlinking the final identity, including after a concurrent identity change',async()=>{
  await readySecurity();fireEvent.click(screen.getByRole('button',{name:/^연결된 계정/}));const providers=screen.getByRole('dialog',{name:'연결된 로그인 수단'});fireEvent.click(within(providers).getByRole('button',{name:'연결 해제'}));user={...user,identities:[google]};const confirm=screen.getByRole('dialog',{name:'계정 연결 해제'});fireEvent.click(within(confirm).getByRole('button',{name:'연결 해제'}));expect(await within(confirm).findByRole('alert')).toHaveTextContent('다른 로그인 수단이 필요합니다.');expect(mock.unlink).not.toHaveBeenCalled();
 });
 it('uses only the others scope after explicit session confirmation',async()=>{
  await readySecurity();fireEvent.click(screen.getByRole('button',{name:'전체 기기 관리'}));fireEvent.click(within(screen.getByRole('dialog',{name:'활성 세션 / 기기'})).getByRole('button',{name:'다른 모든 기기 로그아웃'}));expect(mock.signOut).not.toHaveBeenCalled();const confirm=screen.getByRole('dialog',{name:'다른 세션을 종료할까요?'});mock.signOut.mockResolvedValueOnce({error:new Error('Synthetic failure')});fireEvent.click(within(confirm).getByRole('button',{name:'다른 세션 종료'}));expect(await within(confirm).findByRole('alert')).toHaveTextContent('다른 세션을 종료하지 못했습니다.');fireEvent.click(within(confirm).getByRole('button',{name:'다른 세션 종료'}));await waitFor(()=>expect(confirm).not.toBeInTheDocument());expect(mock.signOut.mock.calls).toEqual([[{scope:'others'}],[{scope:'others'}]]);expect(mock.logout).not.toHaveBeenCalled();
 });
 it('shows only real session information and marks unavailable security notifications disabled',async()=>{
  await readySecurity();expect(await screen.findByText('기기 정보 미확인')).toBeVisible();expect(screen.queryByText(/서울|의심 활동 없음|비밀번호 설정됨/)).not.toBeInTheDocument();expect(screen.getByRole('switch',{name:'새로운 로그인 알림'})).toBeDisabled();expect(screen.getByRole('switch',{name:'새로운 로그인 알림'})).toHaveAttribute('aria-checked','false');expect(screen.getByText('synthetic.profile.updated')).toBeVisible();expect(sessionDevice('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/129.0 Safari/537.36','unknown')).toBe('Windows · Chrome');expect(sessionDevice(null,'unknown')).toBe('unknown');
 });
});
