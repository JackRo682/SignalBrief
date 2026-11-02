import {createHash} from 'node:crypto';
import {describe,expect,it} from 'vitest';
import {dartProfileFields,validateDartProfileResult,type DartProfileBlock} from '../../../supabase/functions/signalbrief-profiles/enrichment-dart-core';

const sha='b'.repeat(64);
function table(header:string[],rows:string[][]){
 const values:{kind:DartProfileBlock['kind'];text:string;cells:string[]}[]=[
  {kind:'paragraph',text:'원문 앞부분 📄',cells:[]},
  {kind:'heading',text:'II. 사업의 내용',cells:[]},
  {kind:'heading',text:'2. 주요 제품 및 서비스',cells:[]},
  ...[header,...rows].map(cells=>({kind:'row' as const,text:cells.join(' '),cells})),
  {kind:'heading',text:'III. 재무에 관한 사항',cells:[]},
 ];
 let offset=0;
 const blocks=values.map(value=>{const block={...value,start:offset,end:offset+value.text.length};offset=block.end+1;return block;});
 const text=values.map(value=>value.text).join('\n');
 return {text,blocks,fields:dartProfileFields(text,blocks,sha)};
}

describe('DART product-table accounting rows',()=>{
 it('excludes the observed fifth internal-elimination row while retaining all four real product rows',()=>{
  const products=[
   ['DX 부문','TV, 모니터, 냉장고, 세탁기, 에어컨,스마트폰, 네트워크시스템, PC 등','1,006,771','33.0%'],
   ['DS 부문','DRAM, NAND Flash, 모바일AP 등','2,092,317','68.5%'],
   ['SDC','스마트폰용 OLED패널 등','141,785','4.6%'],
   ['Harman','디지털 콕핏, 카오디오, 포터블 스피커 등','83,941','2.7%'],
  ];
  const result=table(['부 문','주요 제품','매출액','비중'],[...products,['기타','부문간 내부거래 제거 등','△271,085','△8.9%']]);
  expect(result.fields.products.map(item=>item.name)).toEqual(products.map(row=>row[1]));
  expect(result.fields.products).toHaveLength(4);
  expect(result.fields.segments.map(item=>item.name)).toEqual(products.map(row=>row[0]));
  expect(result.fields.products.map(item=>item.evidence.quote)).toEqual(products.map(row=>row.join(' ')));
 });

 it.each(['내부거래 제거','부문 간 내부거래 제거 등','연결조정','합 계','소계','총계'])
 ('omits the whole accounting row identified as %s, rather than publishing its other cell as a product',label=>{
  const result=table(['사업부문','주요 제품','매출액'],[['장비사업','연구 장비','100'],[label,'제거 대상 장비','-10']]);
  expect(result.fields.products.map(item=>item.name)).toEqual(['연구 장비']);
  expect(result.fields.segments.map(item=>item.name)).toEqual(['장비사업']);
 });

 it('retains 기타제품 and genuine product names that merely contain accounting-related words',()=>{
  const names=['기타제품','내부거래 관리 소프트웨어','연결형 센서','총계 측정기'];
  const result=table(['사업부문','주요 제품','매출액'],names.map((name,index)=>['사업부문 '+index,name,'100']));
  expect(result.fields.products.map(item=>item.name)).toEqual(names);
  expect(result.fields.segments.map(item=>item.name)).toEqual(names.map((_,index)=>'사업부문 '+index));
 });

 it.each(['구분','제품 유형','지역'])('does not infer business divisions from an unrelated %s header',header=>{
  const result=table([header,'주요 제품','매출액'],[['DX 부문','장비 A','100'],['기타','기타제품','10']]);
  expect(result.fields.products.map(item=>item.name)).toEqual(['장비 A','기타제품']);
  expect(result.fields.segments).toEqual([]);
 });

 it('retains explicit division names and original quote offsets without inventing categories',()=>{
  const result=table(['사업부문','주요 제품','매출액'],[
   ['연구장비','합성 장비 A','100'],['데이터 서비스','연구 기록 서비스','50'],
   ['기타','부문간 내부거래 제거 등','-10'],
  ]);
  expect(result.fields.segments.map(item=>item.name)).toEqual(['연구장비','데이터 서비스']);
  const parsed={source_sha256:sha,normalized_sha256:createHash('sha256').update(result.text).digest('hex'),
   normalization:'dart-periodic-xml-text-v1',normalized_text:result.text,member:'20260814000001.xml',...result.fields};
  expect(validateDartProfileResult(JSON.stringify(parsed),sha)).toEqual(parsed);
  for(const item of [...result.fields.products,...result.fields.segments]){
   const location=item.evidence.location;
   expect(location.kind).toBe('normalized_text');
   if(location.kind!=='normalized_text')throw new Error('Unexpected location');
   expect(Array.from(result.text).slice(location.start,location.end).join('')).toBe(item.evidence.quote);
   expect(item.evidence.source_id).toBe(sha);
  }
  parsed.products[0].evidence.location.start++;
  expect(()=>validateDartProfileResult(JSON.stringify(parsed),sha)).toThrow('dart_profile_evidence_invalid');
 });
});
