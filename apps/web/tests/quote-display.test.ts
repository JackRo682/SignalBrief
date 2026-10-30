import {describe,expect,it} from 'vitest';
import {quoteSchema} from '../src/workspace/contracts';
import {quoteUnavailableText,quoteDatePrecision} from '../src/lib/quote-display';
const ko=(value:string)=>value;
describe('quote unavailability',()=>{
 it('shows the selected company reason during a partial outage',()=>{
  const state={loading:false,reason:'partial_provider_unavailable',unavailable:[{symbol:'005930',reason:'kis_display_license_unverified'},{symbol:'AAPL',reason:'fmp_display_license_unverified'}]};
  expect(quoteUnavailableText(state,'005930',ko)).toContain('한국 주가의 웹 표시 승인');
  expect(quoteUnavailableText(state,' aapl ',ko)).toContain('미국 주가의 웹 표시 승인');
 });
 it('does not describe a network failure as a licensing problem',()=>expect(quoteUnavailableText({loading:false,reason:'provider_unavailable'},'AAPL',ko)).toContain('불러오지 못했습니다'));
 it('does not expose arbitrary upstream messages',()=>expect(quoteUnavailableText({loading:false,reason:'https://provider.test?apikey=SECRET'},'AAPL',ko)).not.toContain('SECRET'));
 it('does not invent clock precision for an EOD date',()=>{expect(quoteDatePrecision('2026-10-16')).toBe('date');expect(quoteDatePrecision('2026-10-16T20:00:00Z')).toBe('timestamp');});
});

describe('quote validation',()=>{
 const quote={symbol:'AAPL',price:123,currency:'USD',change_pct:null,as_of:'2026-10-16',source:'Synthetic fixture',history:[]};
 it.each([{price:-1},{price:Infinity},{as_of:'2026-02-31'},{as_of:'not-a-date'},{source:''},{currency:'unknown'}])('rejects malformed price data %o',invalid=>expect(quoteSchema.safeParse({...quote,...invalid}).success).toBe(false));
});
