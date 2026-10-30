'use client';
import {useEffect,useState} from 'react';
import {z} from 'zod';
import {useAuth} from '@/components/auth';
import {quotesSchema,quoteSchema,quoteUnavailableSchema} from './contracts';
type Quote=z.infer<typeof quoteSchema>;
type Unavailable=z.infer<typeof quoteUnavailableSchema>;
/** The licensed provider accepts at most eight symbols per request. Keep partial outages explicit. */
export async function loadQuoteBatches(token:string,symbols:string[],period:string,signal:AbortSignal){
 const unique=[...new Set(symbols.map(s=>s.trim().toUpperCase()).filter(Boolean))];
 const batches:string[][]=[];for(let i=0;i<unique.length;i+=8)batches.push(unique.slice(i,i+8));
 const replies=await Promise.allSettled(batches.map(async batch=>{
  const r=await fetch(`/api/market?symbols=${encodeURIComponent(batch.join(','))}&period=${encodeURIComponent(period)}`,{headers:{Authorization:`Bearer ${token}`},cache:'no-store',signal});
  if(!r.ok){
   const payload=await r.json().catch(()=>null);
   if(r.status===401&&typeof window!=='undefined')window.dispatchEvent(new Event('signalbrief:unauthorized'));
   if(r.status===403&&payload?.error?.code==='mfa_required'&&typeof window!=='undefined')window.dispatchEvent(new Event('signalbrief:mfa-required'));
   throw new Error('provider_unavailable');
  }
  return quotesSchema.parse(await r.json());
 }));
 if(signal.aborted)throw new DOMException('Quote request aborted','AbortError');
 const quotes=new Map<string,Quote>(),unavailable=new Map<string,Unavailable>();
 for(const [index,reply] of replies.entries()){
  const batch=batches[index];
  if(reply.status==='rejected'){for(const symbol of batch)unavailable.set(symbol,{symbol,reason:'provider_unavailable'});continue;}
  for(const q of reply.value.quotes)if(batch.includes(q.symbol)&&q.price!==null)quotes.set(q.symbol,q);
  for(const item of reply.value.unavailable)if(batch.includes(item.symbol)&&!quotes.has(item.symbol))unavailable.set(item.symbol,item);
  for(const symbol of batch)if(!quotes.has(symbol)&&!unavailable.has(symbol))unavailable.set(symbol,{symbol,reason:reply.value.reason||'partial_provider_unavailable'});
 }
 const missing=unique.filter(symbol=>!quotes.has(symbol)).map(symbol=>unavailable.get(symbol)!);
 return {quotes:[...quotes.values()],unavailable:missing,reason:missing.length?(quotes.size?'partial_provider_unavailable':missing[0].reason):''};
}
export function useQuotes(symbols:string[],period='6m'){
 const {token}=useAuth(),key=[...new Set(symbols.map(s=>s.trim().toUpperCase()).filter(Boolean))].sort().join(','),[quotes,setQuotes]=useState<Quote[]>([]),[unavailable,setUnavailable]=useState<Unavailable[]>([]),[loading,setLoading]=useState(false),[reason,setReason]=useState('');
 useEffect(()=>{if(!token||!key){setQuotes([]);setUnavailable([]);setLoading(false);setReason('');return;}const ctrl=new AbortController();let live=true;setLoading(true);setQuotes([]);setUnavailable([]);setReason('');
  loadQuoteBatches(token,key.split(','),period,ctrl.signal).then(d=>{if(live){setQuotes(d.quotes);setUnavailable(d.unavailable);setReason(d.reason);}}).catch(()=>{if(live)setReason('provider_unavailable');}).finally(()=>{if(live)setLoading(false);});return()=>{live=false;ctrl.abort();};},[token,key,period]);
 return {quotes,unavailable,loading,reason};
}
