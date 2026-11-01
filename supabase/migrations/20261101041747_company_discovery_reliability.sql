-- Search official issuer identities without subscribing every issuer to collection.
-- New tables stay private. Public read RPCs retain verified Auth, MFA and rate checks.
CREATE OR REPLACE FUNCTION app_private.sb_search_normalize(value text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path='' AS $$
 SELECT regexp_replace(lower(normalize(coalesce(value,''),NFKC)),'[[:space:][:punct:]]+','','g')
$$;
REVOKE ALL ON FUNCTION app_private.sb_search_normalize(text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION app_private.sb_search_terms(q text) RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 WITH aliases(terms) AS (VALUES
 (ARRAY['애플','apple','aapl']),
 (ARRAY['마이크로소프트','마소','microsoft','msft']),
 (ARRAY['엔비디아','엔비','nvidia','nvda']),
 (ARRAY['테슬라','tesla','tsla']),
 (ARRAY['삼성전자','삼전','samsung electronics','005930']),
 (ARRAY['에스케이하이닉스','sk하이닉스','하이닉스','sk hynix','000660']),
 (ARRAY['현대자동차','현대차','hyundai motor','005380']),
 (ARRAY['네이버','naver','035420']),
 (ARRAY['카카오','kakao','035720']),
 (ARRAY['아마존','amazon','amzn']),
 (ARRAY['구글','알파벳','google','alphabet','goog','googl']),
 (ARRAY['메타','페이스북','meta platforms','facebook','meta']),
 (ARRAY['2차전지','이차전지','battery','batteries']),
 (ARRAY['반도체','semiconductor','semiconductors']),
 (ARRAY['전기차','electric vehicle','electric vehicles']),
 (ARRAY['매출','revenue','revenues']),
 (ARRAY['영업이익','operating income'])
 ) SELECT ARRAY(SELECT DISTINCT term FROM (
 SELECT lower(trim(q)) term UNION ALL
 SELECT unnest(terms) FROM aliases WHERE EXISTS(
  SELECT 1 FROM unnest(terms) a WHERE app_private.sb_search_normalize(a)=app_private.sb_search_normalize(q))
 ) x WHERE app_private.sb_search_normalize(term)<>'')
$$;
REVOKE ALL ON FUNCTION app_private.sb_search_terms(text) FROM PUBLIC,anon,authenticated;

CREATE TABLE app_private.company_directory_sources(
 provider text PRIMARY KEY CHECK(provider IN ('sec','dart')),
 source_url text NOT NULL,last_attempt_at timestamptz,last_success_at timestamptz,
 lease_until timestamptz,lease_id uuid,error_code text,source_sha256 text,raw_object_key text
);
INSERT INTO app_private.company_directory_sources(provider,source_url) VALUES
 ('sec','https://www.sec.gov/files/company_tickers_exchange.json'),
 ('dart','https://opendart.fss.or.kr/api/corpCode.xml');
CREATE TABLE app_private.company_directory(
 provider text NOT NULL REFERENCES app_private.company_directory_sources(provider),
 provider_company_id text NOT NULL,ticker text NOT NULL,name text NOT NULL,market text NOT NULL,
 source_sha256 text NOT NULL CHECK(source_sha256~'^[a-f0-9]{64}$'),
 fetched_at timestamptz NOT NULL,active boolean NOT NULL DEFAULT true,
 PRIMARY KEY(provider,provider_company_id,ticker)
);
CREATE INDEX company_directory_ticker ON app_private.company_directory(ticker) WHERE active;
CREATE TABLE app_private.company_hydration(
 company_id text PRIMARY KEY REFERENCES public.companies(id),
 last_success_at timestamptz,last_attempt_at timestamptz,lease_until timestamptz,lease_id uuid,error_code text
);
-- Preserve full authoritative names within the registry's 500-character contract.
ALTER TABLE public.companies ALTER COLUMN name TYPE varchar(500);
CREATE TABLE app_private.discovery_daily_limits(
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,day date NOT NULL,total integer NOT NULL CHECK(total BETWEEN 1 AND 25),
 PRIMARY KEY(user_id,day)
);
ALTER TABLE app_private.company_directory_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.company_directory ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.company_hydration ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.discovery_daily_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.company_directory_sources,app_private.company_directory,app_private.company_hydration FROM PUBLIC,anon,authenticated;
REVOKE ALL ON app_private.discovery_daily_limits FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION app_content_private.discovery_search(q text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid:=(SELECT auth.uid());result jsonb;BEGIN
 IF u IS NULL OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=u) THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='PT401';END IF;
 PERFORM public.sb_require_mfa();PERFORM public.sb_rate_limit();
 IF q IS NULL OR length(trim(q)) NOT BETWEEN 1 AND 100 OR app_private.sb_search_normalize(q)='' THEN RAISE EXCEPTION 'invalid_query' USING ERRCODE='PT422';END IF;
 WITH matches AS MATERIALIZED (
 SELECT d.provider,d.provider_company_id,d.ticker,d.name,d.market,c.id AS company_id,
 CASE WHEN app_private.sb_search_normalize(d.ticker)=app_private.sb_search_normalize(q) THEN 0
 WHEN app_private.sb_search_normalize(d.name)=app_private.sb_search_normalize(q) THEN 1 ELSE 2 END rank
 FROM app_private.company_directory d LEFT JOIN public.companies c
 ON c.provider=d.provider AND c.provider_company_id=d.provider_company_id AND NOT c.is_demo
 WHERE d.active AND EXISTS(SELECT 1 FROM unnest(app_private.sb_search_terms(q)) term
 WHERE position(app_private.sb_search_normalize(term) IN app_private.sb_search_normalize(d.name||' '||d.ticker))>0)
 ) SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(to_jsonb(x)-'rank') FROM
 (SELECT * FROM matches ORDER BY rank,name,ticker LIMIT 30)x),'[]'::jsonb),'total',(SELECT count(*) FROM matches),
 'source_status',CASE WHEN (SELECT count(*) FROM app_private.company_directory_sources WHERE last_success_at>now()-interval '72 hours' AND error_code IS NULL)=2 THEN 'ready'
 WHEN EXISTS(SELECT 1 FROM app_private.company_directory WHERE active) THEN 'partial' ELSE 'unavailable' END,
 'sources',(SELECT jsonb_agg(jsonb_build_object('provider',provider,'source_url',source_url,'last_success_at',last_success_at,'error_code',error_code)) FROM app_private.company_directory_sources)) INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION app_content_private.discovery_search(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION app_content_private.discovery_search(text) TO authenticated;
CREATE OR REPLACE FUNCTION public.sb_company_discovery(q text) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT app_content_private.discovery_search(q) $$;
REVOKE ALL ON FUNCTION public.sb_company_discovery(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.sb_company_discovery(text) TO authenticated;

-- Only the trusted Edge Function may refresh an official snapshot or activate a verified identity.
CREATE OR REPLACE FUNCTION app_content_private.discovery_admin(op text,p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE provider_name text:=p->>'provider';stamp timestamptz:=clock_timestamp();lease uuid;
 item app_private.company_directory%rowtype;company public.companies%rowtype;hid text;BEGIN
 IF p IS NULL OR jsonb_typeof(p)<>'object' OR octet_length(p::text)>15000000 THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='PT422';END IF;
 IF op='claim' THEN
  lease:=(p->>'lease')::uuid;
  UPDATE app_private.company_directory_sources SET lease_until=stamp+interval '2 minutes',lease_id=lease,last_attempt_at=stamp
  WHERE provider=provider_name AND coalesce(lease_until,'epoch')<stamp
  AND coalesce(last_success_at,'epoch')<stamp-interval '24 hours'
  AND coalesce(last_attempt_at,'epoch')<stamp-interval '5 minutes';
  RETURN to_jsonb(FOUND);
 ELSIF op='save' THEN
  lease:=(p->>'lease')::uuid;
  PERFORM 1 FROM app_private.company_directory_sources WHERE provider=provider_name AND lease_id=lease AND lease_until>stamp FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'lease_expired' USING ERRCODE='PT409';END IF;
  IF jsonb_typeof(p->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'items') NOT BETWEEN 100 AND 50000
   OR coalesce(p->>'sha','')!~'^[a-f0-9]{64}$' OR p->>'object_key' IS DISTINCT FROM ('directory/'||provider_name||'/'||(p->>'sha')||(CASE WHEN provider_name='sec' THEN '.json' ELSE '.zip' END))
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(p->'items') x WHERE
    jsonb_typeof(x)<>'object' OR length(coalesce(x->>'name','')) NOT BETWEEN 1 AND 500 OR length(coalesce(x->>'market','')) NOT BETWEEN 1 AND 30
    OR provider_name='sec' AND (coalesce(x->>'provider_company_id','')!~'^[0-9]{10}$' OR coalesce(x->>'ticker','')!~'^[A-Z0-9][A-Z0-9.-]{0,14}$')
    OR provider_name='dart' AND (coalesce(x->>'provider_company_id','')!~'^[0-9]{8}$' OR coalesce(x->>'ticker','')!~'^[0-9]{6}$')) THEN
   RAISE EXCEPTION 'invalid_directory' USING ERRCODE='PT422';END IF;
  INSERT INTO app_private.company_directory(provider,provider_company_id,ticker,name,market,source_sha256,fetched_at,active)
  SELECT provider_name,x->>'provider_company_id',x->>'ticker',x->>'name',x->>'market',p->>'sha',stamp,true FROM jsonb_array_elements(p->'items') x
  ON CONFLICT(provider,provider_company_id,ticker) DO UPDATE SET name=EXCLUDED.name,market=EXCLUDED.market,source_sha256=EXCLUDED.source_sha256,fetched_at=EXCLUDED.fetched_at,active=true;
  UPDATE app_private.company_directory SET active=false WHERE provider=provider_name AND fetched_at<>stamp;
  UPDATE app_private.company_directory_sources SET last_success_at=stamp,lease_until=NULL,lease_id=NULL,error_code=NULL,source_sha256=p->>'sha',raw_object_key=p->>'object_key' WHERE provider=provider_name;
  RETURN jsonb_build_object('count',jsonb_array_length(p->'items'));
 ELSIF op='fail' THEN
  UPDATE app_private.company_directory_sources SET lease_until=NULL,lease_id=NULL,error_code=left(coalesce(p->>'code','provider_unavailable'),80)
  WHERE provider=provider_name AND lease_id=(p->>'lease')::uuid;RETURN '{}'::jsonb;
 ELSIF op='activate' THEN
  IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id::text=p->>'actor') THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='PT401';END IF;
  IF p ? 'company_id' THEN SELECT * INTO company FROM public.companies WHERE id=p->>'company_id' AND NOT is_demo AND provider IN ('sec','dart');
  ELSE
   SELECT d.* INTO item FROM app_private.company_directory d JOIN app_private.company_directory_sources s ON s.provider=d.provider
   WHERE d.provider=provider_name AND d.provider_company_id=p->>'provider_company_id' AND d.ticker=p->>'ticker' AND d.active AND s.last_success_at>stamp-interval '7 days';
   IF NOT FOUND THEN RAISE EXCEPTION 'company_not_in_official_directory' USING ERRCODE='PT404';END IF;
   PERFORM pg_advisory_xact_lock(hashtextextended(item.provider||':'||item.provider_company_id,0));
   IF NOT EXISTS(SELECT 1 FROM public.companies WHERE provider=item.provider AND provider_company_id=item.provider_company_id) THEN
    INSERT INTO app_private.discovery_daily_limits(user_id,day,total) VALUES((p->>'actor')::uuid,current_date,1)
    ON CONFLICT(user_id,day) DO UPDATE SET total=app_private.discovery_daily_limits.total+1
    WHERE app_private.discovery_daily_limits.total<25;
    IF NOT FOUND THEN RAISE EXCEPTION 'daily_company_limit' USING ERRCODE='PT429';END IF;
   END IF;
   INSERT INTO public.companies(id,name,ticker,market,provider,provider_company_id,is_demo,created_at)
   VALUES(gen_random_uuid()::text,item.name,item.ticker,item.market,item.provider,item.provider_company_id,false,stamp)
   ON CONFLICT(provider,provider_company_id) DO NOTHING;
   SELECT * INTO company FROM public.companies WHERE provider=item.provider AND provider_company_id=item.provider_company_id AND NOT is_demo;
  END IF;
  IF company.id IS NULL THEN RAISE EXCEPTION 'company_not_found' USING ERRCODE='PT404';END IF;
  RETURN jsonb_build_object('id',company.id,'name',company.name,'ticker',company.ticker,'market',company.market,'provider',company.provider,'provider_company_id',company.provider_company_id,'last_ingested_at',company.last_ingested_at);
 ELSIF op='hydration_claim' THEN
  hid:=p->>'company_id';lease:=(p->>'lease')::uuid;
  INSERT INTO app_private.company_hydration(company_id) VALUES(hid) ON CONFLICT DO NOTHING;
  IF EXISTS(SELECT 1 FROM app_private.company_hydration WHERE company_id=hid AND last_success_at>stamp-interval '6 hours') THEN RETURN jsonb_build_object('ready',true,'claimed',false);END IF;
  UPDATE app_private.company_hydration SET lease_id=lease,lease_until=stamp+interval '2 minutes',last_attempt_at=stamp
  WHERE company_id=hid AND coalesce(lease_until,'epoch')<stamp AND coalesce(last_attempt_at,'epoch')<stamp-interval '1 minute';
  RETURN jsonb_build_object('ready',false,'claimed',FOUND);
 ELSIF op='hydration_finish' THEN
  UPDATE app_private.company_hydration SET last_success_at=CASE WHEN p->>'code' IS NULL THEN stamp ELSE last_success_at END,
  error_code=left(p->>'code',80),lease_id=NULL,lease_until=NULL WHERE company_id=p->>'company_id' AND lease_id=(p->>'lease')::uuid;
  RETURN '{}'::jsonb;
 END IF;
 RAISE EXCEPTION 'unsupported_action' USING ERRCODE='PT422';
END $$;
REVOKE ALL ON FUNCTION app_content_private.discovery_admin(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app_content_private.discovery_admin(text,jsonb) TO service_role;
GRANT USAGE ON SCHEMA app_content_private TO service_role;
CREATE OR REPLACE FUNCTION public.sb_discovery_admin(op text,p jsonb) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT app_content_private.discovery_admin(op,p) $$;
REVOKE ALL ON FUNCTION public.sb_discovery_admin(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sb_discovery_admin(text,jsonb) TO service_role;

-- Prioritize followed/held issuers without increasing the collector's provider call budget.
CREATE FUNCTION app_content_private.collection_candidates() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH candidates AS (
 SELECT c.id,c.name,c.ticker,c.provider,c.provider_company_id,c.last_ingested_at,
 CASE WHEN (c.last_ingested_at IS NULL OR c.last_ingested_at<now()-interval '2 hours') AND (
 EXISTS(SELECT 1 FROM public.watchlist_items w WHERE w.company_id=c.id) OR EXISTS(SELECT 1 FROM public.positions p WHERE p.company_id=c.id)) THEN 0
 WHEN c.last_ingested_at IS NULL THEN 1 ELSE 2 END priority
 FROM public.companies c WHERE NOT c.is_demo AND c.provider IN ('sec','dart')
 ),picked AS (SELECT DISTINCT ON (provider) * FROM candidates ORDER BY provider,priority,last_ingested_at NULLS FIRST,id)
 SELECT coalesce(jsonb_agg(to_jsonb(picked)-'priority'),'[]'::jsonb) FROM picked
$$;
REVOKE ALL ON FUNCTION app_content_private.collection_candidates() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app_content_private.collection_candidates() TO service_role;
CREATE FUNCTION public.sb_collection_candidates() RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT app_content_private.collection_candidates()
$$;
REVOKE ALL ON FUNCTION public.sb_collection_candidates() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sb_collection_candidates() TO service_role;

-- Excerpts preserve exact approved evidence; missing unit/period/basis are never invented.
CREATE FUNCTION app_private.sb_company_numeric_evidence(cid text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) FROM (
 SELECT a.filing_id::text||':'||cl.ordinality::text id,a.filing_id::text filing_id,a.kind,a.title,cl.claim->>'quote' quote,
 cl.claim->>'text' claim_text,a.source_url,a.published_at,a.reviewed_at
 FROM app_private.sb_approved_filing_analyses() a
 CROSS JOIN LATERAL jsonb_array_elements(a.result->'claims') WITH ORDINALITY cl(claim,ordinality)
 WHERE a.company_id=cid AND a.reviewed_at IS NOT NULL AND cl.claim->>'quote'~'[0-9]'
 ORDER BY a.reviewed_at DESC,a.filing_id,cl.ordinality LIMIT 30
 )x
$$;
REVOKE ALL ON FUNCTION app_private.sb_company_numeric_evidence(text) FROM PUBLIC,anon,authenticated;

-- Apply normalization at each existing matcher without changing visibility/approval logic.
-- Fail closed if any expected production function no longer has its audited expression.
DO $migration$
DECLARE target regprocedure;definition text;old_expression text;new_expression text;BEGIN
 FOR target,old_expression,new_expression IN SELECT * FROM (VALUES
 ('public.sb_workspace(text,jsonb)'::regprocedure,'position(term IN lower(c.name||'' ''||c.ticker))','position(app_private.sb_search_normalize(term) IN app_private.sb_search_normalize(c.name||'' ''||c.ticker))'),
 ('app_content_private.workspace(text,jsonb)'::regprocedure,'position(term IN lower(x.title||'' ''||x.summary||'' ''||x.ticker||'' ''||x.company_name||'' ''||x.category))','position(app_private.sb_search_normalize(term) IN app_private.sb_search_normalize(x.title||'' ''||x.summary||'' ''||x.ticker||'' ''||x.company_name||'' ''||x.category))'),
 ('app_content_private.redesign(text,jsonb)'::regprocedure,'position(term IN lower(c.company_name||'' ''||c.ticker||'' ''||c.title))','position(app_private.sb_search_normalize(term) IN app_private.sb_search_normalize(c.company_name||'' ''||c.ticker||'' ''||c.title))')
 )x(target,old_expression,new_expression) LOOP
  definition:=pg_get_functiondef(target);
  IF position(old_expression IN definition)=0 THEN RAISE EXCEPTION 'search_migration_precondition_failed: %',target;END IF;
  definition:=replace(definition,old_expression,new_expression);
  IF target='app_content_private.workspace(text,jsonb)'::regprocedure THEN
   IF position('RETURN r||jsonb_build_object(''analyses''' IN definition)=0 THEN RAISE EXCEPTION 'company_projection_precondition_failed';END IF;
   definition:=replace(definition,'RETURN r||jsonb_build_object(''analyses''','RETURN r||jsonb_build_object(''numeric_evidence'',app_private.sb_company_numeric_evidence(selected_id))||jsonb_build_object(''analyses''');
  END IF;
  IF target='app_content_private.redesign(text,jsonb)'::regprocedure THEN
   definition:=replace(definition,'''NASDAQ'',''NYSE'',''AMEX''','''US'',''NASDAQ'',''NYSE'',''AMEX'',''NYSEAMERICAN'',''CBOE''');
  END IF;
  EXECUTE definition;
 END LOOP;
END $migration$;
NOTIFY pgrst,'reload schema';
