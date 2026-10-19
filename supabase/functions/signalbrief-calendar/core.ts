export type Source = {key:string; ticker:string; market:string; url:string; adapter:string};
export type Entry = {key:string; title:string; occurs_on:string; quote:string; timezone:string; location:string};
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
  // Only explicit dt/dd pairs in the Upcoming Events area; never infer a year or a range.
  const upcoming=html.split('Upcoming Events</h2>')[1]?.split('ir-event-wrap__past')[0];
  if(!upcoming)throw new CalendarError('source_format_changed');
  const pairs=[...upcoming.matchAll(/<dl class="ir-event-list__detail">\s*<dt>([\s\S]*?)<\/dt>\s*<dd>([\s\S]*?)<\/dd>/g)];
  if(!pairs.length)throw new CalendarError('no_confirmed_dates');
  for(const [index,[,rawTitle,rawDate]] of pairs.entries()){
   const title=normalize(rawTitle),displayDate=normalize(rawDate),match=displayDate.match(/^([A-Z][a-z]+) (\d{1,2}), (\d{4})(?:, .* KST)?$/);
   if(!match||!months.includes(match[1]))throw new CalendarError('ambiguous_date');
   const date=dateOnly(`${match[3]}-${String(months.indexOf(match[1])+1).padStart(2,'0')}-${match[2].padStart(2,'0')}`);
   const quote=`${title} ${displayDate}`;
   if(!textParts[0].includes(quote))throw new CalendarError('quote_not_found');
   entries.push({key:title.toLowerCase().replace(/\s+/g,' '),title:`Samsung Electronics · ${title}`,occurs_on:date,quote,timezone:'Asia/Seoul',location:`Upcoming Events/dl.ir-event-list__detail[${index}]`});
  }
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
