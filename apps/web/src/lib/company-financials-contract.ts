import { z } from 'zod';
import { profileURL } from './company-profile-contract';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const companyFinancialsSchema = z.object({
  company_id: z.string().uuid(), provider: z.string(),
  status: z.enum(['ready', 'pending', 'unavailable', 'unsupported', 'not_collected']),
  last_success_at: z.string().nullable(), error_code: z.string().nullable(),
  source: z.object({ url: profileURL, raw_sha256: z.string().regex(/^[a-f0-9]{64}$/), fetched_at: z.string() }).nullable(),
  items: z.array(z.object({
    metric: z.string(), taxonomy: z.string(), concept: z.string(), label: z.string(),
    value_raw: z.string().regex(/^-?\d+(?:\.\d+)?$/), unit: z.string().min(1),
    period_start: day.nullable(), period_end: day.nullable(), period_label: z.string().min(1),
    period_kind: z.enum(['instant', 'duration']), fiscal_year: z.number().int().nullable(),
    fiscal_period: z.string().nullable(), form: z.string(), accession: z.string(), filed_on: day.nullable(),
    basis: z.literal('reported'), scope: z.enum(['entity', 'consolidated', 'separate']),
    accounting_standard: z.string().nullable(), source_url: profileURL,
    source_quote: z.string().min(1), location: z.string().startsWith('/'), raw_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })).max(240),
  analysis: z.object({ status: z.enum(['approved', 'pending_review', 'queued', 'collecting', 'blocked', 'not_collected']),
    approved: z.number().int().nonnegative(), pending_review: z.number().int().nonnegative(), error_code: z.string().nullable() }),
}).superRefine((value, context) => {
  if (value.items.length && !value.source) context.addIssue({ code: 'custom', message: 'missing_financial_source' });
  for (const item of value.items) {
    if (item.raw_sha256 !== value.source?.raw_sha256) context.addIssue({ code: 'custom', message: 'financial_source_mismatch' });
    if (item.period_start && item.period_end && item.period_start > item.period_end) context.addIssue({ code: 'custom', message: 'invalid_financial_period' });
  }
});
export type CompanyFinancialsData = z.infer<typeof companyFinancialsSchema>;
