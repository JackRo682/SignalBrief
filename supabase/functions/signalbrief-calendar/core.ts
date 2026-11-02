export type Source = {key:string; ticker:string; market:string; url:string; adapter:string;company_id?:string;provider?:'sec'|'dart';provider_company_id?:string;feed_url?:string};
export type Entry = {key:string; title:string; occurs_on:string; quote:string; timezone:string|null; location:string;source_url?:string;body_sha256?:string;source_title?:string;source_date?:string;ends_on?:string};
export class CalendarError extends Error {}
export const sha256=async(bytes:Uint8Array)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes)))].map(x=>x.toString(16).padStart(2,'0')).join('');
export function decode(text:string):string {
 return text.replace(/&#(x[0-9a-f]+|[0-9]+);|&(quot|apos|amp|lt|gt|nbsp);/gi,(_,n,name)=>n?String.fromCodePoint(Number.parseInt(n.replace(/^x/i,''),/^x/i.test(n)?16:10)):({quot:'"',apos:"'",amp:'&',lt:'<',gt:'>',nbsp:' '}[name.toLowerCase() as 'amp']));
}
export const normalize=(html:string)=>decode(html.replace(/<!--[\s\S]*?-->/g,'').replace(/<script\b[\s\S]*?<\/script>/gi,'').replace(/<style\b[\s\S]*?<\/style>/gi,'').replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim();
export function dateOnly(value:string):string {
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T00:00:00Z'))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)throw new CalendarError('invalid_date');
 return value;
}
const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
function samsungDate(value:string):{start:string;end?:string} {
 const month='([A-Z][a-z]+)',day='(\\d{1,2})',year='(\\d{4})';
 const iso=(m:string,d:string,y:string)=>{
  const index=months.findIndex(name=>name===m||name.slice(0,3)===m);
  if(index<0)throw new CalendarError('ambiguous_date');
  return dateOnly(`${y}-${String(index+1).padStart(2,'0')}-${d.padStart(2,'0')}`);
 };
 const single=value.match(new RegExp(`^${month} ${day}, ${year}(?:, (?:[1-9]|1[0-2]):[0-5][0-9] [ap]\\.m\\. KST)?$`));
 if(single)return {start:iso(single[1],single[2],single[3])};
 const full=value.match(new RegExp(`^${month} ${day}, ${year}\\s*[~–-]\\s*${month} ${day}, ${year}$`));
 const shared=value.match(new RegExp(`^${month} ${day}\\s*[~–-]\\s*(?:${month} )?${day}, ${year}$`));
 let start:string,end:string;
 if(full){start=iso(full[1],full[2],full[3]);end=iso(full[4],full[5],full[6]);}
 else if(shared){start=iso(shared[1],shared[2],shared[5]);end=iso(shared[3]??shared[1],shared[4],shared[5]);}
 else throw new CalendarError('ambiguous_date');
 if(end<=start)throw new CalendarError('ambiguous_date');
 return {start,end};
}
function samsungEntries(html:string,text:string,today:string):Entry[] {
 const upcoming=[...html.matchAll(/<h2\b[^>]*>\s*Upcoming Events\s*<\/h2>/gi)];
 const past=[...html.matchAll(/<section\b[^>]*class="[^"]*\bir-event-wrap__past\b[^"]*"[^>]*>/gi)];
 if(upcoming.length!==1||past.length!==1||past[0].index!<upcoming[0].index!)throw new CalendarError('source_format_changed');
 const pastEnd=html.indexOf('</section>',past[0].index);
 if(pastEnd<0)throw new CalendarError('source_format_changed');
 const history=html.slice(past[0].index,pastEnd);
 const years=[...history.matchAll(/<strong\b[^>]*class="[^"]*\bir-expand__title\b[^"]*"[^>]*>\s*(\d{4})\s*<\/strong>/g)];
 if(!years.length||new Set(years.map(x=>x[1])).size!==years.length)throw new CalendarError('source_format_changed');
 const start=new Date(dateOnly(today)+'T00:00:00Z');start.setUTCDate(start.getUTCDate()-90);
 const end=new Date(today+'T00:00:00Z');end.setUTCMonth(end.getUTCMonth()+18);
 const sections=[{label:'Upcoming Events',body:html.slice(upcoming[0].index!+upcoming[0][0].length,past[0].index),year:undefined as string|undefined}];
 if(/<dl\b[^>]*class="[^"]*\bir-event-list__detail\b/.test(history.slice(0,years[0].index)))throw new CalendarError('source_format_changed');
 for(const [index,group] of years.entries()){
  if(Number(group[1])<start.getUTCFullYear()||Number(group[1])>end.getUTCFullYear())continue;
  sections.push({label:`Past Events/${group[1]}`,body:history.slice(group.index!+group[0].length,years[index+1]?.index??history.length),year:group[1]});
 }
 const entries:Entry[]=[];
 for(const section of sections){
  const pairs=[...section.body.matchAll(/<dl\b[^>]*class="[^"]*\bir-event-list__detail\b[^"]*"[^>]*>\s*<dt>([\s\S]*?)<\/dt>\s*<dd>([\s\S]*?)<\/dd>\s*<\/dl>/g)];
  if(pairs.length!==[...section.body.matchAll(/<dl\b[^>]*class="[^"]*\bir-event-list__detail\b/g)].length)throw new CalendarError('source_format_changed');
  for(const [index,[,rawTitle,rawDate]] of pairs.entries()){
   const title=normalize(rawTitle),displayDate=normalize(rawDate),date=samsungDate(displayDate);
   if(section.year&&date.start.slice(0,4)!==section.year)throw new CalendarError('ambiguous_date');
   const quote=`${title} ${displayDate}`;
   if(!title||!text.includes(quote))throw new CalendarError('quote_not_found');
   const legacy=title.toLowerCase().replace(/\s+/g,' ');
   entries.push({key:`date:${date.start}:${legacy}`,title:`Samsung Electronics · ${title}${date.end?` · 기간 시작 (${displayDate})`:''}`,
    occurs_on:date.start,quote,timezone:'Asia/Seoul',location:`${section.label}/dl.ir-event-list__detail[${index}]`,
    source_title:title,source_date:displayDate,...(date.end?{ends_on:date.end}:{})});
  }
 }
 return entries;
}
export function parseSource(source:Source,html:string,today:string):{entries:Entry[]; text:string} {
 html=html.replace(/<!--[\s\S]*?-->/g,'').replace(/<script\b[\s\S]*?<\/script>/gi,'');
 let entries:Entry[]=[];const textParts=[normalize(html)];
 if(source.adapter==='microsoft') {
  const encoded=html.match(/\beventsData="([^"]+)"/i)?.[1];
  if(!encoded)throw new CalendarError('source_format_changed');
  let data;try{data=JSON.parse(decode(encoded));}catch{throw new CalendarError('source_format_changed');}
  if(!Array.isArray(data.Events))throw new CalendarError('source_format_changed');
  for(const [index,item] of data.Events.entries()){
   const zones:Record<string,string>={PT:'America/Los_Angeles',ET:'America/New_York',MT:'America/Denver',CT:'America/Chicago'};
   if(!item.EventID||!item.EventName||!item.DateTime?.Local||!zones[item.DateTime.TimeZone])throw new CalendarError('source_format_changed');
   const date=dateOnly(item.DateTime.Local.slice(0,10));
   const quote=`${item.EventName} | ${item.DateTime.Local} ${item.DateTime.TimeZone}`;
   textParts.push(quote);
   entries.push({key:String(item.EventID),title:item.EventName,occurs_on:date,quote,timezone:zones[item.DateTime.TimeZone],location:`eventsData.Events[${index}]`});
  }
 }else if(source.adapter==='samsung'){
  // The upcoming section is month-scoped. History remains evidence after month rollover;
  // a published range is one clearly labelled start, never synthetic daily occurrences.
  entries=samsungEntries(html,textParts[0],today);
 }else throw new CalendarError('unsupported_source');
 const seen=new Map<string,Entry>();
 for(const item of entries){
  if(item.title.length>200||!item.key||item.key.length>200)throw new CalendarError('invalid_event');
  const old=seen.get(item.key);if(old&&(old.occurs_on!==item.occurs_on||old.title!==item.title||old.quote!==item.quote||old.timezone!==item.timezone))throw new CalendarError('conflicting_dates');
  seen.set(item.key,item);
 }
 // Keep recent history and at most 18 months of explicitly announced dates.
 const start=new Date(today+'T00:00:00Z');start.setUTCDate(start.getUTCDate()-90);
 const end=new Date(today+'T00:00:00Z');end.setUTCMonth(end.getUTCMonth()+18);
 entries=[...seen.values()].filter(x=>x.occurs_on>=start.toISOString().slice(0,10)&&x.occurs_on<=end.toISOString().slice(0,10));
 return {entries,text:textParts.join('\n')};
}
export async function fetchSource(source:Source,fetcher:typeof fetch=fetch):Promise<Uint8Array>{
 const url=new URL(source.url);
 if(url.protocol!=='https:'||url.username||url.password||!['www.microsoft.com','www.samsung.com'].includes(url.hostname))throw new CalendarError('invalid_source_url');
 const response=await fetcher(url,{redirect:'error',signal:AbortSignal.timeout(20000),headers:{Accept:'text/html','User-Agent':'SignalBrief/1.0 (official IR calendar; signalbrief.online)'}});
 if(!response.ok)throw new CalendarError(`source_http_${response.status}`);
 if(!response.headers.get('content-type')?.includes('text/html'))throw new CalendarError('invalid_content_type');
 const reader=response.body?.getReader();if(!reader)throw new CalendarError('empty_source');
 const chunks:Uint8Array[]=[];let size=0;
 while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>2000000){await reader.cancel();throw new CalendarError('source_too_large');}chunks.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
}
