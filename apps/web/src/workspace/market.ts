'use client';
import {useEffect,useState} from 'react';
import {z} from 'zod';
import {useAuth} from '@/components/auth';
import {quotesSchema,quoteSchema} from './contracts';
type Quote=z.infer<typeof quoteSchema>;
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
 const quotes=new Map<string,Quote>();let failed=false,reason='';
 for(const reply of replies){if(reply.status==='rejected'){failed=true;continue;}reason ||= reply.value.reason??'';for(const q of reply.value.quotes)if(unique.includes(q.symbol))quotes.set(q.symbol,q);}
 return {quotes:[...quotes.values()],reason:failed||quotes.size<unique.length?(reason||'partial_provider_unavailable'):reason};
}
export function useQuotes(symbols:string[],period='6m'){
 const {token}=useAuth(),key=[...new Set(symbols)].sort().join(','),[quotes,setQuotes]=useState<z.infer<typeof quoteSchema>[]>([]),[loading,setLoading]=useState(false),[reason,setReason]=useState('');
 useEffect(()=>{if(!token||!key){setQuotes([]);setLoading(false);setReason('');return;}const ctrl=new AbortController();let live=true;setLoading(true);setQuotes([]);setReason('');
  loadQuoteBatches(token,key.split(','),period,ctrl.signal).then(d=>{if(live){setQuotes(d.quotes);setReason(d.reason);}}).catch(()=>{if(live)setReason('provider_unavailable');}).finally(()=>{if(live)setLoading(false);});return()=>{live=false;ctrl.abort();};},[token,key,period]);
 return {quotes,loading,reason};
}
