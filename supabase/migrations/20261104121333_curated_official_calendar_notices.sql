-- Finite official notices are staged by trusted operations, then archived by the
-- existing one-use calendar worker. Nothing is enqueued by applying this migration.
-- No analysis approval, ordinary source validator, source identity or saved ID changes.
ALTER TABLE app_private.calendar_worker_control ADD COLUMN notice_ready boolean NOT NULL DEFAULT false;

CREATE TABLE app_private.calendar_notice_staging (
 source_key text PRIMARY KEY REFERENCES app_private.calendar_sources(key) ON DELETE RESTRICT,
 manifest_text text NOT NULL CHECK(octet_length(manifest_text) BETWEEN 1 AND 150000),
 manifest_sha256 text NOT NULL CHECK(manifest_sha256 ~ '^[a-f0-9]{64}$'),
 normalized_text text NOT NULL CHECK(length(normalized_text) BETWEEN 1 AND 2000000),
 state text NOT NULL DEFAULT 'staged' CHECK(state IN ('staged','queued','complete')),
 created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
 snapshot_id uuid REFERENCES app_private.calendar_snapshots(id) ON DELETE RESTRICT
);
CREATE TABLE app_private.calendar_notice_chunks (
 source_key text NOT NULL REFERENCES app_private.calendar_notice_staging(source_key) ON DELETE CASCADE,
 part integer NOT NULL CHECK(part BETWEEN 0 AND 62),
 bytes bytea NOT NULL CHECK(octet_length(bytes) BETWEEN 1 AND 64000),
 PRIMARY KEY(source_key,part)
);
ALTER TABLE app_private.calendar_notice_staging ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.calendar_notice_chunks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.calendar_notice_staging,app_private.calendar_notice_chunks FROM PUBLIC,anon,authenticated,service_role;

-- Reviewed issuer-specific official URL prefixes. SEC archive CIK and DART
-- issuer-bound receipt checks below are separate; this is not an arbitrary host list.
CREATE TABLE app_private.calendar_notice_authorities (
 provider text NOT NULL,provider_company_id text NOT NULL,url_prefix text NOT NULL,
 issuer_pattern text NOT NULL,PRIMARY KEY(provider,provider_company_id,url_prefix)
);
ALTER TABLE app_private.calendar_notice_authorities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.calendar_notice_authorities FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO app_private.calendar_notice_authorities VALUES
 ('sec','0000320193','https://www.apple.com/newsroom/','Apple'),
 ('sec','0000789019','https://news.microsoft.com/source/','Microsoft'),
 ('sec','0000723125','https://www.micron.com/about/events','Micron'),
 ('sec','0001045810','https://www.nvidia.com/gtc/','NVIDIA'),
 ('sec','0001141391','https://investor.mastercard.com/investor-news/','Mastercard'),
 ('sec','0001403161','https://investor.visa.com/news/','Visa'),
 ('sec','0001515940','https://www.kkr.com/content/dam/kkr/wealth/us/kio/documents/','KKR Income Opportunities Fund'),
 ('dart','00126380','https://www.samsung.com/global/ir/reports-disclosures/','Samsung'),
 ('dart','00105855','https://www.ls-electric.com/ko/pr/news/view/','LS ELECTRIC|LS일렉트릭');

CREATE FUNCTION app_private.calendar_notice_date(token text,context_year integer DEFAULT NULL,context_month integer DEFAULT NULL)
RETURNS date LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE p text[]; y integer; m integer; d integer; names text[]:=ARRAY['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
BEGIN
 p:=regexp_match(token,'^(20[0-9]{2})[-/.]([0-9]{1,2})[-/.]([0-9]{1,2})$');
 IF p IS NULL THEN p:=regexp_match(token,'^(20[0-9]{2})년[[:space:]]*([0-9]{1,2})월[[:space:]]*([0-9]{1,2})일$');END IF;
 IF p IS NOT NULL THEN y:=p[1]::integer;m:=p[2]::integer;d:=p[3]::integer;
 ELSE
  p:=regexp_match(token,'^(January|February|March|April|May|June|July|August|September|October|November|December|Jan[.]?|Feb[.]?|Mar[.]?|Apr[.]?|Jun[.]?|Jul[.]?|Aug[.]?|Sep[.]?|Sept[.]?|Oct[.]?|Nov[.]?|Dec[.]?) ([0-9]{1,2}), (20[0-9]{2})$','i');
  IF p IS NOT NULL THEN y:=p[3]::integer;m:=array_position(names,lower(left(p[1],3)));d:=p[2]::integer;
  ELSE
   p:=regexp_match(token,'^([0-9]{1,2})/([0-9]{1,2})/([0-9]{2})$');
   IF p IS NOT NULL THEN y:=2000+p[3]::integer;m:=p[1]::integer;d:=p[2]::integer;
   ELSIF context_year IS NOT NULL THEN
    y:=context_year;p:=regexp_match(token,'^([0-9]{1,2})[/.]([0-9]{1,2})$');
    IF p IS NULL THEN p:=regexp_match(token,'^([0-9]{1,2})월[[:space:]]*([0-9]{1,2})일?$');END IF;
    IF p IS NOT NULL THEN m:=p[1]::integer;d:=p[2]::integer;
    ELSE
     p:=regexp_match(token,'^(January|February|March|April|May|June|July|August|September|October|November|December|Jan[.]?|Feb[.]?|Mar[.]?|Apr[.]?|Jun[.]?|Jul[.]?|Aug[.]?|Sep[.]?|Sept[.]?|Oct[.]?|Nov[.]?|Dec[.]?) ([0-9]{1,2})$','i');
     IF p IS NOT NULL THEN m:=array_position(names,lower(left(p[1],3)));d:=p[2]::integer;
     ELSIF context_month IS NOT NULL AND token~'^[0-9]{1,2}일?$' THEN m:=context_month;d:=replace(token,'일','')::integer;
     END IF;
    END IF;
   END IF;
  END IF;
 END IF;
 IF y NOT BETWEEN 2000 AND 2099 OR y IS NULL OR m IS NULL OR d IS NULL THEN RETURN NULL;END IF;
 RETURN make_date(y,m,d);
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $$;

CREATE FUNCTION app_private.calendar_notice_quote(evidence text,quote text,start_at integer,end_at integer,max_length integer)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT coalesce(length(quote) BETWEEN 1 AND max_length AND start_at>=0 AND end_at=start_at+length(quote)
  AND substring(evidence FROM start_at+1 FOR end_at-start_at)=quote,false)
$$;

CREATE FUNCTION app_private.calendar_notice_cue(kind text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE kind
 WHEN 'annual_meeting' THEN 'annual.{0,30}(meeting|shareholder|stockholder)|주주총회'
 WHEN 'conference' THEN 'conference|NDR|investor.{0,20}(tour|meeting)|컨퍼런스|기업설명회|간담회|SC26|GTC'
 WHEN 'exhibition' THEN 'exhibition|expo|BIXPO|전시|박람회|CES'
 WHEN 'dividend_record' THEN 'record|배당기준일|기준일'
 WHEN 'dividend_payment' THEN 'payable|payment|paid|지급'
 WHEN 'dividend_ex' THEN 'ex.dividend|배당락'
 WHEN 'bond_payment' THEN '납입|payment|subscription'
 WHEN 'equity_payment' THEN '납입|payment|subscription'
 WHEN 'new_share_listing' THEN '상장|listing' END
$$;

CREATE FUNCTION app_private.calendar_notice_assert(m jsonb,evidence text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE co public.companies; k text; item jsonb; day date; last_day date; context_year integer; context_date date;
 receipt_id text; dart_record jsonb; expected_source text; fetched timestamptz; published date; permitted boolean:=false;
BEGIN
 IF jsonb_typeof(m) IS DISTINCT FROM 'object' OR NOT(m ?& ARRAY['schema','adapter','complete','source_key','source_url','document_url','company_id','provider','provider_company_id','ticker','format','encoding','raw_sha256','raw_bytes','raw_object_key','normalized_sha256','normalized_object_key','normalization','extraction','fetched_at','published_on','publication_precision','publication_timezone','issuer_quote','issuer_start','issuer_end','entries'])
 OR m->>'schema' IS DISTINCT FROM 'signalbrief.calendar.curated-notice.v1' OR m->>'adapter' IS DISTINCT FROM 'curated-notice' OR m->'complete' IS DISTINCT FROM 'false'::jsonb THEN RAISE EXCEPTION 'invalid_notice_manifest';END IF;
 FOREACH k IN ARRAY ARRAY['source_key','source_url','document_url','company_id','provider','provider_company_id','ticker','format','encoding','raw_sha256','raw_object_key','normalized_sha256','normalized_object_key','normalization','extraction','fetched_at','issuer_quote'] LOOP
  IF jsonb_typeof(m->k) IS DISTINCT FROM 'string' OR length(m->>k) NOT BETWEEN 1 AND 1200 THEN RAISE EXCEPTION 'invalid_notice_manifest';END IF;
 END LOOP;
 SELECT * INTO co FROM public.companies WHERE id=m->>'company_id' AND provider=m->>'provider' AND provider_company_id=m->>'provider_company_id' AND ticker=m->>'ticker' AND NOT is_demo;
 expected_source:='notice-'||co.provider||'-'||co.provider_company_id||'-'||left(encode(extensions.digest(convert_to(m->>'source_url','UTF8'),'sha256'),'hex'),24);
 IF co.id IS NULL OR m->>'source_key' IS DISTINCT FROM expected_source OR coalesce(m->>'raw_sha256','')!~'^[a-f0-9]{64}$' OR coalesce(m->>'normalized_sha256','')!~'^[a-f0-9]{64}$'
 OR coalesce(m->>'raw_bytes','')!~'^[0-9]{1,7}$' OR (m->>'raw_bytes')::integer NOT BETWEEN 1 AND 4000000
 OR m->>'format' NOT IN ('html','pdf','json') OR m->>'encoding' NOT IN ('utf-8','euc-kr')
 OR evidence IS NULL OR length(evidence) NOT BETWEEN 1 AND 2000000
 OR encode(extensions.digest(convert_to(evidence,'UTF8'),'sha256'),'hex') IS DISTINCT FROM m->>'normalized_sha256'
 OR m->>'raw_object_key' IS DISTINCT FROM ('calendar/'||expected_source||'/originals/'||(m->>'raw_sha256')||'.'||(m->>'format'))
 OR m->>'normalized_object_key' IS DISTINCT FROM ('calendar/'||expected_source||'/normalized/'||(m->>'normalized_sha256')||'.txt') THEN RAISE EXCEPTION 'invalid_notice_identity';END IF;
 IF m->>'source_url'~'[[:space:]#\\]' OR m->>'document_url'~'[[:space:]#\\]' OR m->>'source_url'~'(%2[eEfF]|[.][.])' OR m->>'document_url'~'(%2[eEfF]|[.][.])' THEN RAISE EXCEPTION 'invalid_notice_authority';END IF;
 IF co.provider='sec' AND co.provider_company_id~'^[0-9]{10}$' AND m->>'source_url'~('^https://www[.]sec[.]gov/Archives/edgar/data/'||ltrim(co.provider_company_id,'0')||'/[0-9]{18}/[A-Za-z0-9_.-]+[.]html?$')
  AND m->>'document_url'=m->>'source_url' AND m->>'format'='html' THEN permitted:=true;
 ELSIF co.provider='dart' AND co.provider_company_id~'^[0-9]{8}$' AND m->>'source_url'~'^https://dart[.]fss[.]or[.]kr/dsaf001/main[.]do[?]rcpNo=[0-9]{14}$' THEN
  receipt_id:=right(m->>'source_url',14);
  -- Use the already imported, issuer-bound official list, including its original archive.
  SELECT to_jsonb(f) INTO dart_record FROM public.dart_filings f WHERE f.company_id=co.id AND f.receipt=receipt_id AND f.source_url=m->>'source_url';
  IF dart_record IS NULL OR coalesce(dart_record->>'source_sha256','')!~'^[a-f0-9]{64}$' OR dart_record->>'source_object_key' IS DISTINCT FROM 'dart/lists/'||(dart_record->>'source_sha256')||'.json'
   OR NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='signalbrief-raw' AND name=dart_record->>'source_object_key')
   OR m->>'document_url'!~('^https://dart[.]fss[.]or[.]kr/report/viewer[.]do[?]rcpNo='||receipt_id||'&dcmNo=[1-9][0-9]{0,11}&eleId=0&offset=0&length=0&dtd=(HTML|dart4[.]xsd)$')
   OR (right(m->>'document_url',9)='dart4.xsd' AND m->>'encoding'<>'utf-8')
   OR m->>'format'<>'html' OR m->>'published_on' IS DISTINCT FROM dart_record->>'filing_date'
   OR m->>'publication_timezone' IS DISTINCT FROM 'Asia/Seoul' THEN RAISE EXCEPTION 'invalid_notice_dart_binding';END IF;
  permitted:=true;
 ELSE
  SELECT EXISTS(SELECT 1 FROM app_private.calendar_notice_authorities a WHERE a.provider=co.provider AND a.provider_company_id=co.provider_company_id
   AND starts_with(m->>'source_url',a.url_prefix) AND m->>'issuer_quote'~*a.issuer_pattern) INTO permitted;
  IF co.provider='dart' AND co.provider_company_id='00105855' AND m->>'source_url'~'^https://www[.]ls-electric[.]com/ko/pr/news/view/[1-9][0-9]{0,11}$' THEN
   IF m->>'document_url' IS DISTINCT FROM 'https://www.ls-electric.com/ko/api/board.ashx?t=news_view&b_id='||substring(m->>'source_url' FROM '[0-9]+$') OR m->>'format'<>'json' THEN permitted:=false;END IF;
  ELSIF m->>'document_url' IS DISTINCT FROM m->>'source_url' OR m->>'format' NOT IN ('html','pdf') THEN permitted:=false;END IF;
 END IF;
 IF NOT permitted THEN RAISE EXCEPTION 'invalid_notice_authority';END IF;
 IF (m->>'format'='pdf' AND (m->>'normalization'<>'pdf-text-whitespace-v1' OR m->>'extraction'!~'^pdftotext-[0-9]+([.][0-9]+){1,2};layout;utf-8$' OR m->>'encoding'<>'utf-8'))
 OR (m->>'format'='html' AND (m->>'normalization'<>'html-text-v1' OR m->>'extraction'<>'deterministic-v1'))
 OR (m->>'format'='json' AND (m->>'normalization'<>'ls-electric-board-v1' OR m->>'extraction'<>'deterministic-v1' OR m->>'encoding'<>'utf-8')) THEN RAISE EXCEPTION 'invalid_notice_normalization';END IF;
 fetched:=(m->>'fetched_at')::timestamptz;
 IF NOT isfinite(fetched) OR fetched>now()+interval '5 minutes' OR fetched<now()-interval '30 days' THEN RAISE EXCEPTION 'invalid_notice_fetched_at';END IF;
 IF m->'published_on'='null'::jsonb THEN
  IF m->>'publication_precision' IS DISTINCT FROM 'unknown' OR m->'publication_timezone' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'invalid_notice_publication';END IF;
 ELSE
  published:=app_private.calendar_notice_date(m->>'published_on');
  IF published IS NULL OR m->>'published_on'<>published::text OR m->>'publication_precision' IS DISTINCT FROM 'date' OR published>(fetched AT TIME ZONE 'UTC')::date+1 OR coalesce(m->>'publication_timezone','') NOT IN ('','Asia/Seoul','America/New_York','America/Los_Angeles','America/Chicago','America/Denver') THEN RAISE EXCEPTION 'invalid_notice_publication';END IF;
 END IF;
 IF coalesce(m->>'issuer_start','')!~'^[0-9]{1,7}$' OR coalesce(m->>'issuer_end','')!~'^[0-9]{1,7}$'
 OR NOT app_private.calendar_notice_quote(evidence,m->>'issuer_quote',(m->>'issuer_start')::integer,(m->>'issuer_end')::integer,500) THEN RAISE EXCEPTION 'invalid_notice_issuer_quote';END IF;
 IF jsonb_typeof(m->'entries') IS DISTINCT FROM 'array' OR jsonb_array_length(m->'entries') NOT BETWEEN 1 AND 40
 OR (SELECT count(*)<>count(DISTINCT e->>'key') FROM jsonb_array_elements(m->'entries') e) THEN RAISE EXCEPTION 'invalid_notice_entries';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(m->'entries') LOOP
  IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR NOT(item ?& ARRAY['key','title','event_type','occurs_on','quote','date_token','quote_start','quote_end','location','timezone'])
   OR coalesce(item->>'key','')!~'^[a-zA-Z0-9:_-]{1,160}$' OR jsonb_typeof(item->'title') IS DISTINCT FROM 'string' OR length(item->>'title') NOT BETWEEN 1 AND 200
   OR item->'timezone' IS DISTINCT FROM 'null'::jsonb OR app_private.calendar_notice_cue(item->>'event_type') IS NULL
   OR coalesce(item->>'quote_start','')!~'^[0-9]{1,7}$' OR coalesce(item->>'quote_end','')!~'^[0-9]{1,7}$'
   OR NOT app_private.calendar_notice_quote(evidence,item->>'quote',(item->>'quote_start')::integer,(item->>'quote_end')::integer,2400)
   OR item->>'location' IS DISTINCT FROM 'normalized-text['||(item->>'quote_start')||':'||(item->>'quote_end')||']'
   OR jsonb_typeof(item->'date_token') IS DISTINCT FROM 'string' OR length(item->>'date_token') NOT BETWEEN 4 AND 60
   OR position(item->>'date_token' IN item->>'quote')<=0 OR NOT(item->>'quote'~*app_private.calendar_notice_cue(item->>'event_type')) THEN RAISE EXCEPTION 'invalid_notice_entry';END IF;
  context_year:=NULL;context_date:=NULL;
  IF item ? 'year_context_token' THEN
   IF coalesce(item->>'year_context_start','')!~'^[0-9]{1,7}$' OR coalesce(item->>'year_context_end','')!~'^[0-9]{1,7}$'
    OR NOT app_private.calendar_notice_quote(evidence,item->>'year_context_quote',(item->>'year_context_start')::integer,(item->>'year_context_end')::integer,500)
    OR position(item->>'year_context_token' IN item->>'year_context_quote')<=0 THEN RAISE EXCEPTION 'invalid_notice_year_context';END IF;
   IF item->>'year_context_token'~'^20[0-9]{2}$' THEN
    IF NOT(item->>'year_context_quote'~*app_private.calendar_notice_cue(item->>'event_type')) THEN RAISE EXCEPTION 'invalid_notice_year_context';END IF;
    context_year:=(item->>'year_context_token')::integer;
   ELSE context_date:=app_private.calendar_notice_date(item->>'year_context_token');context_year:=extract(year FROM context_date)::integer;
   END IF;
   IF context_year IS NULL THEN RAISE EXCEPTION 'invalid_notice_year_context';END IF;
  ELSIF item ?| ARRAY['year_context_quote','year_context_start','year_context_end'] THEN RAISE EXCEPTION 'invalid_notice_year_context';END IF;
  day:=app_private.calendar_notice_date(item->>'date_token',context_year);
  IF day IS NULL OR item->>'occurs_on' IS DISTINCT FROM day::text OR day<current_date-91 OR day>current_date+550 THEN RAISE EXCEPTION 'invalid_notice_event_date';END IF;
  IF item ? 'ends_on' THEN
   last_day:=app_private.calendar_notice_date(item->>'end_date_token',coalesce(context_year,extract(year FROM day)::integer),extract(month FROM day)::integer);
   IF last_day IS NULL OR item->>'ends_on' IS DISTINCT FROM last_day::text OR last_day<=day OR last_day>day+31
    OR position(item->>'end_date_token' IN item->>'quote')<=0 OR position(day::text IN item->>'title')<=0 OR position(last_day::text IN item->>'title')<=0 THEN RAISE EXCEPTION 'invalid_notice_event_range';END IF;
  ELSIF item ? 'end_date_token' THEN RAISE EXCEPTION 'invalid_notice_event_range';END IF;
 END LOOP;
END $$;

CREATE FUNCTION public.sb_calendar_notice_stage(manifest_text text,normalized_text text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m jsonb; co public.companies; cfg app_private.calendar_sources; existing app_private.calendar_notice_staging; digest text; source text;
BEGIN
 IF manifest_text IS NULL OR octet_length(manifest_text) NOT BETWEEN 1 AND 150000 THEN RAISE EXCEPTION 'invalid_notice_payload';END IF;
 m:=manifest_text::jsonb;source:=m->>'source_key';
 PERFORM pg_catalog.pg_advisory_xact_lock(hashtextextended('calendar:'||source,0));
 PERFORM app_private.calendar_notice_assert(m,normalized_text);
 SELECT * INTO STRICT co FROM public.companies WHERE id=m->>'company_id';
 SELECT * INTO cfg FROM app_private.calendar_sources WHERE key=source;
 IF cfg.key IS NOT NULL AND (cfg.company_id IS DISTINCT FROM co.id OR cfg.provider IS DISTINCT FROM co.provider OR cfg.provider_company_id IS DISTINCT FROM co.provider_company_id OR cfg.ticker IS DISTINCT FROM co.ticker OR cfg.market IS DISTINCT FROM co.market OR cfg.adapter<>'curated-notice' OR cfg.url IS DISTINCT FROM m->>'source_url' OR cfg.feed_url IS NOT NULL OR NOT cfg.enabled) THEN RAISE EXCEPTION 'calendar_source_conflict';END IF;
 digest:=encode(extensions.digest(convert_to(manifest_text,'UTF8'),'sha256'),'hex');
 SELECT * INTO existing FROM app_private.calendar_notice_staging WHERE source_key=source;
 IF existing.source_key IS NOT NULL THEN
  IF existing.manifest_text IS DISTINCT FROM manifest_text OR existing.normalized_text IS DISTINCT FROM normalized_text THEN RAISE EXCEPTION 'notice_revision_requires_review';END IF;
  RETURN source;
 END IF;
 INSERT INTO app_private.calendar_sources(key,ticker,market,url,adapter,company_id,provider,provider_company_id)
 VALUES(source,co.ticker,co.market,m->>'source_url','curated-notice',co.id,co.provider,co.provider_company_id) ON CONFLICT(key) DO NOTHING;
 INSERT INTO app_private.calendar_notice_staging(source_key,manifest_text,manifest_sha256,normalized_text) VALUES(source,manifest_text,digest,normalized_text);
 RETURN source;
END $$;

CREATE FUNCTION public.sb_calendar_notice_chunk(source text,part integer,data_base64 text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE staged app_private.calendar_notice_staging; content bytea; previous bytea; total integer; expected integer;
BEGIN
 SELECT * INTO staged FROM app_private.calendar_notice_staging WHERE source_key=source FOR UPDATE;
 IF staged.source_key IS NULL OR staged.state<>'staged' OR part IS NULL OR part NOT BETWEEN 0 AND 62 OR data_base64 IS NULL OR length(data_base64) NOT BETWEEN 4 AND 85336 OR data_base64!~'^[A-Za-z0-9+/]*={0,2}$' THEN RAISE EXCEPTION 'invalid_notice_chunk';END IF;
 content:=decode(data_base64,'base64');total:=(staged.manifest_text::jsonb->>'raw_bytes')::integer;
 expected:=least(64000,total-part*64000);
 IF expected<=0 OR octet_length(content)<>expected THEN RAISE EXCEPTION 'invalid_notice_chunk_size';END IF;
 SELECT bytes INTO previous FROM app_private.calendar_notice_chunks c WHERE c.source_key=source AND c.part=sb_calendar_notice_chunk.part;
 IF previous IS NOT NULL AND previous<>content THEN RAISE EXCEPTION 'notice_chunk_conflict';END IF;
 INSERT INTO app_private.calendar_notice_chunks(source_key,part,bytes) VALUES(source,part,content) ON CONFLICT DO NOTHING;
 RETURN octet_length(content);
END $$;

CREATE FUNCTION app_private.calendar_notice_original(source text) RETURNS bytea
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE staged app_private.calendar_notice_staging; content bytea; m jsonb; total integer; parts integer;
BEGIN
 SELECT * INTO staged FROM app_private.calendar_notice_staging WHERE source_key=source;m:=staged.manifest_text::jsonb;
 total:=(m->>'raw_bytes')::integer;parts:=(total+63999)/64000;
 SELECT string_agg(bytes,''::bytea ORDER BY part) INTO content FROM app_private.calendar_notice_chunks WHERE source_key=source;
 IF staged.source_key IS NULL OR content IS NULL OR octet_length(content)<>total OR encode(extensions.digest(content,'sha256'),'hex') IS DISTINCT FROM m->>'raw_sha256'
  OR (SELECT count(*)<>parts OR min(part)<>0 OR max(part)<>parts-1 FROM app_private.calendar_notice_chunks WHERE source_key=source) THEN RAISE EXCEPTION 'notice_original_incomplete';END IF;
 RETURN content;
END $$;

CREATE FUNCTION public.sb_calendar_notice_dispatch(source text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE staged app_private.calendar_notice_staging;
BEGIN
 SELECT * INTO staged FROM app_private.calendar_notice_staging WHERE source_key=source FOR UPDATE;
 IF staged.source_key IS NULL THEN RAISE EXCEPTION 'notice_not_staged';END IF;
 IF staged.state='complete' THEN RETURN 0;END IF;
 IF NOT coalesce((SELECT notice_ready AND ready FROM app_private.calendar_worker_control WHERE singleton),false) THEN RAISE EXCEPTION 'notice_worker_not_ready';END IF;
 PERFORM app_private.calendar_notice_original(source);
 IF NOT EXISTS(SELECT 1 FROM app_private.calendar_sources WHERE key=source AND adapter='curated-notice' AND enabled) THEN RAISE EXCEPTION 'notice_source_disabled';END IF;
 UPDATE app_private.calendar_notice_staging SET state='queued' WHERE source_key=source;
 INSERT INTO app_private.calendar_refresh_queue(source_key,state) VALUES(source,'pending')
 ON CONFLICT(source_key) DO UPDATE SET state='pending',attempts=0,next_attempt_at=now(),requested_at=now(),run_id=NULL,lease_until=NULL,rerun_requested=false
 WHERE calendar_refresh_queue.state IN ('idle','failed');
 RETURN app_private.dispatch_calendar_refresh();
END $$;

CREATE FUNCTION app_private.calendar_notice_task(source text,h text) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF h IS NULL OR h!~'^[a-f0-9]{64}$' OR NOT EXISTS(SELECT 1 FROM app_private.calendar_runs r JOIN app_private.calendar_refresh_queue q ON q.run_id=r.id AND q.source_key=r.source_key AND q.state='running'
  WHERE r.source_key=source AND r.token_hash=h AND r.claimed_at IS NOT NULL AND r.finished_at IS NULL AND r.expires_at>now()) THEN RAISE EXCEPTION 'invalid_calendar_task';END IF;
END $$;

CREATE FUNCTION public.sb_calendar_notice_payload(source text,h text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE staged app_private.calendar_notice_staging; original bytea;
BEGIN
 PERFORM app_private.calendar_notice_task(source,h);
 SELECT * INTO staged FROM app_private.calendar_notice_staging WHERE source_key=source;
 IF staged.source_key IS NULL OR staged.state NOT IN ('queued','complete') THEN RAISE EXCEPTION 'notice_not_queued';END IF;
 IF staged.state='complete' THEN RETURN jsonb_build_object('completed',true,'count',jsonb_array_length(staged.manifest_text::jsonb->'entries'));END IF;
 original:=app_private.calendar_notice_original(source);
 RETURN jsonb_build_object('completed',false,'manifest_text',staged.manifest_text,'normalized_text',staged.normalized_text,'raw_base64',replace(encode(original,'base64'),E'\n',''));
END $$;

CREATE FUNCTION public.sb_calendar_ingest_notice(source text,h text,raw_sha text,object_key text,manifest_text text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE staged app_private.calendar_notice_staging; cfg app_private.calendar_sources; m jsonb; item jsonb; snap uuid; existing public.calendar_items; n integer:=0; original bytea;
BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(hashtextextended('calendar:'||source,0));
 PERFORM app_private.calendar_notice_task(source,h);
 SELECT * INTO staged FROM app_private.calendar_notice_staging WHERE source_key=source FOR UPDATE;
 SELECT * INTO cfg FROM app_private.calendar_sources WHERE key=source AND enabled AND adapter='curated-notice';
 IF staged.source_key IS NULL OR staged.state NOT IN ('queued','complete') OR cfg.key IS NULL OR manifest_text IS DISTINCT FROM staged.manifest_text OR raw_sha IS DISTINCT FROM staged.manifest_sha256 OR object_key IS DISTINCT FROM 'calendar/'||source||'/'||raw_sha||'.json'
  OR raw_sha IS DISTINCT FROM encode(extensions.digest(convert_to(manifest_text,'UTF8'),'sha256'),'hex') THEN RAISE EXCEPTION 'invalid_notice_payload';END IF;
 m:=manifest_text::jsonb;PERFORM app_private.calendar_notice_assert(m,staged.normalized_text);
 IF cfg.company_id IS DISTINCT FROM m->>'company_id' OR cfg.provider IS DISTINCT FROM m->>'provider' OR cfg.provider_company_id IS DISTINCT FROM m->>'provider_company_id' OR cfg.ticker IS DISTINCT FROM m->>'ticker' OR cfg.url IS DISTINCT FROM m->>'source_url' OR cfg.feed_url IS NOT NULL
  OR NOT EXISTS(SELECT 1 FROM public.companies c WHERE c.id=cfg.company_id AND c.market=cfg.market AND NOT c.is_demo) THEN RAISE EXCEPTION 'calendar_source_conflict';END IF;
 IF staged.state<>'complete' THEN original:=app_private.calendar_notice_original(source);END IF;
 IF NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='signalbrief-raw' AND name=object_key)
  OR NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='signalbrief-raw' AND name=m->>'raw_object_key')
  OR NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='signalbrief-raw' AND name=m->>'normalized_object_key') THEN RAISE EXCEPTION 'calendar_archive_missing';END IF;
 INSERT INTO app_private.calendar_snapshots(source_key,raw_sha256,object_key,normalized_text,raw_format,provenance)
 VALUES(source,raw_sha,object_key,staged.normalized_text,'json',m) ON CONFLICT(source_key,raw_sha256) DO NOTHING;
 SELECT id INTO snap FROM app_private.calendar_snapshots s WHERE s.source_key=source AND s.raw_sha256=raw_sha AND s.object_key=sb_calendar_ingest_notice.object_key AND s.normalized_text=staged.normalized_text AND s.raw_format='json' AND s.provenance=m;
 IF snap IS NULL THEN RAISE EXCEPTION 'snapshot_conflict';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(m->'entries') LOOP
  SELECT * INTO existing FROM public.calendar_items c WHERE c.source_key=source AND c.company_id=cfg.company_id AND c.source_event_key=item->>'key';
  IF existing.id IS NOT NULL AND (existing.source_snapshot_id IS DISTINCT FROM snap OR existing.title IS DISTINCT FROM item->>'title' OR existing.occurs_on::text IS DISTINCT FROM item->>'occurs_on' OR existing.quote IS DISTINCT FROM item->>'quote' OR existing.source_url IS DISTINCT FROM cfg.url OR existing.source_timezone IS NOT NULL OR existing.source_location IS DISTINCT FROM item->>'location' OR existing.calendar_status<>'confirmed') THEN RAISE EXCEPTION 'notice_revision_requires_review';END IF;
  INSERT INTO public.calendar_items(id,company_id,title,occurs_on,origin,quote,created_at,source_snapshot_id,source_key,source_event_key,source_url,source_timezone,source_location,verified_at,calendar_status)
  VALUES(gen_random_uuid()::text,cfg.company_id,item->>'title',(item->>'occurs_on')::date,'official',item->>'quote',now(),snap,source,item->>'key',cfg.url,NULL,item->>'location',now(),'confirmed')
  ON CONFLICT(source_key,company_id,source_event_key) WHERE source_key IS NOT NULL DO NOTHING;
  n:=n+1;
 END LOOP;
 -- A finite notice is additive. It is never a complete replacement calendar.
 UPDATE app_private.calendar_sources SET last_attempt_at=now(),last_success_at=now(),error_code=NULL WHERE key=source;
 UPDATE app_private.calendar_notice_staging SET state='complete',completed_at=now(),snapshot_id=snap WHERE source_key=source;
 DELETE FROM app_private.calendar_notice_chunks WHERE source_key=source;
 RETURN n;
END $$;

CREATE FUNCTION app_private.calendar_notice_confirmed(cid text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.calendar_items c JOIN app_private.calendar_sources p ON p.key=c.source_key AND p.adapter='curated-notice' AND p.enabled
 JOIN public.companies co ON co.id=c.company_id AND co.id=p.company_id AND co.provider=p.provider AND co.provider_company_id=p.provider_company_id AND co.ticker=p.ticker AND co.market=p.market AND NOT co.is_demo
 JOIN app_private.calendar_snapshots s ON s.id=c.source_snapshot_id AND s.source_key=p.key AND s.raw_format='json'
 JOIN app_private.calendar_notice_staging n ON n.source_key=p.key AND n.state='complete' AND n.snapshot_id=s.id AND n.manifest_sha256=s.raw_sha256 AND n.manifest_text::jsonb=s.provenance AND n.normalized_text=s.normalized_text
 WHERE c.id=cid AND c.origin='official' AND c.calendar_status='confirmed' AND c.verified_at IS NOT NULL AND c.source_url=p.url AND c.source_timezone IS NULL
 AND s.provenance->>'schema'='signalbrief.calendar.curated-notice.v1' AND s.provenance->>'company_id'=co.id AND s.provenance->>'provider_company_id'=co.provider_company_id
 AND EXISTS(SELECT 1 FROM jsonb_array_elements(s.provenance->'entries') e WHERE e->>'key'=c.source_event_key AND e->>'title'=c.title AND e->>'occurs_on'=c.occurs_on::text AND e->>'quote'=c.quote AND e->>'location'=c.source_location
  AND app_private.calendar_notice_quote(s.normalized_text,e->>'quote',(e->>'quote_start')::integer,(e->>'quote_end')::integer,2400)))
$$;

-- Keep the original function OID: RLS and saved/subscription queries continue
-- calling this predicate. A copied private helper preserves every old branch.
DO $$ DECLARE definition text; BEGIN
 definition:=pg_get_functiondef('app_private.sb_calendar_confirmed(text)'::regprocedure);
 IF position('calendar_notice_confirmed' IN definition)>0 THEN RAISE EXCEPTION 'notice_visibility_already_wrapped';END IF;
 EXECUTE replace(definition,'CREATE OR REPLACE FUNCTION app_private.sb_calendar_confirmed(',
  'CREATE FUNCTION app_private.calendar_confirmed_before_notices(');
END $$;
CREATE OR REPLACE FUNCTION app_private.sb_calendar_confirmed(cid text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT CASE WHEN EXISTS(SELECT 1 FROM public.calendar_items c JOIN app_private.calendar_sources s ON s.key=c.source_key WHERE c.id=cid AND s.adapter='curated-notice')
  THEN app_private.calendar_notice_confirmed(cid) ELSE app_private.calendar_confirmed_before_notices(cid) END
$$;

-- The generic dispatcher remains the only creator of task nonces. Readiness
-- guards this additive adapter even if an operator accidentally enqueues it early.
DO $$ DECLARE definition text; marker text:=$marker$AND (s.adapter<>'sec-ir' OR (SELECT sec_ir_ready FROM app_private.calendar_worker_control WHERE singleton))$marker$; BEGIN
 definition:=pg_get_functiondef('app_private.dispatch_calendar_refresh()'::regprocedure);
 IF position(marker IN definition)=0 THEN RAISE EXCEPTION 'unexpected_calendar_dispatcher';END IF;
 EXECUTE replace(definition,marker,marker||E'\n AND (s.adapter<>''curated-notice'' OR (SELECT notice_ready FROM app_private.calendar_worker_control WHERE singleton))');
END $$;
CREATE FUNCTION public.sb_calendar_notice_worker_ready(version text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF version IS DISTINCT FROM 'curated-notice-v1' THEN RAISE EXCEPTION 'unsupported_calendar_worker';END IF;
 UPDATE app_private.calendar_worker_control SET notice_ready=true WHERE singleton;
END $$;

REVOKE ALL ON FUNCTION app_private.calendar_notice_date(text,integer,integer),app_private.calendar_notice_quote(text,text,integer,integer,integer),app_private.calendar_notice_cue(text),app_private.calendar_notice_assert(jsonb,text),app_private.calendar_notice_original(text),app_private.calendar_notice_task(text,text),app_private.calendar_notice_confirmed(text),app_private.calendar_confirmed_before_notices(text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.sb_calendar_notice_stage(text,text),public.sb_calendar_notice_chunk(text,integer,text),public.sb_calendar_notice_dispatch(text),public.sb_calendar_notice_payload(text,text),public.sb_calendar_ingest_notice(text,text,text,text,text),public.sb_calendar_notice_worker_ready(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sb_calendar_notice_stage(text,text),public.sb_calendar_notice_chunk(text,integer,text),public.sb_calendar_notice_dispatch(text),public.sb_calendar_notice_payload(text,text),public.sb_calendar_ingest_notice(text,text,text,text,text),public.sb_calendar_notice_worker_ready(text) TO service_role;
