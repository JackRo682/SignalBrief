-- Official OpenDART snapshots include six-character uppercase alphanumeric
-- stock codes. The eight-digit corporation ID remains the issuer identity.
-- Change only this audited format predicate; preserve the complete snapshot,
-- provenance, leases, validation, activation, quotas and existing privileges.
DO $migration$
DECLARE definition text;
old_predicate text:=$old$provider_name='dart' AND (coalesce(x->>'provider_company_id','')!~'^[0-9]{8}$' OR coalesce(x->>'ticker','')!~'^[0-9]{6}$')$old$;
new_predicate text:=$new$provider_name='dart' AND (coalesce(x->>'provider_company_id','')!~'^[0-9]{8}$' OR coalesce(x->>'ticker','')!~'^[A-Z0-9]{6}$')$new$;
BEGIN
 definition:=pg_get_functiondef('app_content_private.discovery_admin(text,jsonb)'::regprocedure);
 IF length(definition)-length(replace(definition,old_predicate,''))<>length(old_predicate) THEN
  RAISE EXCEPTION 'dart_stock_code_migration_precondition_failed';
 END IF;
 EXECUTE replace(definition,old_predicate,new_predicate);
END $migration$;
NOTIFY pgrst,'reload schema';
