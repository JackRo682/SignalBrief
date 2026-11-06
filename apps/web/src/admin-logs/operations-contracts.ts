import { z } from 'zod';

// The existing administrator RPC/API projections, validated before rendering.
// These schemas deliberately omit fields the overview never displays.
export const operationMetricKeys = [
  'documents', 'events', 'ai_runs', 'ai_failures', 'low_confidence',
  'citation_failures', 'number_mismatch', 'duplicates', 'pipeline_latency', 'ai_cost',
] as const;

export const collectionMetricKeys = ['collector_runs', 'collector_errors', 'dart_filings', 'sec_filings', 'dart_documents', 'provider_analyses', 'collector_latency'] as const;
export const publicationMetricKeys = ['review_pending', 'published_events', 'published_briefs'] as const;
export const deliveryMetricKeys = ['delivery_queued', 'delivery_submitted', 'delivery_delivered', 'delivery_failed'] as const;

const metricSchema = z.object({
  value: z.number().finite().nullable(),
  delta: z.number().finite().nullable(),
  spark: z.array(z.number().finite()),
  note: z.string(),
  display: z.string().optional(),
  recorded_value: z.number().finite().nullable().optional(),
});
const rowSchema = z.object({
  id: z.string().min(1),
  document_id: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  comment: z.string().nullable().optional(),
  question: z.string().nullable().optional(),
  symbol: z.string().nullable().optional(),
  rating: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  error_code: z.string().nullable().optional(),
  confidence: z.number().nullable().optional(),
  created_at: z.string().nullable(),
  kind: z.string().nullable().optional(),
  source_url: z.string().nullable().optional(),
  duration_ms: z.number().finite().nullable().optional(),
});

const activitySchema = z.object({
  id: z.string().min(1), kind: z.string(), title: z.string().nullable(), symbol: z.string().nullable(),
  status: z.string().nullable(), error_code: z.string().nullable(), created_at: z.string().nullable(),
  source_url: z.string().nullable(), duration_ms: z.number().finite().nullable(),
});

export const operationsSnapshotSchema = z.object({
  // Production's additive v2 projection contains more metrics than the legacy ten.
  metrics: z.record(z.string(), metricSchema).refine(metrics => operationMetricKeys.every(key => key in metrics), 'Missing pipeline metrics'),
  since: z.string(),
  until: z.string(),
  review: z.array(rowSchema),
  failures: z.array(rowSchema),
  citations: z.array(rowSchema),
  duplicates: z.array(rowSchema),
  reports: z.array(rowSchema),
  schema_version: z.number().int().positive().optional(),
  generated_at: z.string().optional(),
  review_total: z.number().int().nonnegative().optional(),
  failure_total: z.number().int().nonnegative().optional(),
  list_limit: z.number().int().positive().optional(),
  activity: z.array(activitySchema).optional(),
});
export const operationDocumentsSchema = z.array(z.object({
  id: z.string().min(1), title: z.string(), provider: z.string(), state: z.string(),
  ingested_at: z.string().optional(), publication_date: z.string().nullable().optional(),
}));
export const operationQueuesSchema = z.object({
  failed_runs: z.array(z.object({
    id: z.string().min(1), model: z.string(), status: z.string(),
    prompt_version: z.string().nullable().optional(),
    error_code: z.string().nullable().optional(),
    created_at: z.string().optional(),
  })),
});
export const operationUsersSchema = z.array(z.object({
  display_name: z.string().nullable(), created_at: z.string(), onboarding_completed: z.boolean(),
}));
export const operationAuditSchema = z.array(z.object({
  id: z.string().min(1), action: z.string(), target_id: z.string().nullable(),
  created_at: z.string(), details: z.object({ reason: z.string().nullable().optional() }).nullable().optional(),
}));

export type OperationRow = z.infer<typeof rowSchema>;
export type OperationsSnapshot = z.infer<typeof operationsSnapshotSchema>;
export type OperationData = {
  snapshot: OperationsSnapshot;
  documents: z.infer<typeof operationDocumentsSchema>;
  queues: z.infer<typeof operationQueuesSchema>;
  users: z.infer<typeof operationUsersSchema>;
  audit: z.infer<typeof operationAuditSchema>;
};
