import {cleanup,renderHook,waitFor,act} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {z} from 'zod';
import {usePcResource} from '../src/desktop/data';
import {pageDataCache} from '../src/lib/page-data-cache';
const mock=vi.hoisted(()=>({token:'owner-a',request:vi.fn()}));
vi.mock('../src/components/auth',()=>({useAuth:()=>({token:mock.token})}));
vi.mock('../src/lib/api',async original=>({...await original<typeof import('../src/lib/api')>(),request:mock.request}));
const schema=z.object({owner:z.string(),value:z.string()});
beforeEach(()=>{mock.token='owner-a';vi.clearAllMocks();pageDataCache.reset();mock.request.mockResolvedValue({owner:'owner-a',value:'Persisted collection'});});
afterEach(cleanup);
describe('desktop primary data cache preserves authentication and navigation guarantees',()=>{
 it('coalesces simultaneous readers and reuses a primary collection across remounts',async()=>{
  const first=renderHook(()=>usePcResource('/v1/watchlist',schema));const second=renderHook(()=>usePcResource('/v1/watchlist',schema));
  await waitFor(()=>expect(first.result.current.data?.value).toBe('Persisted collection'));
  expect(second.result.current.data?.owner).toBe('owner-a');expect(mock.request).toHaveBeenCalledTimes(1);
  first.unmount();second.unmount();const third=renderHook(()=>usePcResource('/v1/watchlist',schema));
  await waitFor(()=>expect(third.result.current.data?.value).toBe('Persisted collection'));expect(mock.request).toHaveBeenCalledTimes(1);
 });
 it('never displays another account’s data after a late cached response',async()=>{
  let finishA!:(value:{owner:string;value:string})=>void;
  mock.request.mockImplementation((_path:string,token:string)=>token==='owner-a'?new Promise(resolve=>{finishA=resolve;}):Promise.resolve({owner:'owner-b',value:'Owner B collection'}));
  const view=renderHook(()=>usePcResource('/v1/watchlist',schema));await waitFor(()=>expect(mock.request).toHaveBeenCalledTimes(1));
  mock.token='owner-b';view.rerender();expect(view.result.current.data).toBeNull();
  await waitFor(()=>expect(view.result.current.data?.value).toBe('Owner B collection'));
  await act(async()=>{finishA({owner:'owner-a',value:'Private owner A collection'});});
  expect(view.result.current.data).toEqual({owner:'owner-b',value:'Owner B collection'});
 });
 it('hides the previous route immediately and does not cache event detail/history',async()=>{
  const view=renderHook(({path})=>usePcResource(path,schema),{initialProps:{path:'/v1/events/event-a'}});
  await waitFor(()=>expect(view.result.current.data).not.toBeNull());
  mock.request.mockImplementation(()=>new Promise(()=>{}));view.rerender({path:'/v1/events/event-b'});
  expect(view.result.current.data).toBeNull();expect(view.result.current.loading).toBe(true);
  view.unmount();mock.request.mockResolvedValue({owner:'owner-a',value:'Current detail'});
  const next=renderHook(()=>usePcResource('/v1/events/event-a',schema));await waitFor(()=>expect(next.result.current.data?.value).toBe('Current detail'));
  expect(mock.request.mock.calls.filter(([path])=>path==='/v1/events/event-a')).toHaveLength(2);
 });
 it('invalidates the primary collection on explicit retry and validates replacement responses',async()=>{
  const view=renderHook(()=>usePcResource('/v1/watchlist',schema));await waitFor(()=>expect(view.result.current.data).not.toBeNull());
  mock.request.mockResolvedValue({unexpected:'Invalid response'});act(()=>view.result.current.reload());
  await waitFor(()=>expect(view.result.current.error).toContain('서버 응답 형식'));expect(view.result.current.data).toBeNull();
  mock.request.mockResolvedValue({owner:'owner-a',value:'Recovered collection'});act(()=>view.result.current.reload());
  await waitFor(()=>expect(view.result.current.data?.value).toBe('Recovered collection'));expect(view.result.current.error).toBeNull();
 });
});
