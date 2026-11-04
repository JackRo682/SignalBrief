import {z} from 'zod';
const count=z.number().int().nonnegative();
export const universeCoverageSchema=z.object({
 as_of:z.string(),
 markets:z.array(z.object({market:z.string(),listings:count,eligible_listings:count,excluded_listings:count,classification_pending_listings:count,unresolved_listings:count,mapped_issuers:count,registered_issuers:count,
  issuers_with_filings:count,issuers_with_approved_analysis:count,issuers_with_pending_review:count,issuers_with_upcoming_calendar:count})),
 sources:z.array(z.object({source_key:z.string(),source_url:z.string().url(),coverage_scope:z.enum(['all_listed_securities','issuer_primary_listing']),as_of:z.string().nullable(),fetched_at:z.string().nullable(),status:z.enum(['not_imported','stale','ready']),listings:count.nullable()})),
 limits:z.object({provider_daily_calls:count,model_daily_calls:count,model_daily_budget_usd:z.number().nonnegative().nullable(),human_approval_required:z.literal(true)}),
 usage:z.array(z.object({provider:z.enum(['sec','dart','openai']),calls:count,reserved_usd:z.number().nonnegative()})),
});
export type UniverseCoverageData=z.infer<typeof universeCoverageSchema>;
