import {ProviderError} from '../signalbrief-api/us-core.ts';
export type ZipMember={name:string;size:number;crc:number};
export function inspectDartZIP(bytes:Uint8Array):ZipMember[]{
 if(bytes.length<22||bytes.length>20_000_000)throw new ProviderError('dart','archive_size_limit');
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let end=-1;
 for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(view.getUint32(i,true)===0x06054b50){end=i;break;}
 if(end<0||end+22+view.getUint16(end+20,true)!==bytes.length||view.getUint16(end+4,true)!==0||view.getUint16(end+6,true)!==0)throw new ProviderError('dart','invalid_archive');
 const count=view.getUint16(end+10,true),size=view.getUint32(end+12,true),offset=view.getUint32(end+16,true);
 if(count<1||count>20||offset+size>end)throw new ProviderError('dart','archive_member_limit');
 let position=offset,total=0;const members:ZipMember[]=[],seen=new Set<string>();
 for(let i=0;i<count;i++){
  if(position+46>end||view.getUint32(position,true)!==0x02014b50)throw new ProviderError('dart','invalid_directory');
  const flags=view.getUint16(position+8,true),method=view.getUint16(position+10,true),compressed=view.getUint32(position+20,true),uncompressed=view.getUint32(position+24,true),nameLength=view.getUint16(position+28,true),extra=view.getUint16(position+30,true),comment=view.getUint16(position+32,true);
  const name=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(position+46,position+46+nameLength));
  if(flags&1||![0,8].includes(method)||!nameLength||!/^[A-Za-z0-9_.-]+\.xml$/i.test(name)||name.includes('..')||seen.has(name)||uncompressed>32_000_000||compressed>20_000_000||uncompressed>Math.max(compressed*250,1_000_000))throw new ProviderError('dart','unsafe_archive_member');
  total+=uncompressed;if(total>32_000_000)throw new ProviderError('dart','expanded_size_limit');
  seen.add(name);members.push({name,size:uncompressed,crc:view.getUint32(position+16,true)});
  position+=46+nameLength+extra+comment;
 }
 if(position!==offset+size)throw new ProviderError('dart','invalid_directory');
 return members;
}
export function crc32(bytes:Uint8Array):number{let crc=0xffffffff;for(const value of bytes){crc^=value;for(let i=0;i<8;i++)crc=crc&1?(crc>>>1)^0xedb88320:crc>>>1;}return (crc^0xffffffff)>>>0;}
export function validateDartXML(text:string):void{
 if(/<!DOCTYPE|<!ENTITY/i.test(text))throw new ProviderError('dart','xml_entities_not_supported');
 if(!text.trim().startsWith('<'))throw new ProviderError('dart','invalid_xml');
}
