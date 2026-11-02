// @vitest-environment node
import {describe,it,expect,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {parseDartProfileArchive,parseArchivedDartProfile,profileArchiveURL} from '../src/server/dart-profile-archive';
import {dartProfileFilings,validateDartProfileResult} from '../../../supabase/functions/signalbrief-profiles/enrichment-dart-core';
import {directoryZip,projectUrl,zipSha} from './dart-directory-fixture';
import {businessQuote,dartProfileCompany,dartProfileReceipt,periodicList,profileArchive,profileXML} from './dart-profile-fixture';

describe('DART periodic sources remain issuer-bound and complete',()=>{
 it('selects report period before a newer correction to an older period',()=>{
  const older={corp_code:'12345678',stock_code:'123456',rcept_no:'20261030000001',rcept_dt:'20261030',report_nm:'[기재정정]사업보고서 (2025.12)'};
  const first=JSON.parse(periodicList()).list[0],raw=periodicList({total_count:2,list:[older,first]});
  expect(dartProfileFilings(raw,dartProfileCompany,'2026-11-02').map(v=>v.receipt)).toEqual([dartProfileReceipt,older.rcept_no]);
 });
 it('treats explicit013 as absent, while quota and incomplete pagination are failures',()=>{
  expect(dartProfileFilings('{"status":"013"}',dartProfileCompany,'2026-11-02')).toEqual([]);
  expect(()=>dartProfileFilings('{"status":"020"}',dartProfileCompany,'2026-11-02')).toThrow('profile_source_rate_limited');
  expect(()=>dartProfileFilings(periodicList({total_page:2,total_count:101}),dartProfileCompany,'2026-11-02')).toThrow('dart_periodic_list_incomplete');
 });
 it.each([{corp_code:'87654321'},{stock_code:'OTHER1'},{rcept_no:'not-a-receipt'},{rcept_dt:'20260230'},{rcept_dt:'20261103'},{report_nm:'주요사항보고서'},{report_nm:'반기보고서 (2026.19)'}])('rejects unverified periodic metadata %j',patch=>{
  const value=JSON.parse(periodicList());Object.assign(value.list[0],patch);
  expect(()=>dartProfileFilings(JSON.stringify(value),dartProfileCompany,'2026-11-02')).toThrow();
 });
});

describe('bounded Node DART ZIP and profile extraction',()=>{
 it('keeps the original ZIP hash, exact normalized text/offsets and table-named products',()=>{
  const {bytes,payload}=profileArchive(),parsed=parseDartProfileArchive(bytes,payload);
  expect(parsed.normalization).toBe('dart-periodic-xml-text-v1');expect(parsed.source_sha256).toBe(zipSha(bytes));
  expect(parsed.normalized_sha256).toBe(createHash('sha256').update(parsed.normalized_text).digest('hex'));
  expect(parsed.business.map(v=>v.text)).toEqual([businessQuote]);expect(parsed.products.map(v=>v.name)).toEqual(['합성 장비 A','연구 기록 서비스']);
  expect(parsed.segments.map(v=>v.name)).toEqual(['연구장비','데이터 서비스']);
  expect(validateDartProfileResult(JSON.stringify(parsed),payload.sha)).toEqual(parsed);
  for(const item of [...parsed.business,...parsed.products,...parsed.segments])expect(Array.from(parsed.normalized_text).slice(item.evidence.location.start,item.evidence.location.end).join('')).toBe(item.evidence.quote);
 });
 it('explicitly marks recovered display text and never treats attribute prose as evidence',()=>{
  const {bytes,payload}=profileArchive(profileXML().replace('<P>'+businessQuote,'<P ENG="broken "translated claim"">'+businessQuote));
  const result=parseDartProfileArchive(bytes,payload);expect(result.normalization).toBe('dart-periodic-recovered-text-v1');expect(result.business[0].text).toBe(businessQuote);expect(result.normalized_text).not.toContain('translated claim');
 });
 it.each([
  ['wrong company',(s:string)=>s.replace('AREGCIK="12345678"','AREGCIK="87654321"')],
  ['wrong name',(s:string)=>s.replace('합성연구 주식회사','다른기업 주식회사')],
  ['wrong form',(s:string)=>s.replace('<DOCUMENT-NAME>반기보고서','<DOCUMENT-NAME>사업보고서')],
  ['duplicate identity',(s:string)=>s.replace('<BODY>','<COMPANY-NAME>다른기업</COMPANY-NAME><BODY>')],
  ['external entities',(s:string)=>s.replace('<DOCUMENT>','<!DOCTYPE DOCUMENT [<!ENTITY read SYSTEM "file:///etc/passwd">]><DOCUMENT>')],
  ['incomplete document',(s:string)=>s.replace('</DOCUMENT>','')],
 ] as const)('fails closed for %s',(_label,change)=>{const f=profileArchive(change(profileXML()));expect(()=>parseDartProfileArchive(f.bytes,f.payload)).toThrow();});
 it('requires the exact receipt member and checks every archive byte before any excerpt',()=>{
  const {bytes,payload}=profileArchive();expect(()=>parseDartProfileArchive(bytes,{...payload,sha:'b'.repeat(64)})).toThrow('dart_profile_hash_mismatch');
  const wrong=directoryZip(profileXML(),{name:'20260814000999.xml'});expect(()=>parseDartProfileArchive(wrong,{...payload,sha:zipSha(wrong)})).toThrow('dart_profile_receipt_member_missing');
  const corrupt=Buffer.from(bytes);corrupt[60]^=1;expect(()=>parseDartProfileArchive(corrupt,{...payload,sha:zipSha(corrupt)})).toThrow();
 });
 it('keeps absent business/table coverage empty instead of inventing fields',()=>{
  const f=profileArchive(profileXML().replace('II. 사업의 내용','다른 목차'));const result=parseDartProfileArchive(f.bytes,f.payload);
  expect(result.business).toEqual([]);expect(result.products).toEqual([]);expect(result.segments).toEqual([]);
 });
 it('does not accept forged Node offsets or altered normalized evidence',()=>{
  const f=profileArchive(),result=parseDartProfileArchive(f.bytes,f.payload);result.business[0].evidence.location.start++;
  expect(()=>validateDartProfileResult(JSON.stringify(result),f.payload.sha)).toThrow('dart_profile_evidence_invalid');
 });
 it('processes a large synthetic periodic archive on Node with the same exact evidence',()=>{
  const f=profileArchive(profileXML(Array.from({length:9000},(_,index)=>`<P>합성 재무 부록 ${index} — 이 문장은 대형 원문 처리 범위를 검증하기 위한 합성 자료이며 회사소개 또는 제품으로 추출되지 않습니다.</P>`).join('')));
  const start=performance.now(),cpu=process.cpuUsage(),parsed=parseDartProfileArchive(f.bytes,f.payload),usage=process.cpuUsage(cpu);
  expect(parsed.normalized_text.length).toBeGreaterThan(500_000);expect(parsed.business[0].text).toBe(businessQuote);expect(parsed.products).toHaveLength(2);
  console.info('SYNTHETIC_DART_PROFILE_NODE',{compressed_bytes:f.bytes.length,normalized_characters:parsed.normalized_text.length,wall_ms:Number((performance.now()-start).toFixed(2)),cpu_ms:(usage.user+usage.system)/1000});
 });
});

describe('private archived DART profile read capability',()=>{
 it('fetches only the exact signed raw object, without inherited credentials or redirects',async()=>{
  const f=profileArchive(),fetcher=vi.fn().mockResolvedValue(new Response(f.bytes));
  expect((await parseArchivedDartProfile(f.payload,projectUrl,fetcher)).business[0].text).toBe(businessQuote);
  expect(fetcher).toHaveBeenCalledWith(new URL(f.payload.source_url),expect.objectContaining({redirect:'error',cache:'no-store',signal:expect.any(AbortSignal)}));
  expect(fetcher.mock.calls[0][1].headers).toBeUndefined();
 });
 it.each(['https://evil.test/archive.zip','https://fixture.supabase.co/storage/v1/object/sign/signalbrief-raw/private/a.zip?token=x','https://fixture.supabase.co.evil.test/a','http://127.0.0.1/private'])('rejects arbitrary signed source URLs %s',url=>{
  const {payload}=profileArchive();expect(()=>profileArchiveURL({...payload,source_url:url},projectUrl)).toThrow('relay_invalid_request');
 });
 it('rejects archive failures and bounded body overflow without publishing empty results',async()=>{
  const f=profileArchive();await expect(parseArchivedDartProfile(f.payload,projectUrl,vi.fn().mockResolvedValue(new Response('',{status:403})))).rejects.toThrow('dart_profile_archive_unavailable');
  await expect(parseArchivedDartProfile(f.payload,projectUrl,vi.fn().mockResolvedValue(new Response('x',{headers:{'content-length':'20000001'}})))).rejects.toThrow('dart_profile_archive_unavailable');
 });
});
