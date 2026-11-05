// @vitest-environment node
import {describe,expect,it,vi} from 'vitest';
import {collectDartIR,DART_IR_SOURCE_URL,parseDartIRBody,parseDartIRMain,type DartIRSource} from '../../../supabase/functions/signalbrief-calendar/dart-ir';

// Synthetic identities and bytes following the independently verified DART K/70050
// matrix and correction layout. Real source URLs/hashes are documented separately.
const source:DartIRSource={key:'dart-ir-12345679',adapter:'dart-ir',provider:'dart',provider_company_id:'12345679',company_id:'d702c7c0-0000-4000-8000-000000000002',ticker:'0000B1',market:'KOSDAQ',url:DART_IR_SOURCE_URL};
const root='20261020900001',latest='20261103900002',today='2026-11-04',issuer='Synthetic Kosdaq';
const day=(receipt:string)=>`${receipt.slice(0,4)}-${receipt.slice(4,6)}-${receipt.slice(6,8)}`;
const filing=(receipt=root,first=root)=>({receipt,receipt_date:day(receipt),company_name:issuer,report_name:(receipt===first?'':'[기재정정]')+'기업설명회(IR)개최',remarks:''});
const main=(receipt=root,family=[root])=>`<!doctype html><html><head><title>${issuer}/기업설명회(IR)개최/${day(receipt).replaceAll('-','.')}</title></head><body><span onclick="openCorpInfoNew('12345679','winCorpInfo','/dsae001/selectPopup.ax');">${issuer}</span><select id="family">${[...family].reverse().map(r=>`<option value="rcpNo=${r}" ${r===receipt?'selected':''} title="기업설명회(IR)개최">${day(r).replaceAll('-','.')} ${r===family[0]?'':'[정정]'}기업설명회(IR)개최</option>`).join('')}</select><script>viewDoc("${receipt}","11112223","0","0","0","HTML","");alertJungJung("K","70050");alertInvestNotice("${receipt}","11112223","${family[0]}","${receipt===family[0]?0:1}","70050","HTML");</script></body></html>`;
const matrix=(start='2026-11-11',end=start)=>`<tr><td rowspan="3">1. 일시</td><td>행사일</td><td>시간(현지시간)</td></tr><tr><td>시작일</td><td>종료일</td><td>시작시간</td><td>종료시간</td></tr><tr><td>${start}</td><td>${end}</td><td>16:00</td><td>16:30</td></tr>`;
const correction=(receipt:string,first:string)=>`<table><tr><td>정정일자</td><td>${day(receipt)}</td></tr></table><table><tr><td>1. 정정관련 공시서류</td><td>기업설명회(IR) 개최</td></tr><tr><td>2. 정정관련 공시서류제출일</td><td>${day(first)}</td></tr><tr><td>3. 정정사유</td><td>게재일시 오기재</td></tr><tr><td>4. 정정사항</td></tr><tr><td>정정항목</td><td>정정전</td><td>정정후</td></tr><tr><td>10.IR자료게재 게재일시</td><td>2026-10-20</td><td>2026-12-01</td></tr></table>`;
const body=(start='2026-11-11',end=start,receipt=root,first=root)=>`<!doctype html><html><head><title>${issuer}/기업설명회(IR) 개최/(${day(receipt).replaceAll('-','.')})기업설명회(IR) 개최</title></head><body>${receipt===first?'':correction(receipt,first)}<table><tbody>${matrix(start,end)}<tr><td>2. 장소</td><td>Overseas venue</td></tr><tr><td>3. 대상자</td><td>Investors</td></tr><tr><td>4. 실시목적</td><td>Quarterly results briefing</td></tr><tr><td>5. 실시방법</td><td>Conference call</td></tr><tr><td>6. 주요내용</td><td>Results and questions</td></tr><tr><td>7. 후원기관</td><td>Issuer</td></tr><tr><td>8. 개최확정일</td><td>2026-10-01</td></tr><tr><td>9. 담당자</td><td>IR team</td></tr><tr><td>10. IR 자료게재</td><td>게재일시</td><td>2026-12-01</td></tr></tbody></table></body></html>`;
const lineage=()=>parseDartIRMain(main(),source,filing());
const encode=(text:string)=>new TextEncoder().encode(text);

function collector(family=[root],listed=family){
 const archive=vi.fn(async()=>{});
 const listPage=vi.fn(async()=>encode(JSON.stringify({status:'000',page_no:1,page_count:100,total_count:listed.length,total_page:1,list:listed.map(receipt=>({corp_code:source.provider_company_id,stock_code:source.ticker,corp_name:issuer,report_nm:filing(receipt,family[0]).report_name,rcept_no:receipt,rcept_dt:receipt.slice(0,8),rm:''}))})));
 const fetcher=vi.fn(async(value:string|URL|Request,init?:RequestInit)=>{
  expect(init?.redirect).toBe('error');expect(init?.signal).toBeInstanceOf(AbortSignal);
  const url=new URL(String(value));expect(url.origin).toBe('https://dart.fss.or.kr');
  const receipt=url.searchParams.get('rcpNo')!;
  if(!family.includes(receipt))throw new Error('Unexpected synthetic receipt');
  return new Response(url.pathname==='/dsaf001/main.do'?main(receipt,family):body('2026-11-11','2026-11-12',receipt,family[0]),{headers:{'content-type':'text/html; charset=utf-8'}});
 }) as unknown as typeof fetch;
 return {archive,listPage,fetcher,collect:()=>collectDartIR(source,today,archive,listPage,fetcher)};
}

describe('DART KOSDAQ 70050 source contract',()=>{
 it('requires the exact K marker, selected corporation, report title and matching document proof',()=>{
  expect(lineage()).toMatchObject({template_id:'70050',root_receipt_no:root,corrected:false,family_receipts:[root],body_url:`https://dart.fss.or.kr/report/viewer.do?rcpNo=${root}&dcmNo=11112223&eleId=0&offset=0&length=0&dtd=HTML`});
  expect(()=>parseDartIRMain(main(),{...source,market:'KOSPI'},filing())).toThrow('unsupported_ir_template');
  expect(()=>parseDartIRMain(main().replace('alertJungJung("K"','alertJungJung("Y"'),source,filing())).toThrow('unsupported_ir_template');
  expect(()=>parseDartIRMain(main().replace('12345679','87654321'),source,filing())).toThrow('company_identity_mismatch');
  expect(()=>parseDartIRMain(main().replace('"0","70050","HTML"','"0","99664","HTML"'),source,filing())).toThrow('ambiguous_correction');
  expect(()=>parseDartIRMain(main().replace('</script>','alertJungJung("K","70050");</script>'),source,filing())).toThrow('unsupported_ir_template');
 });
 it('uses the matrix start date while excluding decision and materials-publication dates',()=>{
  expect(parseDartIRBody(body(),filing(),lineage())).toEqual({title:`${issuer} · Quarterly results briefing`,occurs_on:'2026-11-11',quote:'1. 일시 행사일 시간(현지시간) 시작일 종료일 시작시간 종료시간 2026-11-11 2026-11-11 16:00 16:30',location:'70050/table/tr[2]/시작일'});
  expect(()=>parseDartIRBody(body(),filing())).toThrow('filing_identity_mismatch');
 });
 it('represents a declared multi-day event as one explicitly labelled start and retains the end date',()=>{
  const parsed=parseDartIRBody(body('2026-11-11','2026-11-13'),filing(),lineage());
  expect(parsed).toMatchObject({occurs_on:'2026-11-11',ends_on:'2026-11-13',title:`${issuer} · Quarterly results briefing · 기간 시작 (2026-11-11–2026-11-13)`});
  expect(parsed).not.toHaveProperty('timezone');expect(parsed).not.toHaveProperty('timestamp');
 });
 it.each([['2026-02-30','2026-03-01'],['2026-11-12','2026-11-11'],['2026-11-11','2026-12-13'],['11-11','11-12']])('rejects invalid, reversed or unbounded start/end dates %s / %s',(start,end)=>{
  expect(()=>parseDartIRBody(body(start,end),filing(),lineage())).toThrow();
 });
 it('rejects missing, duplicated, reordered or relabelled matrix cells',()=>{
  for(const html of [body().replace(matrix(),''),body().replace(matrix(),matrix()+matrix()),body().replace('시작일</td><td>종료일','종료일</td><td>시작일'),body().replace('16:30</td>','2026-12-01</td>'),body().replace('9. 담당자','Unrelated row')]){
   expect(()=>parseDartIRBody(html,filing(),lineage())).toThrow();
  }
 });
 it('rejects another issuer, another receipt date, truncated data and unverified correction text',()=>{
  for(const html of [body().replaceAll(issuer,'Other issuer'),body().replace('2026.10.20','2026.10.21'),body().replace('</html>',''),body().replace('Results and questions','정정전 2026-11-10 정정후 2026-11-11')]){
   expect(()=>parseDartIRBody(html,filing(),lineage())).toThrow();
  }
 });
 it('ignores hidden alternate matrices and does not execute source scripts',()=>{
  const html=body().replace('<tbody>','<tbody><script>throw new Error("not executed")</script>').replace('</table>',`</table><table hidden>${matrix('2026-12-20')}</table>`);
  expect(parseDartIRBody(html,filing(),lineage()).occurs_on).toBe('2026-11-11');
 });
 it('validates the latest correction table separately from the event matrix',()=>{
  const proof=parseDartIRMain(main(latest,[root,latest]),source,filing(latest));
  expect(parseDartIRBody(body('2026-11-11','2026-11-11',latest),filing(latest),proof).occurs_on).toBe('2026-11-11');
  expect(()=>parseDartIRBody(body('2026-11-11','2026-11-11',latest).replace('게재일시 오기재','행사 취소'),filing(latest),proof)).toThrow('ambiguous_correction');
  expect(()=>parseDartIRBody(body('2026-11-11','2026-11-11',latest).replace('2026-10-20</td>','2026-10-19</td>'),filing(latest),proof)).toThrow('ambiguous_correction');
 });
 it('archives and emits one date-only event with explicit 70050 document provenance',async()=>{
  const f=collector(),result=await f.collect();
  expect(result.manifest.schema).toBe('signalbrief.calendar.dart-ir.v2');
  expect(result.manifest.documents).toHaveLength(1);expect(result.manifest.documents[0].template_id).toBe('70050');
  expect(result.manifest.entries).toHaveLength(1);expect(result.manifest.entries[0]).toMatchObject({key:root,receipt_no:root,occurs_on:'2026-11-11',ends_on:'2026-11-12',timezone:null});
  expect(f.archive).toHaveBeenCalledTimes(4);expect(f.listPage).toHaveBeenCalledTimes(1);
 });
 it('keeps the root receipt stable across corrections and backfills only explicitly proven older members',async()=>{
  for(const [family,listed] of [[[root,latest],[root,latest]],[['20260601900001',latest],[latest]]]){
   const result=await collector(family,listed).collect();
   expect(result.manifest.entries).toHaveLength(1);expect(result.manifest.entries[0]).toMatchObject({key:family[0],receipt_no:latest,occurs_on:'2026-11-11'});
   expect(result.manifest.documents).toHaveLength(2);expect(result.manifest.documents.every(doc=>doc.template_id==='70050')).toBe(true);
  }
 });
});
