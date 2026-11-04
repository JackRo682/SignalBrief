-- Directory pages load monitoring for their visible 50 companies. Existing
-- overview callers retain their unchanged scope and visibility predicates.
DO $migration$
DECLARE definition text;old_guard text:=$old$IF p-'scope'-'company_id'-'days'<>'{}' THEN$old$;
 old_scope text:=$old$AND (company_filter='' OR c.id=company_filter)$old$;
BEGIN
 definition:=pg_get_functiondef('app_content_private.workspace(text,jsonb)'::regprocedure);
 IF array_length(string_to_array(definition,old_guard),1)<>2 OR array_length(string_to_array(definition,old_scope),1)<>2 THEN
  RAISE EXCEPTION 'company_monitoring_scope_precondition_failed';END IF;
 definition:=replace(definition,old_guard,$new$IF p ? 'company_ids' THEN
   IF p ? 'company_id' OR jsonb_typeof(p->'company_ids') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'invalid_company_scope' USING ERRCODE='PT422';END IF;
   IF jsonb_array_length(p->'company_ids')>50 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p->'company_ids') x WHERE jsonb_typeof(x)<>'string' OR x#>>'{}' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')
    OR (SELECT count(*)<>count(DISTINCT value) FROM jsonb_array_elements(p->'company_ids')) THEN RAISE EXCEPTION 'invalid_company_scope' USING ERRCODE='PT422';END IF;
  END IF;
  IF p-'scope'-'company_id'-'company_ids'-'days'<>'{}' THEN$new$);
 definition:=replace(definition,old_scope,old_scope||$new$
    AND (NOT (p ? 'company_ids') OR p->'company_ids' ? c.id)$new$);
 EXECUTE definition;
END $migration$;
NOTIFY pgrst,'reload schema';
