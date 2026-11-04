#!/usr/bin/env node
/** Offline preparation only. No credentials, requests or production writes. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {registerHooks,createRequire} from 'node:module';
import {parseArgs} from 'node:util';
const require=createRequire(new URL('../apps/web/package.json',import.meta.url));
registerHooks({resolve(specifier,context,nextResolve){
 if(specifier==='npm:htmlparser2@10.0.0')return nextResolve(pathToFileURL(require.resolve('htmlparser2')).href,context);
 if(specifier==='npm:iconv-lite@0.6.3')return nextResolve(pathToFileURL(require.resolve('iconv-lite')).href,context);
 return nextResolve(specifier,context);
}});
const {verifyUniversePayload,sha256}=await import('../supabase/functions/signalbrief-universe/core.ts');
const {values}=parseArgs({options:{manifest:{type:'string'},raw:{type:'string'},'out-dir':{type:'string'}}});
if(!values.manifest||!values.raw||!values['out-dir'])throw new Error('Use node --experimental-strip-types scripts/prepare_universe_import.mjs --manifest input.json --raw original --out-dir directory');
const input=JSON.parse(await readFile(resolve(values.manifest),'utf8'));
const {raw_path:_localPath,...manifest}=input;manifest.version='listed-universe-v1';
if(['kind_kospi','kind_kosdaq'].includes(manifest.source_key))manifest.coverage_scope='issuer_primary_listing';
const raw=new Uint8Array(await readFile(resolve(values.raw)));
if(raw.length!==manifest.raw_bytes||await sha256(raw)!==manifest.raw_sha256)throw new Error('Original differs from source manifest');
const manifest_text=JSON.stringify(manifest),manifest_sha256=await sha256(new TextEncoder().encode(manifest_text));
const chunks=[];for(let i=0;i<raw.length;i+=64000)chunks.push({part:chunks.length,data_base64:Buffer.from(raw.slice(i,i+64000)).toString('base64')});
const payload={snapshot_id:'00000000-0000-0000-0000-000000000000',manifest_text,manifest_sha256,
 raw_object_key:`universe/raw/${manifest.source_key}/${manifest.raw_sha256}.bin`,manifest_object_key:`universe/manifests/${manifest_sha256}.json`,chunks};
await verifyUniversePayload(payload);
// Avoid splitting a surrogate pair or a UTF-8 sequence. The SQL limit is bytes.
const parts=[];let text='',bytes=0;
for(const char of manifest_text){const size=Buffer.byteLength(char);if(bytes+size>64000){parts.push(text);text='';bytes=0;}text+=char;bytes+=size;}
if(text)parts.push(text);
const directory=resolve(values['out-dir']);await mkdir(directory,{recursive:true});
const result={source_key:manifest.source_key,manifest_sha256,raw_sha256:manifest.raw_sha256,raw_bytes:raw.length,rows:manifest.items.length,
 begin:{digest:manifest_sha256,total_bytes:Buffer.byteLength(manifest_text),total_parts:parts.length},
 manifest_parts:parts.map((text_chunk,part)=>({digest:manifest_sha256,part,text_chunk})),commit:{digest:manifest_sha256},chunks};
await writeFile(join(directory,`${manifest.source_key}.prepared.json`),JSON.stringify(result));
await writeFile(join(directory,`${manifest.source_key}.manifest.json`),manifest_text);
process.stdout.write(JSON.stringify({source_key:result.source_key,rows:result.rows,raw_bytes:raw.length,manifest_bytes:result.begin.total_bytes,manifest_parts:parts.length,raw_parts:chunks.length,manifest_sha256})+'\n');
