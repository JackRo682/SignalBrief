// @vitest-environment node
import {describe,expect,it,vi} from 'vitest';
import {archiveNotice,locateQuote,normalizeNotice,noticeSourceKey,parseNoticeDate,validateNotice,type NoticeManifest} from '../../../supabase/functions/signalbrief-calendar/curated-notice';
import {sha256,type Source} from '../../../supabase/functions/signalbrief-calendar/core';

export async function noticeFixture(){
 const url='https://www.apple.com/newsroom/2026/11/synthetic-notice/';
 const raw=new TextEncoder().encode('<title>Apple</title><p>😀 Synthetic dividend is payable on November 16, 2026.</p>');
 const text=normalizeNotice(raw,'html','utf-8',url),key=await noticeSourceKey('sec','0000320193',url),rawSha=await sha256(raw),normalizedSha=await sha256(new TextEncoder().encode(text));
 const quote='Synthetic dividend is payable on November 16, 2026.',location=locateQuote(text,quote);
 const source:Source={key,url,company_id:'10000000-0000-4000-8000-000000000081',provider:'sec',provider_company_id:'0000320193',ticker:'AAPL',market:'NASDAQ',adapter:'curated-notice'};
 const manifest:NoticeManifest={schema:'signalbrief.calendar.curated-notice.v1',adapter:'curated-notice',complete:false,source_key:key,source_url:url,document_url:url,company_id:source.company_id!,provider:'sec',provider_company_id:source.provider_company_id!,ticker:'AAPL',format:'html',encoding:'utf-8',raw_sha256:rawSha,raw_bytes:raw.length,raw_object_key:`calendar/${key}/originals/${rawSha}.html`,normalized_sha256:normalizedSha,normalized_object_key:`calendar/${key}/normalized/${normalizedSha}.txt`,normalization:'html-text-v1',extraction:'deterministic-v1',fetched_at:new Date().toISOString(),published_on:null,publication_precision:'unknown',publication_timezone:null,issuer_quote:'Apple',issuer_start:0,issuer_end:5,entries:[{key:'payment-2026-q4',title:'Synthetic dividend payment',event_type:'dividend_payment',occurs_on:'2026-11-16',date_token:'November 16, 2026',quote,quote_start:location.start,quote_end:location.end,location:`normalized-text[${location.start}:${location.end}]`,timezone:null}]};
 return {source,manifest,text,raw,payload:{completed:false as const,manifest_text:JSON.stringify(manifest),normalized_text:text,raw_base64:Buffer.from(raw).toString('base64')}};
}
describe('finite official notice evidence and immutable archival',()=>{
 it('keeps original bytes, deterministic normalized text and the complete manifest in separate immutable paths',async()=>{
  const f=await noticeFixture(),archive=vi.fn(async()=>{}),result=await archiveNotice(f.source,f.payload,archive);
  expect(result.completed).toBe(false);expect(archive).toHaveBeenCalledTimes(3);
  expect(archive.mock.calls[0]).toEqual([f.manifest.raw_object_key,f.raw,'text/html']);
  expect(archive.mock.calls[1]).toEqual([f.manifest.normalized_object_key,new TextEncoder().encode(f.text),'text/plain;charset=utf-8']);
  expect(f.manifest.entries[0].quote_start).toBe(8); // Unicode code points, not UTF-16 units.
 });
 it.each(['company','url','raw','text','quote','offset','day','type','duplicate','path','timezone'])('rejects %s mutation before any archive write',async mutation=>{
  const f=await noticeFixture(),m=structuredClone(f.manifest),archive=vi.fn(async()=>{}),payload={...f.payload};
  if(mutation==='company')m.company_id='another-issuer';
  if(mutation==='url')m.source_url='https://127.0.0.1/';
  if(mutation==='raw')payload.raw_base64=Buffer.from('changed').toString('base64');
  if(mutation==='text')payload.normalized_text+=' altered';
  if(mutation==='quote')m.entries[0].quote='invented date';
  if(mutation==='offset')m.entries[0].quote_start++;
  if(mutation==='day')m.entries[0].occurs_on='2026-11-17';
  if(mutation==='type')m.entries[0].event_type='annual_meeting';
  if(mutation==='duplicate')m.entries.push(m.entries[0]);
  if(mutation==='path')m.raw_object_key='calendar/another/raw.html';
  if(mutation==='timezone')m.entries[0].timezone='Asia/Seoul' as never;
  payload.manifest_text=JSON.stringify(m);
  await expect(archiveNotice(f.source,payload,archive)).rejects.toThrow();expect(archive).not.toHaveBeenCalled();
 });
 it('does not archive a manifest if the original upload fails',async()=>{
  const f=await noticeFixture(),archive=vi.fn(async()=>{throw new Error('storage unavailable');});
  await expect(archiveNotice(f.source,f.payload,archive)).rejects.toThrow('storage unavailable');expect(archive).toHaveBeenCalledTimes(1);
 });
 it('requires genuine PDF signature and records offline extraction explicitly',async()=>{
  const f=await noticeFixture(),raw=new TextEncoder().encode('%PDF-1.7\nSynthetic test bytes, not a real source document.');
  f.manifest.format='pdf';f.manifest.raw_bytes=raw.length;f.manifest.raw_sha256=await sha256(raw);f.manifest.raw_object_key=`calendar/${f.source.key}/originals/${f.manifest.raw_sha256}.pdf`;
  f.manifest.normalization='pdf-text-whitespace-v1';f.manifest.extraction='pdftotext-25.06.0;layout;utf-8';
  await expect(validateNotice(f.source,f.manifest,f.text,raw)).resolves.toBeUndefined();
  f.manifest.extraction='model-reconstructed';await expect(validateNotice(f.source,f.manifest,f.text,raw)).rejects.toThrow('notice_pdf_extraction_missing');
 });
 it('supports only the exact displayed LS ELECTRIC news record JSON contract',()=>{
  const url='https://www.ls-electric.com/ko/api/board.ashx?t=news_view&b_id=123';
  const entity={b_id:123,b_display:true,b_lang:'ko',b_type:'news',b_title:'LS ELECTRIC',b_regdate:'2026/10/28 00:00:00',b_content:'<p>BIXPO 2026 전시회 11월 4~6일</p>'};
  const bytes=(e=entity)=>new TextEncoder().encode(JSON.stringify({success:true,data:{entity:e}}));
  expect(normalizeNotice(bytes(),'json','utf-8',url)).toBe('LS ELECTRIC 2026/10/28 00:00:00 BIXPO 2026 전시회 11월 4~6일');
  expect(()=>normalizeNotice(bytes({...entity,b_id:124}),'json','utf-8',url)).toThrow('notice_board_identity');
  expect(()=>normalizeNotice(bytes({...entity,b_display:false}),'json','utf-8',url)).toThrow('notice_board_identity');
  expect(()=>normalizeNotice(bytes(),'json','utf-8','https://untrusted.invalid/api')).toThrow('notice_board_identity');
 });
 it.each([['2026-11-06','2026-11-06'],['2026년 11월 06일','2026-11-06'],['2026/10/28','2026-10-28'],['Nov. 13, 2026','2026-11-13'],['11/15/26','2026-11-15'],['11월 16','2026-11-16'],['17일','2026-11-17'],['December 1','2026-12-01']])('parses source date %s without locale or timezone guessing',(token,result)=>{
  expect(parseNoticeDate(token,2026,11)).toBe(result);
 });
 it.each(['2026-02-30','November 31, 2026','11/16','17일','soon','2026','01/02/2026'])('rejects ambiguous or impossible token %s without source context',token=>{
  expect(()=>parseNoticeDate(token)).toThrow();
 });
 it('an already completed scoped retry does not reupload deleted staging chunks',async()=>{
  const f=await noticeFixture(),archive=vi.fn(async()=>{});
  await expect(archiveNotice(f.source,{completed:true,count:1},archive)).resolves.toEqual({completed:true,count:1});expect(archive).not.toHaveBeenCalled();
 });
});
