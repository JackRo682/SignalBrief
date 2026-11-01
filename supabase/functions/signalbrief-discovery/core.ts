import {SaxesParser} from 'npm:saxes@6.0.0';
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

/** Parse the official registry, retaining only records with a listed security code. */
export function parseDartDirectory(xml:string):DirectoryEntry[]{
 if(/<!DOCTYPE|<!ENTITY/i.test(xml)||xml.length>80000000)throw new DiscoveryError('invalid_dart_directory');
 const entries=new Map<string,DirectoryEntry>();let current:Record<string,string>|null=null,tag='',root=false;
 try{
  const parser=new SaxesParser({xmlns:false});
  parser.on('error',()=>{throw new Error('invalid_xml');});
  parser.on('opentag',node=>{tag=node.name;if(node.name==='result')root=true;if(node.name==='list')current={};});
  const append=(text:string)=>{if(current&&['corp_code','corp_name','corp_eng_name','stock_code'].includes(tag))current[tag]=(current[tag]??'')+text;};
  parser.on('text',append);parser.on('cdata',append);
  parser.on('closetag',node=>{
   if(node.name==='list'&&current){
    const ticker=(current.stock_code??'').trim(),id=(current.corp_code??'').trim(),name=(current.corp_name??'').trim();
    if(ticker){
     if(!/^\d{6}$/.test(ticker)||!/^\d{8}$/.test(id)||!name||name.length>500)throw new Error('invalid_identity');
     const englishName=(current.corp_eng_name??'').trim();
     if(englishName.length>500)throw new Error('invalid_english_name');
     entries.set(id+':'+ticker,{provider_company_id:id,ticker,name,market:'KR',...(englishName?{official_english_name:englishName}:{})});
    }
    current=null;
   }tag='';
  });parser.write(xml).close();
 }catch{throw new DiscoveryError('invalid_dart_directory');}
 if(!root||!entries.size||entries.size>50000)throw new DiscoveryError('invalid_dart_directory');
 return [...entries.values()];
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
