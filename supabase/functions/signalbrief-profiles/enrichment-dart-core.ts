import {ProfileError,type CompanyIdentity} from './core.ts';
import type {ProfileArchivedSource,ProfileBusinessExcerpt,ProfileBusinessItem} from './enrichment-types.ts';

export type DartPeriodicFiling={receipt:string;title:string;filing_date:string;period:string;form:string;source_url:string};
export type DartProfileBlock={text:string;start:number;end:number;kind:'paragraph'|'heading'|'row';cells:string[]};
export type DartProfileParsed={source_sha256:string;normalized_sha256:string;normalization:'dart-periodic-xml-text-v1'|'dart-periodic-recovered-text-v1';normalized_text:string;member:string;business:ProfileBusinessExcerpt[];products:ProfileBusinessItem[];segments:ProfileBusinessItem[]};
const row=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const date=(v:string)=>/^20\d{2}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
const periodic=/^(?:\[(?:기재정정|첨부정정)\]\s*)?(사업|반기|분기)보고서\s*\((20\d{2})[.]([01]\d)\)$/;

/** Complete issuer-scoped, final-periodic list. A failed/incomplete list is never an empty profile. */
export function dartProfileFilings(raw:string,company:CompanyIdentity,today:string):DartPeriodicFiling[]{
 let data:Record<string,unknown>;try{data=row(JSON.parse(raw));}catch{throw new ProfileError('dart_periodic_list_invalid');}
 if(data.status==='013')return [];
 if(data.status!=='000')throw new ProfileError(data.status==='020'?'profile_source_rate_limited':'dart_periodic_list_unavailable');
 if(Number(data.total_page)!==1||Number(data.page_no)!==1||!Array.isArray(data.list)||data.list.length>100||Number(data.total_count)!==data.list.length)throw new ProfileError('dart_periodic_list_incomplete');
 const seen=new Set<string>(),out:DartPeriodicFiling[]=[];
 for(const value of data.list){
  const item=row(value),receipt=String(item.rcept_no??''),day=String(item.rcept_dt??''),title=String(item.report_nm??'').trim(),match=title.match(periodic);
  if(item.corp_code!==company.provider_company_id||item.stock_code!==undefined&&item.stock_code!==company.ticker||!/^\d{14}$/.test(receipt)||!/^\d{8}$/.test(day)||seen.has(receipt))throw new ProfileError('company_identity_mismatch');
  seen.add(receipt);
  const filed=`${day.slice(0,4)}-${day.slice(4,6)}-${day.slice(6,8)}`;
  if(!date(filed)||filed>today)throw new ProfileError('dart_periodic_list_invalid');
  if(!match)throw new ProfileError('dart_periodic_report_unsupported');
  const period=`${match[2]}-${match[3]}`;
  if(!date(period+'-01')||period>today.slice(0,7))throw new ProfileError('dart_periodic_list_invalid');
  out.push({receipt,title,filing_date:filed,period,form:match[1]+'보고서',source_url:`https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${receipt}`});
 }
 return out.sort((a,b)=>b.period.localeCompare(a.period)||b.filing_date.localeCompare(a.filing_date)||b.receipt.localeCompare(a.receipt));
}

/** Source names are compared after legal-form/whitespace normalization, never fuzzy similarity. */
export const dartLegalName=(v:string)=>v.toLowerCase().replace(/주식회사|\(주\)|㈜/g,'').replace(/[\s().,·ㆍ]/g,'');

export function dartProfileFields(text:string,blocks:DartProfileBlock[],sha:string){
 const evidence=(block:DartProfileBlock,section:string)=>({source_id:sha,quote:block.text,location:{kind:'normalized_text' as const,start:Array.from(text.slice(0,block.start)).length,end:Array.from(text.slice(0,block.end)).length,section}});
 const business:ProfileBusinessExcerpt[]=[],products:ProfileBusinessItem[]=[],segments:ProfileBusinessItem[]=[];
 const start=blocks.findIndex(b=>/^(?:II|Ⅱ|2)[.．]?\s*사업의\s*내용$/.test(b.text));
 if(start<0)return {business,products,segments};
 let end=blocks.findIndex((b,i)=>i>start&&/^(?:III|Ⅲ|3)[.．]?\s*재무에\s*관한\s*사항$/.test(b.text));if(end<0)end=blocks.length;
 const relevant=blocks.slice(start+1,end);
 let overview=false,productSection=false,headers:string[]=[];
 for(const block of relevant){
  if(block.text.length<=160&&/^(?:1[.．]?\s*)?사업의\s*개요$/.test(block.text)){overview=true;productSection=false;headers=[];continue;}
  if(block.text.length<=160&&/^(?:\d+[.．]?\s*)?주요\s*(?:제품|상품)(?:\s*및\s*(?:서비스|제품))?(?:\s*등)?(?:의\s*현황)?$/.test(block.text)){overview=false;productSection=true;headers=[];continue;}
  if(block.kind==='heading'&&/^\d+[.．]\s/.test(block.text)){overview=false;productSection=false;headers=[];}
  if(overview&&block.kind==='paragraph'&&block.text.length>=65&&block.text.length<=1600&&business.length<2&&!/^(?:해당사항|참조|주\s*\d)/.test(block.text))business.push({text:block.text,evidence:evidence(block,'사업의 내용 · 사업의 개요')});
  if(block.kind!=='row'||!productSection||block.cells.length<2)continue;
  if(block.cells.some(cell=>/^(?:주요\s*)?(?:제품|상품|서비스|품목)(?:\s*(?:명|및\s*서비스|등))?$/.test(cell))){headers=block.cells;continue;}
  if(!headers.length||block.cells.length!==headers.length||block.text.length>1600)continue;
  const add=(target:ProfileBusinessItem[],index:number,section:string)=>{
   const name=block.cells[index]?.trim();if(!name||name.length>120||/^[\d,.%()\- ]+$/.test(name)||/^(?:합계|소계|계|주\d|기타)$/.test(name)||target.some(item=>item.name===name))return;
   if(target.length<(section==='사업부문'?12:10))target.push({name,description:null,evidence:evidence(block,'사업의 내용 · '+section)});
  };
  const pi=headers.findIndex(cell=>/^(?:주요\s*)?(?:제품|상품|서비스|품목)(?:\s*(?:명|및\s*서비스|등))?$/.test(cell));
  const si=headers.findIndex(cell=>/^(?:사업\s*부문|부문)$/.test(cell));
  if(pi>=0)add(products,pi,'주요 제품 및 서비스');if(si>=0)add(segments,si,'사업부문');
 }
 return {business,products,segments};
}

/** The Edge validates the hash-bound Node result again before publishing its exact excerpts. */
export function validateDartProfileResult(raw:string,expectedSha:string):DartProfileParsed{
 let value:Record<string,unknown>;try{value=row(JSON.parse(raw));}catch{throw new ProfileError('dart_profile_parse_invalid');}
 if(value.source_sha256!==expectedSha||!/^([a-f0-9]{64})$/.test(String(value.normalized_sha256??''))||!['dart-periodic-xml-text-v1','dart-periodic-recovered-text-v1'].includes(String(value.normalization))||typeof value.normalized_text!=='string'||!value.normalized_text.trim()||value.normalized_text.length>2_000_000||typeof value.member!=='string'||!/^[A-Za-z0-9_.-]+\.xml$/i.test(value.member))throw new ProfileError('dart_profile_parse_invalid');
 const points=Array.from(value.normalized_text);
 for(const field of ['business','products','segments'] as const){
  if(!Array.isArray(value[field])||value[field].length>(field==='business'?2:field==='products'?10:12))throw new ProfileError('dart_profile_parse_invalid');
  for(const entry of value[field]){
   const item=row(entry),proof=row(item.evidence),at=row(proof.location),start=Number(at.start),end=Number(at.end);
   if(proof.source_id!==expectedSha||typeof proof.quote!=='string'||!proof.quote||proof.quote.length>1600||at.kind!=='normalized_text'||typeof at.section!=='string'||at.section.length>200||!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<=start||points.slice(start,end).join('')!==proof.quote||field==='business'&&item.text!==proof.quote||field!=='business'&&(typeof item.name!=='string'||item.name.length>120||!item.name||!proof.quote.includes(item.name)||item.description!==null))throw new ProfileError('dart_profile_evidence_invalid');
  }
 }
 return value as DartProfileParsed;
}

export function dartPublicSource(source:ProfileArchivedSource){
 const {object_key:_,provider_company_id:__,ticker:___,normalized_text:____,normalized_object_key:_____,filing_id:______,...result}=source;
 void _;void __;void ___;void ____;void _____;void ______;return result;
}
