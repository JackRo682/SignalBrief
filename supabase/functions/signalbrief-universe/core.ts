import {parseDocument,DomUtils} from 'npm:htmlparser2@10.0.0';
import iconv from 'npm:iconv-lite@0.6.3';
import {Buffer} from 'node:buffer';
import {parseNasdaqSnapshot} from './us-listings.ts';

type Row=Record<string,unknown>;
export class UniverseError extends Error {}
export type UniversePayload={snapshot_id:string;manifest_text:string;manifest_sha256:string;raw_object_key:string;manifest_object_key:string;chunks:{part:number;data_base64:string}[]};
export const sha256=async(bytes:Uint8Array)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes)))].map(b=>b.toString(16).padStart(2,'0')).join('');
const obj=(value:unknown):value is Row=>!!value&&typeof value==='object'&&!Array.isArray(value);
const normalized=(value:string)=>value.replace(/\s+/gu,' ').trim();
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const fail=(code:string):never=>{throw new UniverseError(code);};
const kindHeaders=['회사명','시장구분','종목코드','업종','주요제품','상장일','결산월','대표자명','홈페이지','지역'];

/** Reparse the immutable export. The HTML is data; no script or remote link runs. */
export function parseKindRows(raw:Uint8Array,market:'KOSPI'|'KOSDAQ'){
 // KIND includes KS X 1001 characters (for example A2E7 = registered sign)
 // absent from some ICU/WHATWG decoder tables. Require a lossless byte roundtrip.
 let html:string;try{html=iconv.decode(Buffer.from(raw),'euc-kr');if(!iconv.encode(html,'euc-kr').equals(Buffer.from(raw)))return fail('universe_source_encoding');}catch{return fail('universe_source_encoding');}
 if(!/<\/html>\s*$/i.test(html)||!/<meta[^>]*charset=euc-kr/i.test(html))return fail('universe_source_format');
 const root=parseDocument(html),tables=DomUtils.getElementsByTagName('table',root.children,true);
 if(tables.length!==1||DomUtils.getElementsByTagName('script',root.children,true).length)return fail('universe_source_format');
 const rows=DomUtils.getElementsByTagName('tr',tables[0].children,true).map(row=>row.children
  .filter(node=>node.type==='tag'&&['th','td'].includes(node.name))
  .map(node=>normalized(DomUtils.textContent(node))));
 if(!same(rows.shift(),kindHeaders)||!rows.length||rows.length>50000)return fail('universe_source_format');
 const seen=new Set<string>(),label=market==='KOSPI'?'유가':'코스닥';
 return rows.map((cells,index)=>{
  if(cells.length!==10||!cells[0]||cells[1]!==label||!/^[A-Z0-9]{6}$/.test(cells[2])||!/^20\d{2}-\d{2}-\d{2}$|^19\d{2}-\d{2}-\d{2}$/.test(cells[5])||seen.has(cells[2]))return fail('universe_source_row');
  seen.add(cells[2]);return {source_row:index+1,market,ticker:cells[2],name:cells[0],source_cells:cells,header_labels:kindHeaders};
 });
}

function verifyRows(m:Row,raw:Uint8Array){
 if(!Array.isArray(m.items)||!m.items.every(obj))return fail('universe_manifest_rows');
 const items=m.items as Row[],request=obj(m.source_request)?m.source_request:{};
 if(m.source_key==='kind_kospi'||m.source_key==='kind_kosdaq'){
  const market=m.source_key==='kind_kospi'?'KOSPI':'KOSDAQ',fields=obj(request.fields)?request.fields:{};
  const expectedFields:Record<string,string>={method:'download',searchType:'13',pageIndex:'1',currentPageSize:'3000',orderMode:'3',orderStat:'D',fiscalYearEnd:'all',location:'all',marketType:market==='KOSPI'?'stockMkt':'kosdaqMkt'};
  if(m.source_url!=='https://kind.krx.co.kr/corpgeneral/corpList.do'||request.method!=='POST'||fields.method!=='download'||fields.searchType!=='13'
   ||Object.keys(fields).length!==Object.keys(expectedFields).length||Object.entries(expectedFields).some(([key,value])=>fields[key]!==value)
   ||m.coverage_scope!=='issuer_primary_listing'||m.parser_version!=='kind-corplist-download-v1')return fail('universe_source_authority');
  const rows=parseKindRows(raw,market);if(rows.length!==items.length||rows.length>=3000)return fail('universe_source_incomplete');
  for(let i=0;i<rows.length;i++){
   const row=rows[i],item=items[i],evidence=obj(item.evidence)?item.evidence:{};
   if(item.source_row!==row.source_row||item.market!==row.market||item.ticker!==row.ticker||item.name!==row.name
    ||item.instrument_type!=='listed_issuer'||item.eligible!==true||item.exclusion_reason!==null||!same(item.aliases,[row.ticker])
    ||!Array.isArray(evidence.source_cells)||!evidence.source_cells.every(value=>typeof value==='string')
    ||!same((evidence.source_cells as string[]).map(normalized),row.source_cells)||!same(evidence.header_labels,row.header_labels))return fail('universe_row_evidence_mismatch');
   if(item.mapping_status==='mapped'&&(item.provider!=='dart'||item.mapping_ticker!==row.ticker))return fail('universe_issuer_mapping_mismatch');
  }
 }else if(m.source_key==='nasdaq_traded'){
  if(m.source_url!=='https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqtraded.txt'||request.method!=='GET'||!obj(request.fields)||Object.keys(request.fields).length!==0||m.coverage_scope!=='all_listed_securities')return fail('universe_source_authority');
  let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(raw);}catch{return fail('universe_source_encoding');}
  const parsed=parseNasdaqSnapshot(text),rows=parsed.rows;
  if(m.as_of!==parsed.as_of||m.parser_version!=='nasdaq-listed-equities-v1')return fail('universe_source_date');
  if(rows.length!==items.length)return fail('universe_source_incomplete');
  for(let i=0;i<rows.length;i++){
   const row=rows[i],item=items[i],evidence=obj(item.evidence)?item.evidence:{};
   if(item.source_row!==row.source_row||item.market!==row.market||item.ticker!==row.ticker||item.name!==row.name
    ||item.instrument_type!==row.instrument_type||item.eligible!==row.eligible||item.exclusion_reason!==row.exclusion_reason
    ||!same(item.aliases,row.aliases)||!same(evidence.fields,row.fields))return fail('universe_row_evidence_mismatch');
   if(item.mapping_status==='mapped'&&(item.provider!=='sec'||typeof item.mapping_ticker!=='string'||!row.aliases.includes(item.mapping_ticker)))return fail('universe_issuer_mapping_mismatch');
  }
 }else return fail('universe_source_authority');
}

/** Validate hashes, chunk order, completeness and every source-bound listing. */
export async function verifyUniversePayload(payload:UniversePayload){
 if(!obj(payload)||typeof payload.manifest_text!=='string'||!/^[a-f0-9]{64}$/.test(payload.manifest_sha256)||!Array.isArray(payload.chunks))return fail('invalid_universe_payload');
 const manifestBytes=new TextEncoder().encode(payload.manifest_text);
 if(manifestBytes.length>20000000||await sha256(manifestBytes)!==payload.manifest_sha256)return fail('universe_manifest_hash');
 let m:unknown;try{m=JSON.parse(payload.manifest_text);}catch{return fail('invalid_universe_manifest');}
 if(!obj(m)||m.version!=='listed-universe-v1'||m.complete!==true||typeof m.raw_sha256!=='string'||!/^[a-f0-9]{64}$/.test(m.raw_sha256)
  ||!Number.isInteger(m.raw_bytes)||Number(m.raw_bytes)<1||Number(m.raw_bytes)>10000000)return fail('invalid_universe_manifest');
 if(payload.raw_object_key!==`universe/raw/${m.source_key}/${m.raw_sha256}.bin`||payload.manifest_object_key!==`universe/manifests/${payload.manifest_sha256}.json`)return fail('universe_archive_path');
 const raw=new Uint8Array(Number(m.raw_bytes)),parts=Math.ceil(raw.length/64000);
 if(payload.chunks.length!==parts)return fail('universe_original_incomplete');
 for(let i=0;i<parts;i++){
  const part=payload.chunks[i];if(!obj(part)||part.part!==i||typeof part.data_base64!=='string'||part.data_base64.length>85336||!/^[A-Za-z0-9+/]*={0,2}$/.test(part.data_base64))return fail('universe_original_incomplete');
  let value:string;try{value=atob(part.data_base64);}catch{return fail('universe_original_incomplete');}
  if(value.length!==Math.min(64000,raw.length-i*64000))return fail('universe_original_incomplete');
  for(let j=0;j<value.length;j++)raw[i*64000+j]=value.charCodeAt(j);
 }
 if(await sha256(raw)!==m.raw_sha256)return fail('universe_original_hash');
 verifyRows(m,raw);
 return {raw,manifestBytes,raw_sha256:m.raw_sha256,manifest_sha256:payload.manifest_sha256,raw_object_key:payload.raw_object_key,manifest_object_key:payload.manifest_object_key};
}
