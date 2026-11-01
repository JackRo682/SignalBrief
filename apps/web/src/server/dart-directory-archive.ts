import {createHash} from 'node:crypto';
import {inflateRawSync} from 'node:zlib';
import {parseDartDirectory} from './dart-directory';

export type DirectoryParsePayload={kind:'directory_parse';source_url:string;sha:string;nonce:string};
const compressedLimit=20_000_000,expandedLimit=80_000_000,responseLimit=4_000_000;
const crcTable=Uint32Array.from({length:256},(_,value)=>{for(let bit=0;bit<8;bit++)value=value&1?(value>>>1)^0xedb88320:value>>>1;return value>>>0;});
function crc32(bytes:Uint8Array){let crc=0xffffffff;for(const byte of bytes)crc=(crc>>>8)^crcTable[(crc^byte)&255];return (crc^0xffffffff)>>>0;}

/** The HMAC authorizes one already-archived object, never an arbitrary fetch URL. */
export function directorySourceUrl(payload:DirectoryParsePayload,projectUrl:string):URL{
 try{
  const expected=new URL(projectUrl),url=new URL(payload.source_url);
  if(expected.protocol!=='https:'||!/^[a-z0-9-]+\.supabase\.co$/.test(expected.hostname)||expected.username||expected.password||expected.port||expected.pathname!=='/'||expected.search||expected.hash)throw new Error();
  if(!/^[a-f0-9]{64}$/.test(payload.sha)||url.origin!==expected.origin||url.username||url.password||url.hash||url.pathname!==`/storage/v1/object/sign/signalbrief-raw/directory/dart/${payload.sha}.zip`)throw new Error();
  const keys=[...url.searchParams.keys()],token=url.searchParams.get('token');
  if(keys.length!==1||keys[0]!=='token'||!token||token.length>3072||!/^[A-Za-z0-9_.-]+$/.test(token))throw new Error();
  return url;
 }catch{throw new Error('relay_invalid_request');}
}

/** Strict single-member ZIP validation, bounded native inflation and CRC check. */
export function parseDartDirectoryArchive(bytes:Uint8Array,expectedSha:string){
 if(!/^[a-f0-9]{64}$/.test(expectedSha)||bytes.length<22||bytes.length>compressedLimit)throw new Error('directory_invalid_archive');
 if(createHash('sha256').update(bytes).digest('hex')!==expectedSha)throw new Error('directory_hash_mismatch');
 const b=Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength);let end=-1;
 for(let at=b.length-22;at>=Math.max(0,b.length-65557);at--)if(b.readUInt32LE(at)===0x06054b50){end=at;break;}
 if(end<0||end+22+b.readUInt16LE(end+20)!==b.length||b.readUInt16LE(end+4)!==0||b.readUInt16LE(end+6)!==0||b.readUInt16LE(end+8)!==1||b.readUInt16LE(end+10)!==1)throw new Error('directory_invalid_archive');
 const size=b.readUInt32LE(end+12),offset=b.readUInt32LE(end+16);
 if(offset+size!==end||offset+46>end||b.readUInt32LE(offset)!==0x02014b50)throw new Error('directory_invalid_archive');
 const flags=b.readUInt16LE(offset+8),method=b.readUInt16LE(offset+10),crc=b.readUInt32LE(offset+16),compressed=b.readUInt32LE(offset+20),expanded=b.readUInt32LE(offset+24),nameSize=b.readUInt16LE(offset+28),extra=b.readUInt16LE(offset+30),comment=b.readUInt16LE(offset+32),local=b.readUInt32LE(offset+42);
 if(flags&~0x80e||![0,8].includes(method)||!compressed||compressed>compressedLimit||!expanded||expanded>expandedLimit||expanded>Math.max(compressed*250,1_000_000)||local!==0||b.readUInt16LE(offset+34)!==0||offset+46+nameSize+extra+comment!==end)throw new Error('directory_invalid_archive');
 const name=b.subarray(offset+46,offset+46+nameSize);
 if(name.toString('utf8').toUpperCase()!=='CORPCODE.XML'||offset<30||b.readUInt32LE(0)!==0x04034b50||b.readUInt16LE(6)!==flags||b.readUInt16LE(8)!==method||b.readUInt16LE(26)!==nameSize)throw new Error('directory_invalid_archive');
 const start=30+nameSize+b.readUInt16LE(28),dataEnd=start+compressed;
 if(start>offset||dataEnd>offset||!b.subarray(30,30+nameSize).equals(name))throw new Error('directory_invalid_archive');
 if(flags&8){
  const descriptorSize=offset-dataEnd,descriptor=dataEnd+(descriptorSize===16?4:0);
  if(![12,16].includes(descriptorSize)||(descriptorSize===16&&b.readUInt32LE(dataEnd)!==0x08074b50)||b.readUInt32LE(descriptor)!==crc||b.readUInt32LE(descriptor+4)!==compressed||b.readUInt32LE(descriptor+8)!==expanded)throw new Error('directory_invalid_archive');
 }else if(dataEnd!==offset||b.readUInt32LE(14)!==crc||b.readUInt32LE(18)!==compressed||b.readUInt32LE(22)!==expanded)throw new Error('directory_invalid_archive');
 let xml:Buffer;
 try{xml=method===0?b.subarray(start,dataEnd):inflateRawSync(b.subarray(start,dataEnd),{maxOutputLength:expanded});}catch{throw new Error('directory_invalid_archive');}
 if(xml.length!==expanded||crc32(xml)!==crc)throw new Error('directory_invalid_archive');
 let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(xml);}catch{throw new Error('directory_invalid_xml');}
 const items=parseDartDirectory(text);
 if(items.length<100)throw new Error('incomplete_official_directory');
 const result={source_sha256:expectedSha,items};
 if(Buffer.byteLength(JSON.stringify(result))>responseLimit)throw new Error('directory_response_too_large');
 return result;
}

export async function parseArchivedDartDirectory(payload:DirectoryParsePayload,projectUrl:string,fetcher:typeof fetch=fetch){
 const url=directorySourceUrl(payload,projectUrl);
 const response=await fetcher(url,{method:'GET',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});
 if(response.status!==200||Number(response.headers.get('content-length')??0)>compressedLimit){await response.body?.cancel();throw new Error('directory_download_failed');}
 const reader=response.body?.getReader();if(!reader)throw new Error('directory_download_failed');
 const chunks:Uint8Array[]=[];let length=0;
 try{
  while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>compressedLimit)throw new Error('directory_download_too_large');chunks.push(value);}
 }catch(error){await reader.cancel().catch(()=>{});throw error;}
 return parseDartDirectoryArchive(Buffer.concat(chunks,length),payload.sha);
}
