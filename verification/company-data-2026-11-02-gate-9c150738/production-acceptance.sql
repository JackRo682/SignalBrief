-- READ ONLY: one SELECT/result for the privileged Supabase SQL connector.
-- No auth impersonation, public RPC, rate-limit write, enqueue, token, user ID,
-- Vault access, raw document, normalized document, or complete source quote.
-- Requires deployed migration 20261102051051 (latest_parser_version).
-- Compare saved before/after analysis counts and snapshot fingerprints: a single
-- observation proves presence/state, not absence of all intervening writes.
-- Calendar sidebar: past 90 days; upcoming 365 days, NOT 18 months.
-- Ingestion: past 90 days through +18 months. Both scopes are returned.
-- Counts exclude personal rows and precede the UI's 500-row per-query display cap.
-- Change only settings.ui_timezone if the inspected UI preference differs.
WITH
settings AS (SELECT 'Asia/Seoul'::text AS ui_timezone),
bounds AS (SELECT ui_timezone,(now() AT TIME ZONE ui_timezone)::date AS ui_day,
 current_date AS collection_day FROM settings),
targets(label,ticker,provider,expected_company_id,expected_provider_id) AS (VALUES
 ('Visa','V','sec','36cdabc1-272b-41bb-9b01-d63946dc499a','0001403161'),
 ('Mastercard','MA','sec','e2087a38-4ffc-49ab-9ecf-54fac8ca5eae','0001141391'),
 ('Tesla','TSLA','sec',NULL,'0001318605'),
 ('NAVER','035420','dart','d702c7c0-a307-4f81-9325-835580e5978b','00266961'),
 ('Samsung','005930','dart',NULL,'00126380'),
 ('Apple','AAPL','sec',NULL,NULL),
 ('Sandisk','SNDK','sec',NULL,NULL)
),
companies AS MATERIALIZED (
 SELECT t.label,t.expected_company_id,t.expected_provider_id,c.id,c.name,c.ticker,
  c.market,c.provider,c.provider_company_id,c.created_at,c.last_ingested_at
 FROM targets t JOIN public.companies c ON c.ticker=t.ticker AND c.provider=t.provider AND NOT c.is_demo
),
financial AS MATERIALIZED (
 SELECT c.id AS company_id,c.provider,c.provider_company_id,c.ticker,
  s.status,s.requested_at,s.last_attempt_at,s.last_success_at,s.error_code,s.attempt_count,
  s.lease_until,s.latest_sha256,s.latest_parser_version,f.source,f.created_at AS snapshot_created_at,
  coalesce(f.source->>'provider'=c.provider AND f.source->>'provider_company_id'=c.provider_company_id
   AND EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='signalbrief-raw' AND o.name=f.raw_object_key),false) AS source_usable
 FROM companies c LEFT JOIN app_private.company_financial_sources s ON s.company_id=c.id
 LEFT JOIN app_private.company_financial_snapshots f ON f.company_id=c.id
  AND f.raw_sha256=s.latest_sha256 AND f.parser_version=s.latest_parser_version
),
visible_facts AS MATERIALIZED (
 SELECT f.company_id,x.item,x.ordinal
 FROM financial f CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN f.source_usable THEN coalesce(f.source->'items','[]'::jsonb) ELSE '[]'::jsonb END
 ) WITH ORDINALITY AS x(item,ordinal)
 WHERE f.provider<>'dart' OR f.latest_parser_version='reported-financials-dart-v2'
  OR (x.item->>'period_kind'='instant' AND app_content_private.dart_financial_fact_valid(
   x.item,(x.item->>'source_quote')::jsonb,f.provider_company_id,f.ticker,f.source->>'source_url'))
),
calendar_rows AS MATERIALIZED (
 SELECT c.label,e.id,e.company_id,e.title,e.occurs_on,e.source_key,e.source_event_key,e.source_url,
  e.source_timezone,e.verified_at,e.source_snapshot_id,
  app_private.sb_calendar_confirmed(e.id) AS provider_visible,
  coalesce(app_private.sb_event_visible(e.event_id),false) AS approved_event_visible
 FROM companies c JOIN public.calendar_items e ON e.company_id=c.id
 WHERE e.origin='official' AND e.calendar_status='confirmed'
),
analysis_counts AS MATERIALIZED (
 SELECT f.company_id,'sec'::text AS provider,a.status,count(*) AS total
 FROM public.us_analyses a JOIN public.us_filings f ON f.id=a.filing_id JOIN companies c ON c.id=f.company_id
 GROUP BY f.company_id,a.status
 UNION ALL
 SELECT f.company_id,'dart'::text,a.status,count(*)
 FROM public.dart_analyses a JOIN public.dart_filings f ON f.id=a.filing_id JOIN companies c ON c.id=f.company_id
 GROUP BY f.company_id,a.status
),
company_results AS (
 SELECT c.label,c.ticker,jsonb_build_object(
  'identity',jsonb_build_object('id',c.id,'name',c.name,'ticker',c.ticker,'market',c.market,
   'provider',c.provider,'provider_company_id',c.provider_company_id,'created_at',c.created_at,'last_ingested_at',c.last_ingested_at,
   'expected_company_id',c.expected_company_id,'expected_id_matches',CASE WHEN c.expected_company_id IS NOT NULL THEN c.id=c.expected_company_id END,
   'expected_provider_id',c.expected_provider_id,'expected_provider_id_matches',CASE WHEN c.expected_provider_id IS NOT NULL THEN c.provider_company_id=c.expected_provider_id END),
  'profile',jsonb_build_object('present',p.company_id IS NOT NULL,
   'identity_matches',coalesce(p.provider=c.provider AND p.provider_company_id=c.provider_company_id AND p.ticker=c.ticker,false),
   'status',p.result->>'status','checked_at',p.result->>'checked_at','updated_at',p.updated_at,
   'next_refresh_at',p.next_refresh_at,'lease_active',coalesce(p.lease_until>now(),false),'lease_until',p.lease_until,
   'last_error',p.last_error,'result_error',p.result->>'last_error','limitations',p.result->'limitations',
   'leadership',coalesce((SELECT jsonb_agg(jsonb_build_object('name',x->>'name','role',x->>'role',
    'as_of',x->>'as_of','basis',x->>'basis','source_id',x#>>'{evidence,source_id}')) FROM jsonb_array_elements(p.result->'leadership') x),'[]'::jsonb),
   'formation',coalesce((SELECT jsonb_agg(jsonb_build_object('kind',x->>'kind','date',x->>'date',
    'precision',x->>'precision','source_id',x#>>'{evidence,source_id}')) FROM jsonb_array_elements(p.result->'formation') x),'[]'::jsonb),
   'business_count',coalesce(jsonb_array_length(p.result->'business'),0),
   'business_preview',left(p.result#>>'{business,0,text}',220),
   'product_count',coalesce(jsonb_array_length(p.result->'products'),0),
   'product_names',coalesce((SELECT jsonb_agg(x->>'name') FROM jsonb_array_elements(p.result->'products') x),'[]'::jsonb),
   'segment_count',coalesce(jsonb_array_length(p.result->'segments'),0),
   'segment_names',coalesce((SELECT jsonb_agg(x->>'name') FROM jsonb_array_elements(p.result->'segments') x),'[]'::jsonb),
   'sources',coalesce((SELECT jsonb_agg(jsonb_build_object('provider',x->>'provider','url',x->>'source_url',
    'sha256',x->>'source_sha256','published_on',x->>'published_on','report_period',x->>'report_period',
    'fetched_at',x->>'fetched_at','normalization',x->>'normalization')) FROM jsonb_array_elements(p.result->'sources') x),'[]'::jsonb)),
  'financial',jsonb_build_object('status',f.status,'parser_version',f.latest_parser_version,
   'requested_at',f.requested_at,'last_attempt_at',f.last_attempt_at,'last_success_at',f.last_success_at,
   'error_code',f.error_code,'attempt_count',f.attempt_count,'lease_active',coalesce(f.lease_until>now(),false),
   'source_identity_and_archive_valid',f.source_usable,'source_url',f.source->>'source_url',
   'latest_raw_sha256',f.latest_sha256,'source_fetched_at',f.source->>'fetched_at','snapshot_created_at',f.snapshot_created_at,
   'stored_item_count',coalesce(jsonb_array_length(f.source->'items'),0),
   'projectable_item_count',(SELECT count(*) FROM visible_facts v WHERE v.company_id=c.id),
   'projectable_duration_count',(SELECT count(*) FROM visible_facts v WHERE v.company_id=c.id AND v.item->>'period_kind'='duration'),
   'legacy_dart_quarantined',coalesce(c.provider='dart' AND f.source_usable AND f.latest_parser_version<>'reported-financials-dart-v2',false)),
  'calendar_sources',coalesce((SELECT jsonb_agg(jsonb_build_object(
    'key',s.key,'adapter',s.adapter,'enabled',s.enabled,
    'identity_matches',s.provider=c.provider AND s.provider_company_id=c.provider_company_id AND s.ticker=c.ticker AND s.market=c.market,
    'last_attempt_at',s.last_attempt_at,'last_success_at',s.last_success_at,'error_code',s.error_code,
    'queue_state',q.state,'attempts',q.attempts,'requested_at',q.requested_at,'next_attempt_at',q.next_attempt_at,
    'lease_active',coalesce(q.lease_until>now(),false),'finished_at',q.finished_at,'rerun_requested',q.rerun_requested,
    'latest_snapshot',CASE WHEN sn.id IS NOT NULL THEN jsonb_build_object('sha256',sn.raw_sha256,'fetched_at',sn.fetched_at,
     'schema',sn.provenance->>'schema','format',sn.provenance->>'format','complete',sn.provenance->'complete',
     'coverage',sn.provenance->>'coverage','window',sn.provenance->'window',
     'archived',EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='signalbrief-raw' AND o.name=sn.object_key)) END
   ) ORDER BY s.key) FROM app_private.calendar_sources s LEFT JOIN app_private.calendar_refresh_queue q ON q.source_key=s.key
   LEFT JOIN LATERAL (SELECT z.id,z.raw_sha256,z.fetched_at,z.provenance,z.object_key FROM app_private.calendar_snapshots z
    WHERE z.source_key=s.key ORDER BY z.fetched_at DESC,z.id DESC LIMIT 1) sn ON true WHERE s.company_id=c.id),'[]'::jsonb),
  'calendar_counts',(SELECT jsonb_build_object(
    'ui_past_90d',count(*) FILTER(WHERE (e.provider_visible OR e.approved_event_visible) AND e.occurs_on BETWEEN b.ui_day-90 AND b.ui_day-1),
    'ui_upcoming_365d',count(*) FILTER(WHERE (e.provider_visible OR e.approved_event_visible) AND e.occurs_on BETWEEN b.ui_day AND b.ui_day+365),
    'collection_past_90d',count(*) FILTER(WHERE e.provider_visible AND e.occurs_on BETWEEN b.collection_day-90 AND b.collection_day-1),
    'collection_upcoming_18mo',count(*) FILTER(WHERE e.provider_visible AND e.occurs_on BETWEEN b.collection_day AND (b.collection_day+interval '18 months')::date),
    'provider_total_visible',count(*) FILTER(WHERE e.provider_visible),
    'confirmed_but_not_public',count(*) FILTER(WHERE NOT(e.provider_visible OR e.approved_event_visible))
   ) FROM calendar_rows e WHERE e.company_id=c.id),
  'analysis_status_counts',coalesce((SELECT jsonb_object_agg(a.provider||':'||a.status,a.total)
   FROM analysis_counts a WHERE a.company_id=c.id),'{}'::jsonb)
 ) AS value
 FROM companies c CROSS JOIN bounds b
 LEFT JOIN app_private.company_profile_enrichments p ON p.company_id=c.id
 LEFT JOIN financial f ON f.company_id=c.id
)
SELECT jsonb_build_object(
 'observed_at',now(),'database_date',current_date,'ui_timezone',b.ui_timezone,'ui_day',b.ui_day,'ui_row_cap',500,
 'bounds',jsonb_build_object('ui_past_from',b.ui_day-90,'ui_past_until',b.ui_day-1,
  'ui_upcoming_from',b.ui_day,'ui_upcoming_until',b.ui_day+365,
  'collection_from',b.collection_day-90,'collection_until',(b.collection_day+interval '18 months')::date),
 'target_matches',(SELECT jsonb_agg(jsonb_build_object('label',t.label,'ticker',t.ticker,'provider',t.provider,
  'matched_count',(SELECT count(*) FROM companies c WHERE c.label=t.label)) ORDER BY t.label) FROM targets t),
 'companies',coalesce((SELECT jsonb_agg(r.value ORDER BY r.label) FROM company_results r),'[]'::jsonb),
 'naver_projectable_revenue',(SELECT coalesce(jsonb_agg(jsonb_build_object(
   'metric',v.item->>'metric','concept',v.item->>'concept','scope',v.item->>'scope','value_raw',v.item->>'value_raw',
   'unit',v.item->>'unit','period_start',v.item->>'period_start','period_end',v.item->>'period_end',
   'period_label',v.item->>'period_label','location',v.item->>'location','form',v.item->>'form','accession',v.item->>'accession',
   'raw_sha256',v.item->>'raw_sha256','source_url',v.item->>'source_url',
   'quoted_current_amount',(v.item->>'source_quote')::jsonb->>'thstrm_amount',
   'quoted_current_accumulated',(v.item->>'source_quote')::jsonb->>'thstrm_add_amount',
   'quoted_previous_amount',(v.item->>'source_quote')::jsonb->>'frmtrm_amount',
   'quoted_previous_accumulated',(v.item->>'source_quote')::jsonb->>'frmtrm_add_amount'
  ) ORDER BY v.ordinal),'[]'::jsonb) FROM visible_facts v JOIN companies c ON c.id=v.company_id
  WHERE c.label='NAVER' AND v.item->>'period_kind'='duration' AND v.item->>'metric' IN ('revenue','operating_revenue')),
 'naver_archived_versions',(SELECT coalesce(jsonb_agg(jsonb_build_object('raw_sha256',s.raw_sha256,
   'parser_version',s.parser_version,'created_at',s.created_at,'item_count',jsonb_array_length(s.source->'items'),
   'snapshot_fingerprint',encode(extensions.digest((s.source-'fetched_at')::text,'sha256'),'hex'),
   'archived',EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='signalbrief-raw' AND o.name=s.raw_object_key)
  ) ORDER BY s.raw_sha256,s.parser_version),'[]'::jsonb) FROM app_private.company_financial_snapshots s
  JOIN companies c ON c.id=s.company_id WHERE c.label='NAVER'),
 'tesla_oct21',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',e.id,'title',e.title,'occurs_on',e.occurs_on,
   'source_key',e.source_key,'source_event_key',e.source_event_key,'source_url',e.source_url,
   'source_timezone',e.source_timezone,'verified_at',e.verified_at,'provider_visible',e.provider_visible,
   'snapshot_sha256',s.raw_sha256,'schema',s.provenance->>'schema','complete',s.provenance->'complete','coverage',s.provenance->>'coverage'
  ) ORDER BY e.id),'[]'::jsonb) FROM calendar_rows e LEFT JOIN app_private.calendar_snapshots s ON s.id=e.source_snapshot_id
  WHERE e.label='Tesla' AND e.occurs_on=DATE '2026-10-21')
) AS acceptance
FROM bounds b;
