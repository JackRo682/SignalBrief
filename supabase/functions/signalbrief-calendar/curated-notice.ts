import {CalendarError,dateOnly,normalize,sha256,type Source} from './core.ts';

/** A reviewed, finite notice is not an automatically refreshed event feed. */
export const NOTICE_SCHEMA='signalbrief.calendar.curated-notice.v1';
export const NOTICE_VERSION='curated-notice-v1';
export const RAW_LIMIT=4_000_000;
export const TEXT_LIMIT=2_000_000;
export const CHUNK_SIZE=64_000;
export const EVENT_TYPES=['annual_meeting','conference','exhibition','dividend_record','dividend_payment','dividend_ex','bond_payment','equity_payment','new_share_listing'] as const;
export type EventType=typeof EVENT_TYPES[number];
export type NoticeEntry={key:string;title:string;event_type:EventType;occurs_on:string;quote:string;date_token:string;quote_start:number;quote_end:number;location:string;timezone:null;ends_on?:string;end_date_token?:string;year_context_quote?:string;year_context_token?:string;year_context_start?:number;year_context_end?:number};
export type NoticeManifest={schema:typeof NOTICE_SCHEMA;adapter:'curated-notice';complete:false;source_key:string;source_url:string;document_url:string;company_id:string;provider:'sec'|'dart';provider_company_id:string;ticker:string;format:'html'|'pdf'|'json';encoding:'utf-8'|'euc-kr';raw_sha256:string;raw_bytes:number;raw_object_key:string;normalized_sha256:string;normalized_object_key:string;normalization:string;extraction:string;fetched_at:string;published_on:string|null;publication_precision:'date'|'unknown';publication_timezone:string|null;issuer_quote:string;issuer_start:number;issuer_end:number;entries:NoticeEntry[]};
export type NoticePayload={completed:false;manifest_text:string;normalized_text:string;raw_base64:string}|{completed:true;count:number};

const fail=(code:string):never=>{throw new CalendarError(code);};
const hashPattern=/^[a-f0-9]{64}$/;
export const textNormalize=(text:string)=>text.replace(/\s+/gu,' ').trim();
export async function noticeSourceKey(provider:string,providerID:string,url:string){
 return `notice-${provider}-${providerID}-${(await sha256(new TextEncoder().encode(url))).slice(0,24)}`;
}
export function normalizeNotice(bytes:Uint8Array,format:NoticeManifest['format'],encoding:NoticeManifest['encoding'],documentURL:string,pdfText?:string):string{
 if(bytes.length<1||bytes.length>RAW_LIMIT)fail('notice_original_size');
 if(format==='pdf'){
  if(new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-'||typeof pdfText!=='string')fail('notice_pdf_extraction_missing');
  return textNormalize(pdfText!);
 }
 const decoded=new TextDecoder(encoding,{fatal:true}).decode(bytes);
 if(format==='html')return normalize(decoded);
 if(format!=='json'||encoding!=='utf-8')fail('notice_format_unsupported');
 // This is one explicit official board response contract, not arbitrary JSON scraping.
 const match=documentURL.match(/^https:\/\/www\.ls-electric\.com\/ko\/api\/board\.ashx\?t=news_view&b_id=([1-9][0-9]{0,11})$/);
 const response=JSON.parse(decoded),entity=response?.data?.entity;
 if(!match||response?.success!==true||entity?.b_id!==Number(match[1])||entity?.b_display!==true||entity?.b_lang!=='ko'||entity?.b_type!=='news'||typeof entity?.b_title!=='string'||typeof entity?.b_content!=='string'||typeof entity?.b_regdate!=='string')fail('notice_board_identity');
 return normalize(`${entity.b_title} ${entity.b_regdate} ${entity.b_content}`);
}
/** Unicode code-point offsets match PostgreSQL substring, including supplementary characters. */
export function locateQuote(text:string,quote:string):{start:number;end:number}{
 if(!quote||quote!==textNormalize(quote))fail('notice_quote_not_normalized');
 const at=text.indexOf(quote);
 if(at<0)fail('notice_quote_missing');
 const start=Array.from(text.slice(0,at)).length;
 return {start,end:start+Array.from(quote).length};
}
export function parseNoticeDate(token:string,year?:number,month?:number):string{
 let match:string[]|null,parts:number[]|undefined;
 if((match=token.match(/^(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})$/)))parts=match.slice(1).map(Number);
 else if((match=token.match(/^(20\d{2})년\s*(\d{1,2})월\s*(\d{1,2})일$/)))parts=match.slice(1).map(Number);
 else if((match=token.match(/^(January|February|March|April|May|June|July|August|September|October|November|December|Jan\.?|Feb\.?|Mar\.?|Apr\.?|Jun\.?|Jul\.?|Aug\.?|Sep\.?|Sept\.?|Oct\.?|Nov\.?|Dec\.?) (\d{1,2}), (20\d{2})$/i))){
  const names=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];parts=[Number(match[3]),names.indexOf(match[1].toLowerCase().slice(0,3))+1,Number(match[2])];
 }else if((match=token.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/)))parts=[2000+Number(match[3]),Number(match[1]),Number(match[2])];
 else if(year&&((match=token.match(/^(\d{1,2})[/.](\d{1,2})$/))||(match=token.match(/^(\d{1,2})월\s*(\d{1,2})일?$/))))parts=[year,Number(match[1]),Number(match[2])];
 else if(year&&(match=token.match(/^(January|February|March|April|May|June|July|August|September|October|November|December|Jan\.?|Feb\.?|Mar\.?|Apr\.?|Jun\.?|Jul\.?|Aug\.?|Sep\.?|Sept\.?|Oct\.?|Nov\.?|Dec\.?) (\d{1,2})$/i)))parts=[year,['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(match[1].toLowerCase().slice(0,3))+1,Number(match[2])];
 else if(year&&month&&(match=token.match(/^(\d{1,2})일?$/)))parts=[year,month,Number(match[1])];
 if(!parts||parts[0]<2000||parts[0]>2099)fail('notice_date_ambiguous');
 return dateOnly(`${parts![0]}-${String(parts![1]).padStart(2,'0')}-${String(parts![2]).padStart(2,'0')}`);
}
function boundedString(value:unknown,min:number,max:number):value is string{return typeof value==='string'&&Array.from(value).length>=min&&Array.from(value).length<=max;}
function exactQuote(text:string,quote:unknown,start:unknown,end:unknown,max:number){
 if(!boundedString(quote,1,max)||!Number.isInteger(start)||!Number.isInteger(end)||(start as number)<0||(end as number)<=(start as number)||Array.from(text).slice(start as number,end as number).join('')!==quote)fail('notice_quote_location');
}
const eventCue:Record<EventType,RegExp>={annual_meeting:/annual.{0,30}(meeting|shareholder|stockholder)|주주총회/i,conference:/conference|NDR|investor.{0,20}(tour|meeting)|컨퍼런스|기업설명회|간담회|SC26|GTC/i,exhibition:/exhibition|expo|BIXPO|전시|박람회|CES/i,dividend_record:/record|배당기준일|기준일/i,dividend_payment:/payable|payment|paid|지급/i,dividend_ex:/ex.dividend|배당락/i,bond_payment:/납입|payment|subscription/i,equity_payment:/납입|payment|subscription/i,new_share_listing:/상장|listing/i};
export async function validateNotice(source:Source,manifest:NoticeManifest,text:string,raw:Uint8Array):Promise<void>{
 if(manifest?.schema!==NOTICE_SCHEMA||manifest.adapter!=='curated-notice'||manifest.complete!==false||source.adapter!=='curated-notice'||manifest.source_key!==source.key||manifest.source_url!==source.url||manifest.company_id!==source.company_id||manifest.provider!==source.provider||manifest.provider_company_id!==source.provider_company_id||manifest.ticker!==source.ticker||await noticeSourceKey(manifest.provider,manifest.provider_company_id,manifest.source_url)!==source.key)fail('notice_source_identity');
 if(!['html','pdf','json'].includes(manifest.format)||!['utf-8','euc-kr'].includes(manifest.encoding)||!hashPattern.test(manifest.raw_sha256)||!hashPattern.test(manifest.normalized_sha256)||raw.length!==manifest.raw_bytes||raw.length<1||raw.length>RAW_LIMIT||await sha256(raw)!==manifest.raw_sha256)fail('notice_original_hash');
 if(!boundedString(text,1,TEXT_LIMIT)||text!==textNormalize(text)||await sha256(new TextEncoder().encode(text))!==manifest.normalized_sha256||manifest.raw_object_key!==`calendar/${source.key}/originals/${manifest.raw_sha256}.${manifest.format}`||manifest.normalized_object_key!==`calendar/${source.key}/normalized/${manifest.normalized_sha256}.txt`)fail('notice_normalized_hash');
 if(manifest.format==='pdf'){
  if(manifest.normalization!=='pdf-text-whitespace-v1'||!/^pdftotext-[0-9]+(?:\.[0-9]+){1,2};layout;utf-8$/.test(manifest.extraction)||normalizeNotice(raw,'pdf',manifest.encoding,manifest.document_url,text)!==text)fail('notice_pdf_extraction_missing');
 }else if(manifest.normalization!==(manifest.format==='html'?'html-text-v1':'ls-electric-board-v1')||manifest.extraction!=='deterministic-v1'||normalizeNotice(raw,manifest.format,manifest.encoding,manifest.document_url)!==text)fail('notice_original_text_mismatch');
 exactQuote(text,manifest.issuer_quote,manifest.issuer_start,manifest.issuer_end,500);
 if(!Array.isArray(manifest.entries)||manifest.entries.length<1||manifest.entries.length>40||new Set(manifest.entries.map(e=>e.key)).size!==manifest.entries.length)fail('notice_entries');
 for(const entry of manifest.entries){
  if(!boundedString(entry.key,1,160)||!/^[a-zA-Z0-9:_-]+$/.test(entry.key)||!boundedString(entry.title,1,200)||!EVENT_TYPES.includes(entry.event_type)||entry.timezone!==null||!boundedString(entry.date_token,4,60)||!entry.quote.includes(entry.date_token)||!eventCue[entry.event_type].test(entry.quote))fail('notice_entry');
  exactQuote(text,entry.quote,entry.quote_start,entry.quote_end,2400);
  if(entry.location!==`normalized-text[${entry.quote_start}:${entry.quote_end}]`)fail('notice_quote_location');
  let year:number|undefined;
  if(entry.year_context_token!==undefined){
   exactQuote(text,entry.year_context_quote,entry.year_context_start,entry.year_context_end,500);
   if(!entry.year_context_quote!.includes(entry.year_context_token))fail('notice_year_context');
   if(/^20\d{2}$/.test(entry.year_context_token)){
    if(!eventCue[entry.event_type].test(entry.year_context_quote!))fail('notice_year_context');
    year=Number(entry.year_context_token);
   }else year=Number(parseNoticeDate(entry.year_context_token).slice(0,4));
  }else if(entry.year_context_quote!==undefined||entry.year_context_start!==undefined||entry.year_context_end!==undefined)fail('notice_year_context');
  if(parseNoticeDate(entry.date_token,year)!==entry.occurs_on)fail('notice_event_date');
  if(entry.ends_on!==undefined){
   if(!entry.end_date_token||!entry.quote.includes(entry.end_date_token)||parseNoticeDate(entry.end_date_token,year??Number(entry.occurs_on.slice(0,4)),Number(entry.occurs_on.slice(5,7)))!==entry.ends_on||entry.ends_on<=entry.occurs_on||Date.parse(entry.ends_on)-Date.parse(entry.occurs_on)>31*86400000||!entry.title.includes(entry.occurs_on)||!entry.title.includes(entry.ends_on))fail('notice_event_range');
  }else if(entry.end_date_token!==undefined)fail('notice_event_range');
 }
}
/** No URL is fetched here. Only the original bytes staged for the claimed task are archived. */
export async function archiveNotice(source:Source,payload:NoticePayload,archive:(path:string,bytes:Uint8Array,contentType:string)=>Promise<void>){
 if(payload?.completed===true){if(!Number.isInteger(payload.count)||payload.count<1||payload.count>40)fail('notice_completed_invalid');return {completed:true as const,count:payload.count};}
 if(!payload||payload.completed!==false||typeof payload.manifest_text!=='string'||payload.manifest_text.length>150_000||typeof payload.normalized_text!=='string'||typeof payload.raw_base64!=='string'||payload.raw_base64.length>Math.ceil(RAW_LIMIT/3)*4+100||!/^[A-Za-z0-9+/]*={0,2}$/.test(payload.raw_base64))fail('notice_payload_invalid');
 const raw=Uint8Array.from(atob(payload.raw_base64),x=>x.charCodeAt(0));
 const manifest=JSON.parse(payload.manifest_text) as NoticeManifest;
 await validateNotice(source,manifest,payload.normalized_text,raw);
 const manifestBytes=new TextEncoder().encode(payload.manifest_text),digest=await sha256(manifestBytes),path=`calendar/${source.key}/${digest}.json`;
 await archive(manifest.raw_object_key,raw,manifest.format==='pdf'?'application/pdf':manifest.format==='json'?'application/json':'text/html');
 await archive(manifest.normalized_object_key,new TextEncoder().encode(payload.normalized_text),'text/plain;charset=utf-8');
 await archive(path,manifestBytes,'application/json');
 return {completed:false as const,raw_sha:digest,object_key:path,manifest_text:payload.manifest_text};
}
