import {cleanup, renderHook} from '@testing-library/react';
import {afterEach, expect, it, vi} from 'vitest';
import {chooseConsent, readConsent} from '../src/acquisition/client';
import {useSurfaceTracking} from '../src/acquisition/surface-tracker';

afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();localStorage.clear();});
it('sends cumulative time for a quick exit while the opening checkpoint is unacknowledged',async()=>{
  let now=10;
  vi.spyOn(performance,'now').mockImplementation(()=>now);
  vi.spyOn(document,'hasFocus').mockReturnValue(true);
  vi.spyOn(document,'visibilityState','get').mockReturnValue('visible');
  let resolveOpen!:(value:Response)=>void;
  const opening=new Promise<Response>(resolve=>{resolveOpen=resolve;});
  const transport=vi.fn<typeof fetch>().mockReturnValueOnce(opening)
    .mockResolvedValue(new Response(JSON.stringify({ok:true,recorded:true})));
  vi.stubGlobal('fetch',transport);
  chooseConsent(true);
  const consent=readConsent();
  const view=renderHook(()=>useSurfaceTracking('/',consent,null,false,false,null));
  expect(transport).toHaveBeenCalledTimes(1);
  now=2010;
  view.unmount();
  expect(transport).toHaveBeenCalledTimes(2);
  const [start,end]=transport.mock.calls.map(([,init])=>JSON.parse(String(init?.body)));
  expect(start.active_ms).toBe(0);
  expect(end).toMatchObject({id:start.id,surface:'home',active_ms:2000});
  resolveOpen(new Response(JSON.stringify({ok:true,recorded:true})));
  await opening;
  expect(transport).toHaveBeenCalledTimes(2);
});
