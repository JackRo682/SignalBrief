-- The existing saved-date RPC must recognize independently verified IR dates.
CREATE OR REPLACE FUNCTION public.sb_reference_reminders(p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u text:=(SELECT auth.uid())::text; cid text; BEGIN
 IF u IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='PT401'; END IF;
 PERFORM public.sb_rate_limit();
 IF p IS NULL OR jsonb_typeof(p)<>'object' OR octet_length(p::text)>1024 THEN RAISE EXCEPTION 'invalid_reminder' USING ERRCODE='PT422'; END IF;
 IF p->>'action'='list' THEN RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('calendar_id',calendar_id)) FROM public.calendar_reminders WHERE user_id=u),'[]'); END IF;
 IF coalesce(p->>'action','')<>'set' OR jsonb_typeof(p->'enabled') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'invalid_reminder_action' USING ERRCODE='PT422'; END IF;
 cid:=p->>'calendar_id';
 IF NOT EXISTS(SELECT 1 FROM public.calendar_items c WHERE c.id=cid AND c.calendar_status='confirmed' AND (
  c.user_id=u OR c.origin='official' AND (app_private.sb_event_visible(c.event_id) OR app_private.sb_calendar_confirmed(c.id)) AND (
   EXISTS(SELECT 1 FROM public.watchlist_items i JOIN public.watchlists w ON w.id=i.watchlist_id WHERE w.user_id=u AND i.company_id=c.company_id)
   OR EXISTS(SELECT 1 FROM public.positions p JOIN public.portfolios f ON f.id=p.portfolio_id WHERE f.user_id=u AND p.company_id=c.company_id)
  ))) THEN RAISE EXCEPTION 'calendar_not_found' USING ERRCODE='PT404'; END IF;
 IF (p->>'enabled')::boolean THEN
  INSERT INTO public.calendar_reminders(user_id,calendar_id) VALUES(u,cid) ON CONFLICT DO NOTHING;
 ELSE DELETE FROM public.calendar_reminders WHERE user_id=u AND calendar_id=cid; END IF;
 RETURN jsonb_build_object('saved',true,'delivery','saved_interest_only');
END $$;
REVOKE ALL ON FUNCTION public.sb_reference_reminders(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.sb_reference_reminders(jsonb) TO authenticated;
