import {createHmac,timingSafeEqual} from 'node:crypto';
import {request as httpsRequest} from 'node:https';
import type {DirectoryParsePayload} from './dart-directory-archive';
import type {ProfileParsePayload} from './dart-profile-archive';

export type DartRelayPayload={kind:'list'|'periodic_list'|'document'|'company'|'directory'|'financials';key:string;nonce:string;corp_code?:string;page?:number;receipt?:string;bgn_de?:string;end_de?:string;bsns_year?:string;reprt_code?:string};
export function relaySignature(body:string,timestamp:string,secret:string):string {
 return createHmac('sha256',secret).update(timestamp+'\n'+body).digest('hex');
}
export function verifyRelay(body:string,timestamp:string,signature:string,secret:string,now=Date.now()):DartRelayPayload|DirectoryParsePayload|ProfileParsePayload {
 if(secret.length<64||!/^\d{13}$/.test(timestamp)||Math.abs(now-Number(timestamp))>60000||!/^([a-f0-9]{64})$/.test(signature)||body.length>4096)throw new Error('relay_unauthorized');
 if(!timingSafeEqual(Buffer.from(signature,'hex'),Buffer.from(relaySignature(body,timestamp,secret),'hex')))throw new Error('relay_unauthorized');
 let value:DartRelayPayload|DirectoryParsePayload|ProfileParsePayload;try{value=JSON.parse(body);}catch{throw new Error('relay_invalid_request');}
 if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.nonce!=='string'||!/^([a-f0-9]{64})$/.test(value.nonce))throw new Error('relay_invalid_request');
 if(value.kind==='directory_parse'){
  if(Object.keys(value).some(k=>!['kind','source_url','sha','nonce'].includes(k))||typeof value.source_url!=='string'||value.source_url.length>3584||typeof value.sha!=='string'||!/^([a-f0-9]{64})$/.test(value.sha))throw new Error('relay_invalid_request');
  return value;
 }
 if(value.kind==='profile_parse'){
  if(Object.keys(value).some(k=>!['kind','source_url','sha','nonce','corp_code','ticker','receipt','company_name','report_name'].includes(k))||typeof value.source_url!=='string'||value.source_url.length>3584||typeof value.sha!=='string'||!/^([a-f0-9]{64})$/.test(value.sha)||typeof value.corp_code!=='string'||!/^\d{8}$/.test(value.corp_code)||typeof value.ticker!=='string'||!/^[A-Z0-9]{6}$/.test(value.ticker)||typeof value.receipt!=='string'||!/^\d{14}$/.test(value.receipt)||typeof value.company_name!=='string'||!value.company_name.trim()||value.company_name.length>200||typeof value.report_name!=='string'||!['사업보고서','반기보고서','분기보고서'].includes(value.report_name))throw new Error('relay_invalid_request');
  return value;
 }
 if(typeof value.key!=='string'||!/^([a-f0-9]{40})$/i.test(value.key))throw new Error('relay_invalid_request');
 dartEndpoint(value);return value;
}
export function dartEndpoint(p:DartRelayPayload):URL {
 const url=new URL('https://opendart.fss.or.kr/api/'+(['list','periodic_list'].includes(p.kind)?'list.json':p.kind==='company'?'company.json':p.kind==='financials'?'fnlttSinglAcnt.json':p.kind==='directory'?'corpCode.xml':'document.xml'));
 if(p.kind==='directory'){
  if(Object.keys(p).some(k=>!['kind','key','nonce'].includes(k)))throw new Error('relay_invalid_request');
 }else if(p.kind==='financials'){
  if(Object.keys(p).some(k=>!['kind','key','nonce','corp_code','bsns_year','reprt_code'].includes(k))||typeof p.corp_code!=='string'||!/^\d{8}$/.test(p.corp_code)||typeof p.bsns_year!=='string'||!/^20\d{2}$/.test(p.bsns_year)||Number(p.bsns_year)<2015||Number(p.bsns_year)>new Date().getUTCFullYear()||typeof p.reprt_code!=='string'||!['11011','11012','11013','11014'].includes(p.reprt_code))throw new Error('relay_invalid_request');
  for(const [k,v] of Object.entries({corp_code:p.corp_code,bsns_year:p.bsns_year,reprt_code:p.reprt_code}))url.searchParams.set(k,v);
 }else if(p.kind==='company'){
  if(!/^\d{8}$/.test(p.corp_code??''))throw new Error('relay_invalid_request');
  url.searchParams.set('corp_code',p.corp_code!);
 }else if(p.kind==='periodic_list'){
  if(Object.keys(p).some(k=>!['kind','key','nonce','corp_code','bgn_de','end_de'].includes(k))||typeof p.corp_code!=='string'||!/^\d{8}$/.test(p.corp_code)||typeof p.bgn_de!=='string'||!/^\d{8}$/.test(p.bgn_de)||typeof p.end_de!=='string'||!/^\d{8}$/.test(p.end_de)||p.bgn_de>p.end_de)throw new Error('relay_invalid_request');
  for(const [k,v] of Object.entries({corp_code:p.corp_code,bgn_de:p.bgn_de,end_de:p.end_de,page_no:'1',page_count:'100',sort:'date',sort_mth:'desc',pblntf_ty:'A',last_reprt_at:'Y'}))url.searchParams.set(k,v);
 }else if(p.kind==='list'){
  if(!/^\d{8}$/.test(p.corp_code??'')||!Number.isInteger(p.page)||Number(p.page)<1||Number(p.page)>5||!/^\d{8}$/.test(p.bgn_de??'')||!/^\d{8}$/.test(p.end_de??''))throw new Error('relay_invalid_request');
  for(const [k,v] of Object.entries({corp_code:p.corp_code,page_no:String(p.page),bgn_de:p.bgn_de,end_de:p.end_de,page_count:'100',sort:'date',sort_mth:'desc'}))url.searchParams.set(k,v??'');
 }else if(p.kind==='document'&&/^\d{14}$/.test(p.receipt??''))url.searchParams.set('rcept_no',p.receipt!);
 else throw new Error('relay_invalid_request');
 url.searchParams.set('crtfc_key',p.key);return url;
}
// Native Node/OpenSSL transport; default CA and hostname verification stay enabled.
export function downloadDart(url:URL,maxBytes:number):Promise<{bytes:Buffer;type:string}> {
 return new Promise((resolve,reject)=>{
  const req=httpsRequest(url,{method:'GET',minVersion:'TLSv1.2',rejectUnauthorized:true,headers:{Accept:'*/*','User-Agent':'SignalBrief/0.3'}},res=>{
   if(res.statusCode!==200){res.resume();reject(new Error('dart_http_'+res.statusCode));return;}
   if(Number(res.headers['content-length']??0)>maxBytes){res.destroy();reject(new Error('dart_response_too_large'));return;}
   const chunks:Buffer[]=[];let count=0;
   res.on('data',(chunk:Buffer)=>{count+=chunk.length;if(count>maxBytes){res.destroy(new Error('dart_response_too_large'));return;}chunks.push(chunk);});
   res.on('error',()=>reject(new Error('dart_response_interrupted')));
   res.on('end',()=>resolve({bytes:Buffer.concat(chunks),type:url.pathname.endsWith('.json')?'application/json':'application/zip'}));
  });
  const timer=setTimeout(()=>req.destroy(new Error('dart_request_timeout')),25000);
  req.on('close',()=>clearTimeout(timer));req.on('error',()=>reject(new Error('dart_transport_failed')));req.end();
 });
}
