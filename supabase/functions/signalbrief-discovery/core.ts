export type DirectoryEntry={provider_company_id:string;ticker:string;name:string;market:string;official_english_name?:string};
export class DiscoveryError extends Error {constructor(public code:string,public status=502){super(code);}}

/** Official SEC exchange directory. Keep each share-class ticker; identity is CIK. */
export function parseSecDirectory(raw:string):DirectoryEntry[]{
 let data:{fields?:unknown;data?:unknown};
 try{data=JSON.parse(raw);}catch{throw new DiscoveryError('invalid_sec_directory');}
 if(!data||!Array.isArray(data.fields)||!Array.isArray(data.data))throw new DiscoveryError('invalid_sec_directory');
 const fields=data.fields as unknown[],columns=['cik','name','ticker','exchange'].map(k=>fields.indexOf(k));
 if(columns.some(i=>i<0)||data.data.length>50000)throw new DiscoveryError('invalid_sec_directory');
 const entries=new Map<string,DirectoryEntry>();
 for(const row of data.data){
  if(!Array.isArray(row))throw new DiscoveryError('invalid_sec_directory');
  const [cik,name,ticker,exchange]=columns.map(i=>row[i]);
  if(!/^\d{1,10}$/.test(String(cik))||Number(cik)===0||typeof name!=='string'||!name.trim()||name.length>500||typeof ticker!=='string'||!/^[A-Z0-9][A-Z0-9.-]{0,14}$/.test(ticker))throw new DiscoveryError('invalid_sec_identity');
  const id=String(cik).padStart(10,'0'),market=typeof exchange==='string'&&exchange.trim()?exchange.trim().toUpperCase():'US';
  if(market.length>30)throw new DiscoveryError('invalid_sec_market');
  entries.set(id+':'+ticker,{provider_company_id:id,ticker,name:name.trim(),market});
 }
 return [...entries.values()];
}

/** Verify the bounded Node parser result without inflating/parsing the full XML in Edge. */
export function parseDartDirectoryResult(raw:string,expectedSha:string):DirectoryEntry[]{
 let value:unknown;try{value=JSON.parse(raw);}catch{throw new DiscoveryError('invalid_dart_directory_result');}
 if(!value||typeof value!=='object'||Array.isArray(value)||!/^[a-f0-9]{64}$/.test(expectedSha))throw new DiscoveryError('invalid_dart_directory_result');
 const result=value as Record<string,unknown>;
 if(Object.keys(result).some(key=>!['source_sha256','items'].includes(key))||result.source_sha256!==expectedSha||!Array.isArray(result.items)||result.items.length>50000)throw new DiscoveryError('invalid_dart_directory_result');
 const seen=new Set<string>();
 for(const value of result.items){
  if(!value||typeof value!=='object'||Array.isArray(value))throw new DiscoveryError('invalid_dart_directory_result');
  const row=value as Record<string,unknown>;
  if(Object.keys(row).some(key=>!['provider_company_id','ticker','name','market','official_english_name'].includes(key))||
   typeof row.provider_company_id!=='string'||!/^\d{8}$/.test(row.provider_company_id)||typeof row.ticker!=='string'||!/^\d{6}$/.test(row.ticker)||
   typeof row.name!=='string'||!row.name.trim()||row.name.length>500||row.market!=='KR'||
   row.official_english_name!==undefined&&(typeof row.official_english_name!=='string'||!row.official_english_name.trim()||row.official_english_name.length>500))throw new DiscoveryError('invalid_dart_directory_result');
  const identity=row.provider_company_id+':'+row.ticker;
  if(seen.has(identity))throw new DiscoveryError('invalid_dart_directory_result');
  seen.add(identity);
 }
 if(result.items.length<100)throw new DiscoveryError('incomplete_official_directory');
 return result.items as DirectoryEntry[];
}

export function parseSelection(value:unknown):{company_id:string}|{provider:'sec'|'dart';provider_company_id:string;ticker:string}{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new DiscoveryError('invalid_selection',422);
 const p=value as Record<string,unknown>,keys=Object.keys(p);
 if(keys.length===1&&typeof p.company_id==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(p.company_id))return {company_id:p.company_id};
 if(keys.length!==3||keys.some(k=>!['provider','provider_company_id','ticker'].includes(k))||!['sec','dart'].includes(String(p.provider))||typeof p.provider_company_id!=='string'||typeof p.ticker!=='string')throw new DiscoveryError('invalid_selection',422);
 if(p.provider==='sec'&&/^\d{10}$/.test(p.provider_company_id)&&/^[A-Z0-9][A-Z0-9.-]{0,14}$/.test(p.ticker))return {provider:'sec',provider_company_id:p.provider_company_id,ticker:p.ticker};
 if(p.provider==='dart'&&/^\d{8}$/.test(p.provider_company_id)&&/^\d{6}$/.test(p.ticker))return {provider:'dart',provider_company_id:p.provider_company_id,ticker:p.ticker};
 throw new DiscoveryError('invalid_selection',422);
}
