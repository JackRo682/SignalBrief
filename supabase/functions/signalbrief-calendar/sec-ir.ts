import {parseDocument,DomUtils} from 'npm:htmlparser2@10.0.0';
import {CalendarError,dateOnly,sha256,type Source,type Entry} from './core.ts';
import {calendarWindow,collectQ4,type Q4Manifest} from './micron-q4.ts';
import {publicIRURL} from './public-source.ts';

export type SecIRSource=Source&{adapter:'sec-ir';provider:'sec';provider_company_id:string;company_id:string};
type Element=ReturnType<typeof DomUtils.getElementsByTagName>[number];
type Doc={role:'submissions'|'primary'|'exhibit'|'ir'|'events';url:string;raw_sha256:string;object_key:string;parent_url?:string;accession?:string;filing_date?:string};
type Binding={url:string;document_url:string;quote:string;location:string};
type IssuerEvidence={source_url:string;raw_sha256:string;label:string;location:string};
export type SecIREntry=Entry&{source_url:string;raw_sha256:string};
export type SecFilingEvidence={source_url:string;raw_sha256:string;accession:string;filing_date:string;form_type:'8-K'|'6-K';normalized_text:string;normalized_sha256:string;normalized_object_key:string;issuer_label:string;quote_start:number;quote_end:number;period_text:string;fiscal_year:number;quarter:number;date_text:string};
export type SecIRManifest={schema:'signalbrief.calendar.sec-ir.v1'|'signalbrief.calendar.sec-filing.v1';adapter:'sec-ir';source_key:string;source_url:string;company_id:string;provider:'sec';provider_company_id:string;ticker:string;issuer_name:string;issuer_evidence:IssuerEvidence[];complete:boolean;window:{start:string;end:string};documents:Doc[];binding:Binding;event_source_url:string;format:'q4'|'structured-html'|'sec-filing';q4?:Q4Manifest;q4_manifest?:{raw_sha256:string;object_key:string};entries:SecIREntry[];coverage?:'explicit-sec-announcement';fallback_reason?:string;filing?:SecFilingEvidence};
type Archive=(path:string,bytes:Uint8Array,contentType:string)=>Promise<void>;
const normalize=(s:string)=>s.replace(/\s+/g,' ').trim();
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
function plain(node:Parameters<typeof DomUtils.textContent>[0]):string{
 const text=(value:Parameters<typeof DomUtils.textContent>[0]):string=>{
  if(Array.isArray(value))return value.map(text).join('');
  if(value.type==='text')return value.data;
  if(!('children' in value))return '';
  const inside=value.children.map(text).join('');
  return 'name' in value&&/^(?:td|th|tr|p|div|br|li|table|h[1-6])$/.test(value.name)?` ${inside} `:inside;
 };
 return normalize(text(node));
}
const html=(bytes:Uint8Array)=>new TextDecoder('utf-8',{fatal:true}).decode(bytes);
const elements=(root:ReturnType<typeof parseDocument>|Element,name:string)=>DomUtils.getElementsByTagName(name,root.children,true);
const tags=(root:ReturnType<typeof parseDocument>|Element)=>DomUtils.getElementsByTagName('*',root.children,true);

const secDocument=(value:string,cik:string)=>{
 const url=new URL(value);if(url.origin!=='https://www.sec.gov'||url.search||url.hash
  ||!new RegExp(`^/Archives/edgar/data/${Number(cik)}/[0-9]{18}/[A-Za-z0-9_.-]+\\.html?$`).test(url.pathname))throw new CalendarError('invalid_sec_document');
 return url;
};
function issuer(data:unknown,source:SecIRSource){
 if(!object(data)||String(data.cik).padStart(10,'0')!==source.provider_company_id||!Array.isArray(data.tickers)||!data.tickers.includes(source.ticker)||typeof data.name!=='string'||!data.name.trim()||data.name.length>300)throw new CalendarError('company_identity_mismatch');
 return data;
}

const irNav='(?:investor relations|investor overview|events calendar|events (?:&|and) presentations|events)';
export const legalIssuerName=(value:string)=>normalize(value.normalize('NFKC').toLowerCase().replace(/[.,]/g,''))
 .replace(/\s+(?:incorporated|inc|corporation|corp|limited|ltd|plc)$/,'');
export const irIssuerLabel=(value:string)=>{
 let label=normalize(value.normalize('NFKC'));
 for(let pass=0;pass<4;pass++){
  const next=label.replace(new RegExp(`^${irNav}(?:\\s*[|–—-]\\s*|\\s+)`,'i'),'')
   .replace(new RegExp(`(?:\\s*[|–—-]\\s*|\\s+)${irNav}$`,'i'),'').trim();
  if(next===label)break;label=next;
 }
 return label;
};

/** A filed link can belong to a counterparty. Require the destination's own issuer identity too. */
export function officialIRIdentity(bytes:Uint8Array,source_url:string,raw_sha256:string,secName:string):IssuerEvidence{
 const expected=legalIssuerName(secName);if(!expected)throw new CalendarError('official_ir_identity_mismatch');
 const root=parseDocument(html(bytes)),candidates:{label:string;location:string;strong:boolean}[]=[];
 for(const [index,node] of elements(root,'title').entries()){
  const label=plain(node);candidates.push({label,location:`title[${index}]`,strong:irIssuerLabel(label)!==normalize(label)});
 }
 for(const [index,node] of elements(root,'meta').entries())if(['og:site_name','og:title'].includes(node.attribs.property)&&node.attribs.content){
  const label=normalize(node.attribs.content);candidates.push({label,location:`meta[${index}].${node.attribs.property}`,strong:node.attribs.property==='og:site_name'||irIssuerLabel(label)!==label});
 }
 for(const [index,node] of elements(root,'h1').entries())candidates.push({label:plain(node),location:`h1[${index}]`,strong:false});
 for(const [scriptIndex,node] of elements(root,'script').entries()){
  if(node.attribs.type!=='application/ld+json')continue;
  let data:unknown;try{data=JSON.parse(DomUtils.textContent(node));}catch{continue;}
  const values=Array.isArray(data)?data:object(data)&&Array.isArray(data['@graph'])?data['@graph']:[data];
  for(const [index,value]of values.entries())if(object(value)&&['Organization','Corporation'].includes(String(value['@type']))){
   const label=typeof value.legalName==='string'?value.legalName:typeof value.name==='string'?value.name:'';
   if(label)candidates.push({label:normalize(label),location:`jsonld[${scriptIndex}].organization[${index}]`,strong:true});
  }
 }
 const usable=candidates.filter(candidate=>candidate.label.length>0&&candidate.label.length<=500);
 if(usable.some(candidate=>candidate.strong&&legalIssuerName(irIssuerLabel(candidate.label))!==expected))throw new CalendarError('official_ir_identity_mismatch');
 const matched=usable.find(candidate=>legalIssuerName(irIssuerLabel(candidate.label))===expected);
 if(!matched)throw new CalendarError('official_ir_identity_mismatch');
 return {source_url,raw_sha256,label:matched.label,location:matched.location};
}

/** A filed explicit IR hostname is an identity-bound link, not a guessed company URL. */
export function filedIRBinding(bytes:Uint8Array,document_url:string):Binding|null{
 const root=parseDocument(html(bytes));
 for(const node of tags(root))if(['script','style','noscript','ix:header'].includes(node.name))DomUtils.removeElement(node);
 const text=plain(root),found=new Map<string,Binding>();
 for(const anchor of elements(root,'a'))if(anchor.attribs.href&&/investor\s+relations|investor\s+website/i.test(plain(anchor))){
  const url=publicIRURL(anchor.attribs.href);found.set(url.origin,{url:url.href,document_url,quote:`${plain(anchor)} | ${anchor.attribs.href}`,location:'anchor/explicit-investor-relations-url'});
 }
 const pattern=/(?:https?:\/\/)?(?:ir|investor|investors)\.[a-z0-9.-]+\.[a-z]{2,}(?:\/[a-z0-9_./-]*)?/gi;
 for(const match of text.matchAll(pattern)){
  const context=text.slice(Math.max(0,match.index!-600),Math.min(text.length,match.index!+400));
  if(!/investor\s+relations|webcast|investor\s+(?:information|website)/i.test(context))continue;
  const raw=match[0].replace(/[.,;:]+$/,'');if(/^http:\/\//i.test(raw))continue;
  const url=publicIRURL(/^https:\/\//i.test(raw)?raw:`https://${raw}`);url.search='';
  const quote=context.slice(Math.max(0,context.indexOf(match[0])-100),Math.min(context.length,context.indexOf(match[0])+match[0].length+100));
  found.set(url.origin,{url:url.href,document_url,quote,location:'normalized-text/explicit-investor-relations-url'});
 }
 if(found.size>1)throw new CalendarError('ambiguous_official_ir_source');
 return [...found.values()][0]??null;
}

function exhibits(bytes:Uint8Array,primaryURL:string,cik:string):string[]{
 const root=parseDocument(html(bytes)),result=new Set<string>();
 for(const row of elements(root,'tr')){
  if(!/\b99[.\s]+[12]\b/.test(plain(row)))continue;
  for(const anchor of elements(row,'a')){
   if(!anchor.attribs.href)continue;
   const url=secDocument(new URL(anchor.attribs.href,primaryURL).href,cik);
   if(url.pathname.slice(0,url.pathname.lastIndexOf('/'))!==new URL(primaryURL).pathname.slice(0,new URL(primaryURL).pathname.lastIndexOf('/')))throw new CalendarError('filing_identity_mismatch');
   result.add(url.href);
  }
 }
 if(result.size>2)throw new CalendarError('too_many_ir_discovery_documents');
 return [...result];
}

function eventPage(bytes:Uint8Array,base:string):string{
 const root=parseDocument(html(bytes)),links=new Set<string>();
 for(const a of elements(root,'a'))if(/^(?:events|events\s*(?:&|and)\s*presentations|events calendar|calendar of events)$/i.test(plain(a))&&a.attribs.href){
  const url=publicIRURL(new URL(a.attribs.href,base).href);if(url.origin===new URL(base).origin)links.add(url.href);
 }
 if(links.size>1){
  const withoutArchive=[...links].filter(url=>!/archive|past-events/i.test(url));if(withoutArchive.length===1)return withoutArchive[0];
  // An overview and its dedicated Events child are one navigation hierarchy.
  // Unrelated destinations or year/query variants remain ambiguous.
  const candidates=withoutArchive.map(value=>{const url=new URL(value);return {value,url,path:url.pathname.replace(/\/(?:default\.aspx|index\.html?)\/?$/i,'').replace(/\/$/,'')};});
  const dedicated=candidates.filter(candidate=>!candidate.url.search&&/(?:^|\/)(?:events|events-calendar|calendar)$/i.test(candidate.path)
   &&candidates.every(other=>!other.url.search&&(other.path===candidate.path||candidate.path.startsWith(other.path+'/'))));
  if(dedicated.length===1)return dedicated[0].value;
  throw new CalendarError('ambiguous_calendar_page');
 }
 return [...links][0]??base;
}
const monthNames=['january','february','march','april','may','june','july','august','september','october','november','december'];
export function explicitIRDate(value:string):string{
 if(/^\d{4}-\d{2}-\d{2}$/.test(value))return dateOnly(value);
 const match=value.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);if(!match)throw new CalendarError('ambiguous_date');
 const month=monthNames.findIndex(name=>name===match[1].toLowerCase()||name.slice(0,3)===match[1].toLowerCase());
 if(month<0)throw new CalendarError('ambiguous_date');return dateOnly(`${match[3]}-${String(month+1).padStart(2,'0')}-${match[2].padStart(2,'0')}`);
}

const filedPeriod='(?:(?:first|second|third|fourth)\\s+(?:fiscal\\s+)?quarter(?:\\s+of)?\\s+[0-9]{4}|Q[1-4]\\s+[0-9]{4})';
const filedDate=`(?:${monthNames.flatMap(name=>[name,name.slice(0,3)]).join('|')})\\s+[0-9]{1,2},\\s+[0-9]{4}`;
const escapeRE=(value:string)=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const allowedFilingFallback=new Set(['calendar_relay_upstream_failed','calendar_relay_network_failed','official_calendar_format_unsupported','source_http_403','source_http_404','source_http_429','source_http_500','source_http_502','source_http_503','source_http_504']);

/** A separate SEC announcement is evidence in its own right, never a guessed IR date. */
export function explicitSecFilingEvent(bytes:Uint8Array,document:Doc,source:SecIRSource,secName:string,window:{start:string;end:string}){
 const root=parseDocument(html(bytes));for(const node of tags(root))if(['script','style','noscript','ix:header'].includes(node.name))DomUtils.removeElement(node);
 const normalized_text=plain(root),name=normalize(secName),short=name.replace(/,?\s+(?:incorporated|inc\.?|corporation|corp\.?|limited|ltd\.?|plc)$/i,'');
 const labels=[...new Set([name,short])].filter(Boolean).sort((a,b)=>b.length-a.length).map(escapeRE).join('|');
 // A direct issuer subject starts a sentence or an explicitly labeled webcast section.
 const pattern=new RegExp(`(?:^|[.!?]\\s+|(?:WEBCAST INFORMATION|CONFERENCE CALL INFORMATION|EARNINGS CALL INFORMATION)\\s+)(${labels})\\s+will\\s+(?:host|hold|conduct|provide)\\b.{1,420}?\\bon\\s+(?:Monday,?\\s+|Tuesday,?\\s+|Wednesday,?\\s+|Thursday,?\\s+|Friday,?\\s+|Saturday,?\\s+|Sunday,?\\s+)?(${filedDate})\\b`,'gi');
 const found: {entry:SecIREntry;detail:Omit<SecFilingEvidence,'normalized_sha256'|'normalized_object_key'|'form_type'>}[]=[];
 for(const match of normalized_text.matchAll(pattern)){
  const quote=match[0].slice(match[0].indexOf(match[1])),start=match.index!+match[0].indexOf(match[1]);
  if(!/financial results|earnings/i.test(quote)||!/conference call|webcast/i.test(quote)||quote.length>500)continue;
  const nearby=normalized_text.slice(Math.max(0,start-200),start+quote.length+150);
  if(/\b(?:cancel(?:led|ed|lation)?|reschedul(?:e|ed|ing)|postpon(?:e|ed|ement)|correct(?:ed|ion)|revised)\b/i.test(nearby))throw new CalendarError('ambiguous_sec_filing_event');
  const periods=[...quote.matchAll(new RegExp(filedPeriod,'gi'))],dates=[...quote.matchAll(new RegExp(filedDate,'gi'))];
  if(periods.length!==1||dates.length!==1)throw new CalendarError('ambiguous_sec_filing_event');
  const period_text=periods[0][0],fiscal_year=Number(period_text.slice(-4)),quarter=/^Q/i.test(period_text)?Number(period_text[1]):['first','second','third','fourth'].indexOf(period_text.split(/\s+/)[0].toLowerCase())+1;
  const date_text=match[2],occurs_on=explicitIRDate(date_text);if(occurs_on<window.start||occurs_on>window.end)continue;
  const quote_start=Array.from(normalized_text.slice(0,start)).length,quote_end=quote_start+Array.from(quote).length;
  const entry:SecIREntry={key:`quarter:${fiscal_year}:Q${quarter}`,title:`${source.ticker} ${fiscal_year} Q${quarter} earnings`,occurs_on,quote,timezone:null,location:`normalized-text[${quote_start}:${quote_end}]`,source_url:document.url,raw_sha256:document.raw_sha256};
  found.push({entry,detail:{source_url:document.url,raw_sha256:document.raw_sha256,accession:document.accession!,filing_date:document.filing_date!,normalized_text,issuer_label:match[1],quote_start,quote_end,period_text,fiscal_year,quarter,date_text}});
 }
 if(new Set(found.map(x=>`${x.entry.key}:${x.entry.occurs_on}`)).size>1)throw new CalendarError('ambiguous_sec_filing_event');
 return found[0]??null;
}

export function structuredIREntries(bytes:Uint8Array,url:string,raw_sha256:string,source:SecIRSource,window:{start:string;end:string}):{recognized:boolean;entries:SecIREntry[]}{
 const root=parseDocument(html(bytes)),entries:SecIREntry[]=[];let recognized=false;
 for(const [tableIndex,table] of elements(root,'table').entries()){
  const rows=elements(table,'tr'),headers=rows[0]?elements(rows[0],'th').map(x=>plain(x).toLowerCase().replace(/[^a-z]/g,'')):[];
  const yearIndex=headers.lastIndexOf('year'),quarterIndex=headers.indexOf('quarter'),dateIndex=headers.findIndex(x=>['earningsdate','earningscalldate','earningswebcastdate'].includes(x));
  if(yearIndex<0||quarterIndex<0||dateIndex<0)continue;
  recognized=true;const spans=new Map<number,{cell:Element;remaining:number}>();
  for(const [rowIndex,row] of rows.slice(1).entries()){
   const cells:Element[]=[];for(const [index,span] of spans){cells[index]=span.cell;if(--span.remaining===0)spans.delete(index);}
   let column=0;for(const cell of row.children.filter((n):n is Element=>'name' in n&&['td','th'].includes(n.name))){
    while(cells[column])column++;if(cell.attribs.colspan&&cell.attribs.colspan!=='1')throw new CalendarError('ambiguous_calendar_table');
    cells[column]=cell;const rowspan=Number(cell.attribs.rowspan??1);if(!Number.isInteger(rowspan)||rowspan<1||rowspan>20)throw new CalendarError('ambiguous_calendar_table');
    if(rowspan>1)spans.set(column,{cell,remaining:rowspan-1});column++;
   }
   if(!cells[yearIndex]||!cells[quarterIndex]||!cells[dateIndex])throw new CalendarError('incomplete_calendar_table');
   const year=plain(cells[yearIndex]),quarter=plain(cells[quarterIndex]),rawDate=plain(cells[dateIndex]);
   if(!/^\d{4}$/.test(year)||!/^Q[1-4]$/.test(quarter))throw new CalendarError('invalid_calendar_identity');
   // Empty/TBD dates are explicitly unknown; they must never become forecast events.
   if(!rawDate||/^(?:tbd|tba|to be announced|-)$/i.test(rawDate))continue;
   const occurs_on=explicitIRDate(rawDate);if(occurs_on<window.start||occurs_on>window.end)continue;
   const quote=`${year} ${quarter} ${rawDate}`;
   entries.push({key:`quarter:${year}:${quarter}`,title:`${source.ticker} ${year} ${quarter} earnings`,occurs_on,quote,timezone:null,location:`tables[${tableIndex}].rows[${rowIndex+1}].earnings-date`,source_url:url,raw_sha256});
  }
 }
 for(const [scriptIndex,node] of elements(root,'script').entries()){
  if(node.attribs.type!=='application/ld+json')continue;
  let data:unknown;try{data=JSON.parse(DomUtils.textContent(node));}catch{throw new CalendarError('invalid_event_schema');}
  const candidates=Array.isArray(data)?data:object(data)&&Array.isArray(data['@graph'])?data['@graph']:[data];
  for(const [index,item] of candidates.entries()){
   if(!object(item)||item['@type']!=='Event')continue;recognized=true;
   if(typeof item.name!=='string'||!item.name.trim()||item.name.length>200||typeof item.startDate!=='string')throw new CalendarError('invalid_event_schema');
   if(item.eventStatus&&item.eventStatus!=='https://schema.org/EventScheduled')throw new CalendarError('event_status_requires_review');
   const match=item.startDate.match(/^(\d{4}-\d{2}-\d{2})(?:T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d))?$/);
   if(!match)throw new CalendarError('ambiguous_date');const occurs_on=dateOnly(match[1]);
   if(occurs_on<window.start||occurs_on>window.end)continue;
   if(typeof item.url!=='string')throw new CalendarError('invalid_calendar_identity');const eventURL=publicIRURL(new URL(item.url,url).href);
   if(eventURL.origin!==new URL(url).origin)throw new CalendarError('invalid_calendar_identity');
   entries.push({key:`event:${eventURL.pathname}${eventURL.search}`,title:normalize(item.name),occurs_on,quote:`${normalize(item.name)} | ${item.startDate}`,timezone:null,location:`jsonld[${scriptIndex}].events[${index}]`,source_url:url,raw_sha256});
  }
 }
 if(entries.length>200||new Set(entries.map(e=>e.key)).size!==entries.length)throw new CalendarError('duplicate_calendar_identity');
 return {recognized,entries};
}

export async function collectSecIR(source:SecIRSource,today:string,contact:string,archive:Archive,fetcher:typeof fetch=fetch,officialFetch?:typeof fetch):Promise<{raw_sha:string;object_key:string;manifest_text:string;manifest:SecIRManifest}>{
 if(source.adapter!=='sec-ir'||source.provider!=='sec'||!/^\d{10}$/.test(source.provider_company_id)||source.key!==`sec-ir-${source.provider_company_id}`||source.url!==`https://www.sec.gov/edgar/browse/?CIK=${source.provider_company_id}`||!source.company_id||!source.ticker)throw new CalendarError('invalid_source_identity');
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact))throw new CalendarError('sec_contact_not_configured');
 const signal=AbortSignal.timeout(35000),documents:Doc[]=[],window=calendarWindow(today),loaded=new Map<string,{bytes:Uint8Array;doc:Doc}>();let bytesRead=0;
 const scopedFetch:typeof fetch=(input,init={})=>{
  const endpoint=publicIRURL(String(input));
  const selected=['www.sec.gov','data.sec.gov'].includes(endpoint.hostname)?fetcher:officialFetch;
  if(!selected)throw new CalendarError('official_ir_transport_unavailable');
  return selected(endpoint,{...init,signal:init.signal?AbortSignal.any([init.signal,signal]):signal});
 };
 const load=async(url:string,role:Doc['role'],parent_url?:string,accession?:string,filing_date?:string):Promise<{bytes:Uint8Array;doc:Doc}>=>{
  const endpoint=publicIRURL(url);
  const cached=loaded.get(endpoint.href);if(cached)return cached;
  const response=await scopedFetch(endpoint,{redirect:'error',signal,headers:{'User-Agent':`SignalBrief/0.4 ${contact}`,Accept:role==='submissions'?'application/json':'text/html,application/xhtml+xml'}});
  if(!response.ok){await response.body?.cancel();throw new CalendarError(`source_http_${response.status}`);}
  const contentType=response.headers.get('content-type')??'';if(role==='submissions'?!/^application\/json\b/i.test(contentType):!/^text\/html\b|^application\/xhtml\+xml\b/i.test(contentType))throw new CalendarError('invalid_content_type');
  const reader=response.body?.getReader();if(!reader)throw new CalendarError('empty_source');const chunks:Uint8Array[]=[];let length=0;
  while(true){const part=await reader.read();if(part.done)break;length+=part.value.length;bytesRead+=part.value.length;if(length>2000000||bytesRead>6000000){await reader.cancel();throw new CalendarError('source_too_large');}chunks.push(part.value);}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  const raw_sha256=await sha256(bytes),object_key=`calendar/${source.key}/discovery/${raw_sha256}.${role==='submissions'?'json':'html'}`;
  await archive(object_key,bytes,contentType);const doc:Doc={role,url:endpoint.href,raw_sha256,object_key,...(parent_url?{parent_url}:{}),...(accession?{accession}:{}),...(filing_date?{filing_date}:{})};documents.push(doc);const result={bytes,doc};loaded.set(endpoint.href,result);return result;
 };
 const submissions=await load(`https://data.sec.gov/submissions/CIK${source.provider_company_id}.json`,'submissions');
 let parsed:unknown;try{parsed=JSON.parse(html(submissions.bytes));}catch{throw new CalendarError('source_format_changed');}
 const data=issuer(parsed,source);let binding:Binding|null=null;
 if(typeof data.investorWebsite==='string'&&data.investorWebsite.trim()){
  const url=publicIRURL(data.investorWebsite.trim());binding={url:url.href,document_url:submissions.doc.url,quote:data.investorWebsite.trim(),location:'submissions.investorWebsite'};
 }
 if(!binding){
  const recent=object(data.filings)&&object(data.filings.recent)?data.filings.recent:null;
  if(!recent||!Array.isArray(recent.form)||!Array.isArray(recent.accessionNumber)||!Array.isArray(recent.primaryDocument)||!Array.isArray(recent.filingDate))throw new CalendarError('invalid_sec_directory');
  const candidates=recent.form.map((form,index)=>({form,index})).filter(x=>x.form==='8-K'||x.form==='6-K').slice(0,3);
  for(const {index} of candidates){
   const accession=recent.accessionNumber[index],primary=recent.primaryDocument[index],filing_date=recent.filingDate[index];
   if(typeof accession!=='string'||!/^\d{10}-\d{2}-\d{6}$/.test(accession)||typeof primary!=='string'||!/^[-A-Za-z0-9_.]+\.html?$/.test(primary)||typeof filing_date!=='string'||dateOnly(filing_date)>today)throw new CalendarError('invalid_sec_document');
   const url=secDocument(`https://www.sec.gov/Archives/edgar/data/${Number(source.provider_company_id)}/${accession.replaceAll('-','')}/${primary}`,source.provider_company_id).href;
   const document=await load(url,'primary',submissions.doc.url,accession,filing_date);binding=filedIRBinding(document.bytes,url);
   if(!binding)for(const exhibitURL of exhibits(document.bytes,url,source.provider_company_id)){
    const exhibit=await load(exhibitURL,'exhibit',url,accession,filing_date);binding=filedIRBinding(exhibit.bytes,exhibitURL);if(binding)break;
   }
   if(binding)break;
  }
 }
 if(!binding)throw new CalendarError('official_ir_link_not_found');
 const persist=async(manifest:SecIRManifest)=>{
  const manifest_text=JSON.stringify(manifest),bytes=new TextEncoder().encode(manifest_text);if(bytes.length>1000000)throw new CalendarError('source_too_large');
  const raw_sha=await sha256(bytes),object_key=`calendar/${source.key}/${raw_sha}.json`;
  await archive(object_key,bytes,'application/json');return {raw_sha,object_key,manifest_text,manifest};
 };
 try{
 const root=await load(binding.url,'ir',binding.document_url),issuer_name=String(data.name),issuer_evidence=[officialIRIdentity(root.bytes,binding.url,root.doc.raw_sha256,issuer_name)],selectedURL=eventPage(root.bytes,binding.url);
 const selected=selectedURL===binding.url?root:await load(selectedURL,'events',binding.url);
 if(selectedURL!==binding.url)issuer_evidence.push(officialIRIdentity(selected.bytes,selectedURL,selected.doc.raw_sha256,issuer_name));
 const structured=structuredIREntries(selected.bytes,selectedURL,selected.doc.raw_sha256,source,window);
 const isQ4=/\/js\/module\/widgets\/dist\/[^"'<>]*q4Api[^"'<>]*\.js/.test(html(selected.bytes));
 let format:SecIRManifest['format']='structured-html',entries=structured.entries,q4:Q4Manifest|undefined,q4_manifest:{raw_sha256:string;object_key:string}|undefined;
 if(isQ4){
  const q4Source={...source,adapter:'q4-events',url:selectedURL,feed_url:new URL('/feed/Event.svc/GetEventList',selectedURL).href};
  const result=await collectQ4(q4Source,today,archive,scopedFetch,'official-events');q4=result.manifest;q4_manifest={raw_sha256:result.raw_sha,object_key:result.object_key};format='q4';
  entries=q4.entries.map(entry=>{const page=Number(entry.location.match(/^pages\[(\d+)\]/)?.[1]);return {...entry,key:`q4:${entry.key}`,source_url:selectedURL,raw_sha256:q4!.pages[page].raw_sha256};});
 }else if(!structured.recognized)throw new CalendarError('official_calendar_format_unsupported');
 const manifest:SecIRManifest={schema:'signalbrief.calendar.sec-ir.v1',adapter:'sec-ir',source_key:source.key,source_url:source.url,company_id:source.company_id,provider:'sec',provider_company_id:source.provider_company_id,ticker:source.ticker,issuer_name,issuer_evidence,complete:true,window,documents,binding,event_source_url:selectedURL,format,...(q4?{q4,q4_manifest}:{}),entries};
 return await persist(manifest);
 }catch(error){
  if(!(error instanceof CalendarError)||!allowedFilingFallback.has(error.message)||signal.aborted)throw error;
  const recent=object(data.filings)&&object(data.filings.recent)?data.filings.recent:null;
  if(!recent||!Array.isArray(recent.form)||!Array.isArray(recent.accessionNumber)||!Array.isArray(recent.primaryDocument)||!Array.isArray(recent.filingDate))throw error;
  // Reuse the same three-filing/two-exhibit budget and already archived originals.
  for(const {form,index} of recent.form.map((form,index)=>({form,index})).filter(x=>x.form==='8-K'||x.form==='6-K').slice(0,3)){
   const accession=recent.accessionNumber[index],primary=recent.primaryDocument[index],filing_date=recent.filingDate[index];
   if(typeof accession!=='string'||!/^\d{10}-\d{2}-\d{6}$/.test(accession)||typeof primary!=='string'||!/^[-A-Za-z0-9_.]+\.html?$/.test(primary)||typeof filing_date!=='string'||dateOnly(filing_date)>today)throw new CalendarError('invalid_sec_document');
   const url=secDocument(`https://www.sec.gov/Archives/edgar/data/${Number(source.provider_company_id)}/${accession.replaceAll('-','')}/${primary}`,source.provider_company_id).href;
   const primaryDoc=await load(url,'primary',submissions.doc.url,accession,filing_date),candidates=[primaryDoc];
   for(const exhibitURL of exhibits(primaryDoc.bytes,url,source.provider_company_id))candidates.push(await load(exhibitURL,'exhibit',url,accession,filing_date));
   const announcements=candidates.map(document=>explicitSecFilingEvent(document.bytes,document.doc,source,String(data.name),window)).filter(value=>value!==null);
   if(new Set(announcements.map(value=>`${value.entry.key}:${value.entry.occurs_on}`)).size>1)throw new CalendarError('ambiguous_sec_filing_event');
   const selected=announcements[0];if(!selected)continue;
   const normalized=new TextEncoder().encode(selected.detail.normalized_text),normalized_sha256=await sha256(normalized),normalized_object_key=`calendar/${source.key}/normalized/${normalized_sha256}.txt`;
   await archive(normalized_object_key,normalized,'text/plain; charset=utf-8');
   const filing:SecFilingEvidence={...selected.detail,form_type:form as '8-K'|'6-K',normalized_sha256,normalized_object_key},entry=selected.entry;
   return await persist({schema:'signalbrief.calendar.sec-filing.v1',adapter:'sec-ir',source_key:source.key,source_url:source.url,company_id:source.company_id,provider:'sec',provider_company_id:source.provider_company_id,ticker:source.ticker,
    issuer_name:String(data.name),issuer_evidence:[],complete:false,coverage:'explicit-sec-announcement',fallback_reason:error.message,window,
    documents:documents.filter(document=>['submissions','primary','exhibit'].includes(document.role)),
    binding:{url:entry.source_url,document_url:entry.source_url,quote:entry.quote,location:entry.location},event_source_url:entry.source_url,format:'sec-filing',filing,entries:[entry]});
  }
  throw error;
 }
}
