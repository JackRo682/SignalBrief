'use client';
import {useEffect,useState} from 'react';
import {z} from 'zod';
import {useAuth} from '@/components/auth';
import {quotesSchema,quoteSchema} from './contracts';
export function useQuotes(symbols:string[],period='6m'){
 const {token}=useAuth(),key=[...new Set(symbols)].sort().join(','),[quotes,setQuotes]=useState<z.infer<typeof quoteSchema>[]>([]),[loading,setLoading]=useState(false),[reason,setReason]=useState('');
 useEffect(()=>{if(!token||!key){setQuotes([]);return;}const ctrl=new AbortController();let live=true;setLoading(true);setQuotes([]);
  fetch(`/api/market?symbols=${encodeURIComponent(key)}&period=${period}`,{headers:{Authorization:`Bearer ${token}`},cache:'no-store',signal:ctrl.signal}).then(async r=>{if(!r.ok)throw new Error('provider_unavailable');return quotesSchema.parse(await r.json());}).then(d=>{if(live){setQuotes(d.quotes);setReason(d.reason??'');}}).catch(()=>{if(live)setReason('provider_unavailable');}).finally(()=>{if(live)setLoading(false);});return()=>{live=false;ctrl.abort();};},[token,key,period]);
 return {quotes,loading,reason};
}
