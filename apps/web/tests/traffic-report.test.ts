// @vitest-environment node
import {afterEach,describe,expect,it,vi} from 'vitest';
import {trafficSummary,type TrafficSummary} from '../src/acquisition/contracts';
import {changeLabel,comparisonNote,csvCell,percentage,previousRange,sumJourneys,trafficCsv} from '../src/acquisition/report';
import {fetchTrafficReport,TrafficReportError} from '../src/acquisition/report-client';

const range={from:'2026-11-20',to:'2026-11-26'};
const count={visitors:12,pageviews:30,starts:4,requests:2,signups:1,onboarded:1};
function report(patch:Partial<TrafficSummary>={}):TrafficSummary{return {
 generated_at:'2026-11-28T00:00:00Z',totals:count,daily:[],sources:[],
 measurement:{first_acquisition_at:'2026-11-01T00:00:00Z',first_journey_at:'2026-11-01T00:00:00Z',first_surface_at:null,retained_from:'2026-08-29T00:00:00Z'},
 ...patch,
};}
afterEach(()=>vi.unstubAllGlobals());

describe('same-length KST period comparisons',()=>{
 it.each([
  [{from:'2026-11-20',to:'2026-11-26'},{from:'2026-11-13',to:'2026-11-19'}],
  [{from:'2026-01-01',to:'2026-01-01'},{from:'2025-12-31',to:'2025-12-31'}],
  [{from:'2024-03-01',to:'2024-03-02'},{from:'2024-02-28',to:'2024-02-29'}],
 ])('uses inclusive date boundaries without shortening the prior period', (current,expected)=>{
  expect(previousRange(current)).toEqual(expected);
  expect(Date.parse(current.to)-Date.parse(current.from)).toBe(Date.parse(expected.to)-Date.parse(expected.from));
 });
 it('withholds a change while the selected KST end day is still in progress',()=>{
  expect(comparisonNote(report({generated_at:'2026-11-26T14:59:59Z'}),range,'acquisition')).toBe('오늘 포함 · 기간 미완료');
  expect(comparisonNote(report({generated_at:'2026-11-26T15:00:00Z'}),range,'acquisition')).toBeNull();
 });
 it('does not manufacture coverage when the retention window or first observation misses the prior start',()=>{
  const complete=report();
  expect(comparisonNote(complete,range,'journey')).toBeNull();
  for(const patch of [{first_journey_at:null},{first_journey_at:'2026-11-12T15:00:00.001Z'},{retained_from:'2026-11-12T15:00:00.001Z'}]){
   expect(comparisonNote(report({measurement:{...complete.measurement!,...patch}}),range,'journey')).toBe('비교 기간 자료 부족');
  }
  expect(comparisonNote(report({measurement:undefined}),range,'acquisition')).toBe('비교 기간 자료 부족');
  expect(comparisonNote(report({measurement:{...complete.measurement!,first_journey_at:'2026-11-12T15:00:00.000Z'}}),range,'journey')).toBeNull();
 });
 it('keeps unknown measurements, true zero baselines and measured zero conversion distinct',()=>{
  expect(sumJourneys(report())).toBeNull();
  expect(sumJourneys(report({journeys:[]}))?.sessions).toBe(0);
  expect(percentage(0,0)).toBe('—');expect(percentage(0,10)).toBe('0.0%');
  expect(changeLabel(12,0,null)).toBe('이전 값 0 · 증감률 미계산');
  expect(changeLabel(12,0,'비교 기간 자료 부족')).toBe('비교 기간 자료 부족');
  expect(changeLabel(15,10,null)).toBe('+50.0%');expect(changeLabel(0,10,null)).toBe('-100.0%');
 });
});

describe('portable, minimized report CSV',()=>{
 it.each(['=1+2','+SUM(A1:A2)','-1+2','@SUM(A1:A2)','  =HYPERLINK("bad")','\tprivate','\rprivate','\nprivate','\uFEFF=1+2'])('neutralizes spreadsheet formulas and leading controls: %j',value=>{
  const escaped=csvCell(value);
  expect(escaped.startsWith('"\'')).toBe(true);
  expect(escaped.endsWith('"')).toBe(true);
 });
 it('preserves Korean text, commas, quotes and missing values without claiming zero',()=>{
  expect(csvCell('유입, "카카오"')).toBe('"유입, ""카카오"""');
  expect(csvCell(null)).toBe('""');expect(csvCell(undefined)).toBe('""');expect(csvCell(0)).toBe('"0"');
  const text=trafficCsv(report({surface_times:[{surface:'home',release:'=HYPERLINK("bad","클릭")',source:'kakao',views:1,browsers:1,mean_ms:0,median_ms:0}]}),range);
  expect(text.charCodeAt(0)).toBe(0xFEFF);expect(text).toContain('\r\n');expect(text).toContain('클릭');
  expect(text).toContain(csvCell('=HYPERLINK("bad","클릭")'));
  expect(text).toContain('"first_surface_at","","timestamp"');
  expect(text).toContain('"unknown"');
 });
 it('exports unknown devices honestly and does not invent sections absent from older responses',()=>{
  const old=trafficCsv(report({measurement:undefined}),range).split('\r\n').slice(1).join('\r\n');
  expect(old).not.toContain('"journey"');expect(old).not.toContain('"device"');expect(old).not.toContain('"surface"');
  const text=trafficCsv(report({journey_devices:[{device:'unknown',sessions:7}]}),range);
  expect(text).toContain('"unknown","","sessions","7","sessions"');
  expect(text).not.toContain('"desktop"');expect(text).not.toContain('"mobile"');
 });
 it('includes the actual prior response only when requested and identifies both date ranges',()=>{
  const current=report(),prior=report({totals:{...count,visitors:5}});
  expect(trafficCsv(current,range)).not.toContain('"previous"');
  const text=trafficCsv(current,range,prior);
  expect(text).toContain('"acquisition","current","2026-11-20","2026-11-26"');
  expect(text).toContain('"acquisition","previous","2026-11-13","2026-11-19"');
  expect(text).toContain('"visitors","5","browsers"');
  expect(text).toContain('No causal or statistical significance claim.');
 });
});

describe('validated report transport',()=>{
 it('uses same-origin POST, verified-session bearer and no-store caching',async()=>{
  const response=report(),transport=vi.fn(async()=>Response.json(response));vi.stubGlobal('fetch',transport);
  const controller=new AbortController();
  expect(await fetchTrafficReport('synthetic-token',{action:'summary',...range},trafficSummary,controller.signal)).toEqual(response);
  expect(transport).toHaveBeenCalledWith('/api/traffic',expect.objectContaining({method:'POST',cache:'no-store',headers:{'Content-Type':'application/json',Authorization:'Bearer synthetic-token'},body:JSON.stringify({action:'summary',...range})}));
 });
 it.each([401,403,429,500])('preserves status %i for access and retry handling without exposing server text',async status=>{
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({private:'untrusted diagnostic'},{status})));
  const result=fetchTrafficReport('synthetic-token',{},trafficSummary,new AbortController().signal);
  await expect(result).rejects.toBeInstanceOf(TrafficReportError);
  await expect(result).rejects.toMatchObject({status});
  await expect(result).rejects.not.toHaveProperty('message','untrusted diagnostic');
 });
 it('rejects malformed success payloads instead of substituting plausible statistics',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({...report(),totals:{...count,visitors:-1}})));
  await expect(fetchTrafficReport('synthetic-token',{},trafficSummary,new AbortController().signal)).rejects.toMatchObject({status:502});
 });
});
