import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import LoginForm from '../src/components/login-form';

const mocks=vi.hoisted(()=>({replace:vi.fn(),signUp:vi.fn(),recover:vi.fn(),signIn:vi.fn(),google:vi.fn()}));
vi.mock('next/navigation',()=>({useRouter:()=>({replace:mocks.replace})}));
vi.mock('../src/components/auth',()=>({useAuth:()=>({me:null,config:null,error:null,googleLogin:mocks.google})}));
vi.mock('../src/lib/supabase',()=>({initializeSupabase:async()=>({auth:{signUp:mocks.signUp,signInWithPassword:mocks.signIn,resetPasswordForEmail:mocks.recover}})}));
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('NODE_ENV','test');vi.stubEnv('NEXT_PUBLIC_SITE_URL','');});
afterEach(()=>{cleanup();vi.unstubAllEnvs();});

it('registers by email and shows confirmation without requiring Google',async()=>{
  mocks.signUp.mockResolvedValue({data:{session:null},error:null});render(<LoginForm mode="signup"/>);
  fireEvent.change(screen.getByLabelText('이메일'),{target:{value:'fixture@example.com'}});
  fireEvent.change(screen.getByLabelText('비밀번호',{exact:true}),{target:{value:'fixture-password-123'}});
  fireEvent.change(screen.getByLabelText('비밀번호 확인',{exact:true}),{target:{value:'fixture-password-123'}});
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button',{name:'무료로 시작하기'}));
  await waitFor(()=>expect(mocks.signUp).toHaveBeenCalledWith({email:'fixture@example.com',password:'fixture-password-123',options:{emailRedirectTo:location.origin+'/auth/callback'}}));
  expect(await screen.findByRole('status')).toHaveTextContent('가입 요청을 접수');expect(mocks.google).not.toHaveBeenCalled();
});
it('requests an email recovery link to the password reset callback',async()=>{
  mocks.recover.mockResolvedValue({error:null});render(<LoginForm mode="reset"/>);
  fireEvent.change(screen.getByLabelText('이메일'),{target:{value:'fixture@example.com'}});
  fireEvent.click(screen.getByRole('button',{name:'재설정 링크 보내기'}));
  await waitFor(()=>expect(mocks.recover).toHaveBeenCalledWith('fixture@example.com',{redirectTo:location.origin+'/auth/callback?next=reset-password'}));
  expect(await screen.findByRole('status')).toHaveTextContent('복구 가능한 계정');expect(screen.queryByLabelText('비밀번호',{exact:true})).toBeNull();
});
it('accepts existing login passwords and navigates without a document reload',async()=>{
  mocks.signIn.mockResolvedValue({error:null});render(<LoginForm mode="login"/>);
  fireEvent.change(screen.getByLabelText('이메일'),{target:{value:'fixture@example.com'}});
  fireEvent.change(screen.getByLabelText('비밀번호',{exact:true}),{target:{value:'old123'}});
  fireEvent.click(screen.getByRole('button',{name:'로그인'}));
  await waitFor(()=>expect(mocks.replace).toHaveBeenCalledWith('/today'));
  expect(screen.getByRole('link',{name:'회원가입하기'})).toHaveAttribute('href','/signup');
  expect(screen.getByRole('link',{name:'비밀번호 찾기'})).toHaveAttribute('href','/forgot-password');
});
it('keeps rejected signups on the form and does not expose provider internals',async()=>{
  mocks.signUp.mockResolvedValue({data:{session:null},error:new Error('private-provider-detail')});render(<LoginForm mode="signup"/>);
  fireEvent.change(screen.getByLabelText('이메일'),{target:{value:'fixture@example.com'}});
  fireEvent.change(screen.getByLabelText('비밀번호',{exact:true}),{target:{value:'fixture-password-123'}});
  fireEvent.change(screen.getByLabelText('비밀번호 확인',{exact:true}),{target:{value:'fixture-password-123'}});
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button',{name:'무료로 시작하기'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('요청을 완료하지 못했습니다');
  expect(screen.queryByText('private-provider-detail')).toBeNull();expect(mocks.replace).not.toHaveBeenCalled();
});

it('requires the service and privacy acknowledgment before email or Google signup',async()=>{
 render(<LoginForm mode="signup"/>);
 fireEvent.change(screen.getByLabelText('이메일'),{target:{value:'fixture@example.com'}});
 fireEvent.change(screen.getByLabelText('비밀번호',{exact:true}),{target:{value:'fixture-password-123'}});
  fireEvent.change(screen.getByLabelText('비밀번호 확인',{exact:true}),{target:{value:'fixture-password-123'}});
 fireEvent.submit(screen.getByRole('button',{name:'무료로 시작하기'}).closest('form')!);
 expect(await screen.findByRole('alert')).toHaveTextContent('먼저 확인');
 fireEvent.click(screen.getByRole('button',{name:'Google로 회원가입'}));
 expect(mocks.signUp).not.toHaveBeenCalled();expect(mocks.google).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Google로 회원가입'}));
 await waitFor(()=>expect(mocks.google).toHaveBeenCalledTimes(1));
});
it('includes only the entered display name in Supabase signup metadata',async()=>{
 mocks.signUp.mockResolvedValue({data:{session:null},error:null});render(<LoginForm mode="signup"/>);
 fireEvent.change(screen.getByLabelText('이름 (선택)'),{target:{value:'  Test name  '}});
 fireEvent.change(screen.getByLabelText('이메일'),{target:{value:'fixture@example.com'}});
 fireEvent.change(screen.getByLabelText('비밀번호',{exact:true}),{target:{value:'fixture-password-123'}});
  fireEvent.change(screen.getByLabelText('비밀번호 확인',{exact:true}),{target:{value:'fixture-password-123'}});
 fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'무료로 시작하기'}));
 await waitFor(()=>expect(mocks.signUp).toHaveBeenCalledWith({email:'fixture@example.com',password:'fixture-password-123',options:{emailRedirectTo:location.origin+'/auth/callback',data:{full_name:'Test name'}}}));
});

it('rejects mismatching signup passwords before contacting Supabase',async()=>{
 render(<LoginForm mode="signup"/>);
 fireEvent.change(screen.getByLabelText('이메일'),{target:{value:'fixture@example.com'}});
 fireEvent.change(screen.getByLabelText('비밀번호',{exact:true}),{target:{value:'fixture-password-123'}});
 fireEvent.change(screen.getByLabelText('비밀번호 확인',{exact:true}),{target:{value:'different-password-123'}});
 fireEvent.click(screen.getByRole('checkbox'));
 fireEvent.submit(screen.getByRole('button',{name:'무료로 시작하기'}).closest('form')!);
 expect(await screen.findByRole('alert')).toHaveTextContent('두 비밀번호가 다릅니다');
 expect(mocks.signUp).not.toHaveBeenCalled();
});
