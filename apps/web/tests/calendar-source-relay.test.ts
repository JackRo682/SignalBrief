// @vitest-environment node
import {createHmac} from 'node:crypto';
import {describe,expect,it,vi} from 'vitest';
import {CALENDAR_SOURCE_RELAY,createCalendarSourceFetch} from '../../../supabase/functions/signalbrief-calendar/source-relay';
import {CalendarError} from '../../../supabase/functions/signalbrief-calendar/core';

const secret='d'.repeat(64),url='https://investors.synthetic-corp.com/events/';
describe('Edge official calendar pinned-transport client',()=>{
 it('signs the exact bounded request and sends it only to the fixed authenticated relay',async()=>{
  const request=vi.fn<typeof fetch>().mockImplementation(async()=>new Response('<title>Synthetic Issuer</title>',{headers:{'Content-Type':'text/html; charset=utf-8'}}));
  const result=await createCalendarSourceFetch(secret,request)(url,{headers:{Authorization:'must-not-forward',Cookie:'must-not-forward'}});
  expect(await result.text()).toBe('<title>Synthetic Issuer</title>');
  const [target,init]=request.mock.calls[0];expect(target).toBe(CALENDAR_SOURCE_RELAY);
  expect(init).toMatchObject({method:'POST',redirect:'error',credentials:'omit'});
  const headers=new Headers(init?.headers),body=String(init?.body),payload=JSON.parse(body);
  expect(payload).toEqual({kind:'calendar_source',url,nonce:expect.stringMatching(/^[a-f0-9]{64}$/)});
  expect(headers.get('x-sb-timestamp')).toMatch(/^\d{13}$/);
  expect(headers.get('x-sb-signature')).toBe(createHmac('sha256',secret).update(headers.get('x-sb-timestamp')+'\n'+body).digest('hex'));
  expect(headers.has('Authorization')).toBe(false);expect(headers.has('Cookie')).toBe(false);
  expect(new TextEncoder().encode(body).length).toBeLessThanOrEqual(4096);
 });
 it('generates a new replay-protected nonce for each transport request',async()=>{
  const request=vi.fn<typeof fetch>().mockImplementation(async()=>new Response('{}',{headers:{'Content-Type':'application/json'}}));
  const fetcher=createCalendarSourceFetch(secret,request);await fetcher(url);await fetcher(url);
  expect(JSON.parse(String(request.mock.calls[0][1]?.body)).nonce).not.toBe(JSON.parse(String(request.mock.calls[1][1]?.body)).nonce);
 });
 it.each(['','x'.repeat(64),'d'.repeat(63)])('rejects unavailable or malformed configuration before network: %s',key=>{
  const request=vi.fn<typeof fetch>();expect(()=>createCalendarSourceFetch(key,request)).toThrow('calendar_relay_not_configured');expect(request).not.toHaveBeenCalled();
 });
 it.each(['http://issuer.com/','https://127.0.0.1/','https://issuer.local/','https://user:pass@issuer.com/'])('does not sign unsafe target %s',async target=>{
  const request=vi.fn<typeof fetch>();await expect(createCalendarSourceFetch(secret,request)(target)).rejects.toThrow('invalid_ir_url');expect(request).not.toHaveBeenCalled();
 });
 it('cannot forward arbitrary POST bodies or Request credentials',async()=>{
  const request=vi.fn<typeof fetch>(),fetcher=createCalendarSourceFetch(secret,request);
  await expect(fetcher(url,{method:'POST',body:'secret'})).rejects.toThrow('invalid_calendar_source_request');
  await expect(fetcher(new Request(url))).rejects.toThrow('invalid_calendar_source_request');
  expect(request).not.toHaveBeenCalled();
 });
 it.each([[401,'calendar_relay_unauthorized'],[502,'calendar_relay_upstream_failed']] as const)('returns fixed diagnostics for status %s without leaking provider errors',async(status,code)=>{
  const request=vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('private response must not leak',{status}));
  await expect(createCalendarSourceFetch(secret,request)(url)).rejects.toThrow(code);
 });
 it.each([
  new Response('{}',{headers:{'Content-Type':'application/octet-stream'}}),
  new Response('x'.repeat(2000001),{headers:{'Content-Type':'text/html'}}),
  new Response(null,{headers:{'Content-Type':'text/html'}}),
 ])('rejects unapproved media, oversized bytes or missing source body',async response=>{
  const request=vi.fn<typeof fetch>().mockResolvedValueOnce(response);await expect(createCalendarSourceFetch(secret,request)(url)).rejects.toThrow(CalendarError);
 });
 it('combines caller cancellation with a bounded relay timeout and reports fixed network errors',async()=>{
  const controller=new AbortController();
  const request=vi.fn<typeof fetch>().mockImplementation(async(_input,init)=>{expect(init?.signal).toBeInstanceOf(AbortSignal);controller.abort();expect(init?.signal?.aborted).toBe(true);throw new Error('private network details');});
  await expect(createCalendarSourceFetch(secret,request)(url,{signal:controller.signal})).rejects.toThrow('calendar_relay_network_failed');
 });
});
