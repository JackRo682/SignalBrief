-- Deploy the corrected SEC profile parser before applying this one-time refresh.
-- Retain every dated field and immutable source until a normal validated refresh
-- succeeds. Never let an older active worker overwrite this refresh request.
DO $migration$
BEGIN
 LOCK TABLE app_private.company_profile_enrichments IN SHARE ROW EXCLUSIVE MODE;
 IF EXISTS(SELECT 1 FROM app_private.company_profile_enrichments
  WHERE provider='sec' AND lease_until>now()) THEN
  RAISE EXCEPTION 'sec_profile_refresh_active_lease';
 END IF;
 UPDATE app_private.company_profile_enrichments AS cache
 SET next_refresh_at=now(),result=jsonb_set(cache.result,'{next_refresh_at}',to_jsonb(now()),false)
 WHERE cache.provider='sec' AND cache.result->>'schema'='signalbrief.company-profile.v1'
  AND EXISTS(SELECT 1 FROM jsonb_array_elements(cache.result->'sources') AS source
   WHERE source->>'provider'='SEC EDGAR' AND source->>'normalization'='profile-visible-text-v1');
END $migration$;
