import {describe,expect,it} from 'vitest';
import {approvedDartQuotation} from '../src/lib/approved-analysis-display';

describe('approved DART quotation display',()=>{
 const body='  Synthetic original quotation.\nSecond line\twith trailing space.  ';
 it.each(['strict_xml','html_text_recovery_requires_review'])('removes only the leading %s marker',mode=>{
  expect(approvedDartQuotation(`FILE 20261029800130.xml MODE ${mode}\n${body}`)).toBe(body);
 });
 it('preserves every body character after a CRLF marker',()=>{
  expect(approvedDartQuotation(`FILE synthetic-document.xml MODE strict_xml\r\n\n${body}`)).toBe(`\n${body}`);
 });
 it.each([
  body,
  `An ordinary FILE 20261029800130.xml MODE strict_xml\n${body}`,
  `FILE 20261029800130.xml MODE unknown_mode\n${body}`,
  `FILE ../20261029800130.xml MODE strict_xml\n${body}`,
  `FILE synthetic..xml MODE strict_xml\n${body}`,
  `FILE 20261029800130.xml MODE strict_xml ${body}`,
  `FILE 20261029800130.txt MODE strict_xml\n${body}`,
 ])('leaves ordinary or unrecognized quotations verbatim',quotation=>{
  expect(approvedDartQuotation(quotation)).toBe(quotation);
 });
 it('does not remove a subsequent marker inside the quote body',()=>{
  const rest=`${body}\nFILE second.xml MODE strict_xml\nMore source text.`;
  expect(approvedDartQuotation(`FILE first.xml MODE strict_xml\n${rest}`)).toBe(rest);
 });
});
