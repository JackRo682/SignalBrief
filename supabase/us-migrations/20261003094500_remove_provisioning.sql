DROP FUNCTION IF EXISTS public.sb_us_task_take(text);
DROP FUNCTION IF EXISTS public.sb_us_task_finish(text,jsonb,jsonb,boolean);
DROP FUNCTION IF EXISTS public.sb_us_vault_put(text,text);
DROP TABLE IF EXISTS app_private.us_tasks;
NOTIFY pgrst,'reload schema';
