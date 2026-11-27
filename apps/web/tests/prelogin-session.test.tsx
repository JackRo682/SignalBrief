import {cleanup, renderHook} from '@testing-library/react';
import {afterEach, expect, it, vi} from 'vitest';
import {CONSENT_KEY, JOURNEY_CONSENT_VERSION, chooseConsent, readConsent} from '../src/acquisition/client';
import {journeyRequest} from '../src/acquisition/contracts';
import {journeyDevice, usePreloginJourney} from '../src/acquisition/prelogin-journey';

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

it.each([[1,'mobile'],[767,'mobile'],[768,'tablet'],[1023,'tablet'],[1024,'desktop'],[2560,'desktop'],[0,undefined],[NaN,undefined]])('classifies viewport %s without returning precise dimensions', (width,device)=>{
 expect(journeyDevice(width as number)).toBe(device);
});

it('keeps an old grant recognized but sends no new journey data until renewed consent',()=>{
 const transport=vi.fn<typeof fetch>().mockImplementation(async()=>new Response('{}'));vi.stubGlobal('fetch',transport);
 chooseConsent(true);
 const stored=JSON.parse(localStorage.getItem(CONSENT_KEY)!);
 localStorage.setItem(CONSENT_KEY,JSON.stringify({...stored,journeyVersion:'2026-11-26.prelogin'}));
 expect(readConsent()).toMatchObject({choice:'yes',identity:stored.identity,journeyVersion:'2026-11-26.prelogin'});
 const view=renderHook(()=>usePreloginJourney('/',readConsent(),true,false));
 expect(transport).not.toHaveBeenCalled();
 vi.stubGlobal('innerWidth',390);
 chooseConsent(true);view.rerender();
 expect(readConsent()).toMatchObject({choice:'yes',identity:stored.identity,source:stored.source,journeyVersion:JOURNEY_CONSENT_VERSION});
 expect(transport).toHaveBeenCalledTimes(1);
 const payload=JSON.parse(String(transport.mock.calls[0][1]?.body));
 expect(payload).toMatchObject({device:'mobile',consent_version:'2026-11-27.prelogin',step:'view'});
 expect(journeyRequest.safeParse(payload).success).toBe(true);
 expect(Object.keys(payload).sort()).toEqual(['action','consent_version','device','id','page','secret','seq','session','source','step','visitor_id']);
 expect(payload).not.toHaveProperty('user_agent');expect(payload).not.toHaveProperty('width');
});

it('omits an unknown viewport and stops subsequent actions immediately after withdrawal',()=>{
 const transport=vi.fn<typeof fetch>().mockImplementation(async()=>new Response('{}'));vi.stubGlobal('fetch',transport);vi.stubGlobal('innerWidth',0);
 chooseConsent(true);
 renderHook(()=>usePreloginJourney('/',readConsent(),true,false));
 const first=JSON.parse(String(transport.mock.calls[0][1]?.body));
 expect(first).not.toHaveProperty('device');expect(journeyRequest.safeParse(first).success).toBe(true);
 chooseConsent(false);transport.mockClear();
 const link=document.createElement('button');link.dataset.sbJourney='signup_cta';document.body.append(link);link.click();link.remove();
 expect(transport).not.toHaveBeenCalled();
});
