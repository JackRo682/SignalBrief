import {ProviderError,obj,str,type Row,jsonFetch,type Fetcher} from '../signalbrief-api/us-core.ts';
export async function verifyDeliveryWebhook(raw:string,headers:Headers,secret:string,now=Date.now()):Promise<Row>{
 const id=headers.get('svix-id')??'',timestamp=headers.get('svix-timestamp')??'',signature=headers.get('svix-signature')??'';
 if(!secret.startsWith('whsec_')||!/^[A-Za-z0-9_-]{1,200}$/.test(id)||!/^\d{10}$/.test(timestamp)||Math.abs(now/1000-Number(timestamp))>300)throw new ProviderError('auth','invalid_webhook',401);
 try{
  const bytes=Uint8Array.from(atob(secret.slice(6)),c=>c.charCodeAt(0));
  const key=await crypto.subtle.importKey('raw',bytes,{name:'HMAC',hash:'SHA-256'},false,['verify']);
  const message=new TextEncoder().encode(id+'.'+timestamp+'.'+raw);
  let valid=false;
  for(const part of signature.split(' ')){const [version,value]=part.split(',');if(version!=='v1'||!value)continue;
   const signed=Uint8Array.from(atob(value),c=>c.charCodeAt(0));
   if(await crypto.subtle.verify('HMAC',key,signed,message)){valid=true;break;}
  }
  if(!valid)throw new Error();
  const event=obj(JSON.parse(raw)),data=obj(event.data);
  if(!['email.sent','email.delivered','email.bounced','email.complained','email.failed','email.suppressed','email.delivery_delayed'].includes(str(event.type))||!str(data.email_id)||!Number.isFinite(Date.parse(str(event.created_at))))throw new Error();
  return {event_id:id,type:event.type,email_id:data.email_id,occurred_at:event.created_at};
 }catch{throw new ProviderError('auth','invalid_webhook',401);}
}
export async function sendNotification(key:string,from:string,to:string,subject:string,text:string,id:string,fetcher:Fetcher=fetch):Promise<string>{
 const email=/^[A-Za-z0-9.!#$%&'*+/=?^_{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
 if(!key||!email.test(from)||!email.test(to)||/[\r\n]/.test(subject)||!/^sb-email-[a-zA-Z0-9-]{1,100}$/.test(id))throw new ProviderError('resend','invalid_email_request',422);
 const response=obj(await jsonFetch(new URL('https://api.resend.com/emails'),'resend',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json','Idempotency-Key':id},body:JSON.stringify({from,to:[to],subject:subject.slice(0,150),text:text.slice(0,20000)})},fetcher));
 if(!str(response.id))throw new ProviderError('resend','missing_email_id');
 return str(response.id);
}
export function retryableEmailError(error:unknown):boolean{
 return error instanceof ProviderError&&(error.status>=500||error.status===429)&&!['invalid_email_request','invalid_key','access_or_plan_denied'].includes(error.code);
}
