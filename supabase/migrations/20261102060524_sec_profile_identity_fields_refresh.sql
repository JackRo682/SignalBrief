-- Deploy the corrected SEC signature, charter and segment parser first.
-- Retain every dated field and original archive until normal recollection succeeds.
DO $migration$
DECLARE due_at timestamptz:=now();
BEGIN
 LOCK TABLE app_private.company_profile_enrichments IN SHARE ROW EXCLUSIVE MODE;
 IF EXISTS(SELECT 1 FROM app_private.company_profile_enrichments
  WHERE provider='sec' AND lease_until>now()) THEN
  RAISE EXCEPTION 'sec_profile_refresh_active_lease';
 END IF;
 UPDATE app_private.company_profile_enrichments AS cache
 SET next_refresh_at=due_at,
  result=jsonb_set(cache.result,'{next_refresh_at}',
   to_jsonb(to_char(due_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')),false)
 WHERE cache.provider='sec' AND cache.last_error IS NULL
  AND cache.result->>'schema'='signalbrief.company-profile.v1'
  AND cache.result->>'status'='partial'
  AND cache.result->'leadership'='[]'::jsonb
  AND cache.result->'last_error'='null'::jsonb
  AND jsonb_typeof(cache.result->'next_refresh_at')='string'
  AND EXISTS(SELECT 1 FROM jsonb_array_elements(
   CASE WHEN jsonb_typeof(cache.result->'sources')='array' THEN cache.result->'sources' ELSE '[]'::jsonb END
  ) AS source
   WHERE source->>'provider'='SEC EDGAR'
    AND source->>'normalization'='profile-visible-text-v1'
    AND source->>'form_type' IN ('10-K','10-K/A','10-Q','10-Q/A','20-F','20-F/A','40-F','40-F/A'));
END $migration$;
