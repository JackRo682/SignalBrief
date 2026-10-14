// @vitest-environment node
import {describe,it,expect,vi} from 'vitest';
import {taskToken,koreaDate,dartPage,dartList} from '../../../supabase/functions/signalbrief-collector/core';
describe('scheduled collection boundaries',()=>{
 it.each(['','abc','A'.repeat(64),'0'.repeat(63)])('rejects malformed task tokens',value=>expect(()=>taskToken(value)).toThrow('invalid_task'));
 it('accepts only an opaque 256-bit token shape',()=>expect(taskToken('a'.repeat(64))).toHaveLength(64));
 it('uses the Korean reception date across UTC midnight',()=>expect(koreaDate(new Date('2026-10-13T15:00:00Z'))).toBe('20261014'));
 it('does not require invented filings for an empty official response',()=>expect(dartPage('{"status":"013"}','00126380')).toEqual({items:[],pages:0}));
 it.each(['010','011','020','999'])('rejects provider status %s',status=>expect(()=>dartPage(JSON.stringify({status}),'00126380')).toThrow());
 const item={corp_code:'00126380',rcept_no:'20261014000001',rcept_dt:'20261014',report_nm:'Quarterly filing'};
 it('preserves receipt identity, date and official URL',()=>{
  const page=dartPage(JSON.stringify({status:'000',total_page:2,list:[item]}),'00126380');
  expect(page).toEqual({pages:2,items:[{receipt:item.rcept_no,title:item.report_nm,filing_date:'2026-10-14',source_url:'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20261014000001'}]});
 });
 it('rejects a response for a different issuer',()=>expect(()=>dartPage(JSON.stringify({status:'000',total_page:1,list:[{...item,corp_code:'99999999'}]}),'00126380')).toThrow('invalid_filing_identity'));
 it.each([0,6,1.5])('reports bounded pagination instead of silently dropping pages: %s',total_page=>expect(()=>dartPage(JSON.stringify({status:'000',total_page,list:[]}),'00126380')).toThrow('pagination_limit_or_invalid_response'));
 it('never contacts DART without valid credentials',async()=>{
  const fetcher=vi.fn();await expect(dartList('00126380','',1,fetcher)).rejects.toThrow('missing_or_invalid_key');expect(fetcher).not.toHaveBeenCalled();
 });
 it('bounds pagination inputs before making a request',async()=>{
  const fetcher=vi.fn();await expect(dartList('00126380','a'.repeat(40),6,fetcher)).rejects.toThrow('invalid_page');expect(fetcher).not.toHaveBeenCalled();
 });
 it('uses only the official HTTPS endpoint and includes amendments',async()=>{
  const fetcher=vi.fn().mockResolvedValue(new Response('{"status":"013"}'));
  await dartList('00126380','a'.repeat(40),1,fetcher);
  const url=fetcher.mock.calls[0][0] as URL;
  expect(url.origin).toBe('https://opendart.fss.or.kr');
  expect(url.searchParams.get('corp_code')).toBe('00126380');
  expect(url.searchParams.get('page_count')).toBe('100');
  expect(url.searchParams.has('last_reprt_at')).toBe(false);
 });
});
