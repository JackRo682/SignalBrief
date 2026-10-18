import {render,screen,cleanup,fireEvent,waitFor} from '@testing-library/react';
import {describe,it,expect,vi,afterEach,beforeEach} from 'vitest';
import CompanyProfile from '../src/components/company-profile';
vi.mock('@/components/auth',()=>({useAuth:()=>({token:'synthetic-test-session'})}));
vi.mock('@/workspace/preferences',()=>({usePrefs:()=>({text:(ko:string)=>ko,date:(s:string)=>s})}));
const id='20000000-0000-4000-8000-000000000001';
const data={status:'verified',fetched_at:'2026-10-18T00:00:00Z',source_url:'https://opendart.fss.or.kr/guide/main.do',profile:{corp_code:'12345678',ticker:'123456',name:'Synthetic company',english_name:null,ceo:'Synthetic executive',address:null,website:'https://example.com',established_on:'2020-01-01',industry_code:'12345',fiscal_month:'12'}};
beforeEach(()=>{vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json(data)));});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
describe('company profile display',()=>{
 it('shows verified profile with source and retrieval time',async()=>{render(<CompanyProfile id={id} ticker="123456"/>);expect(await screen.findByText('Synthetic company')).toBeTruthy();expect(screen.getByText('Synthetic executive')).toBeTruthy();expect(screen.getByText(/2026-10-18/)).toBeTruthy();expect(screen.getByRole('link',{name:'공식 홈페이지 ↗'}).getAttribute('rel')).toBe('noopener noreferrer');expect(fetch).toHaveBeenCalledWith(`/api/company-profile?company_id=${id}`,expect.objectContaining({headers:{Authorization:'Bearer synthetic-test-session'}}));});
 it('does not query this provider for US tickers',()=>{const {container}=render(<CompanyProfile id={id} ticker="AAPL"/>);expect(fetch).not.toHaveBeenCalled();expect(container.textContent).toBe('');});
 it('shows an explicit missing-data state',async()=>{vi.mocked(fetch).mockResolvedValueOnce(Response.json({status:'not_available',profile:null}));render(<CompanyProfile id={id} ticker="123456"/>);expect(await screen.findByText('제공된 기업정보가 없습니다.')).toBeTruthy();});
 it('retries a failed lookup',async()=>{vi.mocked(fetch).mockResolvedValueOnce(new Response('',{status:502}));render(<CompanyProfile id={id} ticker="123456"/>);fireEvent.click(await screen.findByRole('button',{name:'다시 시도'}));expect(await screen.findByText('Synthetic company')).toBeTruthy();expect(fetch).toHaveBeenCalledTimes(2);});
 it('does not retain the previous issuer while navigating',async()=>{const view=render(<CompanyProfile id={id} ticker="123456"/>);await screen.findByText('Synthetic company');vi.mocked(fetch).mockImplementationOnce(()=>new Promise(()=>{}));view.rerender(<CompanyProfile id="30000000-0000-4000-8000-000000000001" ticker="654321"/>);await waitFor(()=>expect(screen.queryByText('Synthetic company')).toBeNull());});
});
