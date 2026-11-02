import {CalendarError,dateOnly,sha256,type Entry,type Source} from './core.ts';

export const MICRON_EVENTS_URL='https://investors.micron.com/events-and-presentations/';
const FEED_URL='https://investors.micron.com/feed/Event.svc/GetEventList';
const PAGE_SIZE=100,MAX_PAGES=10,MAX_PAGE_BYTES=1000000,MAX_TOTAL_BYTES=4000000;
export type CalendarArchive=(path:string,bytes:Uint8Array,contentType:string)=>Promise<void>;
type Page={url:string;page_number:number;raw_sha256:string;object_key:string;count:number};
export type Q4Manifest={
 schema:'signalbrief.calendar.q4.v1';source_key:string;source_url:string;adapter:string;
 company_id?:string;provider?:string;provider_company_id?:string;ticker?:string;
 tag_policy?:'official-events';
 complete:true;page_size:number;window:{start:string;end:string};pages:Page[];entries:Entry[];
};
const record=(value:unknown):value is Record<string,unknown>=>typeof value==='object'&&value!==null&&!Array.isArray(value);

export function micronFeedUrl(page:number):string{
 return q4FeedUrl(FEED_URL,page);
}
export function q4FeedUrl(feed:string,page:number):string{
 if(!Number.isInteger(page)||page<0||page>=MAX_PAGES)throw new CalendarError('invalid_page');
 const url=new URL(feed);
 url.search=new URLSearchParams({LanguageId:'1',eventSelection:'3',eventDateFilter:'3',includeFinancialReports:'false',includePresentations:'false',includePressReleases:'false',sortOperator:'1',pageSize:String(PAGE_SIZE),pageNumber:String(page),tagList:'',includeTags:'true',year:'-1',excludeSelection:'1'}).toString();
 return url.href;
}

export function calendarWindow(today:string):{start:string;end:string}{
 dateOnly(today);
 const start=new Date(today+'T00:00:00Z'),end=new Date(today+'T00:00:00Z');
 start.setUTCDate(start.getUTCDate()-90);
 const day=end.getUTCDate();end.setUTCDate(1);end.setUTCMonth(end.getUTCMonth()+18);
 const lastDay=new Date(Date.UTC(end.getUTCFullYear(),end.getUTCMonth()+1,0)).getUTCDate();end.setUTCDate(Math.min(day,lastDay));
 return {start:start.toISOString().slice(0,10),end:end.toISOString().slice(0,10)};
}

function sourceDate(value:unknown):{day:string;local:string}{
 if(typeof value!=='string')throw new CalendarError('ambiguous_date');
 const match=value.match(/^(\d{2})\/(\d{2})\/(\d{4}) ([01]\d|2[0-3]):([0-5]\d):([0-5]\d)$/);
 if(!match)throw new CalendarError('ambiguous_date');
 const day=dateOnly(`${match[3]}-${match[1]}-${match[2]}`);
 return {day,local:`${day}T${match[4]}:${match[5]}:${match[6]}`};
}

export function parseMicronPage(bytes:Uint8Array,page:number,window:{start:string;end:string},policy:'webcast'|'official-events'='webcast'):{ids:string[];entries:Entry[];count:number}{
 let data:unknown;
 try{data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new CalendarError('source_format_changed');}
 if(!record(data)||!Array.isArray(data.GetEventListResult)||data.GetEventListResult.length>PAGE_SIZE)throw new CalendarError('source_format_changed');
 const ids:string[]=[],entries:Entry[]=[];
 for(const [index,row] of data.GetEventListResult.entries()){
  if(!record(row)||!Number.isSafeInteger(row.EventId)||Number(row.EventId)<=0||!Array.isArray(row.TagsList)||row.TagsList.some(tag=>typeof tag!=='string'))throw new CalendarError('source_format_changed');
  const id=String(row.EventId);ids.push(id);
  // The issuer's own event classification is required. Publication-only risk-factor rows are not calendar events.
  if(row.TagsList.includes('risk-factor')||policy==='webcast'&&!row.TagsList.includes('webcast'))continue;
  if(policy==='official-events'&&(typeof row.LinkToDetailPage!=='string'||!/^\/[^/]/.test(row.LinkToDetailPage)||row.LinkToDetailPage.length>1000))throw new CalendarError('invalid_event');
  if(typeof row.Title!=='string')throw new CalendarError('invalid_event');
  const title=row.Title.trim();
  if(title.length===0||title.length>200||/[\u0000-\u001f]/.test(title))throw new CalendarError('invalid_event');
  const start=sourceDate(row.StartDate),end=sourceDate(row.EndDate);
  if(end.local<start.local)throw new CalendarError('conflicting_dates');
  if(start.day<window.start||start.day>window.end)continue;
  const zones:Record<string,string>={ET:'America/New_York',EDT:'America/New_York',EST:'America/New_York',PT:'America/Los_Angeles',PDT:'America/Los_Angeles',PST:'America/Los_Angeles',MT:'America/Denver',MDT:'America/Denver',MST:'America/Denver',CT:'America/Chicago',CDT:'America/Chicago',CST:'America/Chicago'};
  if(typeof row.TimeZone!=='string'||!zones[row.TimeZone])throw new CalendarError('unknown_timezone');
  // Preserve the explicit local clock and zone in the quote; the calendar's existing date-only contract makes no UTC/all-day inference.
  entries.push({key:id,title,occurs_on:start.day,quote:`${title} | ${row.StartDate} ${row.TimeZone}`,timezone:zones[row.TimeZone],location:`pages[${page}].GetEventListResult[${index}]`});
 }
 return {ids,entries,count:data.GetEventListResult.length};
}

async function fetchPage(url:string,fetcher:typeof fetch,signal:AbortSignal):Promise<Uint8Array>{
 const response=await fetcher(url,{redirect:'error',signal,headers:{Accept:'application/json','User-Agent':'SignalBrief/1.0 (official IR calendar; signalbrief.online)'}});
 if(!response.ok)throw new CalendarError(`source_http_${response.status}`);
 if(!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')??''))throw new CalendarError('invalid_content_type');
 const reader=response.body?.getReader();if(!reader)throw new CalendarError('empty_source');
 const chunks:Uint8Array[]=[];let size=0;
 while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>MAX_PAGE_BYTES){await reader.cancel();throw new CalendarError('source_too_large');}chunks.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
}

export async function collectMicronQ4(source:Source,today:string,archive:CalendarArchive,fetcher:typeof fetch=fetch):Promise<{raw_sha:string;object_key:string;manifest_text:string;manifest:Q4Manifest}>{
 if(source.key!=='micron-ir'||source.adapter!=='micron-q4'||source.ticker!=='MU'||source.url!==MICRON_EVENTS_URL)throw new CalendarError('invalid_source_url');
 return collectQ4({...source,feed_url:FEED_URL},today,archive,fetcher);
}

/** Source/issuer binding comes only from the private reviewed registry, never a request URL. */
export async function collectQ4(source:Source,today:string,archive:CalendarArchive,fetcher:typeof fetch=fetch,policy:'webcast'|'official-events'='webcast'):Promise<{raw_sha:string;object_key:string;manifest_text:string;manifest:Q4Manifest}>{
 let feed:URL,origin:URL;
 try{feed=new URL(source.feed_url??'');origin=new URL(source.url);}catch{throw new CalendarError('invalid_source_url');}
 if(!['micron-q4','q4-events'].includes(source.adapter)||feed.protocol!=='https:'||feed.origin!==origin.origin||origin.protocol!=='https:'
  ||feed.username||feed.password||origin.username||origin.password||feed.port||feed.search||feed.hash
  ||feed.pathname!=='/feed/Event.svc/GetEventList'||!/[a-z]/i.test(feed.hostname)||!feed.hostname.includes('.')
  ||/^(?:localhost|127\.|0\.|10\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(feed.hostname)
  ||/\.(?:localhost|local|internal)$/.test(feed.hostname))throw new CalendarError('invalid_source_url');
 const window=calendarWindow(today),pages:Page[]=[],entries:Entry[]=[],seen=new Set<string>(),signal=AbortSignal.timeout(30000);
 let totalBytes=0,complete=false,shortPage=false;
 for(let page=0;page<MAX_PAGES;page++){
  const url=q4FeedUrl(feed.href,page),bytes=await fetchPage(url,fetcher,signal);
  totalBytes+=bytes.length;if(totalBytes>MAX_TOTAL_BYTES)throw new CalendarError('source_too_large');
  const hash=await sha256(bytes),path=`calendar/${source.key}/pages/${hash}.json`;
  // Keep exact original bytes, including the terminal empty page. Failure here must prevent ingestion/withdrawal.
  await archive(path,bytes,'application/json');
  const parsed=parseMicronPage(bytes,page,window,policy);
  // This all-years feed contains published history. An empty catalog is a source anomaly,
  // unlike a nonempty historical catalog with no eligible events in our current window.
  if(page===0&&parsed.count===0)throw new CalendarError('unexpected_empty_catalog');
  if(shortPage&&parsed.count!==0)throw new CalendarError('incomplete_pagination');
  for(const id of parsed.ids){if(seen.has(id))throw new CalendarError('duplicate_calendar_identity');seen.add(id);}
  entries.push(...parsed.entries);if(entries.length>200)throw new CalendarError('too_many_calendar_entries');
  pages.push({url,page_number:page,raw_sha256:hash,object_key:path,count:parsed.count});
  if(parsed.count===0){complete=true;break;}
  shortPage=parsed.count<PAGE_SIZE;
 }
 if(!complete)throw new CalendarError('incomplete_pagination');
 const manifest:Q4Manifest={schema:'signalbrief.calendar.q4.v1',source_key:source.key,source_url:source.url,adapter:source.adapter,company_id:source.company_id,provider:source.provider,provider_company_id:source.provider_company_id,ticker:source.ticker,...(policy==='official-events'?{tag_policy:policy}:{}),complete:true,page_size:PAGE_SIZE,window,pages,entries};
 const manifest_text=JSON.stringify(manifest),bytes=new TextEncoder().encode(manifest_text),raw_sha=await sha256(bytes),object_key=`calendar/${source.key}/${raw_sha}.json`;
 await archive(object_key,bytes,'application/json');
 return {raw_sha,object_key,manifest_text,manifest};
}
