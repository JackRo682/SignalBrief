import {createHmac,timingSafeEqual} from 'node:crypto';
import {request as httpsRequest} from 'node:https';

export type DartRelayPayload={kind:'list'|'document'|'company';key:string;nonce:string;corp_code?:string;page?:number;receipt?:string;bgn_de?:string;end_de?:string};
export function relaySignature(body:string,timestamp:string,secret:string):string {
 return createHmac('sha256',secret).update(timestamp+'\n'+body).digest('hex');
}
export function verifyRelay(body:string,timestamp:string,signature:string,secret:string,now=Date.now()):DartRelayPayload {
 if(secret.length<64||!/^\d{13}$/.test(timestamp)||Math.abs(now-Number(timestamp))>60000||!/^([a-f0-9]{64})$/.test(signature)||body.length>4096)throw new Error('relay_unauthorized');
 if(!timingSafeEqual(Buffer.from(signature,'hex'),Buffer.from(relaySignature(body,timestamp,secret),'hex')))throw new Error('relay_unauthorized');
 const value=JSON.parse(body) as DartRelayPayload;
 if(!value||!/^([a-f0-9]{40})$/i.test(value.key)||!/^([a-f0-9]{64})$/.test(value.nonce))throw new Error('relay_invalid_request');
 dartEndpoint(value);return value;
}
export function dartEndpoint(p:DartRelayPayload):URL {
 const url=new URL('https://opendart.fss.or.kr/api/'+(p.kind==='list'?'list.json':p.kind==='company'?'company.json':'document.xml'));
 if(p.kind==='company'){
  if(!/^\d{8}$/.test(p.corp_code??''))throw new Error('relay_invalid_request');
  url.searchParams.set('corp_code',p.corp_code!);
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
