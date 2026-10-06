import {afterEach,describe,expect,it,vi} from 'vitest';
import {loadQuoteBatches} from '../src/workspace/market';
afterEach(()=>vi.unstubAllGlobals());
describe('portfolio quote batching',()=>{
 it('loads more than eight symbols without exceeding the upstream limit and de-duplicates',async()=>{
  const sizes:number[]=[];
  vi.stubGlobal('fetch',vi.fn(async(url:string,init:RequestInit)=>{
   expect((init.headers as Record<string,string>).Authorization).toBe('Bearer isolated-token');
   const symbols=new URL(url,'https://local.test').searchParams.get('symbols')!.split(',');sizes.push(symbols.length);
   return Response.json({quotes:symbols.map(symbol=>({symbol,price:125,currency:'USD',change_pct:1,as_of:'2026-10-06T12:00:00Z',source:'isolated fixture',history:[]}))});
  }));
  const symbols=Array.from({length:19},(_,i)=>`TEST${i}`);
  const result=await loadQuoteBatches('isolated-token',[...symbols,symbols[0]],'1m',new AbortController().signal);
  expect(sizes).toEqual([8,8,3]);expect(result.quotes).toHaveLength(19);expect(result.reason).toBe('');
 });
 it('keeps returned quotes but flags an incomplete provider response',async()=>{
  let call=0;vi.stubGlobal('fetch',vi.fn(async()=>++call===1?Response.json({quotes:[{symbol:'A',price:100,currency:'USD',change_pct:null,as_of:'2026-10-06',source:'fixture',history:[]}]}):Response.json({error:{code:'unavailable'}},{status:503})));
  const result=await loadQuoteBatches('isolated-token',['A','B','C','D','E','F','G','H','I'],'1m',new AbortController().signal);
  expect(result.quotes.map(q=>q.symbol)).toEqual(['A']);expect(result.reason).toBe('partial_provider_unavailable');
 });
 it('does not accept unrequested symbols returned by the provider',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({quotes:[{symbol:'WRONG',price:100,currency:'USD',change_pct:null,as_of:'2026-10-06',source:'fixture'}]})));
  expect((await loadQuoteBatches('isolated-token',['AAPL'],'1m',new AbortController().signal)).quotes).toEqual([]);
 });
 it('flags missing symbols even when every HTTP request succeeds',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({quotes:[{symbol:'AAPL',price:100,currency:'USD',change_pct:null,as_of:'2026-10-06',source:'fixture'}]})));
  const result=await loadQuoteBatches('isolated-token',['AAPL','NVDA'],'1m',new AbortController().signal);
  expect(result.quotes.map(q=>q.symbol)).toEqual(['AAPL']);expect(result.reason).toBe('partial_provider_unavailable');
 });
});
