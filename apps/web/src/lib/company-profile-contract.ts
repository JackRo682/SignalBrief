import { z } from 'zod';

export const profileURL = z.string().url().refine(value => {
  const url = new URL(value);
  return url.protocol === 'https:' && !url.username && !url.password;
});
// PostgreSQL JSON timestamps retain an explicit UTC offset; Edge also emits Z.
// Both identify an instant. Timezone-free/local timestamps remain invalid.
const profileTimestamp = z.string().datetime({ offset: true });
const source = z.object({
  id: z.string().min(1), provider: z.enum(['SEC EDGAR', 'OpenDART', 'Official company']),
  source_url: profileURL, source_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  fetched_at: profileTimestamp, published_on: z.string().nullable(),
  publication_precision: z.enum(['date', 'unknown']), report_period: z.string().nullable(),
  form_type: z.string().nullable(), title: z.string(),
  normalization: z.enum(['profile-visible-text-v1', 'dart-periodic-xml-text-v1', 'dart-periodic-recovered-text-v1']),
  normalized_sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).refine(value => !value.normalization.startsWith('dart-periodic-') || Boolean(value.normalized_sha256),
  'missing_normalized_source_hash');
const evidence = z.object({
  source_id: z.string().min(1), quote: z.string().min(1),
  location: z.object({ kind: z.literal('normalized_text'), start: z.number().int().nonnegative(),
    end: z.number().int().positive(), section: z.string() }),
}).refine(value => value.location.end > value.location.start, 'invalid_evidence_location');
const item = z.object({ name: z.string().min(1), description: z.string().nullable(), evidence });
export const profileEnrichmentSchema = z.object({
  schema: z.literal('signalbrief.company-profile.v1'), company_id: z.string().uuid(),
  status: z.enum(['ready', 'partial', 'not_available', 'unavailable']),
  checked_at: profileTimestamp, next_refresh_at: profileTimestamp,
  sources: z.array(source).max(30),
  leadership: z.array(z.object({ name: z.string().min(1), role: z.string(), as_of: z.string(),
    basis: z.enum(['filing', 'official_page', 'official_registry']), evidence })).max(20),
  formation: z.array(z.object({ kind: z.enum(['founded', 'incorporated', 'reorganized', 'established']),
    date: z.string(), precision: z.enum(['day', 'month', 'year']), evidence }).refine(value =>
    (value.precision === 'day' ? /^\d{4}-\d{2}-\d{2}$/ : value.precision === 'month' ? /^\d{4}-\d{2}$/ : /^\d{4}$/).test(value.date),
  'formation_precision_mismatch')).max(10),
  business: z.array(z.object({ text: z.string().min(1), evidence })).max(20),
  products: z.array(item).max(50), segments: z.array(item).max(50),
  limitations: z.array(z.string()), last_error: z.string().nullable(),
}).superRefine((value, context) => {
  const ids = new Set(value.sources.map(entry => entry.id));
  if (ids.size !== value.sources.length) context.addIssue({ code: 'custom', message: 'duplicate_source' });
  for (const entry of [...value.leadership, ...value.formation, ...value.business, ...value.products, ...value.segments]) {
    if (!ids.has(entry.evidence.source_id)) context.addIssue({ code: 'custom', message: 'missing_source' });
  }
});
export const companyProfileSchema = z.object({
  status: z.enum(['verified', 'not_available', 'unsupported']), fetched_at: z.string().optional(),
  provider: z.string().optional(), source_url: profileURL.optional(), source_sha256: z.string().optional(),
  profile: z.object({ corp_code: z.string(), ticker: z.string(), name: z.string(),
    english_name: z.string().nullable(), ceo: z.string().nullable(), address: z.string().nullable(),
    website: profileURL.nullable(), established_on: z.string().nullable(),
    industry_description: z.string().nullable().optional(), industry_code: z.string().nullable(),
    fiscal_month: z.string().nullable() }).nullable(),
  enrichment: profileEnrichmentSchema.nullable().optional(),
});
export type CompanyProfileData = z.infer<typeof companyProfileSchema>;
export type ProfileEnrichment = z.infer<typeof profileEnrichmentSchema>;
export type ProfileEvidence = z.infer<typeof evidence>;
