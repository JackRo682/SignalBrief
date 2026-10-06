-- Search-list controls deliberately do not delete browsing history or bookmarks.
-- This bounded per-user operation follows the existing hosted RPC ownership model.
CREATE FUNCTION public.sb_workspace_searches(action text, p jsonb DEFAULT '{}')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  u text := (SELECT auth.uid())::text;
  q text;
  deleted_count integer;
BEGIN
  IF u IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = u::uuid) THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = 'PT401';
  END IF;
  PERFORM public.sb_require_mfa();
  IF p IS NULL OR jsonb_typeof(p) <> 'object' OR octet_length(p::text) > 2048 THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = 'PT422';
  END IF;
  IF action IS NULL OR action NOT IN ('search_delete', 'searches_clear') THEN
    RAISE EXCEPTION 'unsupported_action' USING ERRCODE = 'PT404';
  END IF;
  PERFORM public.sb_rate_limit();
  IF action = 'search_delete' THEN
    IF p - 'query' <> '{}' OR jsonb_typeof(p->'query') IS DISTINCT FROM 'string'
       OR length(trim(p->>'query')) NOT BETWEEN 1 AND 100 THEN
      RAISE EXCEPTION 'invalid_query' USING ERRCODE = 'PT422';
    END IF;
    q := trim(p->>'query');
    DELETE FROM public.workspace_searches WHERE user_id = u AND query = q;
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN jsonb_build_object('deleted', deleted_count);
  END IF;
  IF p <> '{}' THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = 'PT422';
  END IF;
  DELETE FROM public.workspace_searches WHERE user_id = u;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN jsonb_build_object('cleared', true, 'deleted', deleted_count);
END;
$$;

REVOKE ALL ON FUNCTION public.sb_workspace_searches(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sb_workspace_searches(text, jsonb) TO authenticated;
COMMENT ON FUNCTION public.sb_workspace_searches(text, jsonb) IS
  'Intentional per-user mutation API: current Auth identity, MFA, rate limits and exact owner predicates; no browsing history deletion.';

-- Complete onboarding from explicit deltas. A stale screen may not replace
-- the whole watchlist/portfolio and remove another screen's recent additions.
CREATE FUNCTION public.sb_mobile_onboarding(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  u text := (SELECT auth.uid())::text;
  w text;
  item jsonb;
  add_ids text[];
  remove_ids text[];
BEGIN
  IF u IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = u::uuid) THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = 'PT401';
  END IF;
  PERFORM public.sb_require_mfa();
  IF p IS NULL OR jsonb_typeof(p) <> 'object' OR octet_length(p::text) > 16384 THEN
    RAISE EXCEPTION 'invalid_onboarding' USING ERRCODE = 'PT422';
  END IF;
  IF p - 'company_ids' - 'removed_company_ids' - 'positions' - 'analytics_consent' <> '{}'
     OR jsonb_typeof(p->'company_ids') IS DISTINCT FROM 'array'
     OR jsonb_typeof(p->'removed_company_ids') IS DISTINCT FROM 'array'
     OR jsonb_typeof(p->'positions') IS DISTINCT FROM 'array'
     OR (p ? 'analytics_consent' AND jsonb_typeof(p->'analytics_consent') IS DISTINCT FROM 'boolean') THEN
    RAISE EXCEPTION 'invalid_onboarding' USING ERRCODE = 'PT422';
  END IF;
  IF jsonb_array_length(p->'company_ids') > 10 OR jsonb_array_length(p->'removed_company_ids') > 50
     OR jsonb_array_length(p->'positions') > 10 THEN
    RAISE EXCEPTION 'onboarding_selection_limit' USING ERRCODE = 'PT422';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements((p->'company_ids')||(p->'removed_company_ids')) x
             WHERE jsonb_typeof(x) <> 'string' OR (x#>>'{}') !~ '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$') THEN
    RAISE EXCEPTION 'invalid_company_ids' USING ERRCODE = 'PT422';
  END IF;
  SELECT coalesce(array_agg(x), ARRAY[]::text[]) INTO add_ids FROM jsonb_array_elements_text(p->'company_ids') x;
  SELECT coalesce(array_agg(x), ARRAY[]::text[]) INTO remove_ids FROM jsonb_array_elements_text(p->'removed_company_ids') x;
  IF (SELECT count(DISTINCT x) FROM unnest(add_ids) x) <> cardinality(add_ids)
     OR (SELECT count(DISTINCT x) FROM unnest(remove_ids) x) <> cardinality(remove_ids)
     OR add_ids && remove_ids THEN
    RAISE EXCEPTION 'duplicate_or_conflicting_company' USING ERRCODE = 'PT422';
  END IF;
  IF (SELECT count(*) FROM public.companies WHERE id = ANY(add_ids) AND provider = 'sec' AND NOT is_demo) <> cardinality(add_ids) THEN
    RAISE EXCEPTION 'unsupported_company' USING ERRCODE = 'PT422';
  END IF;
  IF (SELECT count(DISTINCT x->>'company_id') FROM jsonb_array_elements(p->'positions') x) <> jsonb_array_length(p->'positions') THEN
    RAISE EXCEPTION 'duplicate_position_company' USING ERRCODE = 'PT422';
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p->'positions') LOOP
    IF jsonb_typeof(item) <> 'object' OR item - 'company_id' - 'quantity' - 'average_cost' - 'currency' <> '{}'
       OR jsonb_typeof(item->'company_id') IS DISTINCT FROM 'string'
       OR jsonb_typeof(item->'quantity') IS DISTINCT FROM 'string'
       OR jsonb_typeof(item->'currency') IS DISTINCT FROM 'string'
       OR NOT (item ? 'average_cost')
       OR jsonb_typeof(item->'average_cost') NOT IN ('null','string')
       OR coalesce(item->>'quantity','') !~ '^[0-9]{1,20}([.][0-9]{1,8})?$'
       OR coalesce(item->>'currency','') NOT IN ('USD','KRW','EUR','JPY','GBP','AUD','CAD','HKD','CNY','CHF')
       OR NOT EXISTS (SELECT 1 FROM public.companies WHERE id = item->>'company_id' AND provider = 'sec' AND NOT is_demo) THEN
      RAISE EXCEPTION 'invalid_position' USING ERRCODE = 'PT422';
    END IF;
    IF (item->>'quantity')::numeric <= 0 OR (item->>'average_cost' IS NOT NULL AND item->>'average_cost' !~ '^[0-9]{1,20}([.][0-9]{1,8})?$') THEN
      RAISE EXCEPTION 'invalid_position_decimal' USING ERRCODE = 'PT422';
    END IF;
  END LOOP;
  PERFORM public.sb_initialize_profile();
  PERFORM public.sb_rate_limit();
  PERFORM 1 FROM public.users WHERE id = u FOR UPDATE;
  SELECT id INTO w FROM public.watchlists WHERE user_id = u AND name = '관심종목';
  DELETE FROM public.watchlist_items WHERE watchlist_id = w AND company_id = ANY(remove_ids);
  INSERT INTO public.watchlist_items(watchlist_id, company_id, created_at)
    SELECT w, x, now() FROM unnest(add_ids) x ON CONFLICT(watchlist_id, company_id) DO NOTHING;
  IF (SELECT count(*) FROM public.watchlist_items WHERE watchlist_id = w) > 50 THEN
    RAISE EXCEPTION 'watchlist_limit_50' USING ERRCODE = 'PT422';
  END IF;
  IF jsonb_array_length(p->'positions') > 0 THEN
    PERFORM public.sb_user_action('positions', jsonb_build_object('rows', p->'positions'));
  END IF;
  UPDATE public.users SET onboarding_completed = true,
    analytics_consent = CASE WHEN p ? 'analytics_consent' THEN (p->>'analytics_consent')::boolean ELSE analytics_consent END,
    updated_at = now() WHERE id = u;
  RETURN public.sb_initialize_profile();
END;
$$;
REVOKE ALL ON FUNCTION public.sb_mobile_onboarding(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sb_mobile_onboarding(jsonb) TO authenticated;
COMMENT ON FUNCTION public.sb_mobile_onboarding(jsonb) IS
  'Intentional per-user onboarding API: atomic explicit watchlist deltas and holding upserts; never replaces or removes unspecified holdings.';
NOTIFY pgrst, 'reload schema';
