// @vitest-environment node
import {createHash} from 'node:crypto';
import {describe,expect,it,vi} from 'vitest';
import {collectDartIR,DART_IR_SOURCE_URL,decodeDartIRHTML,parseDartIRBody,parseDartIRList,parseDartIRMain,type DartIRSource} from '../../../supabase/functions/signalbrief-calendar/dart-ir';

// Entirely synthetic issuer, filing, and source bytes. The layout follows the
// public 99664 notice contract; no production archive or credential is included.
const source:DartIRSource={key:'dart-ir-12345678',adapter:'dart-ir',provider:'dart',provider_company_id:'12345678',company_id:'d702c7c0-0000-4000-8000-000000000001',ticker:'0000A1',market:'KOSPI',url:DART_IR_SOURCE_URL};
const today='2026-11-01',window={start:'2026-08-03',end:today};
const filing={receipt:'20261020000001',receipt_date:'2026-10-20',company_name:'Synthetic Korea',report_name:'기업설명회(IR)개최(안내공시)',remarks:''};
const encode=(value:string)=>new TextEncoder().encode(value);
const digest=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const row=(receipt=filing.receipt)=>({corp_code:source.provider_company_id,stock_code:source.ticker,corp_name:filing.company_name,report_nm:filing.report_name,rcept_no:receipt,rcept_dt:filing.receipt_date.replaceAll('-',''),rm:''});
const page=(rows:Record<string,unknown>[]= [row()],pageNo=1,total=rows.length)=>encode(JSON.stringify({status:'000',page_no:pageNo,page_count:100,total_count:total,total_page:Math.ceil(total/100),list:rows}));
const main=(receipt=filing.receipt)=>`<!doctype html><html><head><title>Synthetic Korea/기업설명회(IR)개최(안내공시)/2026.10.20</title></head><body><span onclick="openCorpInfoNew('12345678', 'winCorpInfo', '/dsae001/selectPopup.ax');">Synthetic Korea</span><select><option value="rcpNo=${receipt}">현재 본문</option></select><script>viewDoc("${receipt}", "11112222", "0", "0", "0", "HTML", ""); alertJungJung("G", "99664");</script></body></html>`;
const occurrence=(day='2026-11-12')=>`<tr><td rowspan="2">1. 일시 및 장소</td><td>일시</td><td><span>${day}</span></td><td>09:00</td></tr>`;
const body=(day='2026-11-12')=>`<!doctype html><html><head><meta charset="utf-8"><title>Synthetic Korea/기업설명회(IR) 개최(안내공시)/(2026.10.20)</title></head><body><div class="xforms"><div class="xforms_title">기업설명회(IR) 개최(안내공시)</div><table><tbody>${occurrence(day)}<tr><td>장소</td><td colspan="2">온라인</td></tr><tr><td colspan="2">2. 참가 대상자</td><td colspan="2">신청자</td></tr><tr><td colspan="2">3. 개최목적</td><td colspan="2">Synthetic quarterly briefing</td></tr><tr><td>4. 개최방법</td><td>컨퍼런스콜</td></tr><tr><td>5. 후원기관</td><td>자사 주관</td></tr><tr><td>6. 주요 설명회내용(요약)</td><td>Synthetic facts and Q&amp;A</td></tr><tr><td>7. 결정일자</td><td>2026-10-20</td></tr><tr><td>8. IR 자료</td><td>게재일시</td><td>2026-11-11</td></tr><tr><td>9. 기타 투자판단과 관련한 중요사항</td><td>공식 원문 확인</td></tr></tbody></table></div></body></html>`;
const htmlResponse=(html:string)=>new Response(html,{headers:{'content-type':'text/html; charset=utf-8'}});
function fixture(options:{list?:Uint8Array;main?:string;body?:string}={}){
 const archives=new Map<string,{bytes:Uint8Array;type:string}>();
 const archive=vi.fn(async(path:string,bytes:Uint8Array,type:string)=>{archives.set(path,{bytes:bytes.slice(),type});});
 const listPage=vi.fn(async()=>options.list??page());
 const fetcher=vi.fn(async(url:string|URL|Request,init?:RequestInit)=>{
  expect(init?.redirect).toBe('error');expect(init?.signal).toBeInstanceOf(AbortSignal);
  const value=String(url);expect(new URL(value).origin).toBe('https://dart.fss.or.kr');
  return htmlResponse(value.includes('/dsaf001/')?options.main??main():options.body??body());
 }) as unknown as typeof fetch;
 return {archives,archive,listPage,fetcher,collect:()=>collectDartIR(source,today,archive,listPage,fetcher)};
}

describe('DART IR source semantics',()=>{
 it('extracts the explicitly labeled occurrence date, not receipt or material-publication dates',()=>{
  const parsed=parseDartIRBody(body(),filing);
  expect(parsed).toMatchObject({title:'Synthetic Korea · Synthetic quarterly briefing',occurs_on:'2026-11-12',quote:'1. 일시 및 장소 일시 2026-11-12 09:00',location:'99664/table/tr[0]/일시'});
  expect(parsed).not.toHaveProperty('timestamp');expect(parsed).not.toHaveProperty('timezone');
 });
 it.each(['2026-02-30','2026-11-12 ~ 2026-11-13','2026.11.12','11-12'])('rejects an invalid or ambiguous occurrence date %s',value=>{
  expect(()=>parseDartIRBody(body(value),filing)).toThrow();
 });
 it('rejects a missing occurrence row even when other dates are present',()=>{
  expect(()=>parseDartIRBody(body().replace(occurrence(),''),filing)).toThrow('ambiguous_date');
 });
 it('rejects duplicate occurrence rows and a truncated document',()=>{
  expect(()=>parseDartIRBody(body().replace(occurrence(),occurrence()+occurrence('2026-11-13')),filing)).toThrow('ambiguous_date');
  expect(()=>parseDartIRBody(body().replace('</html>',''),filing)).toThrow('incomplete_document');
  expect(()=>parseDartIRBody(body().replace('9. 기타 투자판단과 관련한 중요사항','누락'),filing)).toThrow('incomplete_document');
 });
 it('rejects correction comparisons and another issuer’s body',()=>{
  expect(()=>parseDartIRBody(body().replace('Synthetic facts and Q&amp;A','정정 전: 2026-11-12; 정정 후: 2026-11-13'),filing)).toThrow('ambiguous_correction');
  expect(()=>parseDartIRBody(body().replaceAll('Synthetic Korea','Another issuer'),filing)).toThrow('filing_identity_mismatch');
 });
 it('ignores script and hidden alternate dates instead of executing or treating them as evidence',()=>{
  const value=body().replace('<table>','<script>throw new Error("must never execute");</script><table>').replace('</tbody>',`<tr hidden><td>1. 일시 및 장소</td><td>일시</td><td>2026-12-01</td><td>12:00</td></tr></tbody>`);
  expect(parseDartIRBody(value,filing).occurs_on).toBe('2026-11-12');
 });
 it('binds the main page to the corporation, receipt, and one fixed-format viewer',()=>{
  expect(parseDartIRMain(main(),source,filing).body_url).toBe('https://dart.fss.or.kr/report/viewer.do?rcpNo=20261020000001&dcmNo=11112222&eleId=0&offset=0&length=0&dtd=HTML');
  expect(()=>parseDartIRMain(main().replace('12345678','87654321'),source,filing)).toThrow('company_identity_mismatch');
  expect(()=>parseDartIRMain(main('20261020000002'),source,filing)).toThrow();
  expect(()=>parseDartIRMain(main().replace('99664','70050'),source,filing)).toThrow('unsupported_ir_template');
  expect(()=>parseDartIRMain(main().replace('</select>','<option value="rcpNo=20261019000001">원본문서</option></select>'),source,filing)).toThrow('ambiguous_correction');
  expect(()=>parseDartIRMain(main().replace(/<option[\s\S]*?<\/option>/,''),source,filing)).toThrow('ambiguous_correction');
 });
 it('rejects an ambiguous viewer instead of following arbitrary URLs or evaluating script',()=>{
  expect(()=>parseDartIRMain(main().replace('alertJungJung',`viewDoc("20261020000001", "99992222", "0", "0", "0", "HTML", ""); alertJungJung`),source,filing)).toThrow('ambiguous_document');
  expect(()=>parseDartIRMain(main().replace('"11112222"','"https://attacker.invalid/secret"'),source,filing)).toThrow('ambiguous_document');
  expect(()=>parseDartIRMain(main().replace('alertJungJung','viewDoc("unrecognized"); alertJungJung'),source,filing)).toThrow('ambiguous_document');
 });
 it('bounds malformed HTML nesting before a small response can exhaust parser CPU',()=>{
  expect(()=>parseDartIRMain('<div>'.repeat(65)+main()+'</div>'.repeat(65),source,filing)).toThrow('source_too_large');
 });
 it('decodes genuine Korean legacy encoding without altering archived bytes',()=>{
  const bytes=Uint8Array.from([0xb1,0xe2,0xbe,0xf7]),before=bytes.slice();
  expect(decodeDartIRHTML(bytes,'text/html; charset=MS949')).toBe('기업');
  expect(bytes).toEqual(before);
  expect(()=>decodeDartIRHTML(Uint8Array.from([0xb1]),'text/html; charset=euc-kr')).toThrow('invalid_source_encoding');
  expect(()=>decodeDartIRHTML(encode(body()),'text/html; charset=utf-16')).toThrow('unsupported_source_encoding');
 });
});

describe('complete bounded DART listing',()=>{
 it('accepts the selected canonical alphanumeric ticker and rejects same-name issuer substitution',()=>{
  expect(parseDartIRList(page(),source,1,window).items).toEqual([filing]);
  expect(()=>parseDartIRList(page([{...row(),corp_code:'87654321'}]),source,1,window)).toThrow('company_identity_mismatch');
  expect(()=>parseDartIRList(page([{...row(),stock_code:'0000B1'}]),source,1,window)).toThrow('company_identity_mismatch');
 });
 it.each([
  {page_no:2},{page_count:50},{total_count:2},{total_page:2},{total_count:501,total_page:6},
 ])('rejects incomplete or inconsistent pagination %j',change=>{
  const value={...JSON.parse(new TextDecoder().decode(page())),...change};
  expect(()=>parseDartIRList(encode(JSON.stringify(value)),source,1,window)).toThrow('incomplete_pagination');
 });
 it('distinguishes official no-records from a provider error or partial second page',()=>{
  const none=encode(JSON.stringify({status:'013',message:'No data'}));
  expect(parseDartIRList(none,source,1,window)).toEqual({items:[],count:0,total_count:0,total_page:0});
  expect(()=>parseDartIRList(none,source,2,window)).toThrow('incomplete_pagination');
  expect(()=>parseDartIRList(encode(JSON.stringify({status:'020'})),source,1,window)).toThrow('dart_quota_exceeded');
 });
 it('rejects a filing outside the requested receipt window and mismatched receipt-date identity',()=>{
  expect(()=>parseDartIRList(page([{...row(),rcept_no:'20260701000001',rcept_dt:'20260701'}]),source,1,window)).toThrow('filing_outside_window');
  expect(()=>parseDartIRList(page([{...row(),rcept_dt:'20261021'}]),source,1,window)).toThrow('company_identity_mismatch');
 });
});

describe('DART collection and immutable provenance',()=>{
 it('archives every exact input and only then returns a complete date-only manifest',async()=>{
  const f=fixture(),result=await f.collect(),m=result.manifest;
  expect(f.listPage).toHaveBeenCalledWith('12345678',1,'20260803','20261101',expect.any(AbortSignal));
  expect(m).toMatchObject({schema:'signalbrief.calendar.dart-ir.v1',company_id:source.company_id,provider:'dart',provider_company_id:'12345678',ticker:'0000A1',complete:true,page_size:100,receipt_window:window});
  expect(m.entries).toHaveLength(1);expect(m.entries[0]).toMatchObject({key:filing.receipt,occurs_on:'2026-11-12',timezone:null,source_url:`https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${filing.receipt}`,body_sha256:digest(encode(body()))});
  expect(m.documents[0]).toMatchObject({receipt_no:filing.receipt,main_sha256:digest(encode(main())),body_sha256:digest(encode(body()))});
  for(const [path,{bytes}] of f.archives)expect(path).toContain(digest(bytes));
  expect(f.archives.get(m.pages[0].object_key)?.bytes).toEqual(page());
  expect(f.archives.get(m.documents[0].main_object_key)?.bytes).toEqual(encode(main()));
  expect(f.archives.get(m.documents[0].body_object_key)?.bytes).toEqual(encode(body()));
  expect(f.archive.mock.calls.at(-1)?.[0]).toBe(result.object_key);
  expect(digest(encode(result.manifest_text))).toBe(result.raw_sha);
  expect(m.pages[0].url).not.toContain('crtfc_key');
 });
 it('collects all reported pages before deciding that no IR notice exists',async()=>{
  const f=fixture(),rows=Array.from({length:101},(_,i)=>({...row(`20261020${String(i+1).padStart(6,'0')}`),report_nm:'Synthetic other disclosure'}));
  f.listPage.mockImplementation(async(_corp?:string,index?:number)=>page(index===1?rows.slice(0,100):rows.slice(100),index??1,101));
  const result=await f.collect();
  expect(f.listPage).toHaveBeenCalledTimes(2);expect(result.manifest.pages.map(p=>p.count)).toEqual([100,1]);
  expect(result.manifest.entries).toEqual([]);expect(f.fetcher).not.toHaveBeenCalled();
 });
 it('records a legitimate empty receipt window without fabricating an event or a withdrawal instruction',async()=>{
  const f=fixture({list:encode(JSON.stringify({status:'013',message:'No records'}))}),m=(await f.collect()).manifest;
  expect(m.pages[0]).toMatchObject({count:0,total_count:0,total_page:0});expect(m.documents).toEqual([]);expect(m.entries).toEqual([]);
  expect(m).not.toHaveProperty('withdraw');expect(f.fetcher).not.toHaveBeenCalled();
 });
 it('retains raw out-of-occurrence-window evidence without inventing an in-window date',async()=>{
  const f=fixture({body:body('2028-12-01')}),m=(await f.collect()).manifest;
  expect(m.documents).toHaveLength(1);expect(m.entries).toEqual([]);
 });
 it.each([{report_nm:'[기재정정]기업설명회(IR)개최(안내공시)'},{rm:'정'},{rm:'철'}])('fails correction/withdrawal ambiguity closed before document fetch %j',change=>{
  const f=fixture({list:page([{...row(),...change}])});
  return expect(f.collect()).rejects.toThrow('ambiguous_correction').then(()=>{expect(f.fetcher).not.toHaveBeenCalled();expect([...f.archives.keys()].every(path=>path.includes('/lists/'))).toBe(true);});
 });
 it('rejects a duplicate identity across full pages without returning a partial manifest',async()=>{
  const f=fixture(),rows=Array.from({length:100},(_,i)=>({...row(`20261020${String(i+1).padStart(6,'0')}`),report_nm:'Synthetic other disclosure'}));
  f.listPage.mockImplementation(async(_corp?:string,index?:number)=>page(index===1?rows:[rows[0]],index??1,101));
  await expect(f.collect()).rejects.toThrow('duplicate_filing_identity');expect(f.fetcher).not.toHaveBeenCalled();
 });
 it('rejects page-count changes and a missing later page without an ingestible manifest',async()=>{
  const f=fixture(),rows=Array.from({length:100},(_,i)=>({...row(`20261020${String(i+1).padStart(6,'0')}`),report_nm:'Synthetic other disclosure'}));
  f.listPage.mockImplementation(async(_corp?:string,index?:number)=>index===1?page(rows,1,101):page([row('20261020000101'),row('20261020000102')],2,102));
  await expect(f.collect()).rejects.toThrow('pagination_changed_retry_later');
  f.listPage.mockImplementation(async(_corp?:string,index?:number)=>{if(index===2)throw new Error('private transport details');return page(rows,1,101);});
  await expect(f.collect()).rejects.toThrow('dart_list_unavailable');
 });
 it('bounds candidate work instead of silently dropping extra notices',async()=>{
  const f=fixture({list:page(Array.from({length:21},(_,i)=>row(`20261020${String(i+1).padStart(6,'0')}`)))});
  await expect(f.collect()).rejects.toThrow('too_many_ir_notices');expect(f.fetcher).not.toHaveBeenCalled();
 });
 it('does not produce a manifest when original archive persistence fails',async()=>{
  const f=fixture();f.archive.mockRejectedValueOnce(new Error('storage unavailable'));
  await expect(f.collect()).rejects.toThrow('storage unavailable');expect(f.fetcher).not.toHaveBeenCalled();
  const g=fixture();g.archive.mockImplementation(async(path:string)=>{if(path.endsWith(digest(encode(body()))+'.html'))throw new Error('body archive unavailable');});
  await expect(g.collect()).rejects.toThrow('body archive unavailable');
  expect(g.archive.mock.calls.some(([path])=>/^calendar\/[^/]+\/[a-f0-9]{64}\.json$/.test(path))).toBe(false);
 });
 it.each([{provider:'sec'},{provider_company_id:'1234567x'},{ticker:'aaaa11'},{url:'https://attacker.invalid/'},{key:'../private'}])('rejects an untrusted source before any fetch %j',change=>{
  const f=fixture();
  return expect(collectDartIR({...source,...change} as DartIRSource,today,f.archive,f.listPage,f.fetcher)).rejects.toThrow('invalid_source_identity').then(()=>expect(f.listPage).not.toHaveBeenCalled());
 });
 it('rejects redirects, wrong MIME, oversized HTML, and a failed body response',async()=>{
  const f=fixture(),redirect=htmlResponse(main());Object.defineProperty(redirect,'redirected',{value:true});
  await expect(collectDartIR(source,today,f.archive,f.listPage,vi.fn(async()=>redirect))).rejects.toThrow('invalid_source_url');
  await expect(collectDartIR(source,today,f.archive,f.listPage,vi.fn(async()=>Response.json({data:'not HTML'})))).rejects.toThrow('invalid_content_type');
  await expect(collectDartIR(source,today,f.archive,f.listPage,vi.fn(async()=>htmlResponse('x'.repeat(250001))))).rejects.toThrow('source_too_large');
  const fetcher=vi.fn().mockResolvedValueOnce(htmlResponse(main())).mockResolvedValueOnce(new Response('failed',{status:503}));
  await expect(collectDartIR(source,today,f.archive,f.listPage,fetcher)).rejects.toThrow('source_http_503');
 });
 it('enforces the total deadline even when an injected transport never resolves',async()=>{
  const controller=new AbortController();vi.spyOn(AbortSignal,'timeout').mockReturnValue(controller.signal);
  const f=fixture();f.listPage.mockImplementation(()=>new Promise<Uint8Array>(()=>{}));
  const pending=f.collect();controller.abort();
  await expect(pending).rejects.toThrow('source_timeout');expect(f.archive).not.toHaveBeenCalled();
 });
});
