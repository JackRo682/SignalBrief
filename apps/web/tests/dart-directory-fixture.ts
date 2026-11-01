import {createHash} from 'node:crypto';
import {crc32,deflateRawSync} from 'node:zlib';

/** Synthetic single-member standard ZIP, built independently from the consumer. */
export function directoryZip(xml:string|Buffer,options:{name?:string;stored?:boolean;descriptor?:boolean}={}){
 const source=typeof xml==='string'?Buffer.from(xml):xml,name=Buffer.from(options.name??'CORPCODE.xml');
 const packed=options.stored?source:deflateRawSync(source),method=options.stored?0:8,crc=crc32(source),flags=options.descriptor?8:0;
 const local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22),descriptor=options.descriptor?Buffer.alloc(16):Buffer.alloc(0);
 local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(flags,6);local.writeUInt16LE(method,8);local.writeUInt16LE(name.length,26);
 if(options.descriptor){descriptor.writeUInt32LE(0x08074b50);descriptor.writeUInt32LE(crc,4);descriptor.writeUInt32LE(packed.length,8);descriptor.writeUInt32LE(source.length,12);}
 else{local.writeUInt32LE(crc,14);local.writeUInt32LE(packed.length,18);local.writeUInt32LE(source.length,22);}
 central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(flags,8);central.writeUInt16LE(method,10);central.writeUInt32LE(crc,16);central.writeUInt32LE(packed.length,20);central.writeUInt32LE(source.length,24);central.writeUInt16LE(name.length,28);
 end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(local.length+name.length+packed.length+descriptor.length,16);
 return Buffer.concat([local,name,packed,descriptor,central,name,end]);
}
export const zipSha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
export function listedXML(count=100,longName='Synthetic Company'){
 return '<result>'+Array.from({length:count},(_,index)=>`<list><corp_code>${String(100000+index).padStart(8,'0')}</corp_code><corp_name>${longName} ${index}</corp_name><corp_eng_name>Synthetic Research ${index}</corp_eng_name><stock_code>${100000+index}</stock_code></list>`).join('')+'</result>';
}
/** One deterministic full-registry workload, generated in memory rather than checked in. */
export function largeDirectoryFixture(){
 const listedCount=4000,unlistedCount=220000;
 const unlisted=Array.from({length:unlistedCount},(_,index)=>`<list><corp_code>${String(index+200000).padStart(8,'0')}</corp_code><corp_name>Synthetic unlisted company ${index}</corp_name><corp_eng_name>Synthetic unlisted corporation number ${index}</corp_eng_name><stock_code> </stock_code><modify_date>20261101</modify_date></list>`).join('');
 const xml=listedXML(listedCount).replace('<stock_code>100001</stock_code>','<stock_code>0068Y0</stock_code>').replace('</result>',unlisted+'</result>');
 return {bytes:directoryZip(xml),expandedBytes:Buffer.byteLength(xml),listedCount,unlistedCount};
}
export const projectUrl='https://fixture.supabase.co';
export function parsePayload(sha:string){return {kind:'directory_parse' as const,source_url:`${projectUrl}/storage/v1/object/sign/signalbrief-raw/directory/dart/${sha}.zip?token=synthetic.signed.token`,sha,nonce:'c'.repeat(64)};}
