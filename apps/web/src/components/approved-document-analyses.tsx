'use client';
import {z} from 'zod';
import {FilingAnalysis} from '@/components/filing-analysis';
import {ResearchResourceCard} from '@/components/research-resources';
import {approvedDartQuotation} from '@/lib/approved-analysis-display';
import {approvedFilingAnalysisSchema} from '@/workspace/contracts';
import './research-workspace.css';

/** The database excludes drafts; the explicit display check also applies to admins. */
export function ApprovedDocumentAnalyses({entries}:{entries:z.infer<typeof approvedFilingAnalysisSchema>[]}){
 return <>{entries.filter(entry=>entry.analysis.status==='approved').map(entry=>{
  const value=entry.resource.kind==='dart_analysis'?{...entry.analysis,result:{...entry.analysis.result,claims:entry.analysis.result.claims.map(claim=>({...claim,quote:approvedDartQuotation(claim.quote)}))}}:entry.analysis;
  return <section className="rw-analysis-excerpt" id={`analysis-${entry.resource.kind}`} key={`${entry.resource.kind}:${entry.resource.id}`}><ResearchResourceCard item={entry.resource}/><FilingAnalysis value={value} admin={false} busy={false} approvedOnly onReview={async()=>{}}/></section>;
 })}</>;
}
