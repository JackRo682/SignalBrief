// @vitest-environment node
import {describe,it,expect} from 'vitest';
import {parseDartText} from '../../../supabase/functions/signalbrief-collector/dart-parser';
describe('DART display-text parsing',()=>{
 it('keeps well-formed XML on the strict parser',()=>expect(parseDartText('<DOCUMENT><P>매출 100 원</P></DOCUMENT>')).toEqual({text:'매출 100 원',mode:'strict_xml'}));
 it('recovers official-style unescaped ENG attribute quotes without using attributes as evidence',()=>{
  const result=parseDartText('<DOCUMENT><TABLE><TR><TD ENG="The entity\'s "projected quantity"." HEIGHT="100">예상 수량 100, 거래 범위 70~130%</TD></TR></TABLE></DOCUMENT>');
  expect(result.mode).toBe('html_text_recovery_requires_review');expect(result.text).toContain('예상 수량 100, 거래 범위 70~130%');expect(result.text).not.toContain('projected quantity');
 });
 it('recovers misnested HTML-like paragraphs with explicit review status',()=>expect(parseDartText('<DOCUMENT><P>첫 문장<P>둘째 문장</DOCUMENT>')).toEqual({text:'첫 문장 둘째 문장',mode:'html_text_recovery_requires_review'}));
 it('never resolves external entities during recovery',()=>expect(()=>parseDartText('<!DOCTYPE DOCUMENT [<!ENTITY leak SYSTEM "file:///etc/passwd">]><DOCUMENT><P>Text</DOCUMENT>')).toThrow('xml_entities_not_supported'));
 it('rejects arbitrary malformed structures',()=>expect(()=>parseDartText('<other><P>Text</other>')).toThrow('unsupported_document_markup'));
});
