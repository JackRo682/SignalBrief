import {describe,it,expect} from 'vitest';
import {researchRequest} from '../src/research/contracts';
import {analyticsScreen} from '../src/research/tracker';
import {csvCell,reportCSV} from '../src/research/operations';
import {aggregateResults} from '../src/research/evaluations';
import {difference,equalDecimal,score,prompt} from '../../../supabase/functions/signalbrief-research/core';
describe('research privacy and contracts',()=>{
 it('never maps private URLs or admin/study pages to general analytics',()=>{expect(analyticsScreen('/ops/analytics')).toBeNull();expect(analyticsScreen('/study/123')).toBeNull();expect(analyticsScreen('/events/private-id')).toBe('event');});
 it('rejects unknown request properties and false consent',()=>{expect(researchRequest.safeParse({action:'join',p:{id:'10000000-0000-4000-8000-000000000001',consent:false,consent_version:'v1'}}).success).toBe(false);expect(researchRequest.safeParse({action:'reports',p:{user_id:'someone-else'}}).success).toBe(false);});
 it('neutralizes spreadsheet formula injection',()=>{expect(csvCell('=HYPERLINK("bad")')).toBe('"\'=HYPERLINK(""bad"")"');expect(reportCSV({generated_at:'now',limitations:['No participants']})).toContain('No participants');});
 it('unknown costs and empty denominators remain unknown',()=>{expect(aggregateResults([]).numeric).toBeNull();expect(aggregateResults([{results:[{cost_usd:null}]}]).cost).toBeNull();});
});
describe('exact evaluation arithmetic and evidence',()=>{
 const gold={field:'Revenue',expected:'999999999999.12345678',previous_expected:'0.12345678',period:'FY2026',previous_period:'FY2025',unit:'USD',answerable:true,quote:'Revenue 999999999999.12345678 USD FY2026',previous_quote:'Revenue 0.12345678 USD FY2025'};
 const answer={current:gold.expected,previous:gold.previous_expected,difference:'999999999999',period:gold.period,previous_period:gold.previous_period,unit:gold.unit,quote:gold.quote,previous_quote:gold.previous_quote,refused:false};
 it('preserves decimal precision beyond Number',()=>{expect(difference(gold.expected,gold.previous_expected)).toBe('999999999999.00000000');expect(equalDecimal('0.10','0.1')).toBe(true);expect(equalDecimal(null,'0')).toBe(false);});
 it('grades direct vs deterministic arithmetic separately',()=>{expect(score(gold,{...answer,difference:'wrong'},'A').comparison_correct).toBe(false);expect(score(gold,{...answer,difference:'wrong'},'B').comparison_correct).toBe(true);});
 it('rejects invented citations or periods in C',()=>{expect(score(gold,{...answer,quote:'unrelated invented quote'},'C').validation_accepted).toBe(false);expect(score(gold,{...answer,period:'FY2024'},'C').citation_correct).toBe(false);});
 it('does not leak gold values or answerability labels into prompts',()=>{expect(prompt({...gold,expected:'GOLD_SECRET',answerable:false},'A')).not.toContain('GOLD_SECRET');expect(prompt(gold,'C')).toContain('untrusted data');});
 it('scores refusal only on unanswerable cases',()=>{expect(score(gold,answer,'C').safe_refusal).toBeNull();expect(score({...gold,answerable:false},{refused:true},'C').safe_refusal).toBe(true);});
});
