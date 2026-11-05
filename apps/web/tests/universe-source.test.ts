// @vitest-environment node
import {describe,it,expect} from 'vitest';
import {parseKindRows,verifyUniversePayload,sha256} from '../../../supabase/functions/signalbrief-universe/core';
import {NASDAQ_HEADER,parseNasdaqRows} from '../../../supabase/functions/signalbrief-universe/us-listings';
import iconv from 'iconv-lite';

const headers=['회사명','시장구분','종목코드','업종','주요제품','상장일','결산월','대표자명','홈페이지','지역'];
const cells=['Synthetic company','유가','000081','Industry','Product  with spaces','2026-11-03','12월','A\nB','https://synthetic.invalid','서울'];
const ascii=(value:string)=>Array.from(value).map(char=>char.codePointAt(0)!>127?`&#${char.codePointAt(0)};`:char).join('');
const kindHtml=(rows:string[][]=[cells])=>new TextEncoder().encode(`<html><head><meta charset=euc-kr></head><body><table><tr>${headers.map(s=>`<th>${ascii(s)}</th>`).join('')}</tr>${rows.map(row=>`<tr>${row.map(s=>`<td>${ascii(s)}</td>`).join('')}</tr>`).join('')}</table></body></html>`);
const item=()=>({market:'KOSPI',ticker:'000081',name:'Synthetic company',instrument_type:'listed_issuer',eligible:true,exclusion_reason:null,aliases:['000081'],provider:'dart',provider_company_id:'00000081',mapping_status:'mapped',mapping_ticker:'000081',mapping_source_sha256:'a'.repeat(64),source_row:1,evidence:{source_cells:cells,header_labels:headers}});
async function payload(raw:Uint8Array,items:unknown[]=[item()],extra:Record<string,unknown>={}){
 const m={version:'listed-universe-v1',source_key:'kind_kospi',source_url:'https://kind.krx.co.kr/corpgeneral/corpList.do',source_request:{method:'POST',fields:{method:'download',searchType:'13',pageIndex:'1',currentPageSize:'3000',orderMode:'3',orderStat:'D',fiscalYearEnd:'all',location:'all',marketType:'stockMkt'}},coverage_scope:'issuer_primary_listing',as_of:'2026-11-04',fetched_at:'2026-11-04T13:00:00Z',raw_sha256:await sha256(raw),raw_bytes:raw.length,parser_version:'kind-corplist-download-v1',complete:true,items,...extra};
 const manifest_text=JSON.stringify(m),manifest_sha256=await sha256(new TextEncoder().encode(manifest_text));
 return {snapshot_id:'00000000-0000-4000-8000-000000000081',manifest_text,manifest_sha256,raw_object_key:`universe/raw/${m.source_key}/${m.raw_sha256}.bin`,manifest_object_key:`universe/manifests/${manifest_sha256}.json`,chunks:[{part:0,data_base64:Buffer.from(raw).toString('base64')}]};
}
describe('original-bound universe validation',()=>{
 it('independently parses the Korean table, preserving the representative-listing scope and whitespace-only normalization',async()=>{
  const original=kindHtml(),p=await payload(original),verified=await verifyUniversePayload(p);
  expect(verified.raw).toEqual(original);expect(parseKindRows(original,'KOSPI')[0].source_cells[4]).toBe('Product with spaces');
 });
 it.each(['ticker','name','source_row','instrument_type','eligible','aliases'])('rejects a manifest whose %s differs from its actual source row',async field=>{
  const changed:Record<string,unknown>=item();changed[field]=field==='source_row'?2:field==='eligible'?false:field==='aliases'?['000082']:'changed';
  await expect(verifyUniversePayload(await payload(kindHtml(),[changed]))).rejects.toThrow('universe_row_evidence_mismatch');
 });
 it('rejects fabricated non-identity cells and dropped rows',async()=>{
  const changed=item();changed.evidence={...changed.evidence,source_cells:cells.map((v,i)=>i===4?'Invented product':v)};
  await expect(verifyUniversePayload(await payload(kindHtml(),[changed]))).rejects.toThrow('universe_row_evidence_mismatch');
  await expect(verifyUniversePayload(await payload(kindHtml(),[]))).rejects.toThrow('universe_source_incomplete');
 });
 it.each([{pageIndex:'2'},{currentPageSize:'1000'},{location:'서울'},{industry:'1'}])('rejects a filtered or partial export contract: %j',async change=>{
  const p=await payload(kindHtml()),m=JSON.parse(p.manifest_text);Object.assign(m.source_request.fields,change);
  await expect(verifyUniversePayload(await payload(kindHtml(),[item()],{source_request:m.source_request}))).rejects.toThrow('universe_source_authority');
 });
 it('rejects wrong market, duplicate identities, truncated documents and scripts',()=>{
  expect(()=>parseKindRows(kindHtml(),'KOSDAQ')).toThrow('universe_source_row');
  expect(()=>parseKindRows(kindHtml([cells,cells]),'KOSPI')).toThrow('universe_source_row');
  expect(()=>parseKindRows(kindHtml().slice(0,-7),'KOSPI')).toThrow('universe_source_format');
  const script=new TextDecoder().decode(kindHtml()).replace('</body>','<script>alert(1)</script></body>');
  expect(()=>parseKindRows(new TextEncoder().encode(script),'KOSPI')).toThrow('universe_source_format');
 });
 it('decodes the official EUC-KR registered sign losslessly and rejects undecodable source bytes',()=>{
  const text=new TextDecoder().decode(kindHtml()).replace('Product  with spaces','Product ®');
  const encoded=iconv.encode(text,'euc-kr');expect(encoded.includes(Buffer.from([0xa2,0xe7]))).toBe(true);
  expect(parseKindRows(encoded,'KOSPI')[0].source_cells[4]).toBe('Product ®');
  expect(()=>parseKindRows(new Uint8Array([0xff]),'KOSPI')).toThrow('universe_source_encoding');
 });
 it('rejects changed originals, manifest hashes and object paths before archival',async()=>{
  const p=await payload(kindHtml());p.chunks[0].data_base64=Buffer.from(new Uint8Array(kindHtml().length)).toString('base64');
  await expect(verifyUniversePayload(p)).rejects.toThrow('universe_original_hash');
  const q=await payload(kindHtml());q.manifest_text+=' ';await expect(verifyUniversePayload(q)).rejects.toThrow('universe_manifest_hash');
  const r=await payload(kindHtml());r.raw_object_key='universe/raw/other.bin';await expect(verifyUniversePayload(r)).rejects.toThrow('universe_archive_path');
 });
 it('rejects missing or out-of-order raw parts',async()=>{
  const p=await payload(kindHtml());p.chunks=[];await expect(verifyUniversePayload(p)).rejects.toThrow('universe_original_incomplete');
  const q=await payload(kindHtml());q.chunks[0].part=1;await expect(verifyUniversePayload(q)).rejects.toThrow('universe_original_incomplete');
 });
 it('binds all Nasdaq rows and its footer date, retaining non-traded listed securities',async()=>{
  const text=`${NASDAQ_HEADER}\nN|SYN.A|Synthetic Corporation Class A Common Stock|N| |N|100|N||SYN.A|SYN.A|N\nFile Creation Time: 1104202608:47|||||\n`,raw=new TextEncoder().encode(text),rows=parseNasdaqRows(text);
  const items=rows.map(row=>({...row,provider:'sec',provider_company_id:'0000000081',mapping_status:'mapped',mapping_ticker:'SYN-A',mapping_source_sha256:'a'.repeat(64),evidence:{fields:row.fields}}));
  const extra={source_key:'nasdaq_traded',source_url:'https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqtraded.txt',source_request:{method:'GET',fields:{}},coverage_scope:'all_listed_securities',parser_version:'nasdaq-listed-equities-v1'};
  await expect(verifyUniversePayload(await payload(raw,items,extra))).resolves.toMatchObject({raw});
  await expect(verifyUniversePayload(await payload(raw,items,{...extra,source_request:{method:'GET',fields:{market:'NASDAQ'}}}))).rejects.toThrow('universe_source_authority');
  await expect(verifyUniversePayload(await payload(raw,items,{...extra,as_of:'2026-11-03'}))).rejects.toThrow('universe_source_date');
  items[0].mapping_ticker='OTHER';await expect(verifyUniversePayload(await payload(raw,items,extra))).rejects.toThrow('universe_issuer_mapping_mismatch');
 });
});
