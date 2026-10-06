// @vitest-environment node
import {describe,it,expect} from 'vitest';
import {valuePortfolio,formatExactMoney,validReferenceRate,type Holding,type MarketQuote,type ReferenceRate} from '../src/mobile/portfolio-math';

const now=Date.parse('2026-10-06T09:00:00Z');
const holding=(ticker:string,quantity:string,cost:string|null,currency='USD'):Holding=>({id:ticker,company:{id:ticker,name:`Synthetic ${ticker}`,ticker,market:currency==='USD'?'NASDAQ':'KOSPI',provider:currency==='USD'?'sec':'dart',is_demo:true,last_ingested_at:null},quantity,average_cost:cost,currency});
const quote=(symbol:string,price:number,currency='USD',change_pct:number|null=0):MarketQuote=>({symbol,price,currency,change_pct,as_of:'2026-10-05T20:00:00Z',source:'synthetic-test',history:[]});
const fx:ReferenceRate={base:'USD',quote:'KRW',rate:1300,date:'2026-10-06',source:'synthetic-test',kind:'daily_reference'};

describe('mobile portfolio valuation boundaries',()=>{
 it('keeps decimal multiplication exact for fractional quantities and prices',()=>{
  const result=valuePortfolio([holding('TEST','0.1','0.1')],[quote('TEST',0.2)],null,now);
  expect(result.currency).toBe('USD');expect(result.value).toBe('0.02');expect(result.cost).toBe('0.01');expect(result.gain).toBe('0.01');expect(result.returnPct).toBe(100);
 });
 it('does not mix currencies without a verified FX rate',()=>{
  const result=valuePortfolio([holding('USA','1','80'),holding('KOR','2','40000','KRW')],[quote('USA',100),quote('KOR',50000,'KRW')],null,now);
  expect(result.currency).toBeNull();expect(result.value).toBeNull();expect(result.returnPct).toBeNull();expect(result.rows.map(r=>r.weight)).toEqual([null,null]);
  expect(result.groups).toEqual([{currency:'USD',value:'100',count:1},{currency:'KRW',value:'100000',count:1}]);
 });
 it('uses the actual daily rate for an explicitly KRW presentation',()=>{
  const result=valuePortfolio([holding('USA','10','80'),holding('KOR','1','40000','KRW')],[quote('USA',100),quote('KOR',50000,'KRW')],fx,now);
  expect(result.currency).toBe('KRW');expect(result.value).toBe('1350000');expect(result.cost).toBe('1080000');expect(result.gain).toBe('270000');expect(result.returnPct).toBe(25);expect(result.rows[0].weight).toBeCloseTo(96.296296,5);
 });
 it('converts a USD-only portfolio when a current reference rate is available',()=>{
  expect(valuePortfolio([holding('USA','1','80')],[quote('USA',100)],fx,now).value).toBe('130000');
 });
 it('does not treat a missing price as a zero position or publish a partial total',()=>{
  const result=valuePortfolio([holding('USA','1','80'),holding('MISSING','2','40')],[quote('USA',100)],null,now);
  expect(result.pricedCount).toBe(1);expect(result.complete).toBe(false);expect(result.value).toBeNull();expect(result.rows[0].value).toBe('100');expect(result.rows[1].value).toBeNull();expect(result.rows[0].weight).toBeNull();
 });
 it('keeps returns unknown if even one cost basis is absent',()=>{
  const result=valuePortfolio([holding('USA','1',null)],[quote('USA',100)],null,now);
  expect(result.value).toBe('100');expect(result.cost).toBeNull();expect(result.gain).toBeNull();expect(result.returnPct).toBeNull();
 });
 it('does not replace historical acquisition FX with a current reference rate',()=>{
  const result=valuePortfolio([holding('USA','1','100000','KRW')],[quote('USA',100)],fx,now);
  expect(result.value).toBe('130000');expect(result.cost).toBeNull();expect(result.gain).toBeNull();expect(result.returnPct).toBeNull();
 });
 it('derives the previous-session value from the reported percentage denominator',()=>{
  const result=valuePortfolio([holding('USA','1','80')],[quote('USA',110,'USD',10)],null,now);
  expect(result.dailyChange).toBe('10');expect(result.dailyPct).toBe(10);
 });
 it('preserves a reported zero change and never fabricates a missing change',()=>{
  expect(valuePortfolio([holding('USA','1','80')],[quote('USA',100,'USD',0)],null,now).dailyChange).toBe('0');
  expect(valuePortfolio([holding('USA','1','80')],[quote('USA',100,'USD',null)],null,now).dailyChange).toBeNull();
 });
 it('rejects a percentage whose implied prior value cannot be calculated',()=>{
  const result=valuePortfolio([holding('USA','1','80')],[quote('USA',0,'USD',-100)],null,now);
  expect(result.value).toBe('0');expect(result.dailyChange).toBeNull();
 });
 it.each(['2026-09-01T20:00:00Z','2026-10-10T20:00:00Z','not-a-date'])('does not use stale, future or invalid quote time %s',as_of=>{
  expect(valuePortfolio([holding('USA','1','80')],[{...quote('USA',100),as_of}],null,now).value).toBeNull();
 });
 it.each(['2026-09-01','2026-10-07'])('does not use an expired or future FX rate %s',date=>{
  expect(validReferenceRate({...fx,date},now)).toBeNull();
 });
 it('keeps an empty portfolio unknown and avoids a fabricated investment balance',()=>{
  const result=valuePortfolio([],[],fx,now);expect(result.value).toBeNull();expect(result.returnPct).toBeNull();expect(result.rows).toEqual([]);
 });
 it('rounds display money without losing large input digits to binary floats',()=>{
  expect(formatExactMoney('1000000000000000000.125','USD','en-US')).toBe('$1,000,000,000,000,000,000.13');
  expect(formatExactMoney('-0.125','USD','en-US')).toBe('-$0.13');
  expect(formatExactMoney('130000.5','KRW','ko-KR')).toBe('130,001원');
  expect(formatExactMoney(null,'KRW')).toBe('—');
 });
});
