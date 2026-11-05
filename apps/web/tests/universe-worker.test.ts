// @vitest-environment node
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {describe,it,expect,vi} from 'vitest';
import {UniverseError,sha256} from '../../../supabase/functions/signalbrief-universe/core';

function fixture(){
 let handler!:(req:Request)=>Promise<Response>;
 const checked={raw:new Uint8Array([1,2,3]),manifestBytes:new TextEncoder().encode('{}'),raw_sha256:'b'.repeat(64),manifest_sha256:'c'.repeat(64),raw_object_key:'universe/raw/synthetic/b.bin',manifest_object_key:'universe/manifests/c.json'};
 const verifyUniversePayload=vi.fn().mockResolvedValue(checked),upload=vi.fn().mockResolvedValue({error:null}),download=vi.fn();
 const rpc=vi.fn().mockImplementation(async(name:string)=>({error:null,data:name==='sb_universe_claim'?{snapshot_id:'synthetic'}:{status:'applied',counts:{listings:1}}}));
 const createClient=vi.fn(()=>({rpc,storage:{from:()=>({upload,download})}}));
 const code=readFileSync(new URL('../../../supabase/functions/signalbrief-universe/index.ts',import.meta.url),'utf8').replace(/^import .*\r?\n/gm,'').replace(/^export /gm,'');
 runInNewContext(ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText,{createClient,UniverseError,sha256,verifyUniversePayload,Response,Request,Headers,TextEncoder,Uint8Array,AbortSignal,fetch:vi.fn(),Deno:{env:{get:()=>''},serve:(fn:typeof handler)=>{handler=fn;}}});
 return {rpc,upload,download,verifyUniversePayload,checked,call:(method='POST',token='a'.repeat(64))=>handler(new Request('https://fixture.invalid/universe',{method,headers:{'x-signalbrief-task':token}}))};
}
describe('private universe archive worker',()=>{
 it('rejects malformed tokens and unsupported methods before a database or archive call',async()=>{
  const f=fixture();expect((await f.call('GET')).status).toBe(405);expect((await f.call('POST','invalid')).status).toBe(401);expect(f.rpc).not.toHaveBeenCalled();
 });
 it('never parses or archives an unclaimed/replayed task',async()=>{
  const f=fixture();f.rpc.mockResolvedValueOnce({error:null,data:null});expect((await f.call()).status).toBe(401);expect(f.verifyUniversePayload).not.toHaveBeenCalled();expect(f.upload).not.toHaveBeenCalled();
 });
 it('archives exact original and manifest without overwrite before atomic publication',async()=>{
  const f=fixture();expect(await(await f.call()).json()).toEqual({status:'applied',counts:{listings:1}});
  expect(f.upload.mock.calls).toEqual([[f.checked.raw_object_key,f.checked.raw,{contentType:'application/octet-stream',upsert:false}],[f.checked.manifest_object_key,f.checked.manifestBytes,{contentType:'application/json',upsert:false}]]);
  expect(f.rpc.mock.calls.map(([name])=>name)).toEqual(['sb_universe_claim','sb_universe_finish']);
  expect(f.rpc).toHaveBeenLastCalledWith('sb_universe_finish',expect.objectContaining({raw_sha256:f.checked.raw_sha256,manifest_sha256:f.checked.manifest_sha256}));
 });
 it('source row or hash failure records a bounded retry and never archives or registers',async()=>{
  const f=fixture();f.verifyUniversePayload.mockRejectedValueOnce(new UniverseError('universe_row_evidence_mismatch'));
  expect((await f.call()).status).toBe(502);expect(f.upload).not.toHaveBeenCalled();expect(f.rpc.mock.calls.map(([name])=>name)).toEqual(['sb_universe_claim','sb_universe_fail']);
 });
 it('detects a conflicting preexisting immutable object instead of treating a duplicate as success',async()=>{
  const f=fixture();f.upload.mockResolvedValueOnce({error:{message:'The resource already exists'}});f.download.mockResolvedValueOnce({error:null,data:new Blob([new Uint8Array([9,9,9])])});
  expect(await(await f.call()).json()).toEqual({error:'universe_archive_conflict'});expect(f.rpc.mock.calls.some(([name])=>name==='sb_universe_finish')).toBe(false);
 });
});
