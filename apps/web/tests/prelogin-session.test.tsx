import {cleanup, renderHook} from '@testing-library/react';
import {afterEach, expect, it, vi} from 'vitest';
import {chooseConsent, readConsent} from '../src/acquisition/client';
import {usePreloginJourney} from '../src/acquisition/prelogin-journey';

afterEach(()=>{cleanup();localStorage.clear();sessionStorage.clear();vi.restoreAllMocks();vi.unstubAllGlobals();});
it('begins a new measured entry after 30 minutes and ignores links outside the fixed taxonomy',()=>{
 let now=Date.now();vi.spyOn(Date,'now').mockImplementation(()=>now);
 const transport=vi.fn<typeof fetch>().mockImplementation(async()=>new Response('{}'));vi.stubGlobal('fetch',transport);
 chooseConsent(true);
 const view=renderHook(()=>usePreloginJourney('/',readConsent(),true,false));
 const link=document.createElement('a');link.href='/signup?arbitrary=private';document.body.append(link);
 const click=()=>link.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));
 link.addEventListener('click',e=>e.preventDefault());
 click();expect(transport).toHaveBeenCalledTimes(1);
 now+=30*60*1000;
 link.dataset.sbJourney='signup_cta';click();
 const sent=transport.mock.calls.map(([,init])=>JSON.parse(String(init?.body)));
 expect(sent.map(e=>[e.seq,e.step])).toEqual([[1,'view'],[1,'view'],[2,'signup_cta']]);
 expect(sent[1].session).not.toBe(sent[0].session);expect(sent[2].session).toBe(sent[1].session);
 expect(JSON.stringify(sent)).not.toContain('arbitrary');link.remove();view.unmount();
});
