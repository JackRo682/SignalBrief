// @vitest-environment node
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import type {ClientRequest,IncomingMessage} from 'node:http';
import type {RequestOptions} from 'node:https';
import type {LookupFunction} from 'node:net';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {downloadCalendarSource,verifyCalendarSource,CALENDAR_SOURCE_MAX_BYTES,CALENDAR_SOURCE_TIMEOUT_MS,CALENDAR_SOURCE_MAX_REDIRECTS} from '../src/server/calendar-source';
import {relaySignature} from '../src/server/dart-relay';

const url='https://investors.synthetic-corp.com/events/?year=-1',secret='b'.repeat(64),now=Date.now();
const payload={kind:'calendar_source',url,nonce:'a'.repeat(64)};
const publicRecords=[{address:'8.8.4.4',family:4},{address:'2606:4700:4700::1111',family:6}];
type WireOptions={status?:number;headers?:Record<string,string|undefined>;chunks?:Buffer[];complete?:boolean;hang?:boolean;transportError?:boolean};
function wire(options:WireOptions={}){
 const response=new PassThrough() as PassThrough&IncomingMessage;
 response.statusCode=options.status??200;response.headers=options.headers??{'content-type':'text/html; charset=utf-8'};response.complete=options.complete??true;
 const request=new EventEmitter() as ClientRequest;
 request.destroy=vi.fn(()=>request);request.end=vi.fn(()=>{
  queueMicrotask(()=>{
   if(options.transportError){request.emit('error',new Error('raw transport detail must not escape'));return;}
   if(options.hang)return;
   const callback=send.mock.calls[0][2] as (response:IncomingMessage)=>void;
   callback(response);for(const chunk of options.chunks??[Buffer.from('<html>Verified original</html>')])if(!response.destroyed)response.write(chunk);if(!response.destroyed)response.end();
  });return request;
 });
 const send=vi.fn<(url:URL,options:RequestOptions,callback:(response:IncomingMessage)=>void)=>ClientRequest>(()=>request);
 const resolve=vi.fn().mockResolvedValue(publicRecords.map(record=>({...record})));
 return {request:send as unknown as typeof import('node:https').request,send,resolve,response,socketRequest:request};
}
function wireSequence(responses:WireOptions[]){
 const wires=responses.map(options=>wire(options));let index=0;
 const send=vi.fn<(url:URL,options:RequestOptions,callback:(response:IncomingMessage)=>void)=>ClientRequest>((target,options,callback)=>{
  const next=wires[index++];if(!next)throw new Error('unexpected_request');return next.send(target,options,callback);
 });
 const resolve=vi.fn().mockResolvedValue(publicRecords.map(record=>({...record})));
 return {request:send as unknown as typeof import('node:https').request,send,resolve,wires};
}
function signed(value:unknown=payload){const body=JSON.stringify(value),stamp=String(now);return {body,stamp,signature:relaySignature(body,stamp,secret)};}
afterEach(()=>vi.useRealTimers());

describe('signed calendar source request',()=>{
 it('authenticates an exact bounded operation and rejects stale, modified, malformed and extra fields',()=>{
  const request=signed();expect(verifyCalendarSource(request.body,request.stamp,request.signature,secret,now)).toEqual(payload);
  for(const [body,timestamp,signature,key]of [
   [request.body,request.stamp,'',secret],[request.body,String(now-60001),request.signature,secret],
   [request.body.replace('year=-1','year=0'),request.stamp,request.signature,secret],[request.body,request.stamp,request.signature,'short'],
  ])expect(()=>verifyCalendarSource(body,timestamp,signature,key,now)).toThrow('relay_unauthorized');
  for(const value of [{...payload,key:'credential'},{...payload,headers:{Authorization:'private'}},{...payload,kind:'directory'},
   {...payload,nonce:[payload.nonce]},[payload],null,{...payload,url:[url]}]){
   const invalid=signed(value);expect(()=>verifyCalendarSource(invalid.body,invalid.stamp,invalid.signature,secret,now)).toThrow('relay_invalid_request');
  }
 });
 it.each(['http://investors.synthetic-corp.com/','https://user:password@investors.synthetic-corp.com/',
  'https://127.0.0.1/','https://[::1]/','https://2130706433/','https://metadata.google.internal/',
  'https://private.supabase.co/','https://investors.synthetic-corp.com:444/','https://investors.synthetic-corp.com:443/',
  'https://investors.synthetic-corp.com./','https://investors.synthetic-corp.com/#fragment','https://investors.synthetic-corp.com/\n'])('denies an unsafe URL before DNS (%s)',async target=>{
  const w=wire();await expect(downloadCalendarSource(target,w)).rejects.toThrow();expect(w.resolve).not.toHaveBeenCalled();expect(w.send).not.toHaveBeenCalled();
  const request=signed({...payload,url:target});expect(()=>verifyCalendarSource(request.body,request.stamp,request.signature,secret,now)).toThrow('relay_invalid_request');
 });
});

describe('HTTPS connection pins the verified address',()=>{
 it('pins all socket lookup forms to the verified IP and preserves host/TLS identity without credentials or pool reuse',async()=>{
  const w=wire();const result=await downloadCalendarSource(url,w);expect(result.bytes.toString()).toBe('<html>Verified original</html>');
  expect(w.resolve).toHaveBeenCalledExactlyOnceWith('investors.synthetic-corp.com');expect(w.send).toHaveBeenCalledTimes(1);
  const [endpoint,options]=w.send.mock.calls[0];expect(endpoint.href).toBe(url);
  expect(options).toMatchObject({method:'GET',agent:false,family:4,autoSelectFamily:false,servername:'investors.synthetic-corp.com',rejectUnauthorized:true,minVersion:'TLSv1.2'});
  expect(options.headers).toEqual({Accept:'text/html,application/xhtml+xml,application/json','Accept-Encoding':'identity','User-Agent':'SignalBrief/0.4 (+https://signalbrief.online)'});
  // A later malicious DNS result never participates in the TLS socket's lookup.
  w.resolve.mockResolvedValue([{address:'127.0.0.1',family:4}]);
  const lookup=options.lookup as LookupFunction,one=vi.fn(),all=vi.fn(),foreign=vi.fn();
  lookup(endpoint.hostname,{},one);lookup(endpoint.hostname,{all:true},all);lookup('other.synthetic-corp.com',{},foreign);
  expect(one).toHaveBeenCalledWith(null,'8.8.4.4',4);expect(all).toHaveBeenCalledWith(null,[{address:'8.8.4.4',family:4}]);
  expect(foreign.mock.calls[0][0].message).toBe('source_hostname_mismatch');expect(w.resolve).toHaveBeenCalledTimes(1);
 });
 it('supports a verified IPv6-only origin with matching DNS family',async()=>{
  const w=wire();w.resolve.mockResolvedValue([publicRecords[1]]);await downloadCalendarSource(url,w);
  expect(w.send.mock.calls[0][1]).toMatchObject({family:6,servername:'investors.synthetic-corp.com'});
  const callback=vi.fn();(w.send.mock.calls[0][1].lookup as LookupFunction)('investors.synthetic-corp.com',{},callback);
  expect(callback).toHaveBeenCalledWith(null,'2606:4700:4700::1111',6);
 });
 it.each([[],[{address:'127.0.0.1',family:4}],[{address:'10.0.0.1',family:4}],
  [{address:'169.254.169.254',family:4}],[{address:'100.64.0.1',family:4}],
  [{address:'172.31.2.3',family:4}],[{address:'192.168.2.3',family:4}],
  [{address:'::1',family:6}],[{address:'::ffff:127.0.0.1',family:6}],[{address:'fe80::1',family:6}],
  [{address:'fd12::1',family:6}],[{address:'2002:7f00:1::',family:6}],
  [publicRecords[0],{address:'10.0.0.1',family:4}],[{address:'8.8.4.4',family:6}],
  Array.from({length:33},()=>publicRecords[0]),
 ].map(addresses=>({addresses})))('denies empty, mixed-public/private and non-public DNS sets %#',async({addresses})=>{
  const w=wire();w.resolve.mockResolvedValue(addresses);await expect(downloadCalendarSource(url,w)).rejects.toThrow('source_non_public_address');expect(w.send).not.toHaveBeenCalled();
 });
 it('rejects resolver failures without forwarding raw errors or reaching HTTPS',async()=>{
  const w=wire();w.resolve.mockRejectedValue(new Error('secret DNS resolver detail'));
  await expect(downloadCalendarSource(url,w)).rejects.toThrow('source_dns_failed');expect(w.send).not.toHaveBeenCalled();
 });
 it('has one total deadline covering DNS and an abortable response wait',async()=>{
  vi.useFakeTimers();const dns=wire();dns.resolve.mockImplementation(()=>new Promise(()=>{}));
  const pending=downloadCalendarSource(url,dns),check=expect(pending).rejects.toThrow('source_timeout');
  await vi.advanceTimersByTimeAsync(CALENDAR_SOURCE_TIMEOUT_MS);await check;expect(dns.send).not.toHaveBeenCalled();
  const stalled=wire({hang:true}),controller=new AbortController();const waiting=downloadCalendarSource(url,{...stalled,signal:controller.signal});
  const rejected=expect(waiting).rejects.toThrow('source_timeout');await vi.advanceTimersByTimeAsync(1);controller.abort();await rejected;expect(stalled.socketRequest.destroy).toHaveBeenCalled();
 });
 it.each([403,500])('rejects HTTP status %s with a safe numeric diagnostic',async status=>{
  const w=wire({status,headers:{'content-type':'text/html',location:'https://127.0.0.1/'}});
  await expect(downloadCalendarSource(url,w)).rejects.toMatchObject({message:'source_http_error',upstreamStatus:status});expect(w.send).toHaveBeenCalledTimes(1);
 });
 it.each([301,302,303,307,308])('follows a same-origin HTTPS %s redirect with fresh verified DNS and TLS pinning',async status=>{
  const w=wireSequence([{status,headers:{location:'/overview/default.aspx'}},{}]);
  w.resolve.mockResolvedValueOnce([publicRecords[0]]).mockResolvedValueOnce([publicRecords[1]]);
  const result=await downloadCalendarSource(url,w);expect(result.bytes.toString()).toBe('<html>Verified original</html>');
  expect(w.send.mock.calls.map(([target])=>target.href)).toEqual([url,'https://investors.synthetic-corp.com/overview/default.aspx']);
  expect(w.resolve.mock.calls).toEqual([['investors.synthetic-corp.com'],['investors.synthetic-corp.com']]);
  for(const [index,[target,options]]of w.send.mock.calls.entries()){
   expect(options).toMatchObject({method:'GET',agent:false,servername:target.hostname,rejectUnauthorized:true,minVersion:'TLSv1.2',family:publicRecords[index].family});
   expect(options.headers).toEqual({Accept:'text/html,application/xhtml+xml,application/json','Accept-Encoding':'identity','User-Agent':'SignalBrief/0.4 (+https://signalbrief.online)'});
   const pinned=vi.fn();(options.lookup as LookupFunction)(target.hostname,{},pinned);
   expect(pinned).toHaveBeenCalledWith(null,publicRecords[index].address,publicRecords[index].family);
  }
  expect(w.wires[0].response.destroyed).toBe(true);
 });
 it.each(['https://other.synthetic-corp.com/','//other.synthetic-corp.com/','http://investors.synthetic-corp.com/',
  'https://user:password@investors.synthetic-corp.com/','https://investors.synthetic-corp.com:444/',
  'https://127.0.0.1/','https://[::1]/','https://metadata.google.internal/','/events/#fragment','/events/\n',
  'https://[invalid/','',undefined,'/'.repeat(2049)])('rejects an unsafe or malformed redirect before another DNS lookup (%s)',async location=>{
  const w=wireSequence([{status:302,headers:{location}},{}]);
  await expect(downloadCalendarSource(url,w)).rejects.toThrow('source_redirect_invalid');
  expect(w.resolve).toHaveBeenCalledTimes(1);expect(w.send).toHaveBeenCalledTimes(1);
 });
 it('rejects public-to-private or mixed DNS rebinding on the next same-origin hop',async()=>{
  for(const addresses of [[{address:'127.0.0.1',family:4}],[publicRecords[0],{address:'10.0.0.1',family:4}]]){
   const w=wireSequence([{status:301,headers:{location:'/overview/'}},{}]);
   w.resolve.mockResolvedValueOnce(publicRecords).mockResolvedValueOnce(addresses);
   await expect(downloadCalendarSource(url,w)).rejects.toThrow('source_non_public_address');
   expect(w.resolve).toHaveBeenCalledTimes(2);expect(w.send).toHaveBeenCalledTimes(1);
  }
 });
 it('accepts at most two redirects and stops loops without opening an extra socket',async()=>{
  const success=wireSequence([{status:301,headers:{location:'/overview/'}},{status:302,headers:{location:'../events/'}},{}]);
  await expect(downloadCalendarSource(url,success)).resolves.toMatchObject({type:'text/html; charset=utf-8'});
  expect(success.send.mock.calls.map(([target])=>target.href)).toEqual([url,'https://investors.synthetic-corp.com/overview/','https://investors.synthetic-corp.com/events/']);
  const loop=wireSequence(Array.from({length:CALENDAR_SOURCE_MAX_REDIRECTS+2},()=>({status:302,headers:{location:url}})));
  await expect(downloadCalendarSource(url,loop)).rejects.toThrow('source_redirect_limit');
  expect(loop.resolve).toHaveBeenCalledTimes(CALENDAR_SOURCE_MAX_REDIRECTS+1);expect(loop.send).toHaveBeenCalledTimes(CALENDAR_SOURCE_MAX_REDIRECTS+1);
 });
 it('keeps one deadline across redirected DNS and aborts the subsequent request without resetting the budget',async()=>{
  vi.useFakeTimers();const w=wireSequence([{status:301,headers:{location:'/overview/'}},{hang:true}]);
  w.resolve.mockImplementationOnce(()=>new Promise(accept=>setTimeout(()=>accept(publicRecords),6000))).mockResolvedValue(publicRecords);
  const pending=downloadCalendarSource(url,w),check=expect(pending).rejects.toThrow('source_timeout');
  await vi.advanceTimersByTimeAsync(6000);expect(w.send).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(CALENDAR_SOURCE_TIMEOUT_MS-6000);await check;
  expect(w.wires[1].socketRequest.destroy).toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
 });
 it.each([{'content-type':'text/plain'},{'content-type':'image/svg+xml'},
  {'content-type':'text/html','content-encoding':'gzip'},{'content-type':'application/json; charset=arbitrary; injected=value'}])('accepts only bounded original HTML/XHTML/JSON without transfer decoding %j',async headers=>{
  const w=wire({headers});await expect(downloadCalendarSource(url,w)).rejects.toThrow('source_content_type_invalid');
 });
 it('enforces declared and streamed size, completion and transport failure',async()=>{
  for(const options of [{headers:{'content-type':'text/html','content-length':String(CALENDAR_SOURCE_MAX_BYTES+1)}},
   {chunks:[Buffer.alloc(CALENDAR_SOURCE_MAX_BYTES),Buffer.from('x')]}]){
   await expect(downloadCalendarSource(url,wire(options))).rejects.toThrow('source_too_large');
  }
  for(const options of [{complete:false},{chunks:[]},{headers:{'content-type':'text/html','content-length':'100'}}])
   await expect(downloadCalendarSource(url,wire(options))).rejects.toThrow('source_interrupted');
  await expect(downloadCalendarSource(url,wire({transportError:true}))).rejects.toThrow('source_transport_failed');
 });
});
