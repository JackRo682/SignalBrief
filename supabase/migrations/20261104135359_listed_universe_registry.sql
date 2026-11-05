-- Authoritative listings are separate from canonical disclosure issuers.
-- This migration does not register issuers, enable a worker, raise provider/model
-- budgets, subscribe a user, or approve an analysis.
CREATE TABLE app_private.universe_sources(
 source_key text PRIMARY KEY,source_url text NOT NULL,request_method text NOT NULL,
 request_market text,coverage_scope text NOT NULL,markets text[] NOT NULL,
 min_rows integer NOT NULL,max_rows integer NOT NULL DEFAULT 50000,
 latest_snapshot_id uuid,last_success_at timestamptz
);
INSERT INTO app_private.universe_sources(source_key,source_url,request_method,request_market,coverage_scope,markets,min_rows) VALUES
 ('nasdaq_traded','https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqtraded.txt','GET',NULL,'all_listed_securities',ARRAY['NASDAQ','NYSE','NYSE_AMERICAN','NYSE_ARCA','CBOE','TXSE','NYSE_TEXAS','IEX'],1000),
 ('kind_kospi','https://kind.krx.co.kr/corpgeneral/corpList.do','POST','stockMkt','issuer_primary_listing',ARRAY['KOSPI'],500),
 ('kind_kosdaq','https://kind.krx.co.kr/corpgeneral/corpList.do','POST','kosdaqMkt','issuer_primary_listing',ARRAY['KOSDAQ'],1000);
CREATE TABLE app_private.universe_snapshots(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),source_key text NOT NULL REFERENCES app_private.universe_sources(source_key),
 manifest_text text NOT NULL,manifest_sha256 text UNIQUE NOT NULL CHECK(manifest_sha256~'^[a-f0-9]{64}$'),
 raw_sha256 text NOT NULL CHECK(raw_sha256~'^[a-f0-9]{64}$'),raw_bytes integer NOT NULL CHECK(raw_bytes BETWEEN 1 AND 10000000),
 raw_object_key text NOT NULL,manifest_object_key text NOT NULL,
 as_of date NOT NULL,fetched_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 status text NOT NULL DEFAULT 'staged' CHECK(status IN ('staged','queued','running','applied','failed')),
 token_hash text UNIQUE,expires_at timestamptz,attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
 request_id bigint,error_code text,applied_at timestamptz,row_count integer NOT NULL,counts jsonb,
 UNIQUE(source_key,raw_sha256,manifest_sha256)
);
ALTER TABLE app_private.universe_sources ADD CONSTRAINT universe_latest_snapshot
 FOREIGN KEY(latest_snapshot_id) REFERENCES app_private.universe_snapshots(id);
CREATE TABLE app_private.universe_chunks(
 snapshot_id uuid NOT NULL REFERENCES app_private.universe_snapshots(id) ON DELETE CASCADE,
 part integer NOT NULL CHECK(part BETWEEN 0 AND 156),data bytea NOT NULL CHECK(octet_length(data) BETWEEN 1 AND 64000),
 PRIMARY KEY(snapshot_id,part)
);
CREATE TABLE app_private.universe_manifest_uploads(
 digest text PRIMARY KEY CHECK(digest~'^[a-f0-9]{64}$'),total_bytes integer NOT NULL CHECK(total_bytes BETWEEN 2 AND 20000000),
 total_parts integer NOT NULL CHECK(total_parts BETWEEN 1 AND 313),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app_private.universe_manifest_parts(
 digest text NOT NULL REFERENCES app_private.universe_manifest_uploads(digest) ON DELETE CASCADE,
 part integer NOT NULL CHECK(part BETWEEN 0 AND 312),text_chunk text NOT NULL CHECK(octet_length(text_chunk) BETWEEN 1 AND 64000),
 PRIMARY KEY(digest,part)
);
CREATE TABLE app_private.universe_listings(
 source_key text NOT NULL REFERENCES app_private.universe_sources(source_key),market text NOT NULL,ticker text NOT NULL,
 name text NOT NULL,instrument_type text NOT NULL,eligible boolean NOT NULL,exclusion_reason text,
 aliases jsonb NOT NULL,provider text,provider_company_id text,mapping_ticker text,mapping_source_sha256 text,
 mapping_status text NOT NULL CHECK(mapping_status IN ('mapped','unresolved','ambiguous','conflict')),
 company_id text REFERENCES public.companies(id),listing_status text NOT NULL CHECK(listing_status IN ('current','missing_from_latest')),
 snapshot_id uuid NOT NULL REFERENCES app_private.universe_snapshots(id),source_row integer NOT NULL,evidence jsonb NOT NULL,
 first_seen_at timestamptz NOT NULL DEFAULT now(),last_seen_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(source_key,market,ticker),
 CHECK(num_nonnulls(provider,provider_company_id) IN (0,2)),
 CHECK((provider IS NULL AND provider_company_id IS NULL) OR (provider='sec' AND provider_company_id~'^[0-9]{10}$') OR (provider='dart' AND provider_company_id~'^[0-9]{8}$'))
);
CREATE INDEX universe_listings_register ON app_private.universe_listings(provider,provider_company_id)
 WHERE listing_status='current' AND eligible AND mapping_status='mapped' AND company_id IS NULL;
CREATE INDEX universe_listings_company ON app_private.universe_listings(company_id) WHERE company_id IS NOT NULL;
CREATE INDEX universe_listings_market_ticker ON app_private.universe_listings(market,ticker) WHERE listing_status='current';
CREATE INDEX universe_listings_snapshot ON app_private.universe_listings(snapshot_id);
CREATE INDEX universe_sources_latest_snapshot ON app_private.universe_sources(latest_snapshot_id);
CREATE TABLE app_private.universe_worker_control(id boolean PRIMARY KEY DEFAULT true CHECK(id),ready boolean NOT NULL DEFAULT false);
INSERT INTO app_private.universe_worker_control DEFAULT VALUES;
ALTER TABLE app_private.universe_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.universe_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.universe_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.universe_manifest_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.universe_manifest_parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.universe_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.universe_worker_control ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.universe_sources,app_private.universe_snapshots,app_private.universe_chunks,
 app_private.universe_listings,app_private.universe_worker_control,app_private.universe_manifest_uploads,app_private.universe_manifest_parts FROM PUBLIC,anon,authenticated;

-- Validate the manifest at staging and completion. The one-use worker independently
-- binds every normalized row to actual original bytes before immutable archival.
CREATE FUNCTION app_private.universe_assert(manifest_text text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m jsonb;s app_private.universe_sources%rowtype;x jsonb;stamp timestamptz:=clock_timestamp();BEGIN
 IF manifest_text IS NULL OR octet_length(manifest_text) NOT BETWEEN 2 AND 20000000 THEN
  RAISE EXCEPTION 'invalid_universe_manifest' USING ERRCODE='PT422';END IF;
 BEGIN m:=manifest_text::jsonb;EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'invalid_universe_manifest' USING ERRCODE='PT422';END;
 SELECT * INTO s FROM app_private.universe_sources WHERE source_key=m->>'source_key';
 IF s.source_key IS NULL OR jsonb_typeof(m) IS DISTINCT FROM 'object'
  OR m->>'version' IS DISTINCT FROM 'listed-universe-v1' OR m->>'source_url' IS DISTINCT FROM s.source_url
  OR m->>'coverage_scope' IS DISTINCT FROM s.coverage_scope OR m->'complete' IS DISTINCT FROM 'true'::jsonb
  OR m->'source_request'->>'method' IS DISTINCT FROM s.request_method
  OR s.request_method='POST' AND m->'source_request'->'fields' IS DISTINCT FROM jsonb_build_object(
   'method','download','searchType','13','pageIndex','1','currentPageSize','3000','orderMode','3','orderStat','D',
   'fiscalYearEnd','all','location','all','marketType',s.request_market)
  OR s.request_method='GET' AND m->'source_request'->'fields' IS DISTINCT FROM '{}'::jsonb
  OR coalesce(m->>'raw_sha256','')!~'^[a-f0-9]{64}$'
  OR coalesce(m->>'raw_bytes','')!~'^[0-9]{1,8}$' OR (m->>'raw_bytes')::integer NOT BETWEEN 1 AND 10000000
  OR coalesce(m->>'parser_version','')!~'^[a-z0-9_.-]{1,80}$'
  OR coalesce(m->>'as_of','')!~'^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'
  OR coalesce(m->>'fetched_at','')!~'^20[0-9]{2}-[0-9]{2}-[0-9]{2}T'
  OR jsonb_typeof(m->'items') IS DISTINCT FROM 'array'
 THEN RAISE EXCEPTION 'invalid_universe_manifest' USING ERRCODE='PT422';END IF;
 IF (m->>'fetched_at')::timestamptz>stamp+interval '5 minutes'
  OR (m->>'fetched_at')::timestamptz<stamp-interval '7 days'
  OR (m->>'as_of')::date>(m->>'fetched_at')::timestamptz::date+1
  OR (m->>'as_of')::date<(m->>'fetched_at')::timestamptz::date-7
  OR jsonb_array_length(m->'items') NOT BETWEEN s.min_rows AND s.max_rows
 THEN RAISE EXCEPTION 'stale_or_incomplete_universe' USING ERRCODE='PT422';END IF;
 FOR x IN SELECT value FROM jsonb_array_elements(m->'items') LOOP
  IF jsonb_typeof(x) IS DISTINCT FROM 'object' OR NOT x ?& ARRAY['market','ticker','name','instrument_type','eligible','exclusion_reason','aliases','provider','provider_company_id','mapping_status','mapping_ticker','mapping_source_sha256','source_row','evidence']
   OR NOT coalesce(x->>'market','')=ANY(s.markets)
   OR coalesce(x->>'ticker','')!~'^[A-Z0-9][A-Z0-9.^$+/=-]{0,29}$'
   OR length(trim(coalesce(x->>'name',''))) NOT BETWEEN 1 AND 500
   OR coalesce(x->>'instrument_type','')!~'^[a-z_]{1,60}$'
   OR jsonb_typeof(x->'eligible') IS DISTINCT FROM 'boolean'
   OR jsonb_typeof(x->'aliases') IS DISTINCT FROM 'array' OR jsonb_array_length(x->'aliases') NOT BETWEEN 1 AND 20
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(x->'aliases') a WHERE jsonb_typeof(a)<>'string' OR a#>>'{}' !~'^[A-Za-z0-9][A-Za-z0-9.^$+/=-]{0,29}$')
   OR NOT (x->'aliases' ? (x->>'ticker'))
   OR coalesce(x->>'mapping_status','') NOT IN ('mapped','unresolved','ambiguous')
   OR coalesce(x->>'source_row','')!~'^[0-9]{1,6}$' OR (x->>'source_row')::integer NOT BETWEEN 1 AND 100000
   OR jsonb_typeof(x->'evidence') IS DISTINCT FROM 'object' OR octet_length((x->'evidence')::text)>64000
   OR (x->'eligible'='false'::jsonb AND length(coalesce(x->>'exclusion_reason','')) NOT BETWEEN 1 AND 200)
   OR (x->'eligible'='true'::jsonb AND x->>'exclusion_reason' IS NOT NULL)
   OR (x->>'mapping_status'<>'mapped' AND (x->>'provider' IS NOT NULL OR x->>'provider_company_id' IS NOT NULL OR x->>'mapping_ticker' IS NOT NULL OR x->>'mapping_source_sha256' IS NOT NULL))
  THEN RAISE EXCEPTION 'invalid_universe_listing' USING ERRCODE='PT422';END IF;
  IF x->>'mapping_status'='mapped' AND (
   x->>'provider' IS DISTINCT FROM CASE WHEN x->>'market' IN ('KOSPI','KOSDAQ') THEN 'dart' ELSE 'sec' END
   OR NOT EXISTS(SELECT 1 FROM app_private.company_directory d
    JOIN app_private.company_directory_sources ds ON ds.provider=d.provider
    WHERE d.provider=x->>'provider' AND d.provider_company_id=x->>'provider_company_id'
     AND d.ticker=x->>'mapping_ticker' AND d.source_sha256=x->>'mapping_source_sha256'
     AND ds.source_sha256=d.source_sha256 AND ds.last_success_at>stamp-interval '7 days' AND d.active
     AND (x->'aliases' ? d.ticker)
     AND (d.provider<>'dart' OR d.name=x->>'name')
     AND NOT EXISTS(SELECT 1 FROM app_private.company_directory other WHERE other.provider=d.provider
      AND other.ticker=d.ticker AND other.active AND other.provider_company_id<>d.provider_company_id)
     AND NOT EXISTS(SELECT 1 FROM app_private.company_directory other WHERE other.provider=d.provider
      AND other.ticker=ANY(ARRAY(SELECT jsonb_array_elements_text(x->'aliases'))) AND other.source_sha256=d.source_sha256
      AND other.active AND other.provider_company_id<>d.provider_company_id)
     AND EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='signalbrief-raw' AND o.name=ds.raw_object_key))
  ) THEN RAISE EXCEPTION 'universe_issuer_mapping_unverified' USING ERRCODE='PT422';END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(m->'items') entry GROUP BY entry->>'market',entry->>'ticker' HAVING count(*)>1)
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(m->'items') entry GROUP BY entry->>'source_row' HAVING count(*)>1)
 THEN RAISE EXCEPTION 'duplicate_universe_listing' USING ERRCODE='PT422';END IF;
 RETURN m;
END $$;
CREATE FUNCTION public.sb_universe_manifest_begin(digest text,total_bytes integer,total_parts integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE old app_private.universe_manifest_uploads%rowtype;s app_private.universe_snapshots%rowtype;BEGIN
 IF coalesce(digest,'')!~'^[a-f0-9]{64}$' OR total_bytes IS NULL OR total_bytes NOT BETWEEN 2 AND 20000000
  OR total_parts IS NULL OR total_parts NOT BETWEEN 1 AND 313 OR total_bytes>total_parts*64000 OR total_bytes<total_parts THEN
  RAISE EXCEPTION 'invalid_manifest_upload' USING ERRCODE='PT422';END IF;
 SELECT * INTO s FROM app_private.universe_snapshots WHERE manifest_sha256=digest;
 IF s.id IS NOT NULL THEN RETURN jsonb_build_object('status','staged','snapshot_id',s.id);END IF;
 INSERT INTO app_private.universe_manifest_uploads(digest,total_bytes,total_parts) VALUES(digest,total_bytes,total_parts) ON CONFLICT DO NOTHING;
 SELECT * INTO old FROM app_private.universe_manifest_uploads u WHERE u.digest=sb_universe_manifest_begin.digest FOR UPDATE;
 IF old.total_bytes<>total_bytes OR old.total_parts<>total_parts THEN RAISE EXCEPTION 'manifest_upload_conflict' USING ERRCODE='PT409';END IF;
 RETURN jsonb_build_object('status','receiving');
END $$;
CREATE FUNCTION public.sb_universe_manifest_part(digest text,part integer,text_chunk text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE upload app_private.universe_manifest_uploads%rowtype;previous text;BEGIN
 SELECT * INTO upload FROM app_private.universe_manifest_uploads u WHERE u.digest=sb_universe_manifest_part.digest FOR UPDATE;
 IF upload.digest IS NULL THEN RAISE EXCEPTION 'manifest_upload_not_found' USING ERRCODE='PT404';END IF;
 IF part IS NULL OR part<0 OR part>=upload.total_parts OR text_chunk IS NULL OR octet_length(text_chunk) NOT BETWEEN 1 AND 64000 THEN
  RAISE EXCEPTION 'invalid_manifest_part' USING ERRCODE='PT422';END IF;
 SELECT p.text_chunk INTO previous FROM app_private.universe_manifest_parts p WHERE p.digest=upload.digest AND p.part=sb_universe_manifest_part.part;
 IF previous IS NOT NULL AND previous IS DISTINCT FROM text_chunk THEN RAISE EXCEPTION 'manifest_part_conflict' USING ERRCODE='PT409';END IF;
 INSERT INTO app_private.universe_manifest_parts(digest,part,text_chunk) VALUES(upload.digest,part,text_chunk) ON CONFLICT DO NOTHING;
 RETURN octet_length(text_chunk);
END $$;
CREATE FUNCTION public.sb_universe_manifest_commit(digest text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE upload app_private.universe_manifest_uploads%rowtype;body text;parts integer;answer jsonb;s app_private.universe_snapshots%rowtype;BEGIN
 SELECT * INTO s FROM app_private.universe_snapshots WHERE manifest_sha256=digest;
 IF s.id IS NOT NULL THEN RETURN jsonb_build_object('snapshot_id',s.id,'manifest_sha256',s.manifest_sha256,'raw_object_key',s.raw_object_key,'manifest_object_key',s.manifest_object_key,'status',s.status);END IF;
 SELECT * INTO upload FROM app_private.universe_manifest_uploads u WHERE u.digest=sb_universe_manifest_commit.digest FOR UPDATE;
 IF upload.digest IS NULL THEN RAISE EXCEPTION 'manifest_upload_not_found' USING ERRCODE='PT404';END IF;
 SELECT string_agg(p.text_chunk,'' ORDER BY p.part),count(*) INTO body,parts FROM app_private.universe_manifest_parts p WHERE p.digest=upload.digest;
 IF parts<>upload.total_parts OR octet_length(body)<>upload.total_bytes OR encode(extensions.digest(convert_to(body,'UTF8'),'sha256'),'hex')<>digest THEN
  RAISE EXCEPTION 'manifest_upload_incomplete' USING ERRCODE='PT422';END IF;
 answer:=public.sb_universe_stage(body);
 DELETE FROM app_private.universe_manifest_uploads u WHERE u.digest=upload.digest;
 RETURN answer;
END $$;
REVOKE ALL ON FUNCTION app_private.universe_assert(text) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.sb_universe_stage(manifest_text text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m jsonb;digest text;s app_private.universe_snapshots%rowtype;BEGIN
 m:=app_private.universe_assert(manifest_text);
 digest:=encode(extensions.digest(convert_to(manifest_text,'UTF8'),'sha256'),'hex');
 INSERT INTO app_private.universe_snapshots(source_key,manifest_text,manifest_sha256,raw_sha256,raw_bytes,raw_object_key,manifest_object_key,as_of,fetched_at,row_count)
 VALUES(m->>'source_key',manifest_text,digest,m->>'raw_sha256',(m->>'raw_bytes')::integer,
  'universe/raw/'||(m->>'source_key')||'/'||(m->>'raw_sha256')||'.bin','universe/manifests/'||digest||'.json',
  (m->>'as_of')::date,(m->>'fetched_at')::timestamptz,jsonb_array_length(m->'items')) ON CONFLICT(manifest_sha256) DO NOTHING;
 SELECT * INTO s FROM app_private.universe_snapshots WHERE manifest_sha256=digest;
 IF s.manifest_text IS DISTINCT FROM manifest_text THEN RAISE EXCEPTION 'universe_hash_conflict' USING ERRCODE='PT409';END IF;
 RETURN jsonb_build_object('snapshot_id',s.id,'manifest_sha256',digest,'raw_object_key',s.raw_object_key,'manifest_object_key',s.manifest_object_key,'status',s.status);
END $$;
CREATE FUNCTION public.sb_universe_chunk(snapshot_id uuid,part integer,data_base64 text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s app_private.universe_snapshots%rowtype;bytes bytea;expected integer;previous bytea;BEGIN
 SELECT * INTO s FROM app_private.universe_snapshots WHERE id=snapshot_id FOR UPDATE;
 IF s.id IS NULL OR s.status NOT IN ('staged','failed') THEN RAISE EXCEPTION 'universe_not_staged' USING ERRCODE='PT409';END IF;
 IF part IS NULL OR part<0 OR part>=(s.raw_bytes+63999)/64000 OR data_base64 IS NULL
  OR length(data_base64)>85336 OR data_base64!~'^[A-Za-z0-9+/]*={0,2}$' THEN RAISE EXCEPTION 'invalid_universe_chunk' USING ERRCODE='PT422';END IF;
 BEGIN bytes:=decode(data_base64,'base64');EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'invalid_universe_chunk' USING ERRCODE='PT422';END;
 expected:=least(64000,s.raw_bytes-part*64000);
 IF octet_length(bytes)<>expected THEN RAISE EXCEPTION 'invalid_universe_chunk' USING ERRCODE='PT422';END IF;
 SELECT c.data INTO previous FROM app_private.universe_chunks c WHERE c.snapshot_id=s.id AND c.part=sb_universe_chunk.part;
 IF previous IS NOT NULL AND previous<>bytes THEN RAISE EXCEPTION 'universe_chunk_conflict' USING ERRCODE='PT409';END IF;
 INSERT INTO app_private.universe_chunks(snapshot_id,part,data) VALUES(s.id,part,bytes) ON CONFLICT DO NOTHING;
 RETURN expected;
END $$;
CREATE FUNCTION public.sb_universe_worker_ready(version text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF version IS DISTINCT FROM 'listed-universe-v1' THEN RAISE EXCEPTION 'universe_worker_version_required' USING ERRCODE='PT422';END IF;
 UPDATE app_private.universe_worker_control SET ready=true WHERE id;RETURN true;
END $$;
CREATE FUNCTION public.sb_universe_dispatch(snapshot_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s app_private.universe_snapshots%rowtype;bytes bytea;token text;request bigint;BEGIN
 SELECT * INTO s FROM app_private.universe_snapshots WHERE id=snapshot_id FOR UPDATE;
 IF s.id IS NULL THEN RAISE EXCEPTION 'universe_snapshot_not_found' USING ERRCODE='PT404';END IF;
 IF s.status='applied' THEN RETURN jsonb_build_object('status','applied','request_id',s.request_id);END IF;
 IF s.status IN ('queued','running') AND s.expires_at>now() THEN RETURN jsonb_build_object('status',s.status,'request_id',s.request_id);END IF;
 IF NOT EXISTS(SELECT 1 FROM app_private.universe_worker_control WHERE id AND ready) THEN RAISE EXCEPTION 'universe_worker_not_ready' USING ERRCODE='PT409';END IF;
 IF s.attempts>=3 THEN RAISE EXCEPTION 'universe_retry_limit' USING ERRCODE='PT409';END IF;
 SELECT string_agg(c.data,''::bytea ORDER BY c.part) INTO bytes FROM app_private.universe_chunks c WHERE c.snapshot_id=s.id;
 IF bytes IS NULL OR octet_length(bytes)<>s.raw_bytes OR encode(extensions.digest(bytes,'sha256'),'hex')<>s.raw_sha256 THEN
  RAISE EXCEPTION 'universe_original_incomplete' USING ERRCODE='PT422';END IF;
 token:=encode(extensions.gen_random_bytes(32),'hex');
 UPDATE app_private.universe_snapshots SET status='queued',token_hash=encode(extensions.digest(token,'sha256'),'hex'),
  expires_at=now()+interval '5 minutes',attempts=attempts+1,error_code=NULL WHERE id=s.id;
 SELECT net.http_post(url:='https://xabzzhtdmqsaqdauthbu.supabase.co/functions/v1/signalbrief-universe',
  headers:=jsonb_build_object('Content-Type','application/json','x-signalbrief-task',token),body:='{}'::jsonb,timeout_milliseconds:=120000) INTO request;
 UPDATE app_private.universe_snapshots SET request_id=request WHERE id=s.id;
 RETURN jsonb_build_object('status','queued','request_id',request);
END $$;
CREATE FUNCTION public.sb_universe_claim(h text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s app_private.universe_snapshots%rowtype;BEGIN
 IF coalesce(h,'')!~'^[a-f0-9]{64}$' THEN RETURN NULL;END IF;
 UPDATE app_private.universe_snapshots SET status='running'
 WHERE token_hash=h AND status='queued' AND expires_at>now() RETURNING * INTO s;
 IF s.id IS NULL THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('snapshot_id',s.id,'manifest_text',s.manifest_text,'manifest_sha256',s.manifest_sha256,
  'raw_object_key',s.raw_object_key,'manifest_object_key',s.manifest_object_key,
  'chunks',(SELECT jsonb_agg(jsonb_build_object('part',c.part,'data_base64',replace(encode(c.data,'base64'),E'\n','')) ORDER BY c.part)
   FROM app_private.universe_chunks c WHERE c.snapshot_id=s.id));
END $$;
CREATE FUNCTION public.sb_universe_finish(h text,raw_sha256 text,raw_object_key text,manifest_sha256 text,manifest_object_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s app_private.universe_snapshots%rowtype;src app_private.universe_sources%rowtype;m jsonb;v_counts jsonb;BEGIN
 SELECT * INTO s FROM app_private.universe_snapshots WHERE token_hash=h FOR UPDATE;
 IF s.id IS NULL THEN RAISE EXCEPTION 'invalid_universe_task' USING ERRCODE='PT401';END IF;
 IF s.raw_sha256 IS DISTINCT FROM raw_sha256 OR s.raw_object_key IS DISTINCT FROM raw_object_key
  OR s.manifest_sha256 IS DISTINCT FROM manifest_sha256 OR s.manifest_object_key IS DISTINCT FROM manifest_object_key
 THEN RAISE EXCEPTION 'universe_archive_mismatch' USING ERRCODE='PT422';END IF;
 IF s.status='applied' THEN RETURN jsonb_build_object('status','applied','counts',s.counts);END IF;
 IF s.status<>'running' OR s.expires_at<=now() THEN RAISE EXCEPTION 'invalid_universe_task' USING ERRCODE='PT401';END IF;
 IF NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='signalbrief-raw' AND o.name=s.raw_object_key AND (o.metadata->>'size')::bigint=s.raw_bytes)
  OR NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='signalbrief-raw' AND o.name=s.manifest_object_key AND (o.metadata->>'size')::bigint=octet_length(s.manifest_text))
 THEN RAISE EXCEPTION 'universe_archives_required' USING ERRCODE='PT422';END IF;
 m:=app_private.universe_assert(s.manifest_text);
 SELECT * INTO src FROM app_private.universe_sources WHERE source_key=s.source_key FOR UPDATE;
 IF EXISTS(SELECT 1 FROM app_private.universe_snapshots previous WHERE previous.id=src.latest_snapshot_id
  AND (previous.as_of>s.as_of OR previous.fetched_at>=s.fetched_at)) THEN RAISE EXCEPTION 'universe_snapshot_not_newer' USING ERRCODE='PT409';END IF;
 -- Large deletions require an explicit new reviewed adapter/import. An apparently
 -- complete but truncated download cannot silently remove most of an exchange.
 IF EXISTS(SELECT 1 FROM app_private.universe_snapshots previous WHERE previous.id=src.latest_snapshot_id
  AND s.row_count<previous.row_count*0.9) THEN RAISE EXCEPTION 'universe_snapshot_shrink_requires_review' USING ERRCODE='PT409';END IF;
 INSERT INTO app_private.universe_listings(source_key,market,ticker,name,instrument_type,eligible,exclusion_reason,aliases,provider,provider_company_id,
  mapping_ticker,mapping_source_sha256,mapping_status,company_id,listing_status,snapshot_id,source_row,evidence)
 SELECT s.source_key,x->>'market',x->>'ticker',x->>'name',x->>'instrument_type',(x->>'eligible')::boolean,x->>'exclusion_reason',x->'aliases',
  x->>'provider',x->>'provider_company_id',x->>'mapping_ticker',x->>'mapping_source_sha256',x->>'mapping_status',
  c.id,'current',s.id,(x->>'source_row')::integer,x->'evidence'
 FROM jsonb_array_elements(m->'items') x LEFT JOIN public.companies c ON c.provider=x->>'provider'
  AND c.provider_company_id=x->>'provider_company_id' AND NOT c.is_demo AND x->>'mapping_status'='mapped'
 ON CONFLICT(source_key,market,ticker) DO UPDATE SET name=EXCLUDED.name,instrument_type=EXCLUDED.instrument_type,
  eligible=EXCLUDED.eligible,exclusion_reason=EXCLUDED.exclusion_reason,aliases=EXCLUDED.aliases,
  provider=EXCLUDED.provider,provider_company_id=EXCLUDED.provider_company_id,mapping_ticker=EXCLUDED.mapping_ticker,
  mapping_source_sha256=EXCLUDED.mapping_source_sha256,
  mapping_status=CASE WHEN universe_listings.mapping_status='conflict' OR universe_listings.provider_company_id IS NOT NULL
   AND EXCLUDED.provider_company_id IS NOT NULL AND (universe_listings.provider,universe_listings.provider_company_id)
    IS DISTINCT FROM (EXCLUDED.provider,EXCLUDED.provider_company_id) THEN 'conflict' ELSE EXCLUDED.mapping_status END,
  company_id=CASE WHEN universe_listings.mapping_status='conflict' OR universe_listings.provider_company_id IS NOT NULL
   AND EXCLUDED.provider_company_id IS NOT NULL AND (universe_listings.provider,universe_listings.provider_company_id)
    IS DISTINCT FROM (EXCLUDED.provider,EXCLUDED.provider_company_id) THEN NULL ELSE EXCLUDED.company_id END,
  listing_status='current',snapshot_id=EXCLUDED.snapshot_id,source_row=EXCLUDED.source_row,evidence=EXCLUDED.evidence,last_seen_at=now();
 UPDATE app_private.universe_listings SET listing_status='missing_from_latest'
 WHERE source_key=s.source_key AND snapshot_id<>s.id AND listing_status='current';
 SELECT jsonb_build_object('listings',count(*),'eligible',count(*) FILTER(WHERE eligible),
  'mapped',count(*) FILTER(WHERE eligible AND mapping_status='mapped'),
  'unresolved',count(*) FILTER(WHERE eligible AND mapping_status<>'mapped'),
  'excluded',count(*) FILTER(WHERE NOT eligible AND exclusion_reason<>'instrument_classification_unresolved'),
  'classification_pending',count(*) FILTER(WHERE NOT eligible AND exclusion_reason='instrument_classification_unresolved'),
  'registered',count(*) FILTER(WHERE eligible AND company_id IS NOT NULL))
 INTO v_counts FROM app_private.universe_listings WHERE source_key=s.source_key AND snapshot_id=s.id;
 UPDATE app_private.universe_snapshots SET status='applied',applied_at=now(),counts=v_counts,error_code=NULL WHERE id=s.id;
 UPDATE app_private.universe_sources SET latest_snapshot_id=s.id,last_success_at=now() WHERE source_key=s.source_key;
 DELETE FROM app_private.universe_chunks WHERE snapshot_id=s.id;
 RETURN jsonb_build_object('status','applied','counts',v_counts);
END $$;
CREATE FUNCTION public.sb_universe_fail(h text,code text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF coalesce(code,'')!~'^[a-z0-9_]{1,80}$' THEN RAISE EXCEPTION 'invalid_universe_error' USING ERRCODE='PT422';END IF;
 UPDATE app_private.universe_snapshots SET status='failed',error_code=code,expires_at=NULL WHERE token_hash=h AND status='running';
END $$;

-- Bounded, idempotent issuer activation. Existing company identity/ticker/name and
-- human approvals are preserved; multiple share classes attach to the same issuer.
CREATE FUNCTION public.sb_universe_register(batch_size integer DEFAULT 50) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r record;v_company_id text;created integer:=0;attached integer:=0;n integer;BEGIN
 IF batch_size IS NULL OR batch_size NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'invalid_universe_batch' USING ERRCODE='PT422';END IF;
 PERFORM pg_advisory_xact_lock(20261104,51);
 FOR r IN SELECT DISTINCT ON(l.provider,l.provider_company_id) l.provider,l.provider_company_id,d.name,l.mapping_ticker,l.market
  FROM app_private.universe_listings l JOIN app_private.universe_snapshots s ON s.id=l.snapshot_id
  JOIN app_private.company_directory d ON d.provider=l.provider AND d.provider_company_id=l.provider_company_id
   AND d.ticker=l.mapping_ticker AND d.active
  JOIN app_private.company_directory_sources ds ON ds.provider=d.provider AND ds.source_sha256=d.source_sha256 AND ds.last_success_at>now()-interval '7 days'
  WHERE l.listing_status='current' AND l.eligible AND l.mapping_status='mapped' AND l.company_id IS NULL
   AND s.status='applied' AND s.fetched_at>now()-interval '7 days'
   AND EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='signalbrief-raw' AND o.name=ds.raw_object_key)
  ORDER BY l.provider,l.provider_company_id,
   CASE WHEN l.instrument_type IN ('common_stock','ordinary_shares','common_shares','listed_issuer','equity_share') THEN 0
    WHEN l.instrument_type IN ('adr','depositary_receipt','reit','closed_end_fund','bdc','business_development_company','partnership_or_trust_equity','reit_equity') THEN 1 ELSE 2 END,
   l.market,l.ticker LIMIT batch_size
 LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended(r.provider||':'||r.provider_company_id,0));
  INSERT INTO public.companies(id,name,ticker,market,provider,provider_company_id,is_demo,created_at)
  VALUES(gen_random_uuid()::text,r.name,r.mapping_ticker,r.market,r.provider,r.provider_company_id,false,now())
  ON CONFLICT(provider,provider_company_id) DO NOTHING;
  GET DIAGNOSTICS n=ROW_COUNT;created:=created+n;
  SELECT c.id INTO v_company_id FROM public.companies c WHERE c.provider=r.provider AND c.provider_company_id=r.provider_company_id AND NOT c.is_demo;
  IF v_company_id IS NOT NULL THEN
   UPDATE app_private.universe_listings SET company_id=v_company_id
   WHERE provider=r.provider AND provider_company_id=r.provider_company_id AND mapping_status='mapped';
   GET DIAGNOSTICS n=ROW_COUNT;attached:=attached+n;
  END IF;
 END LOOP;
 RETURN jsonb_build_object('created_issuers',created,'attached_listings',attached,
  'remaining_issuers',(SELECT count(DISTINCT(provider,provider_company_id)) FROM app_private.universe_listings
   WHERE listing_status='current' AND eligible AND mapping_status='mapped' AND company_id IS NULL));
END $$;

CREATE FUNCTION public.sb_universe_coverage() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;u uuid:=(SELECT auth.uid());tz text;today date;BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=auth.uid()) THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='PT401';END IF;
 PERFORM public.sb_require_mfa();PERFORM public.sb_rate_limit();
 SELECT coalesce(w.value->>'timezone','Asia/Seoul') INTO tz FROM public.workspace_preferences w WHERE w.user_id=u::text;
 tz:=coalesce(tz,'Asia/Seoul');
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=tz) THEN tz:='Asia/Seoul';END IF;
 today:=(now() AT TIME ZONE tz)::date;
 WITH current_listings AS MATERIALIZED(SELECT * FROM app_private.universe_listings WHERE listing_status='current'),
 filings AS MATERIALIZED(SELECT company_id FROM public.us_filings UNION SELECT company_id FROM public.dart_filings),
 approved AS MATERIALIZED(SELECT DISTINCT company_id FROM app_private.sb_approved_filing_analyses()),
 pending AS MATERIALIZED(SELECT f.company_id FROM public.us_analyses a JOIN public.us_filings f ON f.id=a.filing_id WHERE a.status='needs_review'
  UNION SELECT f.company_id FROM public.dart_analyses a JOIN public.dart_filings f ON f.id=a.filing_id WHERE a.status='needs_review'),
 calendars AS MATERIALIZED(SELECT DISTINCT c.company_id FROM public.calendar_items c WHERE c.company_id IS NOT NULL
  AND c.occurs_on>=today AND (c.user_id IS NULL OR c.user_id=u::text)
  AND c.calendar_status='confirmed' AND app_private.sb_calendar_confirmed(c.id)),
 markets AS(SELECT l.market,count(*) listings,count(*) FILTER(WHERE l.eligible) eligible_listings,
  count(*) FILTER(WHERE NOT l.eligible AND l.exclusion_reason<>'instrument_classification_unresolved') excluded_listings,
  count(*) FILTER(WHERE NOT l.eligible AND l.exclusion_reason='instrument_classification_unresolved') classification_pending_listings,
  count(*) FILTER(WHERE l.eligible AND l.mapping_status<>'mapped') unresolved_listings,
  count(DISTINCT(l.provider,l.provider_company_id)) FILTER(WHERE l.eligible AND l.mapping_status='mapped') mapped_issuers,
  count(DISTINCT l.company_id) FILTER(WHERE l.eligible) registered_issuers,
  count(DISTINCT l.company_id) FILTER(WHERE l.eligible AND f.company_id IS NOT NULL) issuers_with_filings,
  count(DISTINCT l.company_id) FILTER(WHERE l.eligible AND a.company_id IS NOT NULL) issuers_with_approved_analysis,
  count(DISTINCT l.company_id) FILTER(WHERE l.eligible AND p.company_id IS NOT NULL) issuers_with_pending_review,
  count(DISTINCT l.company_id) FILTER(WHERE l.eligible AND cal.company_id IS NOT NULL) issuers_with_upcoming_calendar
  FROM current_listings l LEFT JOIN filings f ON f.company_id=l.company_id LEFT JOIN approved a ON a.company_id=l.company_id
  LEFT JOIN pending p ON p.company_id=l.company_id LEFT JOIN calendars cal ON cal.company_id=l.company_id GROUP BY l.market)
 SELECT jsonb_build_object('as_of',now(),'calendar_today',today,'calendar_timezone',tz,'markets',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY market) FROM markets x),'[]'::jsonb),
  'sources',(SELECT jsonb_agg(jsonb_build_object('source_key',s.source_key,'source_url',s.source_url,'coverage_scope',s.coverage_scope,
   'as_of',snap.as_of,'fetched_at',snap.fetched_at,'status',CASE WHEN snap.id IS NULL THEN 'not_imported' WHEN snap.fetched_at<now()-interval '72 hours' THEN 'stale' ELSE 'ready' END,
   'listings',snap.row_count) ORDER BY s.source_key) FROM app_private.universe_sources s LEFT JOIN app_private.universe_snapshots snap ON snap.id=s.latest_snapshot_id),
  'limits',jsonb_build_object('provider_daily_calls',500,'model_daily_calls',20,
   'model_daily_budget_usd',(SELECT value FROM app_private.us_config WHERE key='ai_daily_budget_usd'),
   'human_approval_required',true),
  'usage',coalesce((SELECT jsonb_agg(jsonb_build_object('provider',provider,'calls',calls,'reserved_usd',reserved_usd) ORDER BY provider)
   FROM app_private.us_usage WHERE day=current_date AND provider IN ('sec','dart','openai')),'[]'::jsonb)) INTO result;
 RETURN result;
END $$;

-- Reuse the exact existing discovery response contract. Current official listings
-- classify generic KR entries, and registered share-class aliases open the same
-- canonical issuer. Unresolved identities never acquire an activatable company ID.
CREATE OR REPLACE FUNCTION app_content_private.discovery_search_filtered(q text,p jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid:=(SELECT auth.uid());result jsonb;selected_provider text;selected_market text;selected_group text;BEGIN
 IF u IS NULL OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=u) THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='PT401';END IF;
 PERFORM public.sb_require_mfa();PERFORM public.sb_rate_limit();
 IF q IS NULL OR length(trim(q)) NOT BETWEEN 1 AND 100 OR app_private.sb_search_normalize(q)='' THEN RAISE EXCEPTION 'invalid_query' USING ERRCODE='PT422';END IF;
 IF p IS NULL OR jsonb_typeof(p)<>'object' OR p-'provider'-'market'-'market_group'<>'{}'::jsonb
  OR EXISTS(SELECT 1 FROM jsonb_each(p) WHERE jsonb_typeof(value)<>'string') THEN RAISE EXCEPTION 'invalid_filter' USING ERRCODE='PT422';END IF;
 selected_provider:=coalesce(p->>'provider','');selected_market:=upper(btrim(coalesce(p->>'market','')));selected_group:=coalesce(p->>'market_group','all');
 IF selected_provider NOT IN ('','sec','dart') OR selected_group NOT IN ('all','kospi','kosdaq','overseas','unclassified')
  OR length(selected_market)>32 OR (selected_market<>'' AND selected_market!~'^[A-Z0-9가-힣 :._-]+$') THEN RAISE EXCEPTION 'invalid_filter' USING ERRCODE='PT422';END IF;
 WITH listings AS MATERIALIZED(
  SELECT l.*,d.official_english_name FROM app_private.universe_listings l
  JOIN app_private.universe_snapshots snap ON snap.id=l.snapshot_id AND snap.status='applied' AND snap.fetched_at>now()-interval '7 days'
  JOIN app_private.company_directory d ON d.provider=l.provider AND d.provider_company_id=l.provider_company_id AND d.ticker=l.mapping_ticker AND d.active
  JOIN app_private.company_directory_sources ds ON ds.provider=d.provider AND ds.source_sha256=d.source_sha256 AND ds.last_success_at>now()-interval '7 days'
  WHERE l.listing_status='current' AND l.eligible AND l.mapping_status='mapped'
   AND EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='signalbrief-raw' AND o.name=ds.raw_object_key)
 ), registry_rows AS(
  SELECT d.provider,d.provider_company_id,d.ticker,d.name,d.official_english_name,
   coalesce(l.market,nullif(c.market,''),d.market) market,c.id company_id
  FROM app_private.company_directory d LEFT JOIN public.companies c
   ON c.provider=d.provider AND c.provider_company_id=d.provider_company_id AND NOT c.is_demo
  LEFT JOIN LATERAL(SELECT x.market FROM listings x WHERE x.provider=d.provider AND x.provider_company_id=d.provider_company_id
   AND (x.ticker=d.ticker OR x.aliases ? d.ticker) ORDER BY (x.ticker=d.ticker) DESC,x.market LIMIT 1) l ON true
  WHERE d.active AND (selected_provider='' OR d.provider=selected_provider)
  UNION ALL
  SELECT l.provider,l.provider_company_id,l.ticker,l.name,l.official_english_name,l.market,c.id
  FROM listings l JOIN public.companies c ON c.id=l.company_id AND c.provider=l.provider AND c.provider_company_id=l.provider_company_id AND NOT c.is_demo
  WHERE (selected_provider='' OR l.provider=selected_provider)
   AND NOT EXISTS(SELECT 1 FROM app_private.company_directory d WHERE d.provider=l.provider AND d.provider_company_id=l.provider_company_id AND d.ticker=l.ticker AND d.active)
 ), registry AS MATERIALIZED(
  SELECT DISTINCT ON(provider,provider_company_id,ticker) *,CASE WHEN provider='sec' THEN 'overseas'
   WHEN upper(market) IN ('KOSPI','코스피','KRX:KOSPI') THEN 'kospi' WHEN upper(market) IN ('KOSDAQ','코스닥','KRX:KOSDAQ') THEN 'kosdaq'
   ELSE 'unclassified' END market_group FROM registry_rows ORDER BY provider,provider_company_id,ticker,market
 ), matches AS MATERIALIZED(
  SELECT provider,provider_company_id,ticker,name,market,company_id,
   CASE WHEN lower(ticker)=lower(btrim(q)) THEN -1
    WHEN app_private.sb_search_normalize(ticker)=app_private.sb_search_normalize(q) THEN 0
    WHEN app_private.sb_search_normalize(name)=app_private.sb_search_normalize(q)
     OR app_private.sb_search_normalize(official_english_name)=app_private.sb_search_normalize(q) THEN 1 ELSE 2 END rank
  FROM registry d WHERE (selected_market='' OR upper(d.market)=selected_market)
   AND (selected_group='all' OR d.market_group=selected_group)
   AND EXISTS(SELECT 1 FROM unnest(app_private.sb_search_terms(q)) term
    WHERE position(app_private.sb_search_normalize(term) IN app_private.sb_search_normalize(concat_ws(' ',d.name,d.ticker,d.official_english_name)))>0)
 ) SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(to_jsonb(x)-'rank') FROM
  (SELECT * FROM matches ORDER BY rank,name,ticker LIMIT 30)x),'[]'::jsonb),'total',(SELECT count(*) FROM matches),
  'source_status',CASE WHEN (SELECT count(*) FROM app_private.company_directory_sources WHERE last_success_at>now()-interval '72 hours' AND error_code IS NULL)=2 THEN 'ready'
   WHEN EXISTS(SELECT 1 FROM app_private.company_directory WHERE active) THEN 'partial' ELSE 'unavailable' END,
  'sources',(SELECT jsonb_agg(jsonb_build_object('provider',provider,'source_url',source_url,'last_success_at',last_success_at,'error_code',error_code)) FROM app_private.company_directory_sources)) INTO result;
 RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.sb_universe_stage(text),public.sb_universe_chunk(uuid,integer,text),public.sb_universe_worker_ready(text),
 public.sb_universe_dispatch(uuid),public.sb_universe_claim(text),public.sb_universe_finish(text,text,text,text,text),public.sb_universe_fail(text,text),
 public.sb_universe_register(integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.sb_universe_manifest_begin(text,integer,integer),public.sb_universe_manifest_part(text,integer,text),public.sb_universe_manifest_commit(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sb_universe_manifest_begin(text,integer,integer),public.sb_universe_manifest_part(text,integer,text),public.sb_universe_manifest_commit(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.sb_universe_stage(text),public.sb_universe_chunk(uuid,integer,text),public.sb_universe_worker_ready(text),
 public.sb_universe_dispatch(uuid),public.sb_universe_claim(text),public.sb_universe_finish(text,text,text,text,text),public.sb_universe_fail(text,text),
 public.sb_universe_register(integer) TO service_role;
REVOKE ALL ON FUNCTION public.sb_universe_coverage() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.sb_universe_coverage() TO authenticated;
NOTIFY pgrst,'reload schema';
