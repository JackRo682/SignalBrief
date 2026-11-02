-- Qualify the PL/pgSQL value when checking a reviewed official source URL.
-- Preserve exact provider/issuer/URL matching and every archived-evidence check.
DO $migration$
DECLARE definition text;old_expression text:='AND s.source_url=source_url)';
BEGIN
 definition:=pg_get_functiondef('app_content_private.profile_enrichment_admin_v1(text,jsonb)'::regprocedure);
 IF strpos(definition,'<<enrichment>>')=0
  OR length(definition)-length(replace(definition,old_expression,''))<>length(old_expression)
  THEN RAISE EXCEPTION 'profile_source_binding_precondition_failed'; END IF;
 EXECUTE replace(definition,old_expression,'AND s.source_url=enrichment.source_url)');
END $migration$;
NOTIFY pgrst,'reload schema';
