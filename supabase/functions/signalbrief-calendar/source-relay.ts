import {CalendarError} from './core.ts';
import {publicIRURL} from './public-source.ts';

export const CALENDAR_SOURCE_RELAY='https://signalbrief.online/api/internal/calendar-source';
const hex=(bytes:Uint8Array)=>[...bytes].map(value=>value.toString(16).padStart(2,'0')).join('');

/** Only authenticated server work can reach the Node transport's pinned public socket. */
export function createCalendarSourceFetch(secret:string,request:typeof fetch=fetch):typeof fetch{
 if(!/^[a-f0-9]{64}$/.test(secret))throw new CalendarError('calendar_relay_not_configured');
 return async(input,init={})=>{
  if(input instanceof Request||init.method&&init.method!=='GET'||init.body)throw new CalendarError('invalid_calendar_source_request');
  const url=publicIRURL(String(input));
  const nonce=hex(crypto.getRandomValues(new Uint8Array(32))),timestamp=String(Date.now());
  const body=JSON.stringify({kind:'calendar_source',url:url.href,nonce});
  if(new TextEncoder().encode(body).length>4096)throw new CalendarError('invalid_calendar_source_request');
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const signature=hex(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(timestamp+'\n'+body))));
  try{
   const signal=AbortSignal.timeout(12000);
   const response=await request(CALENDAR_SOURCE_RELAY,{method:'POST',redirect:'error',credentials:'omit',
    headers:{'Content-Type':'application/json','x-sb-timestamp':timestamp,'x-sb-signature':signature},body,
    signal:init.signal?AbortSignal.any([init.signal,signal]):signal});
   if(!response.ok){await response.body?.cancel();throw new CalendarError(response.status===401?'calendar_relay_unauthorized':'calendar_relay_upstream_failed');}
   const type=response.headers.get('content-type')??'';
   if(!/^(?:text\/html|application\/(?:xhtml\+xml|json))(?:\s*;|$)/i.test(type))throw new CalendarError('invalid_content_type');
   const reader=response.body?.getReader();if(!reader)throw new CalendarError('empty_source');
   const chunks:Uint8Array[]=[];let size=0;
   while(true){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>2_000_000){await reader.cancel();throw new CalendarError('source_too_large');}chunks.push(next.value);}
   const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
   return new Response(bytes,{headers:{'Content-Type':type,'Cache-Control':'no-store'}});
  }catch(error){if(error instanceof CalendarError)throw error;throw new CalendarError('calendar_relay_network_failed');}
 };
}
