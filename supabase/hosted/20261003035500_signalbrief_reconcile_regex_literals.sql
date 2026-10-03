-- Reconcile historical SQL-string escaping so a fresh migration replay matches the live validated functions.
DO $$ DECLARE src text; BEGIN
 SELECT pg_get_functiondef('public.sb_user_action(text,jsonb)'::regprocedure) INTO src;
 src:=replace(src,chr(92)||chr(92)||'.',chr(92)||'.');
 src:=replace(src,chr(92)||chr(92)||'d',chr(92)||'d');
 EXECUTE src;
END $$;
NOTIFY pgrst,'reload schema';
