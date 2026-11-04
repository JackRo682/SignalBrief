#!/usr/bin/env node
/** Prepare-only. Uses no network, credentials, database, or storage mutation. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {parseArgs} from 'node:util';
import {CHUNK_SIZE,NOTICE_SCHEMA,normalizeNotice,locateQuote,noticeSourceKey,validateNotice} from '../supabase/functions/signalbrief-calendar/curated-notice.ts';
import {sha256} from '../supabase/functions/signalbrief-calendar/core.ts';

const {values}=parseArgs({options:{input:{type:'string'},'out-dir':{type:'string'},normalize:{type:'string'},format:{type:'string',default:'html'},encoding:{type:'string',default:'utf-8'},'document-url':{type:'string'},out:{type:'string'}}});
async function original(spec){
 const raw=new Uint8Array(await readFile(resolve(spec.raw_path)));
 let pdfText,extraction='deterministic-v1';
 if(spec.format==='pdf'){
  const {spawnSync}=await import('node:child_process');
  const result=spawnSync('pdftotext',['-v'],{encoding:'utf8'}),match=`${result.stdout}${result.stderr}`.match(/pdftotext version ([0-9]+(?:\.[0-9]+){1,2})/);
  if(result.status!==0||!match)throw new Error('pdftotext version unavailable');
  extraction=`pdftotext-${match[1]};layout;utf-8`;
  pdfText=execFileSync('pdftotext',['-layout','-enc','UTF-8',resolve(spec.raw_path),'-'],{encoding:'utf8',maxBuffer:8_000_000});
 }
 const text=normalizeNotice(raw,spec.format,spec.encoding??'utf-8',spec.document_url,pdfText);
 return {raw,text,extraction};
}
export async function prepareNotice(spec){
 const {raw,text,extraction}=await original(spec),sourceKey=await noticeSourceKey(spec.provider,spec.provider_company_id,spec.source_url);
 const rawSha=await sha256(raw),textSha=await sha256(new TextEncoder().encode(text));
 const issuer=locateQuote(text,spec.issuer_quote);
 const entries=spec.entries.map(input=>{
  const located=locateQuote(text,input.quote),entry={...input,quote_start:located.start,quote_end:located.end,location:`normalized-text[${located.start}:${located.end}]`,timezone:null};
  if(input.year_context_quote){const context=locateQuote(text,input.year_context_quote);entry.year_context_start=context.start;entry.year_context_end=context.end;}
  return entry;
 });
 const manifest={schema:NOTICE_SCHEMA,adapter:'curated-notice',complete:false,source_key:sourceKey,source_url:spec.source_url,document_url:spec.document_url,company_id:spec.company_id,provider:spec.provider,provider_company_id:spec.provider_company_id,ticker:spec.ticker,format:spec.format,encoding:spec.encoding??'utf-8',raw_sha256:rawSha,raw_bytes:raw.length,raw_object_key:`calendar/${sourceKey}/originals/${rawSha}.${spec.format}`,normalized_sha256:textSha,normalized_object_key:`calendar/${sourceKey}/normalized/${textSha}.txt`,normalization:spec.format==='pdf'?'pdf-text-whitespace-v1':spec.format==='json'?'ls-electric-board-v1':'html-text-v1',extraction,fetched_at:spec.fetched_at,published_on:spec.published_on??null,publication_precision:spec.published_on?'date':'unknown',publication_timezone:spec.publication_timezone??null,issuer_quote:spec.issuer_quote,issuer_start:issuer.start,issuer_end:issuer.end,entries};
 await validateNotice({key:sourceKey,url:spec.source_url,adapter:'curated-notice',company_id:spec.company_id,provider:spec.provider,provider_company_id:spec.provider_company_id,ticker:spec.ticker,market:''},manifest,text,raw);
 const manifestText=JSON.stringify(manifest),chunks=[];
 for(let offset=0;offset<raw.length;offset+=CHUNK_SIZE)chunks.push({source:sourceKey,part:chunks.length,data_base64:Buffer.from(raw.slice(offset,offset+CHUNK_SIZE)).toString('base64')});
 return {source_key:sourceKey,stage:{manifest_text:manifestText,normalized_text:text},chunks,dispatch:{source:sourceKey},manifest};
}

if(values.normalize){
 if(!values.out||!values['document-url'])throw new Error('--normalize requires --document-url and --out');
 const {text}=await original({raw_path:values.normalize,format:values.format,encoding:values.encoding,document_url:values['document-url']});
 await writeFile(resolve(values.out),text,'utf8');
 process.stdout.write(JSON.stringify({normalized_path:resolve(values.out),characters:Array.from(text).length})+'\n');
}else if(values.input){
 if(!values['out-dir'])throw new Error('--input requires --out-dir');
 const input=JSON.parse(await readFile(resolve(values.input),'utf8')),specs=Array.isArray(input)?input:[input],directory=resolve(values['out-dir']);
 await mkdir(directory,{recursive:true});const index=[];
 for(const spec of specs){const result=await prepareNotice(spec),file=join(directory,`${result.source_key}.json`);await writeFile(file,JSON.stringify(result,null,2)+'\n');index.push({source_key:result.source_key,path:file,events:result.manifest.entries.length,raw_bytes:result.manifest.raw_bytes,chunks:result.chunks.length});}
 await writeFile(join(directory,'index.json'),JSON.stringify(index,null,2)+'\n');process.stdout.write(JSON.stringify(index)+'\n');
}else if(process.argv[1]&&resolve(process.argv[1])===resolve(new URL(import.meta.url).pathname))throw new Error('Use --normalize raw --document-url URL --out text, or --input specs.json --out-dir directory. Run with node --experimental-strip-types.');
