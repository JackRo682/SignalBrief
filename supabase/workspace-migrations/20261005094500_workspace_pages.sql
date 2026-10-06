-- Additive workspace release. No market fixtures, Auth secrets, or destructive changes.
-- Requires the existing hosted, reference and US migrations. Applied via Management API.
CREATE TABLE public.workspace_preferences (
 user_id varchar(36) PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
 value jsonb NOT NULL DEFAULT '{"timezone":"Asia/Seoul","locale":"ko","theme":"light","ui_density":"comfortable","font_scale":1,"reduced_motion":false,"chart_animation":true,"history_enabled":false,"quiet_enabled":false,"quiet_start":"22:00","quiet_end":"07:00","daily_cap":3,"muted_companies":[],"bio":""}',
 version integer NOT NULL DEFAULT 1 CHECK(version>0), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.workspace_saved (
 user_id varchar(36) NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('event','document','filing')), resource_id text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,kind,resource_id)
);
CREATE TABLE public.workspace_history (
 user_id varchar(36) NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('company','event','document','filing')), resource_id text NOT NULL,
 viewed_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,kind,resource_id)
);
CREATE TABLE public.workspace_searches (
 user_id varchar(36) NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 query text NOT NULL CHECK(length(query) BETWEEN 1 AND 100), searched_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,query)
);
CREATE TABLE public.workspace_tickets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id varchar(36) NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 request_key uuid NOT NULL, category text NOT NULL CHECK(category IN ('general','data','bug','feedback','privacy')),
 title text NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 120), message text NOT NULL CHECK(length(trim(message)) BETWEEN 1 AND 2000),
 state text NOT NULL DEFAULT 'open' CHECK(state IN ('open','in_progress','resolved')),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,request_key)
);
CREATE TABLE public.workspace_attachments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), ticket_id uuid NOT NULL REFERENCES public.workspace_tickets(id) ON DELETE CASCADE,
 user_id varchar(36) NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 object_path text NOT NULL UNIQUE, filename text NOT NULL, mime_type text NOT NULL CHECK(mime_type IN ('image/png','image/jpeg','image/webp','application/pdf')),
 size_bytes integer NOT NULL CHECK(size_bytes BETWEEN 1 AND 5242880), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX workspace_saved_recent ON public.workspace_saved(user_id,created_at DESC);
CREATE INDEX workspace_history_recent ON public.workspace_history(user_id,viewed_at DESC);
CREATE INDEX workspace_tickets_recent ON public.workspace_tickets(user_id,created_at DESC);
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['workspace_preferences','workspace_saved','workspace_history','workspace_searches','workspace_tickets','workspace_attachments'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
 EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
 EXECUTE format('CREATE POLICY workspace_owner ON public.%I FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid())::text)',t);
 END LOOP;END $$;
CREATE POLICY workspace_support_operator ON public.workspace_tickets FOR SELECT TO authenticated USING((SELECT app_private.sb_is_admin()));
CREATE POLICY workspace_attachment_operator ON public.workspace_attachments FOR SELECT TO authenticated USING((SELECT app_private.sb_is_admin()));

-- Private uploads: writes are scoped to the uploader AND an owned ticket ID.
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 VALUES('signalbrief-support','signalbrief-support',false,5242880,ARRAY['image/png','image/jpeg','image/webp','application/pdf']) ON CONFLICT(id) DO NOTHING;
CREATE POLICY workspace_support_upload ON storage.objects FOR INSERT TO authenticated WITH CHECK(
 bucket_id='signalbrief-support' AND split_part(name,'/',1)=(SELECT auth.uid())::text
 AND EXISTS(SELECT 1 FROM public.workspace_tickets t WHERE t.id::text=split_part(name,'/',2) AND t.user_id=(SELECT auth.uid())::text)
 AND name ~ '^[a-f0-9-]{36}/[a-f0-9-]{36}/[a-f0-9-]{36}\.(png|jpg|webp|pdf)$');
CREATE POLICY workspace_support_read ON storage.objects FOR SELECT TO authenticated USING(bucket_id='signalbrief-support' AND (split_part(name,'/',1)=(SELECT auth.uid())::text OR (SELECT app_private.sb_is_admin())));
CREATE POLICY workspace_support_delete ON storage.objects FOR DELETE TO authenticated USING(bucket_id='signalbrief-support' AND split_part(name,'/',1)=(SELECT auth.uid())::text);

-- A fixed SQL projection. Visibility predicates intentionally match existing RLS:
-- pending/rejected financial analyses never become visible through search/saves.
CREATE FUNCTION app_private.sb_workspace_resources() RETURNS TABLE(
 id text,kind text,title text,summary text,company_id text,company_name text,ticker text,market text,
 source_url text,published_at timestamptz,publication_precision text,category text,is_saved boolean
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT x.*,EXISTS(SELECT 1 FROM public.workspace_saved s WHERE s.user_id=(SELECT auth.uid())::text AND s.kind=x.kind AND s.resource_id=x.id) FROM (
 SELECT c.id::text,'company',c.name::text,''::text,c.id::text,c.name::text,c.ticker::text,c.market::text,
 NULL::text,c.last_ingested_at,'timestamp','company' FROM public.companies c WHERE c.provider='sec' AND NOT c.is_demo
 UNION ALL
 SELECT e.id::text,'event',b.headline::text,b.what_happened,c.id::text,c.name::text,c.ticker::text,c.market::text,
 d.source_url,e.published_at,d.publication_precision::text,e.event_type::text
 FROM public.events e JOIN public.companies c ON c.id=e.company_id JOIN public.documents d ON d.id=e.document_id JOIN public.briefs b ON b.event_id=e.id
 WHERE c.provider='sec' AND NOT c.is_demo AND app_private.sb_event_visible(e.id)
 UNION ALL
 SELECT d.id::text,'document',d.title::text,''::text,c.id::text,c.name::text,c.ticker::text,c.market::text,
 d.source_url,coalesce(d.published_at,d.publication_date::timestamp AT TIME ZONE 'UTC'),d.publication_precision::text,d.form_type::text
 FROM public.documents d JOIN public.companies c ON c.id=d.company_id
 WHERE c.provider='sec' AND NOT c.is_demo AND NOT d.is_demo AND app_private.sb_document_visible(d.id)
 UNION ALL
 SELECT f.id::text,'filing',c.name||' · '||f.form,'SEC accession: '||f.accession,c.id::text,c.name::text,c.ticker::text,c.market::text,
 f.document_url,f.filing_date::timestamp AT TIME ZONE 'UTC','date',f.form
 FROM public.us_filings f JOIN public.companies c ON c.id=f.company_id WHERE c.provider='sec' AND NOT c.is_demo
 ) AS x(id,kind,title,summary,company_id,company_name,ticker,market,source_url,published_at,publication_precision,category)
$$;
REVOKE ALL ON FUNCTION app_private.sb_workspace_resources() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.sb_workspace(action text,p jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u text:=(SELECT auth.uid())::text; r jsonb; prefs jsonb; ver integer; q text; market_filter text; kind_filter text; since_date timestamptz;
 off integer; sz integer; n integer; k text; item record; selected_id text; ticket public.workspace_tickets%rowtype;
 defaults constant jsonb:='{"timezone":"Asia/Seoul","locale":"ko","theme":"light","ui_density":"comfortable","font_scale":1,"reduced_motion":false,"chart_animation":true,"history_enabled":false,"quiet_enabled":false,"quiet_start":"22:00","quiet_end":"07:00","daily_cap":3,"muted_companies":[],"bio":""}';
BEGIN
 IF u IS NULL OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=u::uuid) THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='PT401'; END IF;
 PERFORM public.sb_require_mfa();
 IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=u) THEN PERFORM public.sb_initialize_profile();END IF;
 IF p IS NULL OR jsonb_typeof(p)<>'object' OR octet_length(p::text)>32768 THEN RAISE EXCEPTION 'invalid_body' USING ERRCODE='PT422';END IF;
 PERFORM public.sb_rate_limit();
 SELECT defaults||value,version INTO prefs,ver FROM public.workspace_preferences WHERE user_id=u;
 prefs:=coalesce(prefs,defaults);ver:=coalesce(ver,0);
 CASE action
 WHEN 'preferences' THEN RETURN jsonb_build_object('value',prefs,'version',ver);
 WHEN 'preferences_save' THEN
  IF p-'value'-'version'<>'{}' OR jsonb_typeof(p->'value') IS DISTINCT FROM 'object' OR jsonb_typeof(p->'version') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'invalid_preferences' USING ERRCODE='PT422';END IF;
  PERFORM 1 FROM public.users WHERE id=u FOR UPDATE;
  SELECT defaults||value,version INTO prefs,ver FROM public.workspace_preferences WHERE user_id=u;
  prefs:=coalesce(prefs,defaults);ver:=coalesce(ver,0);
  IF (p->>'version')::numeric<>ver THEN RAISE EXCEPTION 'version_conflict' USING ERRCODE='PT409';END IF;
  FOR k IN SELECT jsonb_object_keys(p->'value') LOOP IF NOT defaults ? k THEN RAISE EXCEPTION 'unsupported_preference' USING ERRCODE='PT422';END IF; END LOOP;
  prefs:=prefs||(p->'value');
  FOR item IN SELECT key,value FROM jsonb_each(prefs) LOOP
   IF jsonb_typeof(item.value) IS DISTINCT FROM jsonb_typeof(defaults->item.key) THEN RAISE EXCEPTION 'invalid_preference_type' USING ERRCODE='PT422';END IF;
  END LOOP;
  IF prefs->>'locale' NOT IN ('ko','en') OR prefs->>'theme' NOT IN ('light','dark','system') OR prefs->>'ui_density' NOT IN ('compact','comfortable')
   OR (prefs->>'font_scale')::numeric NOT IN (0,1,2,3) OR (prefs->>'daily_cap')::numeric NOT BETWEEN 1 AND 100 OR (prefs->>'daily_cap')::numeric<>trunc((prefs->>'daily_cap')::numeric)
   OR length(prefs->>'bio')>160 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=prefs->>'timezone')
   OR prefs->>'quiet_start' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' OR prefs->>'quiet_end' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
   OR jsonb_array_length(prefs->'muted_companies')>50 THEN RAISE EXCEPTION 'invalid_preferences' USING ERRCODE='PT422';END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(prefs->'muted_companies') x WHERE jsonb_typeof(x)<>'string' OR NOT EXISTS(SELECT 1 FROM public.companies c WHERE c.id=x#>>'{}' AND c.provider='sec' AND NOT c.is_demo)) THEN RAISE EXCEPTION 'unsupported_company' USING ERRCODE='PT422';END IF;
  INSERT INTO public.workspace_preferences(user_id,value,version) VALUES(u,prefs,ver+1) ON CONFLICT(user_id) DO UPDATE SET value=EXCLUDED.value,version=EXCLUDED.version,updated_at=now();
  IF NOT (prefs->>'history_enabled')::boolean THEN DELETE FROM public.workspace_history WHERE user_id=u;DELETE FROM public.workspace_searches WHERE user_id=u;END IF;
  RETURN jsonb_build_object('value',prefs,'version',ver+1);
 WHEN 'catalog' THEN
  IF p-'q'-'market'-'kind'-'days'-'offset'-'limit'-'sort'<>'{}' THEN RAISE EXCEPTION 'unsupported_filter' USING ERRCODE='PT422';END IF;
  q:=trim(coalesce(p->>'q',''));market_filter:=coalesce(p->>'market','');kind_filter:=coalesce(p->>'kind','');
  off:=coalesce((p->>'offset')::integer,0);sz:=coalesce((p->>'limit')::integer,20);n:=coalesce((p->>'days')::integer,0);
  IF length(q)>100 OR off NOT BETWEEN 0 AND 1000 OR sz NOT BETWEEN 1 AND 50 OR n NOT BETWEEN 0 AND 3650 OR kind_filter NOT IN ('','company','event','document','filing') OR coalesce(p->>'sort','relevance') NOT IN ('relevance','newest') THEN RAISE EXCEPTION 'invalid_filter' USING ERRCODE='PT422';END IF;
  q:=CASE lower(q) WHEN '엔비디아' THEN 'NVDA' WHEN '애플' THEN 'AAPL' WHEN '마이크로소프트' THEN 'MSFT' WHEN '테슬라' THEN 'TSLA' ELSE q END;
  since_date:=CASE WHEN n=0 THEN '-infinity'::timestamptz ELSE now()-make_interval(days=>n) END;
  WITH all_matches AS MATERIALIZED (
   SELECT x.*,CASE WHEN lower(x.ticker)=lower(q) THEN 0 WHEN lower(x.company_name)=lower(q) THEN 1 ELSE 2 END priority
   FROM app_private.sb_workspace_resources() x WHERE (q='' OR position(lower(q) IN lower(x.title||' '||x.summary||' '||x.ticker||' '||x.company_name||' '||x.category))>0)
    AND (market_filter='' OR x.market=market_filter) AND (x.kind='company' OR x.published_at>=since_date)
  ), selected AS (SELECT * FROM all_matches WHERE kind_filter='' OR kind=kind_filter OR kind_filter='document' AND kind='filing'), paged AS (
   SELECT * FROM selected ORDER BY CASE WHEN p->>'sort'='newest' THEN 0 ELSE priority END,CASE WHEN kind='company' THEN 0 ELSE 1 END,published_at DESC NULLS LAST,id,kind LIMIT sz OFFSET off)
  SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(to_jsonb(x)-'priority') FROM paged x),'[]'),
   'total',(SELECT count(*) FROM selected),'counts',coalesce((SELECT jsonb_object_agg(x.kind,x.n) FROM (SELECT kind,count(*) n FROM all_matches GROUP BY kind) x),'{}'),
   'markets',coalesce((SELECT jsonb_agg(DISTINCT market) FROM public.companies WHERE provider='sec' AND NOT is_demo),'[]'),
   'next_offset',CASE WHEN off+sz<(SELECT count(*) FROM selected) AND off+sz<=1000 THEN off+sz ELSE NULL END) INTO r;RETURN r;
 WHEN 'notifications' THEN
  RETURN jsonb_build_object('realtime_enabled',coalesce((SELECT realtime_enabled FROM public.user_preferences WHERE user_id=u),false),'notify_min_score',coalesce((SELECT notify_min_score FROM public.user_preferences WHERE user_id=u),0.75));
 WHEN 'notification_save' THEN
  IF p-'realtime_enabled'-'notify_min_score'<>'{}' OR (p ? 'realtime_enabled' AND jsonb_typeof(p->'realtime_enabled') IS DISTINCT FROM 'boolean') OR (p ? 'notify_min_score' AND (jsonb_typeof(p->'notify_min_score') IS DISTINCT FROM 'number' OR (p->>'notify_min_score')::numeric NOT BETWEEN 0 AND 1)) THEN RAISE EXCEPTION 'invalid_notification_settings' USING ERRCODE='PT422';END IF;
  PERFORM public.sb_reference_preferences(p);
  RETURN public.sb_workspace('notifications','{}');
 WHEN 'resource' THEN
  IF p-'id'-'kind'<>'{}' OR coalesce(p->>'kind','') NOT IN ('company','event','document','filing') THEN RAISE EXCEPTION 'invalid_resource' USING ERRCODE='PT422';END IF;
  SELECT to_jsonb(x) INTO r FROM app_private.sb_workspace_resources() x WHERE x.id=p->>'id' AND x.kind=p->>'kind';
  IF r IS NULL THEN RAISE EXCEPTION 'resource_not_available' USING ERRCODE='PT404';END IF;RETURN r;
 WHEN 'company' THEN
  IF p-'id'<>'{}' THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='PT422';END IF; selected_id:=p->>'id';
  SELECT to_jsonb(x) INTO r FROM app_private.sb_workspace_resources() x WHERE x.kind='company' AND x.id=selected_id;
  IF r IS NULL THEN RAISE EXCEPTION 'company_not_found' USING ERRCODE='PT404';END IF;
  RETURN jsonb_build_object('company',r,
   'events',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM app_private.sb_workspace_resources() WHERE company_id=selected_id AND kind='event' ORDER BY published_at DESC,id LIMIT 12) x),'[]'),
   'documents',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM app_private.sb_workspace_resources() WHERE company_id=selected_id AND kind IN ('document','filing') ORDER BY published_at DESC,id LIMIT 20) x),'[]'),
   'facts',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT f.id,f.field,f.value_raw,f.unit,f.period,f.basis,f.quote,f.event_id FROM public.facts f JOIN public.events e ON e.id=f.event_id WHERE e.company_id=selected_id AND f.validation_status='supported' AND app_private.sb_event_visible(e.id) ORDER BY e.published_at DESC,f.id LIMIT 12) x),'[]'),
   'watching',EXISTS(SELECT 1 FROM public.watchlist_items i JOIN public.watchlists w ON w.id=i.watchlist_id WHERE w.user_id=u AND i.company_id=selected_id),
   'holding',EXISTS(SELECT 1 FROM public.positions i JOIN public.portfolios w ON w.id=i.portfolio_id WHERE w.user_id=u AND i.company_id=selected_id));
 WHEN 'saved_list' THEN
  kind_filter:=coalesce(p->>'kind','');q:=lower(coalesce(p->>'q',''));IF p-'kind'-'q'-'company'-'sort'<>'{}' OR length(q)>100 OR kind_filter NOT IN ('','event','document','history') THEN RAISE EXCEPTION 'invalid_filter' USING ERRCODE='PT422';END IF;
  WITH entries AS (
   SELECT s.kind,s.resource_id,s.created_at saved_at FROM public.workspace_saved s WHERE s.user_id=u AND kind_filter<>'history'
   UNION ALL SELECT h.kind,h.resource_id,h.viewed_at FROM public.workspace_history h WHERE h.user_id=u AND kind_filter='history'
  ), joined AS (SELECT r.*,e.saved_at FROM entries e JOIN app_private.sb_workspace_resources() r ON r.id=e.resource_id AND r.kind=e.kind
    WHERE (kind_filter IN ('','history') OR kind_filter='event' AND r.kind='event' OR kind_filter='document' AND r.kind IN ('document','filing'))
    AND (q='' OR position(q IN lower(r.title||' '||r.company_name||' '||r.ticker))>0) AND (coalesce(p->>'company','')='' OR r.company_id=p->>'company'))
  SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM joined ORDER BY CASE WHEN p->>'sort'='oldest' THEN saved_at END ASC,saved_at DESC,id LIMIT 500)x),'[]'),
   'counts',jsonb_build_object('event',(SELECT count(*) FROM public.workspace_saved s JOIN app_private.sb_workspace_resources() r ON r.kind=s.kind AND r.id=s.resource_id WHERE s.user_id=u AND s.kind='event'),
    'document',(SELECT count(*) FROM public.workspace_saved s JOIN app_private.sb_workspace_resources() r ON r.kind=s.kind AND r.id=s.resource_id WHERE s.user_id=u AND s.kind IN ('document','filing')),
    'history',(SELECT count(*) FROM public.workspace_history s JOIN app_private.sb_workspace_resources() r ON r.kind=s.kind AND r.id=s.resource_id WHERE s.user_id=u))) INTO r;RETURN r;
 WHEN 'save' THEN
  IF p-'kind'-'id'-'saved'<>'{}' OR jsonb_typeof(p->'saved') IS DISTINCT FROM 'boolean' OR coalesce(p->>'kind','') NOT IN ('event','document','filing') THEN RAISE EXCEPTION 'invalid_save' USING ERRCODE='PT422';END IF;
  PERFORM 1 FROM public.users WHERE id=u FOR UPDATE;
  IF (p->>'saved')::boolean THEN
   IF NOT EXISTS(SELECT 1 FROM app_private.sb_workspace_resources() WHERE kind=p->>'kind' AND id=p->>'id') THEN RAISE EXCEPTION 'resource_not_available' USING ERRCODE='PT404';END IF;
   IF (SELECT count(*) FROM public.workspace_saved WHERE user_id=u)>=500 AND NOT EXISTS(SELECT 1 FROM public.workspace_saved WHERE user_id=u AND kind=p->>'kind' AND resource_id=p->>'id') THEN RAISE EXCEPTION 'saved_limit_500' USING ERRCODE='PT422';END IF;
   INSERT INTO public.workspace_saved(user_id,kind,resource_id) VALUES(u,p->>'kind',p->>'id') ON CONFLICT DO NOTHING;
  ELSE DELETE FROM public.workspace_saved WHERE user_id=u AND kind=p->>'kind' AND resource_id=p->>'id';END IF;RETURN jsonb_build_object('saved',(p->>'saved')::boolean);
 WHEN 'visit' THEN
  IF p-'kind'-'id'<>'{}' OR coalesce(p->>'kind','') NOT IN ('company','event','document','filing') THEN RAISE EXCEPTION 'invalid_visit' USING ERRCODE='PT422';END IF;
  IF (prefs->>'history_enabled')::boolean AND EXISTS(SELECT 1 FROM app_private.sb_workspace_resources() WHERE kind=p->>'kind' AND id=p->>'id') THEN
   INSERT INTO public.workspace_history(user_id,kind,resource_id) VALUES(u,p->>'kind',p->>'id') ON CONFLICT(user_id,kind,resource_id) DO UPDATE SET viewed_at=now();
   DELETE FROM public.workspace_history h WHERE h.user_id=u AND (h.kind,h.resource_id) NOT IN (SELECT x.kind,x.resource_id FROM public.workspace_history x WHERE x.user_id=u ORDER BY x.viewed_at DESC,x.resource_id LIMIT 100);
  END IF;RETURN jsonb_build_object('recorded',(prefs->>'history_enabled')::boolean);
 WHEN 'searches' THEN RETURN coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT query,searched_at FROM public.workspace_searches WHERE user_id=u ORDER BY searched_at DESC LIMIT 10)x),'[]');
 WHEN 'search_record' THEN
  q:=trim(coalesce(p->>'query',''));IF p-'query'<>'{}' OR length(q) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'invalid_query' USING ERRCODE='PT422';END IF;
  IF (prefs->>'history_enabled')::boolean THEN INSERT INTO public.workspace_searches(user_id,query) VALUES(u,q) ON CONFLICT(user_id,query) DO UPDATE SET searched_at=now();
   DELETE FROM public.workspace_searches WHERE user_id=u AND query NOT IN (SELECT query FROM public.workspace_searches WHERE user_id=u ORDER BY searched_at DESC,query LIMIT 10);END IF;
  RETURN jsonb_build_object('recorded',(prefs->>'history_enabled')::boolean);
 WHEN 'history_clear' THEN DELETE FROM public.workspace_history WHERE user_id=u;DELETE FROM public.workspace_searches WHERE user_id=u;RETURN jsonb_build_object('cleared',true);
 WHEN 'account' THEN
  RETURN jsonb_build_object('created_at',(SELECT created_at FROM public.users WHERE id=u),'bio',prefs->>'bio','tickets',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT id,title,category,state,created_at FROM public.workspace_tickets WHERE user_id=u ORDER BY created_at DESC LIMIT 50)x),'[]'));
 WHEN 'security' THEN
  RETURN jsonb_build_object('sessions',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT id::text,created_at,coalesce(refreshed_at,updated_at,created_at) AS last_seen,user_agent,aal,
    id::text=coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'session_id','') AS current
    FROM auth.sessions WHERE user_id=u::uuid AND (not_after IS NULL OR not_after>now()) ORDER BY created_at DESC LIMIT 20) x),'[]'),
   'history',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT created_at,payload->>'action' AS action FROM auth.audit_log_entries WHERE payload->>'actor_id'=u AND payload->>'action' IN ('login','logout','user_signedup','user_recovery_requested','user_updated','token_revoked','mfa_factor_verified','mfa_factor_unenrolled') ORDER BY created_at DESC LIMIT 20)x),'[]'));
 WHEN 'ticket_create' THEN
  IF p-'request_key'-'category'-'title'-'message'<>'{}' OR p->>'category' NOT IN ('general','data','bug','feedback','privacy') OR length(trim(coalesce(p->>'title',''))) NOT BETWEEN 1 AND 120 OR length(trim(coalesce(p->>'message',''))) NOT BETWEEN 1 AND 2000 OR coalesce(p->>'request_key','') !~ '^[a-f0-9-]{36}$' THEN RAISE EXCEPTION 'invalid_ticket' USING ERRCODE='PT422';END IF;
  PERFORM 1 FROM public.users WHERE id=u FOR UPDATE;
  SELECT * INTO ticket FROM public.workspace_tickets WHERE user_id=u AND request_key=(p->>'request_key')::uuid;
  IF FOUND THEN IF ticket.title<>trim(p->>'title') OR ticket.message<>trim(p->>'message') OR ticket.category<>p->>'category' THEN RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='PT409';END IF;RETURN to_jsonb(ticket)-'user_id'-'message';END IF;
  IF (SELECT count(*) FROM public.workspace_tickets WHERE user_id=u AND created_at>now()-interval '1 day')>=10 THEN RAISE EXCEPTION 'ticket_daily_limit' USING ERRCODE='PT429';END IF;
  INSERT INTO public.workspace_tickets(user_id,request_key,category,title,message) VALUES(u,(p->>'request_key')::uuid,p->>'category',trim(p->>'title'),trim(p->>'message')) RETURNING * INTO ticket;
  RETURN to_jsonb(ticket)-'user_id'-'message';
 WHEN 'ticket_attach' THEN
  IF p-'ticket_id'-'object_path'-'filename'-'mime_type'-'size_bytes'<>'{}' OR coalesce(p->>'mime_type','') NOT IN ('image/png','image/jpeg','image/webp','application/pdf') OR length(coalesce(p->>'filename','')) NOT BETWEEN 1 AND 150 OR (p->>'size_bytes')::integer NOT BETWEEN 1 AND 5242880 THEN RAISE EXCEPTION 'invalid_attachment' USING ERRCODE='PT422';END IF;
  PERFORM 1 FROM public.workspace_tickets WHERE id::text=p->>'ticket_id' AND user_id=u FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'ticket_not_found' USING ERRCODE='PT404';END IF;
  IF EXISTS(SELECT 1 FROM public.workspace_attachments WHERE object_path=p->>'object_path' AND ticket_id::text=p->>'ticket_id' AND user_id=u) THEN RETURN jsonb_build_object('attached',true);END IF;
  IF (SELECT count(*) FROM public.workspace_attachments WHERE ticket_id::text=p->>'ticket_id')>=3 THEN RAISE EXCEPTION 'attachment_limit' USING ERRCODE='PT422';END IF;
  IF split_part(p->>'object_path','/',1)<>u OR split_part(p->>'object_path','/',2)<>p->>'ticket_id' OR NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='signalbrief-support' AND name=p->>'object_path' AND (metadata->>'size')::bigint=(p->>'size_bytes')::bigint AND metadata->>'mimetype'=p->>'mime_type') THEN RAISE EXCEPTION 'attachment_not_found' USING ERRCODE='PT404';END IF;
  INSERT INTO public.workspace_attachments(ticket_id,user_id,object_path,filename,mime_type,size_bytes) VALUES((p->>'ticket_id')::uuid,u,p->>'object_path',p->>'filename',p->>'mime_type',(p->>'size_bytes')::integer) ON CONFLICT(object_path) DO NOTHING;RETURN jsonb_build_object('attached',true);
 WHEN 'tickets' THEN RETURN coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT t.id,t.title,t.message,t.category,t.state,t.created_at,
   coalesce((SELECT jsonb_agg(jsonb_build_object('filename',a.filename,'object_path',a.object_path,'mime_type',a.mime_type)) FROM public.workspace_attachments a WHERE a.ticket_id=t.id),'[]') attachments
   FROM public.workspace_tickets t WHERE t.user_id=u OR coalesce((p->>'admin')::boolean,false) AND app_private.sb_is_admin() ORDER BY t.created_at DESC LIMIT 100)x),'[]');
 WHEN 'ticket_update' THEN
  IF NOT app_private.sb_is_admin() THEN RAISE EXCEPTION 'admin_required' USING ERRCODE='PT403';END IF;
  IF p-'id'-'state'<>'{}' OR coalesce(p->>'state','') NOT IN ('open','in_progress','resolved') THEN RAISE EXCEPTION 'invalid_ticket_state' USING ERRCODE='PT422';END IF;
  UPDATE public.workspace_tickets SET state=p->>'state' WHERE id::text=p->>'id';IF NOT FOUND THEN RAISE EXCEPTION 'ticket_not_found' USING ERRCODE='PT404';END IF;
  INSERT INTO public.audit_logs(id,actor_id,action,target_id,details,created_at) VALUES(gen_random_uuid()::text,u,'support_ticket_state',p->>'id',jsonb_build_object('state',p->>'state'),now());RETURN jsonb_build_object('updated',true);
 WHEN 'export' THEN
  RETURN jsonb_build_object('exported_at',now(),'profile',(SELECT to_jsonb(x) FROM public.users x WHERE id=u),'preferences',prefs,
   'watchlist',public.sb_watchlist(),'portfolio',public.sb_portfolio(),
   'saved',coalesce((SELECT jsonb_agg(to_jsonb(x)-'user_id') FROM public.workspace_saved x WHERE user_id=u),'[]'),
   'history',coalesce((SELECT jsonb_agg(to_jsonb(x)-'user_id') FROM public.workspace_history x WHERE user_id=u),'[]'),
   'questions',coalesce((SELECT jsonb_agg(to_jsonb(x)-'user_id') FROM public.question_history x WHERE user_id=u),'[]'),
   'support',coalesce((SELECT jsonb_agg(to_jsonb(x)-'user_id') FROM public.workspace_tickets x WHERE user_id=u),'[]'));
 ELSE RAISE EXCEPTION 'unsupported_action' USING ERRCODE='PT404';
 END CASE;
END $$;
REVOKE ALL ON FUNCTION public.sb_workspace(text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.sb_workspace(text,jsonb) TO authenticated;

-- Enforce the new ordinary in-app notification preferences in the actual delivery path.
-- These controls do not alter published analyses or any correction banners.
CREATE FUNCTION app_private.sb_workspace_notification_gate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v jsonb; t time; a time; b time; company text; tz text; BEGIN
 SELECT value INTO v FROM public.workspace_preferences WHERE user_id=NEW.user_id;IF NOT FOUND THEN v:='{"daily_cap":3,"timezone":"Asia/Seoul","quiet_enabled":false,"muted_companies":[]}';END IF;
 PERFORM 1 FROM public.users WHERE id=NEW.user_id FOR UPDATE;
 SELECT company_id INTO company FROM public.events WHERE id=NEW.event_id;
 IF coalesce(v->'muted_companies','[]') ? company THEN RETURN NULL;END IF;
 tz:=coalesce(v->>'timezone','Asia/Seoul');t:=(now() AT TIME ZONE tz)::time;
 IF coalesce((v->>'quiet_enabled')::boolean,false) THEN a:=(v->>'quiet_start')::time;b:=(v->>'quiet_end')::time;
  IF a=b OR (a<b AND t>=a AND t<b) OR (a>b AND (t>=a OR t<b)) THEN RETURN NULL;END IF;END IF;
 IF (SELECT count(*) FROM public.notifications WHERE user_id=NEW.user_id AND (created_at AT TIME ZONE tz)::date=(now() AT TIME ZONE tz)::date)>=coalesce((v->>'daily_cap')::integer,3) THEN RETURN NULL;END IF;
 RETURN NEW;END $$;
REVOKE ALL ON FUNCTION app_private.sb_workspace_notification_gate() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER sb_workspace_notification_preferences BEFORE INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION app_private.sb_workspace_notification_gate();
NOTIFY pgrst,'reload schema';
