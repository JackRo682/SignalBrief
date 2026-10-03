-- Reference screen extensions. Apply once after the existing hosted migrations.
-- The deployed database records reference_screens_authenticated_interactions.
ALTER TABLE public.user_preferences ADD COLUMN IF NOT EXISTS has_holdings boolean;
ALTER TABLE public.user_preferences ADD COLUMN IF NOT EXISTS realtime_enabled boolean NOT NULL DEFAULT true;
CREATE TABLE public.calendar_reminders(user_id varchar(36) NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,calendar_id varchar(36) NOT NULL REFERENCES public.calendar_items(id) ON DELETE CASCADE,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(user_id,calendar_id));
ALTER TABLE public.calendar_reminders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.calendar_reminders FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.calendar_reminders TO authenticated;
CREATE POLICY owner_select ON public.calendar_reminders FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid())::text);
CREATE OR REPLACE FUNCTION public.sb_reference_preferences(p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE u text:=(SELECT auth.uid())::text;r jsonb; BEGIN
 IF u IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='PT401'; END IF;
 IF p IS NULL OR jsonb_typeof(p)<>'object' OR octet_length(p::text)>4096 THEN RAISE EXCEPTION 'invalid_preferences' USING ERRCODE='PT422';END IF;
 PERFORM public.sb_initialize_profile();PERFORM public.sb_rate_limit();
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p) k WHERE k NOT IN ('experience','markets','sectors','alert_frequency','has_holdings','browser_notifications','realtime_enabled','notify_min_score')) THEN RAISE EXCEPTION 'unsupported_preference' USING ERRCODE='PT422';END IF;
 IF p ? 'has_holdings' AND jsonb_typeof(p->'has_holdings')<>'boolean' OR p ? 'browser_notifications' AND jsonb_typeof(p->'browser_notifications')<>'boolean' OR p ? 'realtime_enabled' AND jsonb_typeof(p->'realtime_enabled')<>'boolean' THEN RAISE EXCEPTION 'boolean_required' USING ERRCODE='PT422';END IF;
 IF p ? 'notify_min_score' AND (jsonb_typeof(p->'notify_min_score')<>'number' OR (p->>'notify_min_score')::numeric NOT BETWEEN 0 AND 1) THEN RAISE EXCEPTION 'invalid_threshold' USING ERRCODE='PT422';END IF;
 PERFORM public.sb_user_action('preferences',p-'has_holdings'-'browser_notifications'-'realtime_enabled'-'notify_min_score');
 UPDATE public.user_preferences SET has_holdings=coalesce((p->>'has_holdings')::boolean,has_holdings),browser_notifications=coalesce((p->>'browser_notifications')::boolean,browser_notifications),realtime_enabled=coalesce((p->>'realtime_enabled')::boolean,realtime_enabled),notify_min_score=coalesce((p->>'notify_min_score')::numeric,notify_min_score),updated_at=now() WHERE user_id=u RETURNING to_jsonb(user_preferences.*) INTO r;
 RETURN r; END $$;
CREATE OR REPLACE FUNCTION public.sb_reference_setup(p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE u text:=(SELECT auth.uid())::text;w text;pf text;ids text[];items jsonb;cnt int;BEGIN
 IF u IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='PT401';END IF;
 IF p IS NULL OR jsonb_typeof(p)<>'object' OR octet_length(p::text)>131072 OR jsonb_typeof(p->'company_ids') IS DISTINCT FROM 'array' OR jsonb_typeof(p->'positions') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'invalid_setup' USING ERRCODE='PT422';END IF;
 IF jsonb_array_length(p->'company_ids')>50 OR jsonb_array_length(p->'positions')>200 THEN RAISE EXCEPTION 'setup_limit_exceeded' USING ERRCODE='PT422';END IF;
 IF p ? 'complete_onboarding' AND jsonb_typeof(p->'complete_onboarding')<>'boolean' THEN RAISE EXCEPTION 'invalid_onboarding_flag' USING ERRCODE='PT422';END IF;
 SELECT coalesce(array_agg(DISTINCT value),'{}'::text[]) INTO ids FROM jsonb_array_elements_text(p->'company_ids');
 IF cardinality(ids)<>jsonb_array_length(p->'company_ids') OR (SELECT count(*) FROM public.companies WHERE id=ANY(ids) AND NOT is_demo)<>cardinality(ids) THEN RAISE EXCEPTION 'invalid_company_ids' USING ERRCODE='PT422';END IF;
 PERFORM public.sb_initialize_profile();PERFORM public.sb_rate_limit();PERFORM 1 FROM public.users WHERE id=u FOR UPDATE;
 SELECT id INTO w FROM public.watchlists WHERE user_id=u AND name='관심종목';SELECT id INTO pf FROM public.portfolios WHERE user_id=u AND name='내 포트폴리오';items:=p->'positions';
 DELETE FROM public.watchlist_items WHERE watchlist_id=w;
 INSERT INTO public.watchlist_items(watchlist_id,company_id,created_at) SELECT w,x,now() FROM unnest(ids) x;
 DELETE FROM public.positions WHERE portfolio_id=pf;
 IF jsonb_array_length(items)>0 THEN PERFORM public.sb_user_action('positions',jsonb_build_object('rows',items));END IF;
 IF coalesce((p->>'complete_onboarding')::boolean,false) THEN UPDATE public.users SET onboarding_completed=true,updated_at=now() WHERE id=u;END IF;
 RETURN jsonb_build_object('saved',true,'watchlist_count',cardinality(ids),'position_count',jsonb_array_length(items));END $$;
CREATE OR REPLACE FUNCTION public.sb_reference_reminders(p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE u text:=(SELECT auth.uid())::text;cid text;BEGIN
 IF u IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='PT401';END IF;PERFORM public.sb_rate_limit();
 IF p IS NULL OR jsonb_typeof(p)<>'object' OR octet_length(p::text)>1024 THEN RAISE EXCEPTION 'invalid_reminder' USING ERRCODE='PT422';END IF;
 IF p->>'action'='list' THEN RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('calendar_id',calendar_id)) FROM public.calendar_reminders WHERE user_id=u),'[]');END IF;
 IF p->>'action'<>'set' OR jsonb_typeof(p->'enabled') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'invalid_reminder_action' USING ERRCODE='PT422';END IF;cid:=p->>'calendar_id';
 IF NOT EXISTS(SELECT 1 FROM public.calendar_items c WHERE c.id=cid AND (c.user_id=u OR c.origin='official' AND app_private.sb_event_visible(c.event_id) AND (EXISTS(SELECT 1 FROM public.watchlist_items i JOIN public.watchlists w ON w.id=i.watchlist_id WHERE w.user_id=u AND i.company_id=c.company_id) OR EXISTS(SELECT 1 FROM public.positions p JOIN public.portfolios f ON f.id=p.portfolio_id WHERE f.user_id=u AND p.company_id=c.company_id)))) THEN RAISE EXCEPTION 'calendar_not_found' USING ERRCODE='PT404';END IF;
 IF (p->>'enabled')::boolean THEN INSERT INTO public.calendar_reminders(user_id,calendar_id) VALUES(u,cid) ON CONFLICT DO NOTHING;ELSE DELETE FROM public.calendar_reminders WHERE user_id=u AND calendar_id=cid;END IF;RETURN jsonb_build_object('saved',true,'delivery','saved_interest_only');END $$;
CREATE OR REPLACE FUNCTION public.sb_reference_users() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$ BEGIN IF NOT app_private.sb_is_admin() THEN RAISE EXCEPTION 'admin_required' USING ERRCODE='PT403';END IF;RETURN coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT display_name,created_at,onboarding_completed FROM public.users ORDER BY created_at DESC LIMIT 100) x),'[]');END $$;
CREATE OR REPLACE FUNCTION public.sb_reference_public_stats() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT jsonb_build_object('documents',(SELECT count(*) FROM public.documents WHERE NOT is_demo),'companies',(SELECT count(*) FROM public.companies WHERE NOT is_demo),'users',NULL,'uptime_pct',NULL) $$;
CREATE OR REPLACE FUNCTION public.sb_reference_ops(p jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$ DECLARE since_at timestamptz;until_at timestamptz:=now();period interval;metrics jsonb;key text;value numeric;note text;BEGIN
 IF NOT app_private.sb_is_admin() THEN RAISE EXCEPTION 'admin_required' USING ERRCODE='PT403';END IF;
 IF p IS NULL OR jsonb_typeof(p)<>'object' OR octet_length(p::text)>1024 THEN RAISE EXCEPTION 'invalid_range' USING ERRCODE='PT422';END IF;
 CASE p->>'range' WHEN '24h' THEN since_at:=now()-interval '24 hours';WHEN '7d' THEN since_at:=now()-interval '7 days';WHEN '30d' THEN since_at:=now()-interval '30 days';WHEN 'custom' THEN since_at:=((p->>'start')::date)::timestamp AT TIME ZONE 'Asia/Seoul';until_at:=(((p->>'end')::date)+1)::timestamp AT TIME ZONE 'Asia/Seoul';ELSE RAISE EXCEPTION 'invalid_range' USING ERRCODE='PT422';END CASE;
 IF since_at IS NULL OR until_at IS NULL OR until_at<=since_at OR until_at-since_at>interval '91 days' THEN RAISE EXCEPTION 'invalid_range' USING ERRCODE='PT422';END IF;
 metrics:='{}';FOREACH key IN ARRAY ARRAY['documents','events','ai_runs','ai_failures','low_confidence','citation_failures','number_mismatch','duplicates','pipeline_latency','ai_cost'] LOOP
 note:='선택 기간의 기록';CASE key
 WHEN 'documents' THEN SELECT count(*) INTO value FROM public.documents WHERE NOT is_demo AND ingested_at>=since_at AND ingested_at<until_at;
 WHEN 'events' THEN SELECT count(*) INTO value FROM public.events WHERE created_at>=since_at AND created_at<until_at;
 WHEN 'ai_runs' THEN SELECT count(*) INTO value FROM public.ai_runs WHERE created_at>=since_at AND created_at<until_at;
 WHEN 'ai_failures' THEN SELECT count(*) INTO value FROM public.ai_runs WHERE status='failed' AND created_at>=since_at AND created_at<until_at;
 WHEN 'low_confidence' THEN SELECT count(*) INTO value FROM public.events WHERE confidence<0.7 AND created_at>=since_at AND created_at<until_at;
 WHEN 'citation_failures' THEN SELECT count(*) INTO value FROM public.validations WHERE status IN ('missing_source','unsupported','conflicting_sources') AND created_at>=since_at AND created_at<until_at;
 WHEN 'number_mismatch' THEN SELECT count(*) INTO value FROM public.validations WHERE status='numeric_mismatch' AND created_at>=since_at AND created_at<until_at;
 WHEN 'duplicates' THEN SELECT count(*) INTO value FROM public.events WHERE state='duplicate' AND created_at>=since_at AND created_at<until_at;
 WHEN 'pipeline_latency' THEN SELECT round(avg(latency_ms)::numeric,0) INTO value FROM public.ai_runs WHERE created_at>=since_at AND created_at<until_at;note:='실행 지연시간 평균 · ms';
 WHEN 'ai_cost' THEN SELECT sum(cost_usd) INTO value FROM public.ai_runs WHERE created_at>=since_at AND created_at<until_at;note:='기록된 비용만 합산 · USD';END CASE;
 metrics:=metrics||jsonb_build_object(key,jsonb_build_object('value',value,'delta',NULL,'spark','[]'::jsonb,'note',note));END LOOP;
 RETURN jsonb_build_object('metrics',metrics,'since',since_at,'until',until_at,
 'review',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT e.id,e.document_id,e.title,e.confidence,e.state,e.created_at,c.ticker AS symbol FROM public.events e JOIN public.companies c ON c.id=e.company_id WHERE e.state='needs_review' AND e.created_at>=since_at AND e.created_at<until_at ORDER BY e.created_at DESC LIMIT 100) x),'[]'),
 'failures',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT r.id,d.title,r.status,r.error_code,r.created_at FROM public.ai_runs r LEFT JOIN public.documents d ON d.id=r.document_id WHERE r.status IN ('failed','validation_failed') AND r.created_at>=since_at AND r.created_at<until_at ORDER BY r.created_at DESC LIMIT 100) x),'[]'),
 'citations',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT DISTINCT e.id,e.document_id,e.title,e.state,e.created_at,v.status AS symbol FROM public.events e JOIN public.validations v ON v.event_id=e.id WHERE v.status IN ('missing_source','unsupported','conflicting_sources','numeric_mismatch') AND v.created_at>=since_at AND v.created_at<until_at ORDER BY e.created_at DESC LIMIT 100) x),'[]'),
 'duplicates',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT e.id,e.document_id,e.title,e.state,e.created_at,c.ticker AS symbol FROM public.events e JOIN public.companies c ON c.id=e.company_id WHERE e.state='duplicate' AND e.created_at>=since_at AND e.created_at<until_at ORDER BY e.created_at DESC LIMIT 100) x),'[]'),
 'reports',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT f.id,f.comment,f.rating,f.state,f.created_at FROM public.feedback f WHERE f.state='open' AND f.created_at>=since_at AND f.created_at<until_at ORDER BY f.created_at DESC LIMIT 100) x),'[]'));END $$;
REVOKE ALL ON FUNCTION public.sb_reference_preferences(jsonb),public.sb_reference_setup(jsonb),public.sb_reference_reminders(jsonb),public.sb_reference_users(),public.sb_reference_ops(jsonb),public.sb_reference_public_stats() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.sb_reference_preferences(jsonb),public.sb_reference_setup(jsonb),public.sb_reference_reminders(jsonb),public.sb_reference_users(),public.sb_reference_ops(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sb_reference_public_stats() TO anon,authenticated;
CREATE OR REPLACE FUNCTION app_private.sb_preference_notification_gate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE pref public.user_preferences%rowtype;e public.events%rowtype;relevance double precision:=0;novelty double precision;rank_score double precision;source_quality double precision;BEGIN
 SELECT * INTO pref FROM public.user_preferences WHERE user_id=NEW.user_id;IF FOUND AND NOT pref.realtime_enabled THEN RETURN NULL;END IF;
 IF coalesce(pref.notify_min_score,0)<=0 THEN RETURN NEW;END IF;SELECT * INTO e FROM public.events WHERE id=NEW.event_id;
 IF EXISTS(SELECT 1 FROM public.positions p JOIN public.portfolios f ON f.id=p.portfolio_id WHERE f.user_id=NEW.user_id AND p.company_id=e.company_id) THEN relevance:=1;ELSIF EXISTS(SELECT 1 FROM public.watchlist_items i JOIN public.watchlists w ON w.id=i.watchlist_id WHERE w.user_id=NEW.user_id AND i.company_id=e.company_id) THEN relevance:=0.6;END IF;
 novelty:=CASE WHEN EXISTS(SELECT 1 FROM public.changes WHERE event_id=e.id AND change_type IN ('increased','decreased','wording_changed')) THEN 1 ELSE 0.3 END;
 SELECT CASE WHEN provider IN ('dart','sec') THEN 1 ELSE 0.5 END INTO source_quality FROM public.documents WHERE id=e.document_id;
 rank_score:=(0.3*relevance+0.2*greatest(0,least(1,e.materiality))+0.15*novelty+0.15*source_quality+0.1*exp(-ln(2)*greatest(0,extract(epoch FROM(now()-e.published_at))/3600)/48))/0.9;
 IF rank_score<pref.notify_min_score THEN RETURN NULL;END IF;RETURN NEW;END $$;
CREATE TRIGGER sb_reference_notification_preferences BEFORE INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION app_private.sb_preference_notification_gate();
NOTIFY pgrst,'reload schema';
