// @vitest-environment node
import {describe,it,expect,vi} from 'vitest';
import {directorySourceUrl,parseArchivedDartDirectory,parseDartDirectoryArchive} from '../src/server/dart-directory-archive';
import {directoryZip,listedXML,parsePayload,projectUrl,zipSha} from './dart-directory-fixture';

describe('archived DART directory source boundary',()=>{
 const bytes=directoryZip(listedXML()),payload=parsePayload(zipSha(bytes));
 it('downloads only the signed source object and returns source-bound validated entries',async()=>{
  const fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response(bytes));
  const result=await parseArchivedDartDirectory(payload,projectUrl,fetcher);
  expect(result.source_sha256).toBe(payload.sha);expect(result.items).toHaveLength(100);
  expect(result.items[0]).toEqual({provider_company_id:'00100000',ticker:'100000',name:'Synthetic Company 0',official_english_name:'Synthetic Research 0',market:'KR'});
  const [url,init]=fetcher.mock.calls[0];expect(String(url)).toBe(payload.source_url);
  expect(init).toMatchObject({method:'GET',cache:'no-store',redirect:'error'});expect(init?.signal).toBeInstanceOf(AbortSignal);expect(init?.headers).toBeUndefined();
 });
 it.each([
  (url:string)=>url.replace('fixture.supabase.co','attacker.test'),
  (url:string)=>url.replace('fixture.supabase.co','different.supabase.co'),
  (url:string)=>url.replace('https:','http:'),
  (url:string)=>url.replace('https://','https://user:secret@'),
  (url:string)=>url.replace('fixture.supabase.co','fixture.supabase.co:8443'),
  (url:string)=>url.replace('signalbrief-raw','other-bucket'),
  (url:string)=>url.replace('/directory/dart/','/dart/profiles/'),
  (url:string)=>url.replace(payload.sha,'a'.repeat(64)),
  (url:string)=>url+'&download=1',
  (url:string)=>url+'&token=duplicate',
  (url:string)=>url+'#fragment',
  (url:string)=>url.replace('?token=synthetic.signed.token',''),
 ])('rejects a changed origin, object, credential or query before any network request',async change=>{
  const fetcher=vi.fn<typeof fetch>();
  await expect(parseArchivedDartDirectory({...payload,source_url:change(payload.source_url)},projectUrl,fetcher)).rejects.toThrow('relay_invalid_request');
  expect(fetcher).not.toHaveBeenCalled();
 });
 it('fails closed when the server project origin is not the configured Supabase endpoint',()=>{
  for(const configured of ['', 'http://fixture.supabase.co','https://attacker.test','https://fixture.supabase.co/other'])expect(()=>directorySourceUrl(payload,configured)).toThrow('relay_invalid_request');
 });
 it.each([302,401,403,404,500])('rejects redirects, expired/unauthorized links and failed storage responses (%s)',async status=>{
  const fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response('unavailable',{status}));
  await expect(parseArchivedDartDirectory(payload,projectUrl,fetcher)).rejects.toThrow('directory_download_failed');
  expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it('enforces the announced compressed byte limit',async()=>{
  const fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response(bytes,{headers:{'Content-Length':'20000001'}}));
  await expect(parseArchivedDartDirectory(payload,projectUrl,fetcher)).rejects.toThrow('directory_download_failed');
 });
 it('enforces the streamed byte limit and cancels the reader',async()=>{
  const cancel=vi.fn();let part=0;
  const stream=new ReadableStream<Uint8Array>({pull(controller){controller.enqueue(new Uint8Array(++part===1?20_000_000:1));},cancel});
  const fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response(stream));
  await expect(parseArchivedDartDirectory(payload,projectUrl,fetcher)).rejects.toThrow('directory_download_too_large');expect(cancel).toHaveBeenCalledTimes(1);
 });
});

describe('bounded Node directory archive processing',()=>{
 it('preserves the complete registry when listed issuers have official alphanumeric stock codes',()=>{
  const xml=listedXML().replace('<stock_code>100000</stock_code>','<stock_code>0068Y0</stock_code>').replace('<stock_code>100001</stock_code>','<stock_code>0017J0</stock_code>');
  const bytes=directoryZip(xml,{descriptor:true}),result=parseDartDirectoryArchive(bytes,zipSha(bytes));
  expect(result.items).toHaveLength(100);expect(result.source_sha256).toBe(zipSha(bytes));
  expect(result.items[0]).toMatchObject({provider_company_id:'00100000',ticker:'0068Y0'});
  expect(result.items[1]).toMatchObject({provider_company_id:'00100001',ticker:'0017J0'});
  expect(result.items.at(-1)?.ticker).toBe('100099');
 });
 it.each(['0068y0','068Y0','00068Y0','006.Y0','006 Y0','００６８Ｙ０'])('rejects malformed stock code %s without returning a partial registry',ticker=>{
  const xml=listedXML().replace('<stock_code>100050</stock_code>',`<stock_code>${ticker}</stock_code>`),bytes=directoryZip(xml);
  expect(()=>parseDartDirectoryArchive(bytes,zipSha(bytes))).toThrow('invalid_dart_directory');
 });
 it.each([{},{stored:true},{descriptor:true}])('accepts standard stored/deflated archives with validated local and central metadata (%j)',options=>{
  const bytes=directoryZip(listedXML(),options);expect(parseDartDirectoryArchive(bytes,zipSha(bytes)).items).toHaveLength(100);
 });
 it('checks the archived hash before interpreting ZIP or XML content',()=>{
  expect(()=>parseDartDirectoryArchive(directoryZip(listedXML()),'0'.repeat(64))).toThrow('directory_hash_mismatch');
 });
 it.each(['other.xml','../CORPCODE.xml'])('rejects an unexpected or path-like member name (%s)',name=>{
  const bytes=directoryZip(listedXML(),{name});expect(()=>parseDartDirectoryArchive(bytes,zipSha(bytes))).toThrow('directory_invalid_archive');
 });
 it('rejects CRC mismatch even when both headers agree and the archive hash matches',()=>{
  const bytes=directoryZip(listedXML()),central=bytes.readUInt32LE(bytes.length-6);
  bytes.writeUInt32LE(123,14);bytes.writeUInt32LE(123,central+16);
  expect(()=>parseDartDirectoryArchive(bytes,zipSha(bytes))).toThrow('directory_invalid_archive');
 });
 it.each([80_000_001,16])('bounds both declared expanded size and actual native inflation (%s)',size=>{
  const bytes=directoryZip(listedXML()),central=bytes.readUInt32LE(bytes.length-6);
  bytes.writeUInt32LE(size,22);bytes.writeUInt32LE(size,central+24);
  expect(()=>parseDartDirectoryArchive(bytes,zipSha(bytes))).toThrow('directory_invalid_archive');
 });
 it('rejects extra archive members and encrypted content',()=>{
  for(const mutate of [(bytes:Buffer)=>{bytes.writeUInt16LE(2,bytes.length-14);bytes.writeUInt16LE(2,bytes.length-12);},(bytes:Buffer)=>{bytes.writeUInt16LE(1,6);bytes.writeUInt16LE(1,bytes.readUInt32LE(bytes.length-6)+8);}]){
   const bytes=directoryZip(listedXML());mutate(bytes);expect(()=>parseDartDirectoryArchive(bytes,zipSha(bytes))).toThrow('directory_invalid_archive');
  }
 });
 it('retains strict XML/entity/encoding and complete listed-snapshot checks',()=>{
  for(const xml of ['<!DOCTYPE result [<!ENTITY x SYSTEM "file:///etc/passwd">]><result>&x;</result>','<result><list>',listedXML(99)]){
   const bytes=directoryZip(xml);expect(()=>parseDartDirectoryArchive(bytes,zipSha(bytes))).toThrow();
  }
  const bytes=directoryZip(Buffer.from([0xff,0xfe,0x3c]));expect(()=>parseDartDirectoryArchive(bytes,zipSha(bytes))).toThrow('directory_invalid_xml');
 });
 it('caps the JSON response instead of returning a partial directory',()=>{
  const xml=listedXML(8000,'A'.repeat(490)),bytes=directoryZip(xml,{stored:true});
  expect(()=>parseDartDirectoryArchive(bytes,zipSha(bytes))).toThrow('directory_response_too_large');
 });
});
