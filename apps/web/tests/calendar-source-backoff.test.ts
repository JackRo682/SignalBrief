// @vitest-environment node
import {describe,it,expect} from 'vitest';
import {CalendarSourceBackoff} from '../src/server/calendar-source';
describe('provider access restriction cooldown',()=>{
 it('backs off 403/429 for five minutes and then permits a real retry',()=>{let now=0;const backoff=new CalendarSourceBackoff(()=>now);backoff.restrict('https://official.example/events',403);expect(()=>backoff.check('https://official.example/events')).toThrow('source_http_error');expect(()=>backoff.check('https://another.example/events')).not.toThrow();now=300001;expect(()=>backoff.check('https://official.example/events')).not.toThrow();});
 it('does not turn internal failures into cached restrictions',()=>{const backoff=new CalendarSourceBackoff();backoff.restrict('https://official.example/events',500);expect(()=>backoff.check('https://official.example/events')).not.toThrow();});
 it('caps memory for untrusted but signed source URLs',()=>{const backoff=new CalendarSourceBackoff();for(let i=0;i<129;i++)backoff.restrict(`https://official.example/${i}`,429);expect(()=>backoff.check('https://official.example/0')).not.toThrow();expect(()=>backoff.check('https://official.example/128')).toThrow();});
});
