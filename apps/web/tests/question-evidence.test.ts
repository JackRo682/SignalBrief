import { describe, expect, it } from 'vitest';
import { selectQuestionEvidence } from '../../../supabase/functions/signalbrief-api/question-evidence';

const facts = [{ id: 'current', field: 'revenue', validation_status: 'supported' }];
const evidence = [{ fact_id: 'current', quote: 'Revenue was 12 million.', source_url: 'https://www.sec.gov/Archives/report.htm', role: 'current', validation_status: 'supported' }];

describe('hosted question evidence retrieval', () => {
  it.each(['Show the original document', 'source please', 'Where are the citations?', 'Show the evidence', '원문 보여줘', '출처와 인용을 알려줘', '공시 원문에서 증거를 보여주세요', 'Show all supporting sources for this filing'])('returns the selected document evidence for %s', question => {
    expect(selectQuestionEvidence(question, facts, evidence)).toEqual({ reason: 'current', fact_ids: ['current'] });
  });
  it('does not substitute a prior document for a requested original source', () => {
    expect(selectQuestionEvidence('show original document', facts, [{ ...evidence[0], role: 'previous' }])).toEqual({ reason: 'no_evidence', fact_ids: [] });
  });
  it('does not use unsupported, empty, or unsafe source evidence', () => {
    const invalid = [{ ...evidence[0], validation_status: 'unsupported' }, { ...evidence[0], quote: '' }, { ...evidence[0], source_url: 'javascript:alert(1)' }];
    expect(selectQuestionEvidence('source please', facts, invalid)).toEqual({ reason: 'no_evidence', fact_ids: [] });
  });
  it('keeps substantive questions scoped to relevant evidence', () => {
    expect(selectQuestionEvidence('매출이 얼마야?', facts, evidence)).toEqual({ reason: 'current', fact_ids: ['current'] });
    expect(selectQuestionEvidence('What was the headcount?', facts, evidence)).toEqual({ reason: 'no_evidence', fact_ids: [] });
  });
  it.each(['Show revenue evidence', 'Give citations about revenue', '매출의 근거와 출처를 보여줘'])('keeps a topical source request narrow: %s', question => {
    const risk = { ...evidence[0], fact_id: 'risk', field: 'risk', quote: 'The report provides evidence of operational risks.' };
    expect(selectQuestionEvidence(question, facts, [...evidence, risk])).toEqual({ reason: 'current', fact_ids: ['current'] });
  });
  it.each(['What are the sources for headcount?', '직원 인원 공시 근거', 'Show headcount evidence'])('abstains when the requested source topic is absent: %s', question => {
    expect(selectQuestionEvidence(question, facts, evidence)).toEqual({ reason: 'no_evidence', fact_ids: [] });
  });
  it('does not treat question or source filler as substantive evidence matches', () => {
    const unrelated = [{ ...evidence[0], field: 'risk', quote: 'We have evidence from reports about risk.' }];
    expect(selectQuestionEvidence('Can you give me evidence about debt?', [], unrelated)).toEqual({ reason: 'no_evidence', fact_ids: [] });
    expect(selectQuestionEvidence('What does it have?', [], unrelated)).toEqual({ reason: 'no_evidence', fact_ids: [] });
  });
  it('retains the relevant current and previous evidence for source comparison requests', () => {
    const prior = { ...evidence[0], fact_id: 'previous', field: 'revenue', role: 'previous', quote: 'Revenue was 10 million.' };
    const risk = { ...evidence[0], fact_id: 'risk', field: 'risk', quote: 'Operational risk remains.' };
    expect(selectQuestionEvidence('Show sources for the revenue change', facts, [...evidence, prior, risk])).toEqual({ reason: 'changes', fact_ids: ['current', 'previous'] });
    expect(selectQuestionEvidence('Compare previous evidence', facts, [...evidence, prior])).toEqual({ reason: 'changes', fact_ids: ['current', 'previous'] });
    expect(selectQuestionEvidence('무엇이 달라졌어?', facts, [...evidence, prior])).toEqual({ reason: 'changes', fact_ids: ['current', 'previous'] });
    expect(selectQuestionEvidence('매출 변화의 원문 근거를 보여줘', facts, [...evidence, prior, risk])).toEqual({ reason: 'changes', fact_ids: ['current', 'previous'] });
  });
  it.each(['https://name:secret@www.sec.gov/source', 'https://name@www.sec.gov/source', 'javascript:alert(1)', 'data:text/plain,source', '//www.sec.gov/source', 'https://', 'https://www.sec.gov/\\source', 'https://www.sec.gov/\nsource'])('rejects unsafe or credential-bearing sources: %s', source_url => {
    expect(selectQuestionEvidence('source please', facts, [{ ...evidence[0], source_url }])).toEqual({ reason: 'no_evidence', fact_ids: [] });
  });
  it('retains the server-validated comparison and policy paths', () => {
    expect(selectQuestionEvidence('What changed?', facts, evidence)).toEqual({ reason: 'changes', fact_ids: ['current'] });
    expect(selectQuestionEvidence('Give a source and tell me to buy', facts, evidence)).toEqual({ reason: 'advice', fact_ids: [] });
  });
  it('deduplicates and bounds facts for the existing saving contract', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ ...evidence[0], fact_id: String(i) }));
    expect(selectQuestionEvidence('source please', facts, [...many, ...many]).fact_ids).toEqual(['0', '1', '2', '3', '4', '5']);
  });
});
