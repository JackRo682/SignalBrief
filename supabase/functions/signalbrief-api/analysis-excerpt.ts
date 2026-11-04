import {isSecFundReport,ProviderError} from './us-core.ts';

/** Select a declared excerpt from the entire normalized original, not its cover page. */
export function selectAnalysisExcerpt(source:string,form=''){
 const limit=12000;
 if(source.length<=limit)return {text:source,start:0,end:source.length,selection:'complete_normalized_document'};
 const corporate=/(?:condensed\s+)?consolidated\s+(?:statements?\s+of\s+(?:income|operations|earnings|cash\s+flows|profit|financial\s+position)|balance\s+sheets)|results\s+of\s+operations\s+and\s+financial\s+condition|financial\s+highlights/;
 // Fund reports often have no consolidated heading. Do not broaden corporate
 // report selection to unrelated subsidiary or unconsolidated statements.
 const fund=/statements?\s+of\s+(?:assets\s+and\s+liabilities|operations|changes\s+in\s+net\s+assets|cash\s+flows)/;
 const headings=new RegExp(corporate.source+(isSecFundReport(form)?'|'+fund.source:''),'gi');
 let best:{start:number;end:number;score:number}|undefined,count=0;
 for(const match of source.matchAll(headings)){
  if(++count>120)break;
  const start=Math.max(0,match.index-180),end=Math.min(source.length,start+limit),text=source.slice(start,end);
  const amounts=(text.match(/\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b|[$€£]\s*\d/g)??[]).length;
  const contexts=(text.match(/\b(?:revenue|income|assets|liabilities|cash|million|thousand|ended)\b/gi)??[]).length;
  const score=Math.min(amounts,80)*4+Math.min(contexts,80);
  if(amounts>=3&&contexts>=3&&(!best||score>best.score))best={start,end,score};
 }
 if(!best)throw new ProviderError('sec','financial_excerpt_not_identified');
 return {text:source.slice(best.start,best.end),start:best.start,end:best.end,selection:'financial_statement_window_v1'};
}
