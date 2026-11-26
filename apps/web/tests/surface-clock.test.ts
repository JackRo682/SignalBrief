import {describe, expect, it} from 'vitest';
import {activeClock} from '../src/acquisition/active-clock';
describe('active foreground intervals',()=>{
 it('counts visible and focused time, pausing at idle and on blur',()=>{
  const clock=activeClock(0); expect(clock.sample(2000)).toBe(0);
  clock.foreground(true,2000); expect(clock.sample(52000)).toBe(30000);
  clock.activity(62000); expect(clock.sample(65000)).toBe(33000);
  clock.foreground(false,66000); expect(clock.sample(90000)).toBe(34000);
  clock.foreground(true,100000); expect(clock.sample(101000)).toBe(35000);
 });
 it('never double counts a duplicate checkpoint',()=>{
  const clock=activeClock(0); clock.foreground(true,0); expect(clock.sample(1000)).toBe(1000);
  expect(clock.sample(1000)).toBe(1000); expect(clock.sample(1100)).toBe(1100);
 });
});
