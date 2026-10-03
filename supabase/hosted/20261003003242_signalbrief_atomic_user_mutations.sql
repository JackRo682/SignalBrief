CREATE FUNCTION public.sb_user_action(action text,p jsonb DEFAULT '{}'::jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u text:=(SELECT auth.uid())::text;w text;pf text;c text;i text;r jsonb;j jsonb;n int;q numeric;cost numeric;v text;ids text[];
BEGIN
 IF u IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='PT401'; END IF;
 IF p IS NULL OR jsonb_typeof(p)<>'object' OR octet_length(p::text)>131072 THEN RAISE EXCEPTION 'invalid_body' USING ERRCODE='PT422'; END IF;
 PERFORM public.sb_initialize_profile(); PERFORM 1 FROM public.users WHERE id=u FOR UPDATE;
 SELECT id INTO w FROM public.watchlists WHERE user_id=u AND name='관심종목'; SELECT id INTO pf FROM public.portfolios WHERE user_id=u AND name='내 포트폴리오';
 CASE action
 WHEN 'profile' THEN
  IF p ? 'density' AND coalesce(p->>'density','') NOT IN ('beginner','advanced') THEN RAISE EXCEPTION 'invalid_density' USING ERRCODE='PT422'; END IF;
  IF p ? 'display_name' AND length(trim(coalesce(p->>'display_name',''))) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'invalid_name' USING ERRCODE='PT422'; END IF;
  UPDATE public.users SET display_name=coalesce(nullif(trim(p->>'display_name'),''),display_name),density=coalesce(p->>'density',density),analytics_consent=coalesce((p->>'analytics_consent')::boolean,analytics_consent),updated_at=now() WHERE id=u;
  RETURN public.sb_initialize_profile();
 WHEN 'onboarding' THEN
  IF jsonb_typeof(p->'company_ids') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'invalid_company_ids' USING ERRCODE='PT422'; END IF;
  SELECT array_agg(DISTINCT x) INTO ids FROM jsonb_array_elements_text(p->'company_ids') AS x;
  IF coalesce(cardinality(ids),0) NOT BETWEEN 3 AND 50 OR (SELECT count(*) FROM public.companies WHERE id=ANY(ids) AND NOT is_demo)<>cardinality(ids) THEN RAISE EXCEPTION 'select_3_to_50_valid_companies' USING ERRCODE='PT422'; END IF;
  DELETE FROM public.watchlist_items WHERE watchlist_id=w; INSERT INTO public.watchlist_items SELECT w,x,now() FROM unnest(ids) AS x;
  UPDATE public.users SET onboarding_completed=true,analytics_consent=coalesce((p->>'analytics_consent')::boolean,false),updated_at=now() WHERE id=u; RETURN public.sb_initialize_profile();
 WHEN 'preferences' THEN
  IF p ? 'markets' AND (jsonb_typeof(p->'markets') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'markets') NOT BETWEEN 1 AND 2 OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(p->'markets') AS x WHERE x NOT IN ('KR','US'))) THEN RAISE EXCEPTION 'invalid_markets' USING ERRCODE='PT422'; END IF;
  IF p ? 'sectors' AND (jsonb_typeof(p->'sectors') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'sectors')>5 OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(p->'sectors') AS x WHERE length(x)>40)) THEN RAISE EXCEPTION 'invalid_sectors' USING ERRCODE='PT422'; END IF;
  UPDATE public.user_preferences SET experience=coalesce(p->>'experience',experience),markets=coalesce(p->'markets',markets),sectors=coalesce(p->'sectors',sectors),alert_frequency=coalesce(p->>'alert_frequency',alert_frequency),updated_at=now() WHERE user_id=u RETURNING to_jsonb(user_preferences.*) INTO r; RETURN r;
 WHEN 'watch_add' THEN
  c:=p->>'company_id'; IF NOT EXISTS(SELECT 1 FROM public.companies WHERE id=c AND NOT is_demo) THEN RAISE EXCEPTION 'company_not_found' USING ERRCODE='PT404'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.watchlist_items WHERE watchlist_id=w AND company_id=c) AND (SELECT count(*) FROM public.watchlist_items WHERE watchlist_id=w)>=50 THEN RAISE EXCEPTION 'watchlist_limit_50' USING ERRCODE='PT422'; END IF;
  INSERT INTO public.watchlist_items VALUES(w,c,now()) ON CONFLICT DO NOTHING;
 WHEN 'watch_remove' THEN DELETE FROM public.watchlist_items WHERE watchlist_id=w AND company_id=p->>'company_id';
 WHEN 'positions' THEN
  IF jsonb_typeof(p->'rows') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'rows') NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'invalid_positions' USING ERRCODE='PT422'; END IF;
  IF (SELECT count(DISTINCT x->>'company_id') FROM jsonb_array_elements(p->'rows') x)<>jsonb_array_length(p->'rows') THEN RAISE EXCEPTION 'duplicate_import_company' USING ERRCODE='PT422'; END IF;
  FOR j IN SELECT value FROM jsonb_array_elements(p->'rows') LOOP
   c:=j->>'company_id'; IF NOT EXISTS(SELECT 1 FROM public.companies WHERE id=c AND NOT is_demo) THEN RAISE EXCEPTION 'company_not_found' USING ERRCODE='PT422'; END IF;
   IF coalesce(j->>'quantity','') !~ '^[0-9]{1,20}(\\.[0-9]{1,8})?$' OR coalesce(j->>'currency','') NOT IN ('USD','KRW','EUR','JPY','GBP','AUD','CAD','HKD','CNY','CHF') THEN RAISE EXCEPTION 'invalid_quantity_or_currency' USING ERRCODE='PT422'; END IF;
   q:=(j->>'quantity')::numeric; IF q<=0 THEN RAISE EXCEPTION 'quantity_must_be_positive' USING ERRCODE='PT422'; END IF;
   cost:=NULL; IF j->>'average_cost' IS NOT NULL THEN IF j->>'average_cost' !~ '^[0-9]{1,20}(\\.[0-9]{1,8})?$' THEN RAISE EXCEPTION 'invalid_cost' USING ERRCODE='PT422'; END IF; cost:=(j->>'average_cost')::numeric; END IF;
   INSERT INTO public.positions(id,portfolio_id,company_id,quantity,average_cost,currency,created_at,updated_at) VALUES(gen_random_uuid()::text,pf,c,q,cost,j->>'currency',now(),now()) ON CONFLICT(portfolio_id,company_id) DO UPDATE SET quantity=EXCLUDED.quantity,average_cost=EXCLUDED.average_cost,currency=EXCLUDED.currency,updated_at=now();
  END LOOP;
  IF (SELECT count(*) FROM public.positions WHERE portfolio_id=pf)>200 THEN RAISE EXCEPTION 'portfolio_limit_200' USING ERRCODE='PT422'; END IF;
 WHEN 'position_remove' THEN DELETE FROM public.positions WHERE portfolio_id=pf AND company_id=p->>'company_id';
 WHEN 'alert_save' THEN
  IF length(trim(coalesce(p->>'name',''))) NOT BETWEEN 1 AND 100 OR coalesce(p->>'min_score','') !~ '^(0(\\.[0-9]+)?|1(\\.0+)?)$' OR jsonb_typeof(p->'event_types') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'event_types')>20 THEN RAISE EXCEPTION 'invalid_alert' USING ERRCODE='PT422'; END IF;
  i:=p->>'id'; IF i IS NULL THEN
   IF (SELECT count(*) FROM public.alerts WHERE user_id=u)>=20 THEN RAISE EXCEPTION 'alert_limit_20' USING ERRCODE='PT422'; END IF;
   i:=gen_random_uuid()::text; INSERT INTO public.alerts(id,user_id,name,event_types,min_score,enabled,created_at) VALUES(i,u,trim(p->>'name'),(p->'event_types')::json,(p->>'min_score')::float,coalesce((p->>'enabled')::boolean,true),now());
  ELSE UPDATE public.alerts SET name=trim(p->>'name'),event_types=(p->'event_types')::json,min_score=(p->>'min_score')::float,enabled=coalesce((p->>'enabled')::boolean,true) WHERE id=i AND user_id=u; IF NOT FOUND THEN RAISE EXCEPTION 'alert_not_found' USING ERRCODE='PT404'; END IF; END IF;
  SELECT to_jsonb(a) INTO r FROM public.alerts a WHERE id=i AND user_id=u; RETURN r;
 WHEN 'alert_remove' THEN DELETE FROM public.alerts WHERE id=p->>'id' AND user_id=u;
 WHEN 'calendar_add' THEN
  IF length(trim(coalesce(p->>'title',''))) NOT BETWEEN 1 AND 200 OR coalesce(p->>'occurs_on','') !~ '^\\d{4}-\\d{2}-\\d{2}$' THEN RAISE EXCEPTION 'invalid_calendar_item' USING ERRCODE='PT422'; END IF;
  IF (SELECT count(*) FROM public.calendar_items WHERE user_id=u)>=500 THEN RAISE EXCEPTION 'calendar_limit_500' USING ERRCODE='PT422'; END IF;
  i:=gen_random_uuid()::text; INSERT INTO public.calendar_items(id,user_id,title,occurs_on,origin,created_at) VALUES(i,u,trim(p->>'title'),(p->>'occurs_on')::date,'user',now());
  SELECT to_jsonb(x)||jsonb_build_object('source_url',NULL,'is_demo',false) INTO r FROM public.calendar_items x WHERE id=i; RETURN r;
 WHEN 'calendar_remove' THEN DELETE FROM public.calendar_items WHERE id=p->>'id' AND user_id=u AND origin='user';
 WHEN 'notification_read' THEN UPDATE public.notifications SET read_at=coalesce(read_at,now()) WHERE user_id=u AND (p->>'id'='all' OR id=p->>'id');
 WHEN 'feedback' THEN
  c:=p->>'event_id'; IF NOT app_private.sb_event_visible(c) THEN RAISE EXCEPTION 'event_not_found' USING ERRCODE='PT404'; END IF;
  IF coalesce(p->>'rating','') NOT IN ('helpful','not_helpful','report') OR length(coalesce(p->>'comment',''))>1000 THEN RAISE EXCEPTION 'invalid_feedback' USING ERRCODE='PT422'; END IF;
  INSERT INTO public.feedback(id,user_id,event_id,rating,comment,state,created_at) VALUES(gen_random_uuid()::text,u,c,p->>'rating',coalesce(p->>'comment',''),'open',now()) ON CONFLICT(user_id,event_id) DO UPDATE SET rating=EXCLUDED.rating,comment=EXCLUDED.comment,state='open';
 WHEN 'chat_save' THEN
  c:=p->>'event_id'; IF NOT app_private.sb_event_visible(c) THEN RAISE EXCEPTION 'event_not_found' USING ERRCODE='PT404'; END IF;
  IF jsonb_typeof(p->'answer') IS DISTINCT FROM 'object' OR octet_length((p->'answer')::text)>24000 THEN RAISE EXCEPTION 'invalid_answer' USING ERRCODE='PT422'; END IF;
  INSERT INTO public.question_history(user_id,event_id,question,answer) VALUES(u,c,p->>'question',p->'answer');
 WHEN 'subscription_create' THEN
  v:=p->>'token'; IF coalesce(v,'') !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'invalid_token' USING ERRCODE='PT422'; END IF;
  INSERT INTO app_private.calendar_subscriptions(user_id,token_hash) VALUES(u,encode(sha256(convert_to(v,'UTF8')),'hex')) ON CONFLICT(user_id) DO UPDATE SET token_hash=EXCLUDED.token_hash,created_at=now(),expires_at=now()+interval '90 days';
 WHEN 'subscription_revoke' THEN DELETE FROM app_private.calendar_subscriptions WHERE user_id=u;
 ELSE RAISE EXCEPTION 'unknown_action' USING ERRCODE='PT404'; END CASE; RETURN '{}'::jsonb;
END $$;
REVOKE ALL ON FUNCTION public.sb_user_action(text,jsonb) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.sb_user_action(text,jsonb) TO authenticated;
CREATE FUNCTION public.sb_calendar_feed(token text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'title',c.title,'occurs_on',c.occurs_on,'origin',c.origin) ORDER BY c.occurs_on),'[]'::jsonb) FROM public.calendar_items c WHERE token ~ '^[a-f0-9]{64}$' AND c.origin='user' AND c.user_id=(SELECT s.user_id FROM app_private.calendar_subscriptions s WHERE s.token_hash=encode(sha256(convert_to(token,'UTF8')),'hex') AND s.expires_at>now()) $$;
REVOKE ALL ON FUNCTION public.sb_calendar_feed(text) FROM PUBLIC; GRANT EXECUTE ON FUNCTION public.sb_calendar_feed(text) TO anon,authenticated;
NOTIFY pgrst,'reload schema';