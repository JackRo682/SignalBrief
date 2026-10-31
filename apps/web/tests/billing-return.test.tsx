// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import BillingPage from '../src/components/billing-page';

vi.mock('@/components/auth',()=>({useAuth:()=>({token:'synthetic-billing-reader'})}));
vi.mock('@/components/ui',()=>({useResource:()=>({data:[],error:null,reload:vi.fn()})}));
let active=false;
beforeEach(()=>{
  active=false;
  window.history.replaceState({},'', '/billing?returned=1');
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({active,expires_at:active?'2026-12-01T00:00:00Z':null,test_active:false,test_expires_at:null,checkout:false,test:false}),{status:200})));
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();window.history.replaceState({},'','/');});

describe('verified payment return',()=>{
  it('keeps a checkout return pending without activating a pass or export',async()=>{
    render(<BillingPage/>);
    expect(await screen.findByText('결제 확인 중 · 결제 제공자의 확인을 기다리고 있습니다.')).toBeVisible();
    expect(screen.queryByRole('button',{name:'CSV 다운로드'})).not.toBeInTheDocument();
    expect(screen.queryByRole('button',{name:'30일 이용권 결제'})).not.toBeInTheDocument();
  });
  it('enables export only when the authenticated status endpoint confirms an active pass',async()=>{
    render(<BillingPage/>);
    await screen.findByText('결제 확인 중 · 결제 제공자의 확인을 기다리고 있습니다.');
    active=true;
    fireEvent.click(screen.getByRole('button',{name:'결제 확인 / 상태 새로고침'}));
    expect(await screen.findByText('이용 중 · 만료: 2026-12-01T00:00:00Z')).toBeVisible();
    expect(screen.getByRole('button',{name:'CSV 다운로드'})).toBeDisabled();
    expect(screen.queryByText('결제 확인 중 · 결제 제공자의 확인을 기다리고 있습니다.')).not.toBeInTheDocument();
  });
});
