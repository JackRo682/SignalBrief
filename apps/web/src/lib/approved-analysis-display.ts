/** Remove only the collector's leading DART archive-member marker for display.
 * Stored evidence, offsets, hashes, and every character of the quote body stay intact.
 */
export function approvedDartQuotation(quotation:string):string{
 const marker=/^FILE ([A-Za-z0-9_.-]+\.xml) MODE (?:strict_xml|html_text_recovery_requires_review)\r?\n/.exec(quotation);
 return marker&&!marker[1].includes('..')?quotation.slice(marker[0].length):quotation;
}
