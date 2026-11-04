import React from 'react';
import '@testing-library/jest-dom/vitest';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,render,screen,waitFor,fireEvent} from '@testing-library/react';
import UniverseCoverage from '@/redesign/universe-coverage';
import {workspaceRequest} from '@/workspace/contracts';
import {pageDataCache} from '@/lib/page-data-cache';
const state=vi.hoisted(()=>({token:'synthetic-user-a'}));
vi.mock('@/components/auth',()=>({useAuth:()=>state}));
vi.mock('@/workspace/preferences',()=>({usePrefs:()=>({text:(_ko:string,en:string)=>en})}));
const coverage={as_of:'2026-11-04T14:00:00Z',markets:[{market:'NYSE',listings:100,eligible_listings:60,excluded_listings:37,classification_pending_listings:3,unresolved_listings:2,mapped_issuers:55,registered_issuers:20,issuers_with_filings:15,issuers_with_approved_analysis:5,issuers_with_pending_review:6,issuers_with_upcoming_calendar:7}],sources:[{source_key:'nasdaq_traded',source_url:'https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqtraded.txt',coverage_scope:'all_listed_securities',as_of:'2026-11-04',fetched_at:'2026-11-04T13:00:00Z',status:'ready',listings:100}],limits:{provider_daily_calls:500,model_daily_calls:20,model_daily_budget_usd:1,human_approval_required:true},usage:[]};
afterEach(()=>{cleanup();vi.unstubAllGlobals();state.token='synthetic-user-a';pageDataCache.reset();});
describe('coverage keeps listing, issuer, content and review counts distinct',()=>{
 it('defers the aggregate request until the coverage panel is opened',()=>{
  const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);render(<UniverseCoverage/>);
  expect(fetcher).not.toHaveBeenCalled();
 });
 it.each([[401,'invalid_or_expired_session','signalbrief:unauthorized'],[403,'mfa_required','signalbrief:mfa-required']] as const)('routes current-session %s failures to authentication recovery',async(status,code,event)=>{
  pageDataCache.reset(state.token);const listener=vi.fn();window.addEventListener(event,listener);
  try{
   vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({error:{code}},{status})));
   render(<UniverseCoverage/>);fireEvent.click(screen.getByText('Market coverage and collection progress'));
   await waitFor(()=>expect(listener).toHaveBeenCalledOnce());
  }finally{window.removeEventListener(event,listener);}
 });
 it('renders actual incomplete counts, classification holds and source dates',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>coverage}));render(<UniverseCoverage/>);fireEvent.click(screen.getByText('Market coverage and collection progress'));
  expect(await screen.findByText('Observed coverage by market')).toBeVisible();
  expect(screen.getByRole('row',{name:'NYSE 60 20 15 7 5 6 2 3'})).toBeVisible();
  expect(screen.getByText(/approved analyses require human review/)).toBeVisible();
  expect(screen.getByRole('link',{name:'U.S. · Nasdaq Trader'})).toHaveAttribute('href',coverage.sources[0].source_url);
 });
 it('does not display stale data after an account switch and supports retry after failure',async()=>{
  const fetcher=vi.fn().mockResolvedValueOnce({ok:true,json:async()=>coverage}).mockResolvedValueOnce({ok:false}).mockResolvedValue({ok:true,json:async()=>({...coverage,markets:[]})});
  vi.stubGlobal('fetch',fetcher);const view=render(<UniverseCoverage/>);fireEvent.click(screen.getByText('Market coverage and collection progress'));
  await screen.findByText('Observed coverage by market');state.token='synthetic-user-b';view.rerender(<UniverseCoverage/>);
  expect(screen.queryByRole('row',{name:'NYSE 60 20 15 7 5 6 2 3'})).toBeNull();
  await screen.findByText('Collection coverage is unavailable.');fireEvent.click(screen.getByRole('button',{name:'Retry coverage'}));
  await waitFor(()=>expect(screen.getByText('Official listing snapshots have not been imported yet.')).toBeVisible());
 });
});
describe('bounded company monitoring contract',()=>{
 const id='00000000-0000-4000-8000-000000000081';
 it('accepts empty or visible page scopes and retains existing single-company calls',()=>{
  for(const p of [{scope:'all',company_ids:[]},{scope:'all',company_ids:[id]},{company_id:id}])expect(workspaceRequest.safeParse({action:'source_overview',p}).success).toBe(true);
 });
 it('rejects duplicate, excessive or conflicting scopes',()=>{
  for(const p of [{company_ids:[id,id]},{company_ids:Array.from({length:51},()=>id)},{company_ids:[id],company_id:id},{company_ids:['bad']}])expect(workspaceRequest.safeParse({action:'source_overview',p}).success).toBe(false);
 });
});
