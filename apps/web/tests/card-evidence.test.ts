import {describe,expect,it} from 'vitest';
import {headlineFact} from '../../../supabase/functions/signalbrief-api/card-evidence';

describe('hosted Today evidence selection',()=>{
 const facts=[
  {id:'a',field:'operating_income',period:'2026-03-29/2026-06-27',quote:'Operating income 35,695',validation_status:'supported'},
  {id:'b',field:'revenue',period:'2025-03-30/2025-06-28',quote:'Total net sales 94,036',validation_status:'supported'},
  {id:'c',field:'revenue',period:'2025-09-28/2026-06-27',quote:'Total net sales 364,357',validation_status:'supported'},
  {id:'z',field:'revenue',period:'2026-03-29/2026-06-27',quote:'Total net sales 109,417',validation_status:'supported'},
 ];
 const change={field:'revenue',change_type:'decreased',percentage_change:'-1.5893',current_fact_id:'z'};
 it('binds revenue to the current quarter regardless of ID order',()=>{
  expect(headlineFact('매출 감소 -1.5893%',facts,[change])?.id).toBe('z');
 });
 it('selects the latest quarter without comparison history',()=>{
  expect(headlineFact('매출 확인 · 비교 근거 추가 필요',[...facts].reverse(),[])?.id).toBe('z');
 });
 it('does not substitute stale, unsupported or ambiguous evidence',()=>{
  expect(headlineFact('매출 감소 -1.5893%',facts,[{...change,current_fact_id:'b'}])).toBeUndefined();
  expect(headlineFact('매출 감소 -1.5893%',facts.map(f=>f.id==='z'?{...f,validation_status:'unsupported'}:f),[change])).toBeUndefined();
  expect(headlineFact('매출 감소 -1.5893%',[...facts,{...facts[3],id:'zz'}],[change,{...change,current_fact_id:'zz'}])).toBeUndefined();
 });
});
