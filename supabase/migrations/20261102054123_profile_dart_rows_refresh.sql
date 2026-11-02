-- Deploy the corrected DART product-row parser before this one-time refresh.
-- Keep the dated fields and immutable originals until normal recollection succeeds.
DO $migration$
DECLARE due_at timestamptz:=now();
BEGIN
 LOCK TABLE app_private.company_profile_enrichments IN SHARE ROW EXCLUSIVE MODE;
 IF EXISTS(SELECT 1 FROM app_private.company_profile_enrichments
  WHERE provider='dart' AND lease_until>now()) THEN
  RAISE EXCEPTION 'dart_profile_refresh_active_lease';
 END IF;
 UPDATE app_private.company_profile_enrichments AS cache
 SET next_refresh_at=due_at,
  result=jsonb_set(cache.result,'{next_refresh_at}',
   to_jsonb(to_char(due_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')),false)
 WHERE cache.provider='dart' AND cache.last_error IS NULL
  AND cache.result->>'schema'='signalbrief.company-profile.v1'
  AND cache.result->>'status' IN ('ready','partial')
  AND cache.result->'last_error'='null'::jsonb
  AND EXISTS(SELECT 1 FROM jsonb_array_elements(cache.result->'sources') AS source
   WHERE source->>'provider'='OpenDART'
    AND source->>'normalization' IN ('dart-periodic-xml-text-v1','dart-periodic-recovered-text-v1')
    AND source->>'form_type' IN ('사업보고서','반기보고서','분기보고서'));
END $migration$;
