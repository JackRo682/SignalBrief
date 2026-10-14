import {unzipSync} from 'npm:fflate@0.8.2';
import {SaxesParser} from 'npm:saxes@6.0.0';
import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.117.2';
import {ProviderError,obj,str,analyzeEvidence,type Row} from '../signalbrief-api/us-core.ts';
import {inspectDartZIP,crc32,validateDartXML} from './dart-document-core.ts';
const sha=async(bytes:Uint8Array)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes).buffer))].map(x=>x.toString(16).padStart(2,'0')).join('');
async function rpc(db:SupabaseClient,name:string,args:Row={}){const {data,error}=await db.rpc(name,args);if(error)throw new ProviderError('database','operation_failed');return data;}
async function download(receipt:string,key:string):Promise<Uint8Array>{
 if(!/^\d{14}$/.test(receipt)||!/^[a-f0-9]{40}$/i.test(key))throw new ProviderError('dart','missing_or_invalid_key',503);
 const url=new URL('https://opendart.fss.or.kr/api/document.xml');url.searchParams.set('rcept_no',receipt);url.searchParams.set('crtfc_key',key);
 try{
  const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(20000)});if(!response.ok)throw new ProviderError('dart','document_http_error');
  if(Number(response.headers.get('content-length')??0)>20_000_000)throw new ProviderError('dart','archive_size_limit');
  const reader=response.body?.getReader();if(!reader)throw new ProviderError('dart','empty_document');let length=0;const chunks:Uint8Array[]=[];
  while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>20_000_000){await reader.cancel();throw new ProviderError('dart','archive_size_limit');}chunks.push(value);}
  const bytes=new Uint8Array(length);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.length;}
  if(bytes[0]!==80||bytes[1]!==75){const error=new TextDecoder().decode(bytes.slice(0,2000));throw new ProviderError('dart',/<status>020<\/status>/.test(error)?'quota_exceeded':'invalid_document_response');}
  return bytes;
 }catch(error){if(error instanceof ProviderError)throw error;throw new ProviderError('dart','network_or_timeout');}
}
async function archive(db:SupabaseClient,path:string,bytes:Uint8Array,type:string){const result=await db.storage.from('signalbrief-raw').upload(path,bytes,{contentType:type,upsert:false});if(result.error&&!/duplicate|already exists/i.test(result.error.message))throw new ProviderError('storage','archive_failed');}
export async function processDartDocument(db:SupabaseClient,secrets:Row,config:Row):Promise<Row>{
 if(!secrets.DART_API_KEY)return {status:'blocked',code:'missing_key'};
 const filing=obj(await rpc(db,'sb_dart_document_claim'));if(!filing.id)return {status:'idle'};
 try{
  await rpc(db,'sb_us_reserve',{p:'dart',amount:0,smoke:false});
  const raw=await download(str(filing.receipt),str(secrets.DART_API_KEY)),rawHash=await sha(raw),members=inspectDartZIP(raw);
  const rawPath='dart/documents/'+rawHash+'.zip';await archive(db,rawPath,raw,'application/zip');
  const expanded=unzipSync(raw);const texts:string[]=[];
  for(const member of members){
   const bytes=expanded[member.name];if(!bytes||bytes.length!==member.size||crc32(bytes)!==member.crc)throw new ProviderError('dart','archive_integrity_mismatch');
   const xml=new TextDecoder('utf-8',{fatal:true}).decode(bytes);validateDartXML(xml);
   const parser=new SaxesParser({xmlns:false});let text='';
   parser.on('error',()=>{throw new ProviderError('dart','malformed_xml');});
   parser.on('text',value=>{text+=value;});parser.on('cdata',value=>{text+=value;});parser.on('closetag',()=>{text+=' ';});
   parser.write(xml).close();texts.push('FILE '+member.name+'\n'+text.replace(/\s+/g,' ').trim());
  }
  const normalized=texts.join('\n\n'),bytes=new TextEncoder().encode(normalized),normalizedHash=await sha(bytes),normalizedPath='dart/normalized/'+normalizedHash+'.txt';
  await archive(db,normalizedPath,bytes,'text/plain; charset=utf-8');
  const saved=await db.from('dart_documents').insert({filing_id:filing.id,raw_sha256:rawHash,normalized_sha256:normalizedHash,raw_object_key:rawPath,normalized_object_key:normalizedPath,raw_bytes:raw.length,normalized_bytes:bytes.length,member_count:members.length,parser_version:'saxes-6.0.0-dart-v1'});
  if(saved.error)throw new ProviderError('database','document_save_failed');
  let analysis:Row={status:'not_requested'};
  if(secrets.OPENAI_API_KEY&&Number(config.ai_daily_budget_usd)>0){
   const source=normalized.slice(0,12000),amount=(new TextEncoder().encode(source).length+3000)*0.4/1e6+1800*1.6/1e6;
   await rpc(db,'sb_us_reserve',{p:'openai',amount,smoke:false});
   const answer=await analyzeEvidence(source,str(secrets.OPENAI_API_KEY)),usage=obj(answer.usage);
   const result=await db.from('dart_analyses').insert({filing_id:filing.id,status:'needs_review',model:answer.model,source_sha256:rawHash,normalized_sha256:normalizedHash,result:{...answer,source_url:filing.source_url,normalized_excerpt:source,source_characters:normalized.length,excerpt_characters:source.length},input_tokens:usage.prompt_tokens,output_tokens:usage.completion_tokens});
   if(result.error)throw new ProviderError('database','analysis_save_failed');analysis={status:'needs_review'};
  }
  await rpc(db,'sb_dart_document_finish',{fid:filing.id,status:'parsed',error_code:null});return {status:'parsed',receipt:filing.receipt,analysis,raw_sha256:rawHash};
 }catch(error){const code=error instanceof ProviderError?error.code:'document_processing_failed';await rpc(db,'sb_dart_document_finish',{fid:filing.id,status:'blocked',error_code:code});return {status:'blocked',code};}
}
