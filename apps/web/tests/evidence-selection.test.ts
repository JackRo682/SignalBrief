import {describe,it,expect} from 'vitest';
import {selectEvidence} from '../../../supabase/functions/signalbrief-api/evidence-selection';
const evidence=[{fact_id:'a',quote:'Revenue was 42 million.'},{fact_id:'b',quote:'The company expanded its facilities.'}];
const fields=new Map([['a','revenue'],['b','capex']]);
describe('authorized evidence retrieval',()=>{
 it.each(['원문을 보여줘','출처와 인용을 알려줘','Show original documents','What are the sources?','Citations please'])('retrieves source requests without literal overlap: %s',question=>expect(selectEvidence(question,evidence,fields).evidence).toEqual(evidence));
 it('still abstains for unrelated facts',()=>expect(selectEvidence('employee headcount',evidence,fields).evidence).toEqual([]));
 it('matches Korean fields to saved source facts',()=>expect(selectEvidence('매출 수치',evidence,fields).evidence).toEqual([evidence[0]]));
 it('preserves comparison context and caps citation count',()=>{const result=selectEvidence('Compare previous periods',Array.from({length:10},()=>evidence[0]),fields);expect(result.changed).toBe(true);expect(result.evidence).toHaveLength(6);});
 it('does not use a general source request to substitute unrelated facts',()=>expect(selectEvidence('직원 수의 원문 근거',evidence,fields).evidence).toEqual([]));
 it('does not invent sources for an empty evidence set',()=>expect(selectEvidence('원문',[],fields).evidence).toEqual([]));
});
