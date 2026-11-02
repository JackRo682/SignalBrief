import {CalendarError} from './core.ts';

/** Source URLs must be established by canonical SEC evidence, never request input. */
export function publicIRURL(value:string):URL{
 let url:URL;try{url=new URL(value);}catch{throw new CalendarError('invalid_ir_url');}
 if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash||url.href.length>1000
  ||!/^([a-z0-9-]+\.)+[a-z]{2,63}$/i.test(url.hostname)||url.hostname.endsWith('.')
  ||/(?:^|\.)(?:localhost|local|internal|test|invalid|example|onion)$/.test(url.hostname)
  ||/^(?:\d+\.){3}\d+$/.test(url.hostname)||url.hostname.includes('supabase')||url.hostname.includes('metadata.google'))throw new CalendarError('invalid_ir_url');
 return url;
}
export function publicAddress(value:string):boolean{
 if(/^\d+\.\d+\.\d+\.\d+$/.test(value)){
  const parts=value.split('.'),a=parts.map(Number);if(a.some((x,index)=>x>255||String(x)!==parts[index]))return false;
  return !(a[0]===0||a[0]===10||a[0]===127||a[0]>=224||(a[0]===100&&a[1]>=64&&a[1]<=127)||(a[0]===169&&a[1]===254)||(a[0]===172&&a[1]>=16&&a[1]<=31)||(a[0]===192&&(a[1]===168||a[1]===0))||(a[0]===198&&(a[1]===18||a[1]===19||a[1]===51&&a[2]===100))||(a[0]===203&&a[1]===0&&a[2]===113));
 }
 // Global unicast only. Reject IPv4-mapped, loopback, link-local, multicast and ULA.
 try{new URL(`https://[${value}]/`);}catch{return false;}
 return /^[23][0-9a-f]{3}:[0-9a-f:]+$/i.test(value)&&value.split(':').filter(Boolean).every(x=>x.length<=4)
  &&!/^2002:|^2001:(?:0{0,4}|0*db8|0*1[0-9a-f]|0*2[0-9a-f]):/i.test(value);
}
