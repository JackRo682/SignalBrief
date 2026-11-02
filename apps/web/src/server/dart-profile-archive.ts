import {createHash} from 'node:crypto';
import {crc32,inflateRawSync} from 'node:zlib';
import {SaxesParser} from 'saxes';
import {Parser} from 'htmlparser2';
import {dartLegalName,dartProfileFields,type DartProfileBlock} from '../../../../supabase/functions/signalbrief-profiles/enrichment-dart-core';

export type ProfileParsePayload={kind:'profile_parse';source_url:string;sha:string;nonce:string;corp_code:string;ticker:string;receipt:string;company_name:string;report_name:string};
const compressedLimit=20_000_000,expandedLimit=32_000_000,responseLimit=8_000_000;
const failure=(code='dart_profile_invalid_archive'):never=>{throw new Error(code);};
export function profileArchiveURL(p:ProfileParsePayload,projectUrl:string):URL{
 try{
  const base=new URL(projectUrl),url=new URL(p.source_url);
  if(base.protocol!=='https:'||!/^[a-z0-9-]+\.supabase\.co$/.test(base.hostname)||base.username||base.password||base.port||base.pathname!=='/'||base.search||base.hash)throw new Error();
  if(url.origin!==base.origin||url.username||url.password||url.port||url.hash||url.pathname!==`/storage/v1/object/sign/signalbrief-raw/profiles/dart/${p.sha}.zip`)throw new Error();
  const keys=[...url.searchParams.keys()],token=url.searchParams.get('token');
  if(keys.length!==1||keys[0]!=='token'||!token||token.length>3072||!/^[A-Za-z0-9_.-]+$/.test(token))throw new Error();
  return url;
 }catch{throw new Error('relay_invalid_request');}
}

/** Validate central/local headers and every CRC before parsing the receipt-named member. */
function documentMember(bytes:Uint8Array,receipt:string):{name:string;bytes:Uint8Array}{
 const b=Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength);if(b.length<22||b.length>compressedLimit)failure();
 let end=-1;for(let at=b.length-22;at>=Math.max(0,b.length-65557);at--)if(b.readUInt32LE(at)===0x06054b50){end=at;break;}
 if(end<0||end+22+b.readUInt16LE(end+20)!==b.length||b.readUInt16LE(end+4)!==0||b.readUInt16LE(end+6)!==0)failure();
 const count=b.readUInt16LE(end+10),centralSize=b.readUInt32LE(end+12),central=b.readUInt32LE(end+16);
 if(count<1||count>20||b.readUInt16LE(end+8)!==count||central+centralSize!==end)failure();
 let at=central,localEnd=0,total=0,selected:{name:string;bytes:Uint8Array}|undefined;const names=new Set<string>();
 for(let i=0;i<count;i++){
  if(at+46>end||b.readUInt32LE(at)!==0x02014b50)failure();
  const flags=b.readUInt16LE(at+8),method=b.readUInt16LE(at+10),crc=b.readUInt32LE(at+16),compressed=b.readUInt32LE(at+20),expanded=b.readUInt32LE(at+24),nameLength=b.readUInt16LE(at+28),extra=b.readUInt16LE(at+30),comment=b.readUInt16LE(at+32),local=b.readUInt32LE(at+42);
  if(at+46+nameLength+extra+comment>end||flags&~0x80e||![0,8].includes(method)||!compressed||compressed>compressedLimit||!expanded||expanded>expandedLimit||expanded>Math.max(compressed*250,1_000_000)||b.readUInt16LE(at+34)!==0||local!==localEnd||local+30>central)failure();
  const nameBytes=b.subarray(at+46,at+46+nameLength);let name:string;try{name=new TextDecoder('utf-8',{fatal:true}).decode(nameBytes);}catch{failure();}
  if(!/^[A-Za-z0-9_.-]+\.xml$/i.test(name!)||name!.includes('..')||names.has(name!))failure();names.add(name!);
  if(b.readUInt32LE(local)!==0x04034b50||b.readUInt16LE(local+6)!==flags||b.readUInt16LE(local+8)!==method||b.readUInt16LE(local+26)!==nameLength||!b.subarray(local+30,local+30+nameLength).equals(nameBytes))failure();
  const start=local+30+nameLength+b.readUInt16LE(local+28),dataEnd=start+compressed;
  if(start>central||dataEnd>central)failure();
  localEnd=dataEnd;
  if(flags&8){
   const signature=dataEnd+4<=central&&b.readUInt32LE(dataEnd)===0x08074b50,descriptor=dataEnd+(signature?4:0);localEnd=descriptor+12;
   if(localEnd>central||b.readUInt32LE(descriptor)!==crc||b.readUInt32LE(descriptor+4)!==compressed||b.readUInt32LE(descriptor+8)!==expanded)failure();
  }else if(b.readUInt32LE(local+14)!==crc||b.readUInt32LE(local+18)!==compressed||b.readUInt32LE(local+22)!==expanded)failure();
  total+=expanded;if(total>expandedLimit)failure('dart_profile_source_too_large');
  let decoded:Buffer;try{decoded=method===0?b.subarray(start,dataEnd):inflateRawSync(b.subarray(start,dataEnd),{maxOutputLength:expanded});}catch{failure();}
  if(decoded!.length!==expanded||crc32(decoded!)!==crc)failure();
  if(name!.toLowerCase()===receipt+'.xml')selected={name:name!,bytes:decoded!};
  at+=46+nameLength+extra+comment;
 }
 if(at!==end||localEnd!==central||!selected)failure('dart_profile_receipt_member_missing');
 return selected!;
}

function normalize(xml:string,p:ProfileParsePayload){
 if(/<!DOCTYPE|<!ENTITY/i.test(xml)||!/^\s*(?:<\?xml[^>]*>\s*)?<DOCUMENT(?:\s|>)/i.test(xml)||!/<\/DOCUMENT>\s*$/i.test(xml))failure('dart_profile_markup_unsupported');
 let normalization:'dart-periodic-xml-text-v1'|'dart-periodic-recovered-text-v1'='dart-periodic-xml-text-v1';
 try{const parser=new SaxesParser({xmlns:false});parser.on('error',()=>{throw new Error();});parser.write(xml).close();}
 catch{normalization='dart-periodic-recovered-text-v1';}
 const blocks:DartProfileBlock[]=[],companyNames:string[]=[],companyCodes:string[]=[],documentNames:string[]=[];
 let text='',value='',nodes=0,visible=0,depth=0,suppressed=0,kind:DartProfileBlock['kind']='paragraph',cells:string[]=[],cell:string|null=null;
 const captures:{name:string;value:string}[]=[];
 const clean=(v:string)=>v.replace(/\s+/g,' ').trim();
 const flush=()=>{const content=clean(value);if(content){if(text)text+='\n';const start=text.length;text+=content;blocks.push({text:content,start,end:text.length,kind,cells:[...cells]});}value='';cells=[];};
 const parser=new Parser({
  onopentag(name,attrs){
   if(++nodes>300_000||++depth>160)failure('dart_profile_source_too_large');
   if(['script','style','noscript'].includes(name))suppressed++;
   if(['company-name','document-name'].includes(name)){captures.push({name,value:''});if(name==='company-name'&&attrs.aregcik)companyCodes.push(attrs.aregcik);}
   if(suppressed)return;
   if(['p','title','tr'].includes(name)){if(cell===null)flush();kind=name==='tr'?'row':name==='title'?'heading':'paragraph';}
   if(['td','th','te','tu'].includes(name)){if(cell===null)cell='';value+=' ';}
   if(name==='br'){value+=' ';if(cell!==null)cell+=' ';}
  },
  ontext(part){
   for(const capture of captures)capture.value+=part;
   if(suppressed)return;visible+=part.length;if(visible>2_000_000)failure('dart_profile_source_too_large');
   value+=part;if(cell!==null)cell+=part;
  },
  onclosetag(name){
   const capture=captures.at(-1);if(capture?.name===name){(name==='company-name'?companyNames:documentNames).push(clean(capture.value));captures.pop();}
   if(['script','style','noscript'].includes(name)&&suppressed)suppressed--;
   if(!suppressed){
    if(['td','th','te','tu'].includes(name)&&cell!==null){cells.push(clean(cell));cell=null;value+=' ';}
    if(['p','title','tr'].includes(name)&&cell===null){if(name==='tr')kind='row';flush();kind='paragraph';}
   }
   depth=Math.max(0,depth-1);
  },
  onerror(){failure('dart_profile_markup_unsupported');},
 },{decodeEntities:true,recognizeCDATA:true,xmlMode:false});
 parser.write(xml);parser.end();flush();
 if(companyNames.length!==1||dartLegalName(companyNames[0])!==dartLegalName(p.company_name)||companyCodes.some(code=>code!==p.corp_code)||documentNames.length!==1||documentNames[0].replace(/\s/g,'')!==p.report_name.replace(/\s/g,''))failure('dart_profile_identity_mismatch');
 if(!text.trim())failure('dart_profile_source_empty');
 return {normalization,normalized_text:text,...dartProfileFields(text,blocks,p.sha)};
}

export function parseDartProfileArchive(bytes:Uint8Array,p:ProfileParsePayload){
 if(createHash('sha256').update(bytes).digest('hex')!==p.sha)failure('dart_profile_hash_mismatch');
 const member=documentMember(bytes,p.receipt);let xml:string;try{xml=new TextDecoder('utf-8',{fatal:true}).decode(member.bytes);}catch{failure('dart_profile_encoding_unsupported');}
 const parsed=normalize(xml!,p),result={source_sha256:p.sha,normalized_sha256:createHash('sha256').update(parsed.normalized_text).digest('hex'),member:member.name,...parsed};
 if(Buffer.byteLength(JSON.stringify(result))>responseLimit)failure('dart_profile_source_too_large');return result;
}

export async function parseArchivedDartProfile(p:ProfileParsePayload,projectUrl:string,fetcher:typeof fetch=fetch){
 const response=await fetcher(profileArchiveURL(p,projectUrl),{method:'GET',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10_000)});
 if(response.status!==200||Number(response.headers.get('content-length')??0)>compressedLimit){await response.body?.cancel();failure('dart_profile_archive_unavailable');}
 const reader=response.body?.getReader();if(!reader)failure('dart_profile_archive_unavailable');
 const chunks:Uint8Array[]=[];let length=0;
 try{while(true){const next=await reader!.read();if(next.done)break;length+=next.value.length;if(length>compressedLimit)failure('dart_profile_source_too_large');chunks.push(next.value);}}
 catch(error){await reader!.cancel().catch(()=>{});throw error;}
 return parseDartProfileArchive(Buffer.concat(chunks,length),p);
}
