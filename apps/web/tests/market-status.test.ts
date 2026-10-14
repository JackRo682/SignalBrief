import {describe,expect,it} from 'vitest';
import {marketStatusText} from '../src/workspace/market-status';
import {loadQuoteBatches} from '../src/workspace/market';
import {afterEach,vi} from 'vitest';
afterEach(()=>vi.unstubAllGlobals());
describe('market permission states',()=>{
 it('preserves a license denial through multi-batch quote loading',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({quotes:[],available:false,reason:'fmp_display_license_unverified'})));
  const result=await loadQuoteBatches('fixture-token',Array.from({length:9},(_,i)=>`FIX${i}`),'1m',new AbortController().signal);
  expect(result.quotes).toEqual([]);
  expect(marketStatusText(result.reason,'en')).toContain('display permission');
  expect(marketStatusText(result.reason,'ko')).toContain('표시 권한');
 });
 it('does not expose unknown upstream error text or label it as a license denial',()=>{
  const message=marketStatusText('private-provider-error','en');
  expect(message).toContain('Try again');expect(message).not.toContain('private-provider-error');expect(message).not.toContain('permission');
 });
 it('explains missing coverage without treating missing values as zero',()=>{
  expect(marketStatusText('partial_provider_unavailable','en')).toContain('complete quote coverage');
  expect(marketStatusText('','ko')).toBe('');
 });
});
