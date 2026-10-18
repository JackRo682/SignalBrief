import {ProviderError,type Row} from '../signalbrief-api/us-core.ts';
export async function dartRelay(payload:Row,secret:string):Promise<Uint8Array>{
 if(!/^[a-f0-9]{64}$/.test(secret))throw new ProviderError('dart','relay_not_configured',503);
 const nonce=[...crypto.getRandomValues(new Uint8Array(32))].map(x=>x.toString(16).padStart(2,'0')).join('');
 const body=JSON.stringify({...payload,nonce}),timestamp=String(Date.now());
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const signature=[...new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(timestamp+'\n'+body)))].map(x=>x.toString(16).padStart(2,'0')).join('');
 try{
  const response=await fetch('https://signalbrief.online/api/internal/dart',{method:'POST',redirect:'error',signal:AbortSignal.timeout(32000),headers:{'Content-Type':'application/json','x-sb-timestamp':timestamp,'x-sb-signature':signature},body});
  if(!response.ok){await response.body?.cancel();throw new ProviderError('dart',response.status===401?'relay_unauthorized':'relay_upstream_failed');}
  const limit=payload.kind==='company'?128_000:payload.kind==='list'?2_000_000:20_000_000;
  const reader=response.body?.getReader();if(!reader)throw new ProviderError('dart','empty_response');const chunks:Uint8Array[]=[];let length=0;
  while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>limit){await reader.cancel();throw new ProviderError('dart','response_too_large');}chunks.push(value);}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
 }catch(error){if(error instanceof ProviderError)throw error;throw new ProviderError('dart','relay_network_failed');}
}
