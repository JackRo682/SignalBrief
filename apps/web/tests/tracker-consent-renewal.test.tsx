import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
vi.mock('next/navigation',()=>({usePathname:()=>'/'}));
vi.mock('@/components/auth',()=>({useAuth:()=>({loading:false,token:null,me:null,config:{demo_mode:false}})}));
vi.mock('@/lib/public-analytics',()=>({consentChoice:()=> 'granted',measurementId:()=>'',setMeasurementConsent:vi.fn()}));
vi.mock('../src/acquisition/product-client',()=>({isProductPath:()=>false,productConsentChoice:()=> 'granted',setProductConsent:()=>true,syncProductAccount:vi.fn()}));
vi.mock('../src/acquisition/surface-tracker',()=>({useSurfaceTracking:vi.fn()}));
import AcquisitionTracker from '../src/acquisition/tracker';
import {CONSENT_KEY,chooseConsent,readConsent} from '../src/acquisition/client';

beforeEach(()=>{localStorage.clear();sessionStorage.clear();vi.stubGlobal('fetch',vi.fn(async()=>new Response('{}')));});
afterEach(()=>{cleanup();vi.unstubAllGlobals();localStorage.clear();sessionStorage.clear();});
const journeys=()=>vi.mocked(fetch).mock.calls.map(([,options])=>JSON.parse(String(options?.body))).filter(event=>event.action==='prelogin');

it('shows renewed device disclosure for an older grant and starts the new journey only after accepting',async()=>{
 chooseConsent(true);
 const original=JSON.parse(localStorage.getItem(CONSENT_KEY)!);
 localStorage.setItem(CONSENT_KEY,JSON.stringify({...original,journeyVersion:'2026-11-26.prelogin'}));
 render(<AcquisitionTracker/>);
 expect(screen.getByRole('complementary',{name:'선택적 방문 통계'}).textContent).toContain('모바일·태블릿·데스크톱');
 expect(journeys()).toEqual([]);
 fireEvent.click(screen.getByRole('button',{name:'동의'}));
 await waitFor(()=>expect(screen.queryByRole('complementary',{name:'선택적 방문 통계'})).toBeNull());
 expect(journeys()).toHaveLength(1);
 expect(journeys()[0]).toMatchObject({consent_version:'2026-11-27.prelogin',device:'desktop'});
 expect(readConsent()).toMatchObject({identity:original.identity});
});

it('honors refusal of the expanded measurement and does not send a prelogin device event',async()=>{
 chooseConsent(true);
 const original=JSON.parse(localStorage.getItem(CONSENT_KEY)!);
 localStorage.setItem(CONSENT_KEY,JSON.stringify({...original,journeyVersion:'2026-11-26.prelogin'}));
 render(<AcquisitionTracker/>);
 fireEvent.click(screen.getByRole('button',{name:'거절 / 동의 철회'}));
 await waitFor(()=>expect(readConsent()?.choice).toBe('no'));
 expect(journeys()).toEqual([]);
 expect(screen.queryByRole('complementary',{name:'선택적 방문 통계'})).toBeNull();
});
