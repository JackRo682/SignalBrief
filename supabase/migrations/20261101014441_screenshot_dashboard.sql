-- Additive queries for the screenshot-based customer workspace.
-- Requires the existing source visibility + signed-in content migrations.
-- Reads approved customer projections; never exposes raw analysis/admin rows.
CREATE OR REPLACE FUNCTION app_content_private.redesign(action text,p jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 u text:=(SELECT auth.uid())::text; company_filter text; first_day date; last_day date;
 q text; selected_market_group text; off integer; sz integer; result jsonb;
BEGIN
 IF u IS NULL OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=u::uuid) THEN
  RAISE EXCEPTION 'authentication_required' USING ERRCODE='PT401';
 END IF;
 PERFORM public.sb_require_mfa();
 PERFORM public.sb_rate_limit();
 IF p IS NULL OR jsonb_typeof(p)<>'object' OR octet_length(p::text)>4096 THEN
  RAISE EXCEPTION 'invalid_input' USING ERRCODE='PT422';
 END IF;
 IF action='design_dashboard' THEN
  IF p-'start_date'-'end_date'-'company_id'<>'{}' OR coalesce(p->>'start_date','')!~'^\d{4}-\d{2}-\d{2}$'
   OR coalesce(p->>'end_date','')!~'^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'invalid_dates' USING ERRCODE='PT422'; END IF;
  BEGIN first_day:=(p->>'start_date')::date;last_day:=(p->>'end_date')::date;
  EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN RAISE EXCEPTION 'invalid_dates' USING ERRCODE='PT422';END;
  IF first_day>last_day OR last_day-first_day>365 THEN RAISE EXCEPTION 'invalid_range' USING ERRCODE='PT422';END IF;
  company_filter:=lower(coalesce(p->>'company_id',''));
  IF (p ? 'company_id' AND jsonb_typeof(p->'company_id') IS DISTINCT FROM 'string')
   OR company_filter<>'' AND company_filter!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   THEN RAISE EXCEPTION 'invalid_company' USING ERRCODE='PT422';END IF;
  WITH resources AS MATERIALIZED (
   SELECT x.* FROM app_private.sb_customer_resources() x WHERE company_filter='' OR x.company_id=company_filter
  ),filings AS MATERIALIZED (
   SELECT * FROM resources WHERE kind='filing'
    AND CASE WHEN publication_precision='date' THEN (published_at AT TIME ZONE 'UTC')::date
             ELSE (published_at AT TIME ZONE 'Asia/Seoul')::date END BETWEEN first_day AND last_day
  ),analyses AS MATERIALIZED (
   SELECT * FROM resources WHERE kind IN ('us_analysis','dart_analysis','event')
    AND (reviewed_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN first_day AND last_day
  ),dates AS MATERIALIZED (
   SELECT c.id,c.company_id,c.title,c.occurs_on,c.source_url,c.source_timezone,c.verified_at,co.name company_name
   FROM public.calendar_items c JOIN public.companies co ON co.id=c.company_id
   WHERE NOT co.is_demo AND co.provider IN ('sec','dart') AND (company_filter='' OR c.company_id=company_filter)
    AND (c.user_id IS NULL OR c.user_id=u) AND c.origin='official' AND c.calendar_status='confirmed'
    AND c.verified_at IS NOT NULL AND c.source_url IS NOT NULL AND app_private.sb_calendar_confirmed(c.id)
    AND c.occurs_on BETWEEN first_day AND last_day
  ) SELECT jsonb_build_object(
   'as_of',now(),'timezone','Asia/Seoul','start_date',first_day,'end_date',last_day,
   'filing_count',(SELECT count(*) FROM filings),'analysis_count',(SELECT count(*) FROM analyses),'event_count',(SELECT count(*) FROM dates),
   'filings',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM filings ORDER BY published_at DESC,id LIMIT 5)x),'[]'::jsonb),
   'analyses',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM analyses ORDER BY reviewed_at DESC,id,kind LIMIT 5)x),'[]'::jsonb),
   'events',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM dates ORDER BY occurs_on,id LIMIT 5)x),'[]'::jsonb)
  ) INTO result;
  RETURN result;
 ELSIF action='design_directory' THEN
  IF p-'q'-'market_group'-'offset'-'limit'<>'{}' THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='PT422';END IF;
  q:=lower(trim(coalesce(p->>'q','')));selected_market_group:=coalesce(p->>'market_group','all');
  off:=coalesce((p->>'offset')::integer,0);sz:=coalesce((p->>'limit')::integer,50);
  IF length(q)>100 OR off NOT BETWEEN 0 AND 10000 OR sz NOT BETWEEN 1 AND 50 OR selected_market_group NOT IN ('all','kospi','kosdaq','overseas','unclassified') THEN RAISE EXCEPTION 'invalid_filter' USING ERRCODE='PT422';END IF;
  WITH companies AS MATERIALIZED (
   SELECT x.*,CASE
    WHEN upper(x.market) IN ('KOSPI','코스피','KRX:KOSPI') THEN 'kospi'
    WHEN upper(x.market) IN ('KOSDAQ','코스닥','KRX:KOSDAQ') THEN 'kosdaq'
    WHEN upper(x.market) IN ('NASDAQ','NYSE','AMEX','NYSEARCA','NYSE ARCA','OTC','LSE','TSE','HKEX') THEN 'overseas'
    ELSE 'unclassified' END market_group
   FROM app_private.sb_customer_resources() x WHERE kind='company'
  ),matched AS MATERIALIZED (
   SELECT c.* FROM companies c WHERE (selected_market_group='all' OR c.market_group=selected_market_group)
    AND (q='' OR EXISTS(SELECT 1 FROM unnest(app_private.sb_search_terms(q)) term WHERE position(term IN lower(c.company_name||' '||c.ticker||' '||c.title))>0))
  ) SELECT jsonb_build_object(
   'items',coalesce((SELECT jsonb_agg(to_jsonb(x)-'market_group') FROM (SELECT * FROM matched ORDER BY company_name,id LIMIT sz OFFSET off)x),'[]'::jsonb),
   'total',(SELECT count(*) FROM matched),'counts',jsonb_build_object('company',(SELECT count(*) FROM matched)),
   'markets',coalesce((SELECT jsonb_agg(DISTINCT market) FROM companies),'[]'::jsonb),'categories','[]'::jsonb,
   'next_offset',CASE WHEN off+sz<(SELECT count(*) FROM matched) AND off+sz<=10000 THEN off+sz ELSE NULL END
  ) INTO result;
  RETURN result;
 END IF;
 RAISE EXCEPTION 'unsupported_action' USING ERRCODE='PT422';
END $$;
REVOKE ALL ON FUNCTION app_content_private.redesign(text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION app_content_private.redesign(text,jsonb) TO authenticated;
CREATE OR REPLACE FUNCTION public.sb_redesign_workspace(action text,p jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT app_content_private.redesign(action,p)
$$;
REVOKE ALL ON FUNCTION public.sb_redesign_workspace(text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.sb_redesign_workspace(text,jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';

-- Ownership-only deletion remains possible after unfollow/cancellation.
CREATE OR REPLACE FUNCTION public.sb_reference_reminders(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u text:=(SELECT auth.uid())::text; cid text; BEGIN
 IF u IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='PT401'; END IF;
 PERFORM public.sb_require_mfa();
 PERFORM public.sb_rate_limit();
 IF p IS NULL OR jsonb_typeof(p)<>'object' OR octet_length(p::text)>1024 THEN RAISE EXCEPTION 'invalid_reminder' USING ERRCODE='PT422';END IF;
 IF p->>'action'='list' THEN RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('calendar_id',calendar_id)) FROM public.calendar_reminders WHERE user_id=u),'[]');END IF;
 IF p-'action'-'calendar_id'-'enabled'<>'{}' OR coalesce(p->>'action','')<>'set' OR jsonb_typeof(p->'enabled') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'invalid_reminder_action' USING ERRCODE='PT422';END IF;
 cid:=p->>'calendar_id';
 IF cid IS NULL OR length(cid)>100 THEN RAISE EXCEPTION 'invalid_calendar_id' USING ERRCODE='PT422';END IF;
 IF NOT (p->>'enabled')::boolean THEN
  DELETE FROM public.calendar_reminders WHERE user_id=u AND calendar_id=cid;
  -- The legacy response is an operation acknowledgement, not current state.
  RETURN jsonb_build_object('saved',true,'delivery','saved_interest_only');
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.calendar_items c WHERE c.id=cid AND c.calendar_status='confirmed' AND (
  c.user_id=u OR c.origin='official' AND (app_private.sb_event_visible(c.event_id) OR app_private.sb_calendar_confirmed(c.id)) AND (
   EXISTS(SELECT 1 FROM public.watchlist_items i JOIN public.watchlists w ON w.id=i.watchlist_id WHERE w.user_id=u AND i.company_id=c.company_id)
   OR EXISTS(SELECT 1 FROM public.positions p JOIN public.portfolios f ON f.id=p.portfolio_id WHERE f.user_id=u AND p.company_id=c.company_id)
  ))) THEN RAISE EXCEPTION 'calendar_not_found' USING ERRCODE='PT404';END IF;
 INSERT INTO public.calendar_reminders(user_id,calendar_id) VALUES(u,cid) ON CONFLICT DO NOTHING;
 RETURN jsonb_build_object('saved',true,'delivery','saved_interest_only');
END $$;
REVOKE ALL ON FUNCTION public.sb_reference_reminders(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.sb_reference_reminders(jsonb) TO authenticated;
