-- Additive customer content projection. Existing admin/review RPCs are unchanged.
-- Customer APIs explicitly publish approved, source-bound excerpts only.
-- No approvals, email dispatches, billing state or source dates are changed here.
-- Reverting the web deployment returns callers to the legacy RPCs. Leave this
-- additive schema and saved identities intact to preserve user records on rollback.
CREATE SCHEMA app_content_private;
REVOKE ALL ON SCHEMA app_content_private FROM PUBLIC,anon;
GRANT USAGE ON SCHEMA app_content_private TO authenticated;
ALTER TABLE public.workspace_saved DROP CONSTRAINT IF EXISTS workspace_saved_kind_check;
ALTER TABLE public.workspace_saved ADD CONSTRAINT workspace_saved_kind_check CHECK(kind IN ('event','document','filing','us_analysis','dart_analysis'));
ALTER TABLE public.workspace_history DROP CONSTRAINT IF EXISTS workspace_history_kind_check;
ALTER TABLE public.workspace_history ADD CONSTRAINT workspace_history_kind_check CHECK(kind IN ('company','event','document','filing','us_analysis','dart_analysis'));

CREATE FUNCTION app_private.sb_approved_filing_analyses()
RETURNS TABLE(filing_id uuid,kind text,company_id text,title text,source_url text,published_at timestamptz,category text,result jsonb,created_at timestamptz,reviewed_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH candidates AS (
  SELECT a.filing_id,'us_analysis'::text kind,f.company_id::text,c.name||' · '||f.form title,f.document_url source_url,
   f.filing_date::timestamp AT TIME ZONE 'UTC' published_at,f.form category,a.result,a.created_at,
   (SELECT max(l.created_at) FROM public.audit_logs l WHERE l.action='us_analysis_review' AND l.target_id=a.filing_id::text AND l.details->>'status'='approved' AND l.created_at>=a.created_at) reviewed_at
  FROM public.us_analyses a JOIN public.us_filings f ON f.id=a.filing_id JOIN public.companies c ON c.id=f.company_id
  WHERE a.status='approved' AND c.provider='sec' AND NOT c.is_demo
   AND f.document_url ~ '^https://www[.]sec[.]gov/Archives/edgar/data/'
  UNION ALL
  SELECT a.filing_id,'dart_analysis',f.company_id::text,trim(f.title),f.source_url,
   f.filing_date::timestamp AT TIME ZONE 'UTC','DART',a.result,a.created_at,
   (SELECT max(l.created_at) FROM app_private.dart_reviews l WHERE l.filing_id=a.filing_id AND l.decision='approved' AND l.created_at>=a.created_at)
  FROM public.dart_analyses a JOIN public.dart_filings f ON f.id=a.filing_id JOIN public.companies c ON c.id=f.company_id
  WHERE a.status='approved' AND c.provider='dart' AND NOT c.is_demo
   AND f.receipt ~ '^[0-9]{14}$' AND f.publication_precision='date'
   AND f.source_url='https://dart.fss.or.kr/dsaf001/main.do?rcpNo='||f.receipt
 )
 SELECT x.* FROM candidates x
 WHERE (SELECT auth.uid()) IS NOT NULL
  AND x.result->>'validation'='quote_substring_and_numeric_check'
  AND x.result->>'source_url'=x.source_url
  AND jsonb_array_length(CASE WHEN jsonb_typeof(x.result->'claims')='array' THEN x.result->'claims' ELSE '[]'::jsonb END)>0
  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(x.result->'claims')='array' THEN x.result->'claims' ELSE '[]'::jsonb END) claim
   WHERE jsonb_typeof(claim->'text') IS DISTINCT FROM 'string' OR jsonb_typeof(claim->'quote') IS DISTINCT FROM 'string'
    OR length(trim(claim->>'text'))=0 OR length(trim(claim->>'quote'))=0
    OR position(claim->>'quote' IN coalesce(x.result->>'normalized_excerpt',''))=0)
$$;
REVOKE ALL ON FUNCTION app_private.sb_approved_filing_analyses() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION app_private.sb_customer_resources() RETURNS TABLE(
 id text,kind text,title text,summary text,company_id text,company_name text,ticker text,market text,
 source_url text,published_at timestamptz,publication_precision text,category text,is_saved boolean,
 provider text,reviewed_at timestamptz,coverage text,filing_id text
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT r.*,c.provider::text,CASE WHEN r.kind='event' THEN e.published_to_users_at ELSE NULL END,
  CASE WHEN r.kind='event' THEN 'event' ELSE NULL END,NULL::text
 FROM app_private.sb_workspace_resources() r JOIN public.companies c ON c.id=r.company_id
 LEFT JOIN public.events e ON r.kind='event' AND e.id=r.id
 WHERE (SELECT auth.uid()) IS NOT NULL
 UNION ALL
 SELECT a.filing_id::text,a.kind,a.title,
  (SELECT string_agg(claim->>'text',E'\n' ORDER BY ordinal) FROM jsonb_array_elements(a.result->'claims') WITH ORDINALITY AS cl(claim,ordinal)),
  c.id::text,c.name::text,c.ticker::text,c.market::text,a.source_url,a.published_at,'date',a.category,
  EXISTS(SELECT 1 FROM public.workspace_saved s WHERE s.user_id=(SELECT auth.uid())::text AND s.kind=a.kind AND s.resource_id=a.filing_id::text),
  c.provider::text,a.reviewed_at,'excerpt',a.filing_id::text
 FROM app_private.sb_approved_filing_analyses() a JOIN public.companies c ON c.id=a.company_id
$$;
REVOKE ALL ON FUNCTION app_private.sb_customer_resources() FROM PUBLIC,anon,authenticated;

-- App-only notifications: intentionally no relation to the email outbox.
CREATE TABLE public.content_notifications(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id varchar(36) NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('us_analysis','dart_analysis')),resource_id uuid NOT NULL,
 company_id varchar(36) NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(),read_at timestamptz,
 UNIQUE(user_id,kind,resource_id)
);
CREATE INDEX content_notifications_user_recent ON public.content_notifications(user_id,created_at DESC,id);
ALTER TABLE public.content_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.content_notifications FROM PUBLIC,anon,authenticated;
-- All reads use the authenticated API below, which also rechecks publication.
GRANT ALL ON public.content_notifications TO service_role;

-- Both kinds of app alerts share quiet hours and one local-calendar-day cap.
-- The callers hold the same user row lock so concurrent approvals cannot exceed it.
CREATE FUNCTION app_private.sb_app_notification_allowed(u text,company text,at_time timestamptz DEFAULT now()) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE v jsonb;tz text;t time;a time;b time;day_start timestamptz;day_end timestamptz;cap integer;
BEGIN
 SELECT coalesce(value,'{}'::jsonb) INTO v FROM public.workspace_preferences WHERE user_id=u;
 v:=coalesce(v,'{}'::jsonb);tz:=coalesce(v->>'timezone','Asia/Seoul');
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=tz) THEN RETURN false;END IF;
 IF coalesce(v->'muted_companies','[]'::jsonb) ? company THEN RETURN false;END IF;
 IF coalesce(v->>'quiet_enabled','false') NOT IN ('true','false') OR coalesce(v->>'daily_cap','3') !~ '^[0-9]{1,3}$' THEN RETURN false;END IF;
 cap:=coalesce((v->>'daily_cap')::integer,3);IF cap NOT BETWEEN 1 AND 100 THEN RETURN false;END IF;
 IF coalesce((v->>'quiet_enabled')::boolean,false) THEN
  IF coalesce(v->>'quiet_start','22:00') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' OR coalesce(v->>'quiet_end','07:00') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN RETURN false;END IF;
  t:=(at_time AT TIME ZONE tz)::time;a:=coalesce((v->>'quiet_start')::time,'22:00');b:=coalesce((v->>'quiet_end')::time,'07:00');
  IF a=b OR (a<b AND t>=a AND t<b) OR (a>b AND (t>=a OR t<b)) THEN RETURN false;END IF;
 END IF;
 day_start:=(at_time AT TIME ZONE tz)::date::timestamp AT TIME ZONE tz;
 day_end:=((at_time AT TIME ZONE tz)::date+1)::timestamp AT TIME ZONE tz;
 RETURN (SELECT count(*) FROM public.content_notifications n WHERE n.user_id=u AND n.created_at>=day_start AND n.created_at<day_end)
  +(SELECT count(*) FROM public.notifications n WHERE n.user_id=u AND n.created_at>=day_start AND n.created_at<day_end)<cap;
END $$;
REVOKE ALL ON FUNCTION app_private.sb_app_notification_allowed(text,text,timestamptz) FROM PUBLIC,anon,authenticated;
CREATE INDEX notifications_user_recent ON public.notifications(user_id,created_at DESC);
-- The existing event score/channel trigger remains unchanged.
CREATE OR REPLACE FUNCTION app_private.sb_workspace_notification_gate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE company text;
BEGIN
 PERFORM 1 FROM public.users WHERE id=NEW.user_id FOR UPDATE;
 SELECT company_id INTO company FROM public.events WHERE id=NEW.event_id;
 IF NOT app_private.sb_app_notification_allowed(NEW.user_id,company) THEN RETURN NULL;END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_private.sb_workspace_notification_gate() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION app_private.sb_content_notification_enqueue() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE company text;resource_kind text;recipient text;
BEGIN
 IF NEW.status<>'approved' OR TG_OP='UPDATE' AND OLD.status='approved' THEN RETURN NEW;END IF;
 IF NEW.result->>'validation' IS DISTINCT FROM 'quote_substring_and_numeric_check'
  OR jsonb_array_length(CASE WHEN jsonb_typeof(NEW.result->'claims')='array' THEN NEW.result->'claims' ELSE '[]'::jsonb END)=0
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(NEW.result->'claims')='array' THEN NEW.result->'claims' ELSE '[]'::jsonb END) claim
   WHERE jsonb_typeof(claim->'text') IS DISTINCT FROM 'string' OR jsonb_typeof(claim->'quote') IS DISTINCT FROM 'string'
    OR length(trim(claim->>'text'))=0 OR length(trim(claim->>'quote'))=0
    OR position(claim->>'quote' IN coalesce(NEW.result->>'normalized_excerpt',''))=0) THEN RETURN NEW;END IF;
 resource_kind:=CASE TG_TABLE_NAME WHEN 'us_analyses' THEN 'us_analysis' ELSE 'dart_analysis' END;
 IF TG_TABLE_NAME='us_analyses' THEN SELECT f.company_id INTO company FROM public.us_filings f JOIN public.companies c ON c.id=f.company_id
  WHERE f.id=NEW.filing_id AND NEW.result->>'source_url'=f.document_url AND f.document_url ~ '^https://www[.]sec[.]gov/Archives/edgar/data/' AND c.provider='sec' AND NOT c.is_demo;
 ELSE SELECT f.company_id INTO company FROM public.dart_filings f JOIN public.companies c ON c.id=f.company_id
  WHERE f.id=NEW.filing_id AND NEW.result->>'source_url'=f.source_url AND f.receipt ~ '^[0-9]{14}$' AND f.publication_precision='date'
   AND f.source_url='https://dart.fss.or.kr/dsaf001/main.do?rcpNo='||f.receipt AND c.provider='dart' AND NOT c.is_demo;END IF;
 IF company IS NULL THEN RETURN NEW;END IF;
 FOR recipient IN SELECT DISTINCT w.user_id FROM public.watchlists w JOIN public.watchlist_items i ON i.watchlist_id=w.id
  JOIN public.user_preferences p ON p.user_id=w.user_id WHERE i.company_id=company AND p.realtime_enabled ORDER BY w.user_id LOOP
  PERFORM 1 FROM public.users WHERE id=recipient FOR UPDATE;
  IF app_private.sb_app_notification_allowed(recipient,company) THEN
   INSERT INTO public.content_notifications(user_id,kind,resource_id,company_id) VALUES(recipient,resource_kind,NEW.filing_id,company)
   ON CONFLICT(user_id,kind,resource_id) DO NOTHING;
  END IF;
 END LOOP;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_private.sb_content_notification_enqueue() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER us_content_notification AFTER INSERT OR UPDATE OF status ON public.us_analyses FOR EACH ROW EXECUTE FUNCTION app_private.sb_content_notification_enqueue();
CREATE TRIGGER dart_content_notification AFTER INSERT OR UPDATE OF status ON public.dart_analyses FOR EACH ROW EXECUTE FUNCTION app_private.sb_content_notification_enqueue();

CREATE FUNCTION app_private.sb_customer_notifications() RETURNS TABLE(id text,created_at timestamptz,read_at timestamptz,resource jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT n.id::text,n.created_at,n.read_at,to_jsonb(r) FROM public.notifications n
 JOIN app_private.sb_customer_resources() r ON r.kind='event' AND r.id=n.event_id
 WHERE n.user_id=(SELECT auth.uid())::text
 UNION ALL
 SELECT n.id::text,n.created_at,n.read_at,to_jsonb(r) FROM public.content_notifications n
 JOIN app_private.sb_customer_resources() r ON r.kind=n.kind AND r.id=n.resource_id::text
 WHERE n.user_id=(SELECT auth.uid())::text
$$;
REVOKE ALL ON FUNCTION app_private.sb_customer_notifications() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION app_content_private.workspace(action text,p jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u text:=(SELECT auth.uid())::text;r jsonb;requested_scope text;effective_scope text;followed integer;days integer;since_date timestamptz;
 q text;kind_filter text;market_filter text;company_filter text;source_filter text;category_filter text;off integer;sz integer;selected_id text;current_day date;
BEGIN
 IF u IS NULL OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=u::uuid) THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='PT401';END IF;
 PERFORM public.sb_require_mfa();
 IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=u) THEN PERFORM public.sb_initialize_profile();END IF;
 IF p IS NULL OR jsonb_typeof(p)<>'object' OR octet_length(p::text)>32768 THEN RAISE EXCEPTION 'invalid_body' USING ERRCODE='PT422';END IF;
 PERFORM public.sb_rate_limit();
 current_day:=(now() AT TIME ZONE coalesce((SELECT value->>'timezone' FROM public.workspace_preferences WHERE user_id=u),'Asia/Seoul'))::date;
 CASE action
 WHEN 'source_overview' THEN
  IF p-'scope'-'company_id'-'days'<>'{}' THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='PT422';END IF;
  requested_scope:=coalesce(p->>'scope','following');company_filter:=coalesce(p->>'company_id','');days:=coalesce((p->>'days')::integer,0);
  IF requested_scope NOT IN ('all','following') OR days NOT BETWEEN 0 AND 3650 OR (company_filter<>'' AND company_filter !~ '^[0-9a-fA-F-]{36}$') THEN RAISE EXCEPTION 'invalid_filter' USING ERRCODE='PT422';END IF;
  SELECT count(DISTINCT i.company_id) INTO followed FROM public.watchlist_items i JOIN public.watchlists w ON w.id=i.watchlist_id JOIN public.companies c ON c.id=i.company_id WHERE w.user_id=u AND c.provider IN ('sec','dart') AND NOT c.is_demo;
  effective_scope:=CASE WHEN company_filter<>'' OR followed=0 THEN 'all' ELSE requested_scope END;
  since_date:=CASE WHEN days=0 THEN '-infinity'::timestamptz ELSE now()-make_interval(days=>days) END;
  WITH scope AS MATERIALIZED (
   SELECT c.id FROM public.companies c WHERE c.provider IN ('sec','dart') AND NOT c.is_demo
    AND (company_filter='' OR c.id=company_filter)
    AND (effective_scope='all' OR EXISTS(SELECT 1 FROM public.watchlist_items i JOIN public.watchlists w ON w.id=i.watchlist_id WHERE w.user_id=u AND i.company_id=c.id))
  ),resources AS MATERIALIZED (SELECT r.* FROM app_private.sb_customer_resources() r JOIN scope s ON s.id=r.company_id),
  dates AS MATERIALIZED (
   SELECT c.id,c.company_id,c.title,c.occurs_on,c.source_url,c.source_timezone,c.verified_at FROM public.calendar_items c JOIN scope s ON s.id=c.company_id
   WHERE c.origin='official' AND c.calendar_status='confirmed' AND c.verified_at IS NOT NULL AND c.source_url IS NOT NULL
    AND (c.user_id IS NULL OR c.user_id=u) AND app_private.sb_calendar_confirmed(c.id)
  ) SELECT jsonb_build_object(
   'scope',effective_scope,'following_count',followed,'fallback_to_all',requested_scope='following' AND followed=0 AND company_filter='',
   'companies',(SELECT count(*) FROM scope),'filing_count',(SELECT count(*) FROM resources WHERE kind='filing'),
   'published_count',(SELECT count(*) FROM resources WHERE kind IN ('event','us_analysis','dart_analysis')),
   'saved_count',(SELECT count(*) FROM public.workspace_saved s JOIN app_private.sb_customer_resources() r ON r.id=s.resource_id AND r.kind=s.kind WHERE s.user_id=u),
   'unread_count',(SELECT count(*) FROM app_private.sb_customer_notifications() n WHERE n.read_at IS NULL),
   'filings',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM resources WHERE kind='filing' AND published_at>=since_date ORDER BY published_at DESC NULLS LAST,id LIMIT 20)x),'[]'),
   'analyses',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM resources WHERE kind IN ('us_analysis','dart_analysis') AND published_at>=since_date ORDER BY reviewed_at DESC NULLS LAST,published_at DESC,id,kind LIMIT 20)x),'[]'),
   'historical_events',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM resources WHERE kind='event' AND published_at>=since_date ORDER BY reviewed_at DESC NULLS LAST,published_at DESC,id LIMIT 8)x),'[]'),
   'calendar',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM dates WHERE occurs_on>=current_day ORDER BY occurs_on,id LIMIT 20)x),'[]'),
   'historical_calendar',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM dates WHERE occurs_on<current_day ORDER BY occurs_on DESC,id LIMIT 20)x),'[]'),
   'monitoring',coalesce((SELECT jsonb_agg(jsonb_build_object('company_id',c.id,'last_collected_at',c.last_ingested_at,
    'filing_count',(SELECT count(*) FROM resources r WHERE r.company_id=c.id AND kind='filing'),
    'analysis_count',(SELECT count(*) FROM resources r WHERE r.company_id=c.id AND kind IN ('event','us_analysis','dart_analysis')),
    'latest_filing',(SELECT to_jsonb(x) FROM resources x WHERE x.company_id=c.id AND x.kind='filing' ORDER BY published_at DESC NULLS LAST,id LIMIT 1),
    'latest_analysis',(SELECT to_jsonb(x) FROM resources x WHERE x.company_id=c.id AND x.kind IN ('event','us_analysis','dart_analysis') ORDER BY reviewed_at DESC NULLS LAST,published_at DESC,id,kind LIMIT 1),
    'next_event',(SELECT to_jsonb(x) FROM dates x WHERE x.company_id=c.id AND x.occurs_on>=current_day ORDER BY occurs_on,id LIMIT 1)) ORDER BY c.name,c.id)
    FROM public.companies c JOIN scope s ON s.id=c.id),'[]')
  ) INTO r;RETURN r;
 WHEN 'catalog' THEN
  IF p-'q'-'market'-'kind'-'days'-'offset'-'limit'-'sort'-'source'-'company_id'-'category'<>'{}' THEN RAISE EXCEPTION 'unsupported_filter' USING ERRCODE='PT422';END IF;
  q:=trim(coalesce(p->>'q',''));market_filter:=coalesce(p->>'market','');kind_filter:=coalesce(p->>'kind','');company_filter:=coalesce(p->>'company_id','');source_filter:=coalesce(p->>'source','');category_filter:=coalesce(p->>'category','');
  off:=coalesce((p->>'offset')::integer,0);sz:=coalesce((p->>'limit')::integer,20);days:=coalesce((p->>'days')::integer,0);
  IF length(q)>100 OR length(market_filter)>32 OR length(category_filter)>100 OR off NOT BETWEEN 0 AND 1000 OR sz NOT BETWEEN 1 AND 50 OR days NOT BETWEEN 0 AND 3650
   OR kind_filter NOT IN ('','company','event','document','filing','analysis','us_analysis','dart_analysis') OR source_filter NOT IN ('','sec','dart') OR coalesce(p->>'sort','relevance') NOT IN ('relevance','newest')
   OR company_filter<>'' AND company_filter !~ '^[0-9a-fA-F-]{36}$' THEN RAISE EXCEPTION 'invalid_filter' USING ERRCODE='PT422';END IF;
  since_date:=CASE WHEN days=0 THEN '-infinity'::timestamptz ELSE now()-make_interval(days=>days) END;
  WITH all_matches AS MATERIALIZED (
   SELECT x.*,CASE WHEN lower(x.ticker)=lower(q) THEN 0 WHEN lower(x.company_name)=lower(q) THEN 1 ELSE 2 END priority FROM app_private.sb_customer_resources() x
   WHERE (q='' OR EXISTS(SELECT 1 FROM unnest(app_private.sb_search_terms(q)) term WHERE position(term IN lower(x.title||' '||x.summary||' '||x.ticker||' '||x.company_name||' '||x.category))>0
     OR x.kind='document' AND EXISTS(SELECT 1 FROM public.document_chunks dc WHERE dc.document_id=x.id AND app_private.sb_document_visible(dc.document_id) AND to_tsvector('simple',dc.text) @@ plainto_tsquery('simple',term))))
    AND (market_filter='' OR x.market=market_filter) AND (company_filter='' OR x.company_id=company_filter) AND (source_filter='' OR x.provider=source_filter)
    AND (category_filter='' OR x.category=category_filter) AND (x.kind='company' OR x.published_at>=since_date)
  ),selected AS (SELECT * FROM all_matches WHERE kind_filter='' OR kind=kind_filter OR kind_filter='document' AND kind='filing' OR kind_filter='analysis' AND kind IN ('event','us_analysis','dart_analysis')),
  paged AS (SELECT * FROM selected ORDER BY CASE WHEN p->>'sort'='newest' THEN 0 ELSE priority END,CASE WHEN kind='company' THEN 0 ELSE 1 END,published_at DESC NULLS LAST,id,kind LIMIT sz OFFSET off)
  SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(to_jsonb(x)-'priority') FROM paged x),'[]'),
   'total',(SELECT count(*) FROM selected),'counts',coalesce((SELECT jsonb_object_agg(x.kind,x.n) FROM (SELECT kind,count(*) n FROM all_matches GROUP BY kind)x),'{}'),
   'markets',coalesce((SELECT jsonb_agg(DISTINCT market) FROM public.companies WHERE provider IN ('sec','dart') AND NOT is_demo),'[]'),
   'categories',coalesce((SELECT jsonb_agg(DISTINCT category) FROM app_private.sb_customer_resources() WHERE kind IN ('filing','document')),'[]'),
   'next_offset',CASE WHEN off+sz<(SELECT count(*) FROM selected) AND off+sz<=1000 THEN off+sz ELSE NULL END) INTO r;RETURN r;
 WHEN 'resource' THEN
  IF p-'id'-'kind'<>'{}' THEN RAISE EXCEPTION 'invalid_resource' USING ERRCODE='PT422';END IF;
  SELECT to_jsonb(x) INTO r FROM app_private.sb_customer_resources() x WHERE x.id=p->>'id' AND x.kind=p->>'kind';
  IF r IS NULL THEN RAISE EXCEPTION 'resource_not_available' USING ERRCODE='PT404';END IF;RETURN r;
 WHEN 'company' THEN
  IF p-'id'<>'{}' THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='PT422';END IF;selected_id:=p->>'id';
  r:=public.sb_workspace('company',p);
  RETURN r||jsonb_build_object('analyses',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM app_private.sb_customer_resources() WHERE company_id=selected_id AND kind IN ('us_analysis','dart_analysis') ORDER BY reviewed_at DESC NULLS LAST,published_at DESC,id,kind LIMIT 50)x),'[]'));
 WHEN 'document_detail' THEN
  r:=public.sb_document_detail(p);
  RETURN r||jsonb_build_object('approved_analyses',coalesce((SELECT jsonb_agg(jsonb_build_object('resource',to_jsonb(c),'analysis',jsonb_build_object(
   'filing_id',a.filing_id,'status','approved','created_at',a.created_at,'reviewed_at',a.reviewed_at,
   'result',jsonb_build_object('claims',(SELECT jsonb_agg(jsonb_build_object('text',claim->>'text','quote',claim->>'quote')) FROM jsonb_array_elements(a.result->'claims')claim),
    'source_url',a.source_url,'uncertainty',coalesce(a.result->>'uncertainty',''),'validation',a.result->>'validation','coverage','excerpt'))))
   FROM app_private.sb_approved_filing_analyses() a JOIN app_private.sb_customer_resources() c ON c.kind=a.kind AND c.id=a.filing_id::text WHERE p->>'kind'='filing' AND a.filing_id::text=p->>'id'),'[]'));
 WHEN 'saved_list' THEN
  kind_filter:=coalesce(p->>'kind','');q:=lower(trim(coalesce(p->>'q','')));
  IF p-'kind'-'q'-'company'-'sort'<>'{}' OR length(q)>100 OR kind_filter NOT IN ('','event','document','analysis','history') OR coalesce(p->>'sort','newest') NOT IN ('oldest','newest') THEN RAISE EXCEPTION 'invalid_filter' USING ERRCODE='PT422';END IF;
  WITH entries AS (
   SELECT s.kind,s.resource_id,s.created_at saved_at FROM public.workspace_saved s WHERE s.user_id=u AND kind_filter<>'history'
   UNION ALL SELECT h.kind,h.resource_id,h.viewed_at FROM public.workspace_history h WHERE h.user_id=u AND kind_filter='history'
  ),joined AS (SELECT r.*,e.saved_at FROM entries e JOIN app_private.sb_customer_resources() r ON r.id=e.resource_id AND r.kind=e.kind
   WHERE (kind_filter IN ('','history') OR kind_filter='event' AND r.kind='event' OR kind_filter='analysis' AND r.kind IN ('us_analysis','dart_analysis') OR kind_filter='document' AND r.kind IN ('document','filing'))
    AND (q='' OR position(q IN lower(r.title||' '||r.company_name||' '||r.ticker))>0) AND (coalesce(p->>'company','')='' OR r.company_id=p->>'company'))
  SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM joined ORDER BY CASE WHEN p->>'sort'='oldest' THEN saved_at END ASC,saved_at DESC,id,kind LIMIT 500)x),'[]'),
   'counts',jsonb_build_object('event',(SELECT count(*) FROM public.workspace_saved s JOIN app_private.sb_customer_resources() r ON r.kind=s.kind AND r.id=s.resource_id WHERE s.user_id=u AND s.kind='event'),
    'document',(SELECT count(*) FROM public.workspace_saved s JOIN app_private.sb_customer_resources() r ON r.kind=s.kind AND r.id=s.resource_id WHERE s.user_id=u AND s.kind IN ('document','filing')),
    'analysis',(SELECT count(*) FROM public.workspace_saved s JOIN app_private.sb_customer_resources() r ON r.kind=s.kind AND r.id=s.resource_id WHERE s.user_id=u AND s.kind IN ('us_analysis','dart_analysis')),
    'history',(SELECT count(*) FROM public.workspace_history s JOIN app_private.sb_customer_resources() r ON r.kind=s.kind AND r.id=s.resource_id WHERE s.user_id=u))) INTO r;RETURN r;
 WHEN 'save' THEN
  IF p-'kind'-'id'-'saved'<>'{}' OR jsonb_typeof(p->'saved') IS DISTINCT FROM 'boolean' OR coalesce(p->>'kind','') NOT IN ('event','document','filing','us_analysis','dart_analysis') THEN RAISE EXCEPTION 'invalid_save' USING ERRCODE='PT422';END IF;
  PERFORM 1 FROM public.users WHERE id=u FOR UPDATE;
  IF (p->>'saved')::boolean THEN
   IF NOT EXISTS(SELECT 1 FROM app_private.sb_customer_resources() WHERE kind=p->>'kind' AND id=p->>'id') THEN RAISE EXCEPTION 'resource_not_available' USING ERRCODE='PT404';END IF;
   IF (SELECT count(*) FROM public.workspace_saved WHERE user_id=u)>=500 AND NOT EXISTS(SELECT 1 FROM public.workspace_saved WHERE user_id=u AND kind=p->>'kind' AND resource_id=p->>'id') THEN RAISE EXCEPTION 'saved_limit_500' USING ERRCODE='PT422';END IF;
   INSERT INTO public.workspace_saved(user_id,kind,resource_id) VALUES(u,p->>'kind',p->>'id') ON CONFLICT DO NOTHING;
  ELSE DELETE FROM public.workspace_saved WHERE user_id=u AND kind=p->>'kind' AND resource_id=p->>'id';END IF;RETURN jsonb_build_object('saved',(p->>'saved')::boolean);
 WHEN 'visit' THEN
  IF p-'kind'-'id'<>'{}' OR coalesce(p->>'kind','') NOT IN ('company','event','document','filing','us_analysis','dart_analysis') THEN RAISE EXCEPTION 'invalid_visit' USING ERRCODE='PT422';END IF;
  IF coalesce((SELECT (value->>'history_enabled')::boolean FROM public.workspace_preferences WHERE user_id=u),false) AND EXISTS(SELECT 1 FROM app_private.sb_customer_resources() WHERE kind=p->>'kind' AND id=p->>'id') THEN
   INSERT INTO public.workspace_history(user_id,kind,resource_id) VALUES(u,p->>'kind',p->>'id') ON CONFLICT(user_id,kind,resource_id) DO UPDATE SET viewed_at=now();
   DELETE FROM public.workspace_history h WHERE h.user_id=u AND (h.kind,h.resource_id) NOT IN (SELECT x.kind,x.resource_id FROM public.workspace_history x WHERE x.user_id=u ORDER BY x.viewed_at DESC,x.resource_id LIMIT 100);
   RETURN jsonb_build_object('recorded',true);
  END IF;RETURN jsonb_build_object('recorded',false);
 WHEN 'content_notifications' THEN
  IF p<>'{}' THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='PT422';END IF;
  RETURN jsonb_build_object('items',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM app_private.sb_customer_notifications() ORDER BY created_at DESC,id LIMIT 100)x),'[]'),'unread_count',(SELECT count(*) FROM app_private.sb_customer_notifications() WHERE read_at IS NULL));
 WHEN 'content_notification_read' THEN
  IF p-'id'-'all'<>'{}' OR (p ? 'all' AND jsonb_typeof(p->'all') IS DISTINCT FROM 'boolean') OR (coalesce((p->>'all')::boolean,false)=(p ? 'id')) THEN RAISE EXCEPTION 'invalid_notification' USING ERRCODE='PT422';END IF;
  UPDATE public.notifications SET read_at=coalesce(read_at,now()) WHERE user_id=u AND (coalesce((p->>'all')::boolean,false) OR id=p->>'id');
  UPDATE public.content_notifications SET read_at=coalesce(read_at,now()) WHERE user_id=u AND (coalesce((p->>'all')::boolean,false) OR id::text=p->>'id');
  RETURN jsonb_build_object('updated',true);
 ELSE RAISE EXCEPTION 'unsupported_action' USING ERRCODE='PT404';
 END CASE;
END $$;
REVOKE ALL ON FUNCTION app_content_private.workspace(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app_content_private.workspace(text,jsonb) TO authenticated;
CREATE FUNCTION public.sb_customer_workspace(action text,p jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT app_content_private.workspace(action,p) $$;
REVOKE ALL ON FUNCTION public.sb_customer_workspace(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sb_customer_workspace(text,jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
