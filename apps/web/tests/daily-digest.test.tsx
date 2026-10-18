// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import DailyDigestSettings from '../src/workspace/daily-digest';
const mocks=vi.hoisted(()=>({rpc:vi.fn(),text:(ko:string)=>ko}));
vi.mock('@/components/auth',()=>({useAuth:()=>({token:'synthetic'})}));
vi.mock('@/lib/supabase',()=>({initializeSupabase:async()=>({rpc:mocks.rpc})}));
vi.mock('@/workspace/preferences',()=>({usePrefs:()=>({text:mocks.text,value:{timezone:'Asia/Seoul'}})}));
let enabled=false,time='09:00';
beforeEach(()=>{enabled=false;time='09:00';mocks.rpc.mockReset();mocks.rpc.mockImplementation(async(_name,{p})=>{enabled=p.enabled??enabled;time=p.time??time;return {data:{available:true,enabled,time},error:null};});});
afterEach(cleanup);
describe('daily digest preferences',()=>{
 it('requires an explicit switch and reloads persisted consent',async()=>{
  const view=render(<DailyDigestSettings/>);const toggle=await screen.findByRole('switch');await waitFor(()=>expect((toggle as HTMLInputElement).disabled).toBe(false));expect(enabled).toBe(false);expect(mocks.rpc).toHaveBeenCalledTimes(1);fireEvent.click(toggle);await waitFor(()=>expect(enabled).toBe(true));view.unmount();render(<DailyDigestSettings/>);await waitFor(()=>expect((screen.getByRole('switch') as HTMLInputElement).checked).toBe(true));
 });
 it('only saves a changed delivery time when applied',async()=>{
  render(<DailyDigestSettings/>);await waitFor(()=>expect((screen.getByRole('switch') as HTMLInputElement).disabled).toBe(false));fireEvent.change(screen.getByLabelText('일일 요약 발송 시각'),{target:{value:'18:30'}});expect(time).toBe('09:00');fireEvent.click(screen.getByRole('button',{name:'발송 시각 저장'}));await waitFor(()=>expect(time).toBe('18:30'));
 });
 it('keeps consent unchanged and reports rejected writes',async()=>{
  render(<DailyDigestSettings/>);await waitFor(()=>expect((screen.getByRole('switch') as HTMLInputElement).disabled).toBe(false));mocks.rpc.mockResolvedValueOnce({data:null,error:{message:'denied'}});fireEvent.click(screen.getByRole('switch'));await screen.findByRole('alert');expect((screen.getByRole('switch') as HTMLInputElement).checked).toBe(false);expect(screen.queryByRole('status')).toBeNull();
 });
});
