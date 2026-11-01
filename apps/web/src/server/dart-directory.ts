import {SaxesParser} from 'saxes';
import type {DirectoryEntry} from '../../../../supabase/functions/signalbrief-discovery/core';

/** Parse the complete official registry on Node, retaining listed identities only. */
export function parseDartDirectory(xml:string):DirectoryEntry[]{
 if(/<!DOCTYPE|<!ENTITY/i.test(xml)||xml.length>80000000)throw new Error('invalid_dart_directory');
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
     if(!/^[A-Z0-9]{6}$/.test(ticker)||!/^\d{8}$/.test(id)||!name||name.length>500)throw new Error('invalid_identity');
     const englishName=(current.corp_eng_name??'').trim();
     if(englishName.length>500)throw new Error('invalid_english_name');
     entries.set(id+':'+ticker,{provider_company_id:id,ticker,name,market:'KR',...(englishName?{official_english_name:englishName}:{})});
    }
    current=null;
   }tag='';
  });parser.write(xml).close();
 }catch{throw new Error('invalid_dart_directory');}
 if(!root||!entries.size||entries.size>50000)throw new Error('invalid_dart_directory');
 return [...entries.values()];
}
