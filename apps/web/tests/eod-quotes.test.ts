// @vitest-environment node
import {describe,expect,it,vi} from 'vitest';
import {fmpEquityQuote} from '../../../supabase/functions/signalbrief-api/market-core';
const rights={fmp_display_enabled:true,fmp_license_reference:'synthetic agreement',fmp_license_until:'2099-01-01',fmp_quote_mode:'eod'};
const history=[{symbol:'AAPL',date:'2026-01-06',price:123},{symbol:'AAPL',date:'2026-01-05',price:120}];
describe('licensed EOD quotes — synthetic fixtures',()=>{
 it.each([{}, {...rights,fmp_display_enabled:false},{...rights,fmp_license_until:'2000-01-01'},{...rights,fmp_license_reference:''}])('makes no calls before approval',async config=>{
  const fetcher=vi.fn();await expect(fmpEquityQuote('AAPL','synthetic',config,fetcher)).rejects.toThrow('fmp_display_license_unverified');expect(fetcher).not.toHaveBeenCalled();
 });
 it('uses only the EOD endpoint and preserves the provider date',async()=>{
  const fetcher=vi.fn().mockResolvedValue(Response.json(history));
  const quote=await fmpEquityQuote('AAPL','synthetic',rights,fetcher);
  expect(quote).toMatchObject({symbol:'AAPL',price:123,as_of:'2026-01-06',change_pct:null,source:'FMP EOD',price_kind:'end_of_day_close',timestamp_kind:'provider_date',delay:'end_of_day'});
  expect(quote.history).toEqual([{date:'2026-01-05',close:120},{date:'2026-01-06',close:123}]);
  expect(fetcher).toHaveBeenCalledTimes(1);expect(fetcher.mock.calls[0][0].pathname).toBe('/stable/historical-price-eod/light');expect(JSON.stringify(quote)).not.toContain('synthetic');
 });
 it('never falls back to intraday quotes when the EOD plan is denied',async()=>{
  const fetcher=vi.fn().mockResolvedValue(new Response('private provider message',{status:403}));
  await expect(fmpEquityQuote('AAPL','synthetic',rights,fetcher)).rejects.toThrow('access_or_plan_denied');expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it('does not fabricate a quote from empty history',async()=>await expect(fmpEquityQuote('AAPL','synthetic',rights,vi.fn().mockResolvedValue(Response.json([])))).rejects.toThrow('eod_price_unavailable'));
 it('does not fetch an unknown feed mode',async()=>{
  const fetcher=vi.fn();await expect(fmpEquityQuote('AAPL','synthetic',{...rights,fmp_quote_mode:'typo'},fetcher)).rejects.toThrow('invalid_quote_mode');expect(fetcher).not.toHaveBeenCalled();
 });
 it('rejects impossible provider trading dates',async()=>await expect(fmpEquityQuote('AAPL','synthetic',rights,vi.fn().mockResolvedValue(Response.json([{symbol:'AAPL',date:'2026-02-31',price:123}])))).rejects.toThrow('invalid_history'));
 it('retains the explicitly licensed snapshot path',async()=>{
  const fetcher=vi.fn().mockResolvedValue(Response.json([{symbol:'AAPL',price:123,timestamp:1767729600}]));
  expect(await fmpEquityQuote('AAPL','synthetic',{...rights,fmp_quote_mode:'snapshot'},fetcher)).toMatchObject({source:'FMP',price:123});expect(fetcher.mock.calls[0][0].pathname).toBe('/stable/quote');
 });
});
