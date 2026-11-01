import {Parser} from 'npm:htmlparser2@10.0.0';
import {CalendarError,dateOnly,sha256,type Entry,type Source} from './core.ts';

export const DART_IR_SOURCE_URL='https://dart.fss.or.kr/';
const PAGE_SIZE=100,MAX_PAGES=5,MAX_NOTICES=20,MAX_FAMILY=8,MAX_DOCUMENTS=40,MAX_TOTAL_BYTES=4_000_000;
const MAX_LIST_BYTES=2_000_000,MAX_HTML_BYTES=250_000;
export type DartIRSource=Source&{adapter:'dart-ir';company_id:string;provider:'dart';provider_company_id:string};
export type DartIREntry=Omit<Entry,'timezone'>&{timezone:null;receipt_no:string;source_url:string;body_sha256:string};
export type DartIRArchive=(path:string,bytes:Uint8Array,contentType:string)=>Promise<void>;
/** Implemented by the task handler using the existing HMAC relay and server-only credentials. */
export type DartIRListPage=(corpCode:string,page:number,start:string,end:string,signal:AbortSignal)=>Promise<Uint8Array>;
type Filing={receipt:string;receipt_date:string;company_name:string;report_name:string;remarks:string};
type ListPage={items:Filing[];count:number;total_count:number;total_page:number};
type Page={page_number:number;count:number;total_count:number;total_page:number;url:string;raw_sha256:string;object_key:string};
type Family={root_receipt_no:string;latest_receipt_no:string;receipt_nos:string[]};
type Lineage={root_receipt_no:string;corrected:boolean;family_receipts:string[]};
type Document=Lineage&{receipt_no:string;main_url:string;main_sha256:string;main_object_key:string;body_url:string;body_sha256:string;body_object_key:string};
export type DartIRManifest={
 schema:'signalbrief.calendar.dart-ir.v2';adapter:'dart-ir';source_key:string;source_url:string;
 company_id:string;provider:'dart';provider_company_id:string;ticker:string;complete:true;page_size:100;
 receipt_window:{start:string;end:string};window:{start:string;end:string};pages:Page[];documents:Document[];families:Family[];entries:DartIREntry[];
};
const record=(value:unknown):value is Record<string,unknown>=>typeof value==='object'&&value!==null&&!Array.isArray(value);
const text=(value:string)=>value.replace(/\s+/g,' ').trim();
const compact=(value:string)=>value.normalize('NFKC').replace(/\s+/g,'');
const integer=(value:unknown):number=>typeof value==='number'&&Number.isSafeInteger(value)?value:typeof value==='string'&&/^\d{1,6}$/.test(value)?Number(value):-1;
const iso=(value:string)=>dateOnly(`${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}`);

function windows(today:string):{receipt_window:{start:string;end:string};window:{start:string;end:string}}{
 dateOnly(today);
 const start=new Date(today+'T00:00:00Z'),end=new Date(today+'T00:00:00Z');start.setUTCDate(start.getUTCDate()-90);
 const day=end.getUTCDate();end.setUTCDate(1);end.setUTCMonth(end.getUTCMonth()+18);
 end.setUTCDate(Math.min(day,new Date(Date.UTC(end.getUTCFullYear(),end.getUTCMonth()+1,0)).getUTCDate()));
 return {receipt_window:{start:start.toISOString().slice(0,10),end:today},window:{start:start.toISOString().slice(0,10),end:end.toISOString().slice(0,10)}};
}

/** A provenance URL, deliberately without the API credential. Never fetch it without the signed relay. */
export function dartIRListUrl(corpCode:string,page:number,start:string,end:string):string{
 if(!/^\d{8}$/.test(corpCode)||!Number.isInteger(page)||page<1||page>MAX_PAGES)throw new CalendarError('invalid_source_identity');
 dateOnly(start);dateOnly(end);
 const url=new URL('https://opendart.fss.or.kr/api/list.json');
 url.search=new URLSearchParams({corp_code:corpCode,page_no:String(page),bgn_de:start.replaceAll('-',''),end_de:end.replaceAll('-',''),page_count:String(PAGE_SIZE),sort:'date',sort_mth:'desc'}).toString();
 return url.href;
}

export function parseDartIRList(bytes:Uint8Array,source:DartIRSource,page:number,window:{start:string;end:string}):ListPage{
 if(bytes.length>MAX_LIST_BYTES)throw new CalendarError('source_too_large');
 let value:unknown;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new CalendarError('source_format_changed');}
 if(!record(value))throw new CalendarError('source_format_changed');
 if(value.status==='013'){
  if(page!==1||(value.list!==undefined&&(!Array.isArray(value.list)||value.list.length!==0))||(value.total_count!==undefined&&integer(value.total_count)!==0))throw new CalendarError('incomplete_pagination');
  return {items:[],count:0,total_count:0,total_page:0};
 }
 if(value.status!=='000')throw new CalendarError(value.status==='020'?'dart_quota_exceeded':'dart_list_unavailable');
 const total=integer(value.total_count),pages=integer(value.total_page);
 if(integer(value.page_no)!==page||integer(value.page_count)!==PAGE_SIZE||total<1||total>PAGE_SIZE*MAX_PAGES||pages!==Math.ceil(total/PAGE_SIZE)||page>pages||!Array.isArray(value.list))throw new CalendarError('incomplete_pagination');
 const expected=Math.min(PAGE_SIZE,total-(page-1)*PAGE_SIZE);
 if(value.list.length!==expected)throw new CalendarError('incomplete_pagination');
 const items=value.list.map((row):Filing=>{
  if(!record(row)||row.corp_code!==source.provider_company_id||row.stock_code!==source.ticker||typeof row.rcept_no!=='string'||!/^\d{14}$/.test(row.rcept_no)||typeof row.rcept_dt!=='string'||!/^\d{8}$/.test(row.rcept_dt)||!row.rcept_no.startsWith(row.rcept_dt))throw new CalendarError('company_identity_mismatch');
  if(typeof row.corp_name!=='string'||!row.corp_name.trim()||row.corp_name.length>500||typeof row.report_nm!=='string'||!row.report_nm.trim()||row.report_nm.length>500||typeof row.rm!=='string'||row.rm.length>100)throw new CalendarError('source_format_changed');
  const date=iso(row.rcept_dt);if(date<window.start||date>window.end)throw new CalendarError('filing_outside_window');
  return {receipt:row.rcept_no,receipt_date:date,company_name:text(row.corp_name),report_name:text(row.report_nm),remarks:row.rm};
 });
 return {items,count:items.length,total_count:total,total_page:pages};
}

function isIR(filing:Filing):boolean{
 const name=compact(filing.report_name).replace(/^(?:\[[^\]]+\])+/,'');
 return name==='기업설명회(IR)개최(안내공시)'||name==='기업설명회(IR)개최';
}

type FamilyOption={value:string;title:string;selected:boolean;label:string};
type Table={rows:{cells:string[];index:number}[]};
type HTML={title:string;visible:string;rows:string[][];tables:Table[];scripts:string[];issuer_ids:string[];families:FamilyOption[];family_selects:number};
/** Parse text/rows only. No script is executed, no remote URL or HTML is rendered. */
function htmlParts(html:string,collectRows=false):HTML{
 const result:HTML={title:'',visible:'',rows:[],tables:[],scripts:[],issuer_ids:[],families:[],family_selects:0};
 const stack:{name:string;hidden:boolean}[]=[];let script:string|null=null,title=false,row:string[]|null=null,cell:string|null=null,nodes=0;
 let family=false,option:FamilyOption|null=null,table:Table|null=null;
 const hidden=()=>stack.at(-1)?.hidden??false;
 const parser=new Parser({
  onopentag(name,attrs){
   if(++nodes>20000||stack.length>=64)throw new CalendarError('source_too_large');
   const isHidden=hidden()||['script','style','noscript'].includes(name)||'hidden' in attrs||attrs['aria-hidden']==='true'||/(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(attrs.style??'');
   stack.push({name,hidden:isHidden});
   if(name==='script'){script='';return;}
   if(name==='title')title=true;
   const corp=attrs.onclick?.match(/^\s*openCorpInfoNew\(\s*['"](\d{8})['"]\s*,/);
   if(corp)result.issuer_ids.push(corp[1]);
   if(name==='select'&&attrs.id==='family'){if(family)throw new CalendarError('ambiguous_correction');family=true;result.family_selects++;}
   if(name==='option'&&family)option={value:attrs.value??'',title:attrs.title??'',selected:'selected' in attrs,label:''};
   if(isHidden)return;
   if(collectRows&&name==='table'){if(table!==null)throw new CalendarError('ambiguous_table');table={rows:[]};result.tables.push(table);}
   if(collectRows&&name==='tr'){if(row!==null)throw new CalendarError('ambiguous_table');row=[];}
   if(collectRows&&['td','th'].includes(name)&&row!==null){if(cell!==null)throw new CalendarError('ambiguous_table');cell='';}
   else if(cell!==null)cell+=' ';
  },
  ontext(value){
   if(script!==null){script+=value;return;}
   if(hidden())return;
   if(title)result.title+=value;
   if(option!==null)option.label+=value;
   result.visible+=value+' ';
   if(cell!==null)cell+=value;
  },
  onclosetag(name){
   if(name==='script'&&script!==null){result.scripts.push(script);script=null;}
   if(name==='title')title=false;
   if(name==='option'&&option!==null){option.label=text(option.label);result.families.push(option);option=null;}
   if(name==='select')family=false;
   if(!hidden()){
    if(collectRows&&['td','th'].includes(name)&&cell!==null){row?.push(text(cell));cell=null;}
    else if(cell!==null)cell+=' ';
    if(collectRows&&name==='tr'&&row!==null){if(!table)throw new CalendarError('ambiguous_table');table.rows.push({cells:row,index:result.rows.length});result.rows.push(row);row=null;}
    if(collectRows&&name==='table')table=null;
   }
   const index=stack.map(x=>x.name).lastIndexOf(name);if(index>=0)stack.splice(index);
  },
  onerror(){throw new CalendarError('source_format_changed');},
 },{decodeEntities:true});
 parser.write(html);parser.end();
 result.title=text(result.title);result.visible=text(result.visible);return result;
}

export function parseDartIRMain(html:string,source:DartIRSource,filing:Filing):Lineage&{body_url:string}{
 const parsed=htmlParts(html),ids=new Set(parsed.issuer_ids);
 if(ids.size!==1||!ids.has(source.provider_company_id))throw new CalendarError('company_identity_mismatch');
 if(parsed.family_selects!==1||/철회/.test(parsed.title))throw new CalendarError('ambiguous_correction');
 if(!parsed.title.startsWith(filing.company_name+'/')||!compact(parsed.title).includes('기업설명회(IR)개최(안내공시)')||!parsed.title.includes(filing.receipt_date.replaceAll('-','.')))throw new CalendarError('filing_identity_mismatch');
 const scripts=parsed.scripts.join('\n');
 if(!/\balertJungJung\(\s*['"][A-Z]['"]\s*,\s*['"]99664['"]\s*\)/.test(scripts))throw new CalendarError('unsupported_ir_template');
 const calls=[...scripts.matchAll(/\bviewDoc\(\s*['"](\d{14})['"]\s*,\s*['"]([1-9]\d{0,11})['"]\s*,\s*['"]0['"]\s*,\s*['"]0['"]\s*,\s*['"]0['"]\s*,\s*['"]HTML['"]\s*,\s*['"]['"]\s*\)/g)];
 if([...scripts.matchAll(/\bviewDoc\(\s*['"]/g)].length!==1||calls.length!==1||calls[0][1]!==filing.receipt)throw new CalendarError('ambiguous_document');
 const members=parsed.families.filter(option=>option.value!=='null').map(option=>{
  const receipt=option.value.match(/^rcpNo=(\d{14})$/)?.[1];
  const label=compact(option.label).match(/^(\d{4}\.\d{2}\.\d{2})(\[정정\])?기업설명회\(IR\)개최(?:\(안내공시\))?$/);
  if(!receipt||!label||!['기업설명회(IR)개최(안내공시)','기업설명회(IR)개최'].includes(compact(option.title))||iso(receipt.slice(0,8)).replaceAll('-','.')!==label[1])throw new CalendarError('ambiguous_correction');
  return {receipt,corrected:Boolean(label[2]),selected:option.selected};
 });
 if(members.length<1||members.length>MAX_FAMILY||new Set(members.map(member=>member.receipt)).size!==members.length
  ||members.some((member,index)=>index>0&&member.receipt>=members[index-1].receipt)
  ||members.filter(member=>member.selected).length!==1||members.find(member=>member.selected)?.receipt!==filing.receipt
  ||members.at(-1)?.corrected||members.slice(0,-1).some(member=>!member.corrected))throw new CalendarError('ambiguous_correction');
 const root_receipt_no=members.at(-1)!.receipt,corrected=members.find(member=>member.receipt===filing.receipt)!.corrected;
 const proofs=[...scripts.matchAll(/\balertInvestNotice\(\s*['"](\d{14})['"]\s*,\s*['"]([1-9]\d{0,11})['"]\s*,\s*['"](\d{14})['"]\s*,\s*['"]([01])['"]\s*,\s*['"]99664['"]\s*,\s*['"]HTML['"]\s*\)/g)];
 if([...scripts.matchAll(/\balertInvestNotice\(\s*['"]/g)].length!==1||proofs.length!==1||proofs[0][1]!==filing.receipt||proofs[0][2]!==calls[0][2]||proofs[0][3]!==root_receipt_no||proofs[0][4]!==String(Number(corrected)))throw new CalendarError('ambiguous_correction');
 const report=compact(filing.report_name),expected=report.replace(/^\[(?:기재정정|정정)\]/,'');
 if(!['기업설명회(IR)개최(안내공시)','기업설명회(IR)개최'].includes(expected)||corrected!==(report!==expected)||/[철]/.test(filing.remarks)||(/정/.test(filing.remarks)&&members.length===1))throw new CalendarError('ambiguous_correction');
 const url=new URL('/report/viewer.do',DART_IR_SOURCE_URL);
 url.search=new URLSearchParams({rcpNo:filing.receipt,dcmNo:calls[0][2],eleId:'0',offset:'0',length:'0',dtd:'HTML'}).toString();
 return {body_url:url.href,root_receipt_no,corrected,family_receipts:members.map(member=>member.receipt).reverse()};
}

export function parseDartIRBody(html:string,filing:Filing,lineage?:Lineage):{title:string;occurs_on:string;quote:string;location:string}{
 const parsed=htmlParts(html,true);
 if(!/<\/html>\s*$/i.test(html))throw new CalendarError('incomplete_document');
 if(!parsed.title.startsWith(filing.company_name+'/')||!compact(parsed.title).includes('기업설명회(IR)개최(안내공시)')||!parsed.title.includes(filing.receipt_date.replaceAll('-','.')))throw new CalendarError('filing_identity_mismatch');
 if(/철회/.test(parsed.title))throw new CalendarError('ambiguous_correction');
 const schedules=parsed.tables.filter(table=>table.rows.some(({cells})=>compact(cells[0]??'')==='1.일시및장소'&&compact(cells[1]??'')==='일시'));
 if(schedules.length!==1)throw new CalendarError('ambiguous_date');
 const schedule=schedules[0],rows=schedule.rows.map(row=>row.cells),correctionMarkers=parsed.rows.some(row=>row.some(value=>/정정전|정정후|정정사항/.test(compact(value))));
 if(lineage?.corrected){
  const corrections=parsed.tables.filter(table=>table.rows.some(({cells})=>compact(cells[0]??'')==='1.정정관련공시서류'));
  const dates=parsed.rows.filter(cells=>compact(cells[0]??'')==='정정일자');
  if(corrections.length!==1||parsed.tables.indexOf(corrections[0])>=parsed.tables.indexOf(schedule)||dates.length!==1||dates[0].length!==2||dates[0][1]!==filing.receipt_date)throw new CalendarError('ambiguous_correction');
  const correction=corrections[0].rows.map(row=>row.cells),value=(label:string)=>correction.filter(cells=>compact(cells[0]??'')===label);
  const report=value('1.정정관련공시서류'),submitted=value('2.정정관련공시서류제출일'),reason=value('3.정정사유'),changes=value('4.정정사항');
  const headers=correction.filter(cells=>cells.map(compact).join('|')==='정정항목|정정전|정정후');
  if(report.length!==1||report[0].length!==2||!['기업설명회(IR)개최(안내공시)','기업설명회(IR)개최'].includes(compact(report[0][1]))
   ||submitted.length!==1||submitted[0].length!==2||submitted[0][1]!==iso(lineage.root_receipt_no.slice(0,8))
   ||reason.length!==1||reason[0].length!==2||!reason[0][1]||/취소|철회/.test(reason[0][1])||changes.length!==1||headers.length!==1
   ||!correction.some(cells=>cells.length===3&&cells!==headers[0]&&cells.every(Boolean)))throw new CalendarError('ambiguous_correction');
 }else if(correctionMarkers||/정정/.test(parsed.title))throw new CalendarError('ambiguous_correction');
 if(rows.some(cells=>cells.some(value=>/정정전|정정후|정정사항/.test(compact(value)))))throw new CalendarError('ambiguous_correction');
 for(const label of ['2.참가대상자','3.개최목적','4.개최방법','5.후원기관','6.주요설명회내용(요약)','7.결정일자','8.IR자료','9.기타투자판단과관련한중요사항']){
  if(rows.filter(cells=>compact(cells[0]??'')===label).length!==1)throw new CalendarError('incomplete_document');
 }
 const occurrences=schedule.rows.filter(({cells})=>compact(cells[0]??'')==='1.일시및장소'&&compact(cells[1]??'')==='일시');
 const purposes=rows.filter(cells=>compact(cells[0]??'')==='3.개최목적');
 if(occurrences.length!==1||purposes.length!==1||occurrences[0].cells.length!==4||purposes[0].length!==2)throw new CalendarError('ambiguous_date');
 const {cells,index}=occurrences[0],date=dateOnly(cells[2]);
 if(cells[3].length>100||/\d{4}[-./]\d{1,2}[-./]\d{1,2}/.test(cells[3]))throw new CalendarError('ambiguous_date');
 const purpose=purposes[0][1],title=`${filing.company_name} · ${purpose}`;
 if(!purpose||title.length>200||/[\u0000-\u001f]/.test(title)||/취소|철회/.test(purpose))throw new CalendarError('invalid_event');
 const quote=cells.join(' ');
 if(!parsed.visible.includes(quote))throw new CalendarError('quote_not_found');
 return {title,occurs_on:date,quote,location:`99664/table/tr[${index}]/일시`};
}

export function decodeDartIRHTML(bytes:Uint8Array,contentType:string):string{
 const prefix=new TextDecoder('windows-1252').decode(bytes.slice(0,4096));
 const charset=(contentType.match(/charset\s*=\s*["']?([a-z0-9_-]+)/i)?.[1]??prefix.match(/charset\s*=\s*["']?([a-z0-9_-]+)/i)?.[1]??'utf-8').toLowerCase();
 const encoding=['euc-kr','ms949','cp949','ks_c_5601-1987'].includes(charset)?'euc-kr':['utf8','utf-8'].includes(charset)?'utf-8':null;
 if(!encoding)throw new CalendarError('unsupported_source_encoding');
 try{return new TextDecoder(encoding,{fatal:true}).decode(bytes);}catch{throw new CalendarError('invalid_source_encoding');}
}

async function bounded<T>(promise:Promise<T>,signal:AbortSignal):Promise<T>{
 if(signal.aborted)throw new CalendarError('source_timeout');
 let abort:()=>void=()=>{};
 const cancelled=new Promise<never>((_,reject)=>{abort=()=>reject(new CalendarError('source_timeout'));signal.addEventListener('abort',abort,{once:true});});
 try{return await Promise.race([promise,cancelled]);}finally{signal.removeEventListener('abort',abort);}
}

async function fetchHTML(url:string,fetcher:typeof fetch,signal:AbortSignal):Promise<{bytes:Uint8Array;type:string}>{
 const parsed=new URL(url);
 if(parsed.origin!=='https://dart.fss.or.kr'||!['/dsaf001/main.do','/report/viewer.do'].includes(parsed.pathname)||parsed.username||parsed.password||parsed.hash)throw new CalendarError('invalid_source_url');
 let response:Response;
 try{response=await bounded(fetcher(url,{redirect:'error',signal,headers:{Accept:'text/html','User-Agent':'SignalBrief/1.0 (official DART IR calendar; signalbrief.online)'}}),signal);}catch(error){if(error instanceof CalendarError)throw error;throw new CalendarError('source_fetch_failed');}
 if(response.redirected||(response.url&&response.url!==url))throw new CalendarError('invalid_source_url');
 if(!response.ok)throw new CalendarError(`source_http_${response.status}`);
 const type=response.headers.get('content-type')??'';
 if(!/^text\/html(?:\s*;|$)/i.test(type)||type.length>128)throw new CalendarError('invalid_content_type');
 if(Number(response.headers.get('content-length')??0)>MAX_HTML_BYTES){await response.body?.cancel();throw new CalendarError('source_too_large');}
 const reader=response.body?.getReader();if(!reader)throw new CalendarError('empty_source');
 const chunks:Uint8Array[]=[];let length=0;
 try{
  while(true){const {done,value}=await bounded(reader.read(),signal);if(done)break;length+=value.length;if(length>MAX_HTML_BYTES)throw new CalendarError('source_too_large');chunks.push(value);}
 }catch(error){await reader.cancel().catch(()=>{});if(error instanceof CalendarError)throw error;throw new CalendarError('source_fetch_failed');}
 const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 return {bytes,type};
}

/** Complete within the receipt window only. Absence is never evidence that an older event was withdrawn. */
export async function collectDartIR(source:DartIRSource,today:string,archive:DartIRArchive,listPage:DartIRListPage,fetcher:typeof fetch=fetch):Promise<{raw_sha:string;object_key:string;manifest_text:string;manifest:DartIRManifest}>{
 if(source.provider!=='dart'||source.adapter!=='dart-ir'||!/^\d{8}$/.test(source.provider_company_id)||!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(source.company_id)||!/^[A-Z0-9]{6}$/.test(source.ticker)||!/^[a-z0-9][a-z0-9-]{1,79}$/.test(source.key)||source.url!==DART_IR_SOURCE_URL)throw new CalendarError('invalid_source_identity');
 const {receipt_window,window}=windows(today),signal=AbortSignal.timeout(30000),pages:Page[]=[],filings:Filing[]=[],seen=new Set<string>();
 let totalBytes=0;
 const save=async(path:string,bytes:Uint8Array,type:string)=>{
  totalBytes+=bytes.length;if(totalBytes>MAX_TOTAL_BYTES)throw new CalendarError('source_too_large');
  await bounded(archive(path,bytes,type),signal);
 };
 const loadList=async(page:number)=>{
  let bytes:Uint8Array;try{bytes=await bounded(listPage(source.provider_company_id,page,receipt_window.start.replaceAll('-',''),receipt_window.end.replaceAll('-',''),signal),signal);}catch(error){if(error instanceof CalendarError)throw error;throw new CalendarError('dart_list_unavailable');}
  if(!(bytes instanceof Uint8Array)||bytes.length>MAX_LIST_BYTES)throw new CalendarError('source_too_large');
  const raw_sha256=await sha256(bytes),object_key=`calendar/${source.key}/lists/${raw_sha256}.json`;
  await save(object_key,bytes,'application/json');
  const parsed=parseDartIRList(bytes,source,page,receipt_window);
  return {parsed,page:{page_number:page,count:parsed.count,total_count:parsed.total_count,total_page:parsed.total_page,url:dartIRListUrl(source.provider_company_id,page,receipt_window.start,receipt_window.end),raw_sha256,object_key}};
 };
 const first=await loadList(1),remaining=await Promise.all(Array.from({length:Math.max(0,first.parsed.total_page-1)},(_,index)=>loadList(index+2)));
 for(const result of [first,...remaining]){
  if(result.parsed.total_page!==first.parsed.total_page||result.parsed.total_count!==first.parsed.total_count)throw new CalendarError('pagination_changed_retry_later');
  pages.push(result.page);
  for(const item of result.parsed.items){if(seen.has(item.receipt))throw new CalendarError('duplicate_filing_identity');seen.add(item.receipt);filings.push(item);}
 }
 if(filings.length!==first.parsed.total_count)throw new CalendarError('incomplete_pagination');
 const notices=filings.filter(isIR);
 if(notices.length>MAX_NOTICES)throw new CalendarError('too_many_ir_notices');
 if(notices.some(item=>/철회/.test(item.report_name)||/철/.test(item.remarks)))throw new CalendarError('ambiguous_correction');
 const noticeByReceipt=new Map(notices.map(filing=>[filing.receipt,filing]));
 type Loaded={document:Document;entry:DartIREntry;filing:Filing};
 const loaded=new Map<string,Loaded>();
 const load=async(filing:Filing):Promise<Loaded>=>{
   const main_url=`https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${filing.receipt}`,main=await fetchHTML(main_url,fetcher,signal),main_sha256=await sha256(main.bytes),main_object_key=`calendar/${source.key}/documents/${main_sha256}.html`;
   await save(main_object_key,main.bytes,main.type);
   const {body_url,...lineage}=parseDartIRMain(decodeDartIRHTML(main.bytes,main.type),source,filing),body=await fetchHTML(body_url,fetcher,signal),body_sha256=await sha256(body.bytes),body_object_key=`calendar/${source.key}/documents/${body_sha256}.html`;
   await save(body_object_key,body.bytes,body.type);
   const parsed=parseDartIRBody(decodeDartIRHTML(body.bytes,body.type),filing,lineage);
   const document:Document={receipt_no:filing.receipt,main_url,main_sha256,main_object_key,body_url,body_sha256,body_object_key,...lineage};
   const entry:DartIREntry={...parsed,key:lineage.root_receipt_no,receipt_no:filing.receipt,timezone:null,source_url:main_url,body_sha256};
   return {document,entry,filing};
 };
 // Bound parallelism as well as bytes/time: at most three two-request source chains.
 const loadGroup=async(inputs:Filing[])=>{
  for(let offset=0;offset<inputs.length;offset+=3){
   const group=await Promise.all(inputs.slice(offset,offset+3).map(load));
   for(const item of group)loaded.set(item.document.receipt_no,item);
  }
 };
 await loadGroup(notices);
 const familiesByRoot=new Map<string,Family>(),memberRoots=new Map<string,string>(),missing=new Map<string,Filing>();
 for(const {document,filing} of loaded.values()){
  const receipts=document.family_receipts,root=document.root_receipt_no,latest=receipts.at(-1)!;
  if(receipts[0]!==root||!noticeByReceipt.has(latest))throw new CalendarError('incomplete_correction_family');
  const prior=familiesByRoot.get(root);
  if(prior&&JSON.stringify(prior.receipt_nos)!==JSON.stringify(receipts))throw new CalendarError('inconsistent_correction_family');
  familiesByRoot.set(root,{root_receipt_no:root,latest_receipt_no:latest,receipt_nos:receipts});
  for(const receipt of receipts){
   if(memberRoots.has(receipt)&&memberRoots.get(receipt)!==root)throw new CalendarError('inconsistent_correction_family');
   memberRoots.set(receipt,root);
   if(!loaded.has(receipt)){
    const receipt_date=iso(receipt.slice(0,8));
    // A member inside the scan cannot be silently missing from a complete list.
    if(receipt_date>=receipt_window.start)throw new CalendarError('incomplete_correction_family');
    missing.set(receipt,{receipt,receipt_date,company_name:filing.company_name,report_name:(receipt===root?'':'[기재정정]')+'기업설명회(IR)개최(안내공시)',remarks:''});
   }
  }
 }
 if(loaded.size+missing.size>MAX_DOCUMENTS)throw new CalendarError('too_many_ir_documents');
 await loadGroup([...missing.values()]);
 for(const {document} of loaded.values()){
  const family=familiesByRoot.get(document.root_receipt_no);
  if(!family||memberRoots.get(document.receipt_no)!==document.root_receipt_no||JSON.stringify(family.receipt_nos)!==JSON.stringify(document.family_receipts)
   ||document.corrected!==(document.receipt_no!==family.root_receipt_no))throw new CalendarError('inconsistent_correction_family');
 }
 const families=[...familiesByRoot.values()].sort((a,b)=>a.root_receipt_no.localeCompare(b.root_receipt_no));
 const documents=[...loaded.values()].map(item=>item.document).sort((a,b)=>a.receipt_no.localeCompare(b.receipt_no));
 // A corrected date outside the display window still updates the same root row;
 // silently omitting it would retain the obsolete original date in the calendar.
 const entries=families.map(family=>loaded.get(family.latest_receipt_no)!.entry);
 const manifest:DartIRManifest={schema:'signalbrief.calendar.dart-ir.v2',adapter:'dart-ir',source_key:source.key,source_url:source.url,company_id:source.company_id,provider:'dart',provider_company_id:source.provider_company_id,ticker:source.ticker,complete:true,page_size:100,receipt_window,window,pages,documents,families,entries};
 const manifest_text=JSON.stringify(manifest),bytes=new TextEncoder().encode(manifest_text),raw_sha=await sha256(bytes),object_key=`calendar/${source.key}/${raw_sha}.json`;
 await save(object_key,bytes,'application/json');return {raw_sha,object_key,manifest_text,manifest};
}
