import {timingSafeEqual} from 'node:crypto';
import {lookup as dnsLookup} from 'node:dns/promises';
import type {LookupAddress} from 'node:dns';
import {request as httpsRequest} from 'node:https';
import type {RequestOptions} from 'node:https';
import {isIP,type LookupFunction} from 'node:net';
import {relaySignature} from './dart-relay';
import {publicIRURL,publicAddress} from '../../../../supabase/functions/signalbrief-calendar/public-source';

export type CalendarSourcePayload={kind:'calendar_source';url:string;nonce:string};
export const CALENDAR_SOURCE_MAX_BYTES=2_000_000;
export const CALENDAR_SOURCE_TIMEOUT_MS=10_000;
type Resolver=(hostname:string)=>Promise<LookupAddress[]>;
type DownloadOptions={resolve?:Resolver;request?:typeof httpsRequest;signal?:AbortSignal};
const failure=(code:string)=>new Error(code);

export function verifyCalendarSource(body:string,timestamp:string,signature:string,secret:string,now=Date.now()):CalendarSourcePayload{
 if(secret.length<64||!/^\d{13}$/.test(timestamp)||Math.abs(now-Number(timestamp))>60_000
  ||!(/^[a-f0-9]{64}$/).test(signature)||Buffer.byteLength(body)>4096)throw failure('relay_unauthorized');
 if(!timingSafeEqual(Buffer.from(signature,'hex'),Buffer.from(relaySignature(body,timestamp,secret),'hex')))throw failure('relay_unauthorized');
 let value:unknown;try{value=JSON.parse(body);}catch{throw failure('relay_invalid_request');}
 if(!value||typeof value!=='object'||Array.isArray(value))throw failure('relay_invalid_request');
 const payload=value as Record<string,unknown>;
 if(Object.keys(payload).some(key=>!['kind','url','nonce'].includes(key))||payload.kind!=='calendar_source'
  ||typeof payload.nonce!=='string'||!(/^[a-f0-9]{64}$/).test(payload.nonce)||typeof payload.url!=='string')throw failure('relay_invalid_request');
 try{calendarURL(payload.url);}catch{throw failure('relay_invalid_request');}
 return payload as CalendarSourcePayload;
}

function calendarURL(value:string):URL{
 // URL parsing must not silently remove whitespace, credentials or a default port.
 if(/[\s\u0000-\u001f\u007f]/.test(value))throw failure('source_url_invalid');
 const url=publicIRURL(value);if(url.href!==value)throw failure('source_url_invalid');return url;
}

function resolveBounded(hostname:string,resolve:Resolver,signal:AbortSignal):Promise<LookupAddress[]>{
 return new Promise((accept,reject)=>{
  const aborted=()=>reject(failure('source_timeout'));
  if(signal.aborted){aborted();return;}
  signal.addEventListener('abort',aborted,{once:true});
  Promise.resolve().then(()=>resolve(hostname)).then(accept,()=>reject(failure('source_dns_failed')))
   .finally(()=>signal.removeEventListener('abort',aborted));
 });
}

/** A new HTTPS socket uses only the address already verified here. No second DNS lookup. */
export async function downloadCalendarSource(value:string|URL,options:DownloadOptions={}):Promise<{bytes:Buffer;type:string}>{
 const url=calendarURL(typeof value==='string'?value:value.href),deadline=new AbortController();
 const timer=setTimeout(()=>deadline.abort(),CALENDAR_SOURCE_TIMEOUT_MS);
 const signal=options.signal?AbortSignal.any([options.signal,deadline.signal]):deadline.signal;
 try{
  const addresses=await resolveBounded(url.hostname,options.resolve??(hostname=>dnsLookup(hostname,{all:true,verbatim:true})),signal);
  if(signal.aborted)throw failure('source_timeout');
  if(!Array.isArray(addresses)||addresses.length<1||addresses.length>32||addresses.some(record=>
   !record||typeof record.address!=='string'||![4,6].includes(record.family)||isIP(record.address)!==record.family||!publicAddress(record.address)))throw failure('source_non_public_address');
  // Prefer IPv4 when both are available; never retry with a newly resolved address.
  const candidate=addresses.find(record=>record.family===4)??addresses[0];
  const selected={address:candidate.address,family:candidate.family};
  const lookup:LookupFunction=(hostname,settings,callback)=>{
   if(hostname!==url.hostname){callback(failure('source_hostname_mismatch'),'',0);return;}
   if(settings.all)callback(null,[selected]);else callback(null,selected.address,selected.family);
  };
  return await new Promise((accept,reject)=>{
   let settled=false;
   const finish=(error:Error|null,result?:{bytes:Buffer;type:string})=>{
    if(settled)return;settled=true;signal.removeEventListener('abort',abort);
    if(error)reject(error);else accept(result!);
   };
   const abort=()=>{request.destroy();finish(failure('source_timeout'));};
   const connection:RequestOptions&{autoSelectFamily:false}={
    method:'GET',agent:false,lookup,family:selected.family,autoSelectFamily:false,
    servername:url.hostname,rejectUnauthorized:true,minVersion:'TLSv1.2',
    headers:{Accept:'text/html,application/xhtml+xml,application/json','Accept-Encoding':'identity','User-Agent':'SignalBrief/0.4 (+https://signalbrief.online)'},
   };
   const request=(options.request??httpsRequest)(url,connection,response=>{
    if(response.statusCode!==200){response.destroy();finish(failure('source_http_error'));return;}
    const type=response.headers['content-type'],encoding=response.headers['content-encoding'];
    if(typeof type!=='string'||!(/^(?:text\/html|application\/xhtml\+xml|application\/json)(?:\s*;\s*charset=(?:"[a-z0-9._-]{1,40}"|[a-z0-9._-]{1,40}))?\s*$/i).test(type)
     ||encoding!==undefined&&encoding!=='identity'){response.destroy();finish(failure('source_content_type_invalid'));return;}
    const length=response.headers['content-length'];
    if(length!==undefined&&(!/^\d+$/.test(length)||Number(length)>CALENDAR_SOURCE_MAX_BYTES)){response.destroy();finish(failure('source_too_large'));return;}
    const chunks:Buffer[]=[];let count=0;
    response.on('data',(chunk:Buffer)=>{
     count+=chunk.length;if(count>CALENDAR_SOURCE_MAX_BYTES){response.destroy();finish(failure('source_too_large'));return;}
     chunks.push(chunk);
    });
    response.on('error',()=>finish(failure('source_interrupted')));
    response.on('aborted',()=>finish(failure('source_interrupted')));
    response.on('end',()=>{
     if(!response.complete||count===0||length!==undefined&&count!==Number(length)){finish(failure('source_interrupted'));return;}
     finish(null,{bytes:Buffer.concat(chunks),type});
    });
   });
   request.on('error',()=>finish(failure(signal.aborted?'source_timeout':'source_transport_failed')));
   signal.addEventListener('abort',abort,{once:true});
   if(signal.aborted){abort();return;}
   request.end();
  });
 }finally{clearTimeout(timer);}
}
