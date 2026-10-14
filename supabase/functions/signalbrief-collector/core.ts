import {ProviderError,obj,arr,str,providerFetch,type Row,type Fetcher} from '../signalbrief-api/us-core.ts';
import {dartRelay} from './dart-relay.ts';

export function taskToken(value:string):string {
 if(!/^[a-f0-9]{64}$/.test(value))throw new ProviderError('auth','invalid_task',401);
 return value;
}
export function koreaDate(now=new Date()):string {
 return new Date(now.getTime()+9*3600_000).toISOString().slice(0,10).replaceAll('-','');
}
export function dartPage(raw:string,corpCode:string):{items:Row[];pages:number} {
 let value:Row;try{value=obj(JSON.parse(raw));}catch{throw new ProviderError('dart','invalid_json');}
 if(value.status==='013')return {items:[],pages:0};
 if(value.status!=='000')throw new ProviderError('dart',value.status==='010'||value.status==='011'?'invalid_key':value.status==='020'?'quota_exceeded':'provider_rejected');
 const pages=Number(value.total_page);
 if(!Number.isInteger(pages)||pages<1||pages>5||!Array.isArray(value.list))throw new ProviderError('dart','pagination_limit_or_invalid_response');
 const items=arr(value.list).map(item=>{
  if(item.corp_code!==corpCode||!/^\d{14}$/.test(str(item.rcept_no))||!/^\d{8}$/.test(str(item.rcept_dt))||!str(item.report_nm))
   throw new ProviderError('dart','invalid_filing_identity');
  return {receipt:item.rcept_no,title:item.report_nm,filing_date:`${str(item.rcept_dt).slice(0,4)}-${str(item.rcept_dt).slice(4,6)}-${str(item.rcept_dt).slice(6,8)}`,source_url:`https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${item.rcept_no}`};
 });
 return {items,pages};
}
export async function dartList(corpCode:string,key:string,page:number,fetcher:Fetcher=fetch,relaySecret=''):Promise<string>{
 if(!/^[0-9]{8}$/.test(corpCode))throw new ProviderError('dart','invalid_corp_code',422);
 if(!/^[a-f0-9]{40}$/i.test(key))throw new ProviderError('dart','missing_or_invalid_key',503);
 if(!Number.isInteger(page)||page<1||page>5)throw new ProviderError('dart','invalid_page',422);
 const url=new URL('https://opendart.fss.or.kr/api/list.json');
 const start=koreaDate(new Date(Date.now()-7*86400_000));
 for(const [k,v] of Object.entries({crtfc_key:key,corp_code:corpCode,bgn_de:start,end_de:koreaDate(),page_no:String(page),page_count:'100',sort:'date',sort_mth:'desc'}))url.searchParams.set(k,v);
 if(relaySecret)return new TextDecoder().decode(await dartRelay({kind:'list',key,corp_code:corpCode,page,bgn_de:start,end_de:koreaDate()},relaySecret));
 return providerFetch(url,'dart',{},fetcher,2_000_000);
}
