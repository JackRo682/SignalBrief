-- DART interim IS/CIS amounts and accumulated periods must travel together.
-- Apply this guard before deploying the v2 parser: v1 duration facts are hidden
-- immediately, while their immutable originals and valid BS facts remain.
CREATE FUNCTION app_content_private.financial_parser_version(provider text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SET search_path='' AS $$
 SELECT CASE provider WHEN 'sec' THEN 'reported-financials-v1' WHEN 'dart' THEN 'reported-financials-dart-v2' END
$$;
REVOKE ALL ON FUNCTION app_content_private.financial_parser_version(text) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION app_content_private.dart_financial_dates(label text,instant boolean) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE part text[];dates date[]:=ARRAY[]::date[];parsed date;
BEGIN
 FOR part IN SELECT regexp_matches(label,'([0-9]{4})[.\-/]([0-9]{1,2})[.\-/]([0-9]{1,2})','g') LOOP
  BEGIN parsed:=make_date(part[1]::integer,part[2]::integer,part[3]::integer);
  EXCEPTION WHEN datetime_field_overflow THEN parsed:=NULL;END;
  dates:=array_append(dates,parsed);
 END LOOP;
 IF instant AND cardinality(dates)=1 AND dates[1] IS NOT NULL THEN
  RETURN jsonb_build_object('start',NULL,'end',to_char(dates[1],'YYYY-MM-DD'));
 ELSIF NOT instant AND cardinality(dates)=2 AND dates[1] IS NOT NULL AND dates[2] IS NOT NULL AND dates[1]<=dates[2] THEN
  RETURN jsonb_build_object('start',to_char(dates[1],'YYYY-MM-DD'),'end',to_char(dates[2],'YYYY-MM-DD'));
 END IF;
 -- Preserve an unfamiliar official label without inventing quarter dates.
 RETURN jsonb_build_object('start',NULL,'end',NULL);
END $$;
REVOKE ALL ON FUNCTION app_content_private.dart_financial_dates(text,boolean) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION app_content_private.dart_financial_fact_valid(item jsonb,quote jsonb,corp text,ticker text,source_url text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE term text;amount_key text;amount text;instant boolean;dates jsonb;
BEGIN
 IF jsonb_typeof(quote) IS DISTINCT FROM 'object' OR coalesce(quote->>'sj_div','') NOT IN ('BS','IS','CIS')
  OR coalesce(quote->>'reprt_code','') NOT IN ('11011','11012','11013','11014')
  OR coalesce(quote->>'bsns_year','')!~'^20[0-9]{2}$'
  OR coalesce(item->>'location','')!~'^/list/[0-9]+/(thstrm|frmtrm)(_add)?_amount$'
 THEN RETURN false;END IF;
 term:=split_part(split_part(item->>'location','/',4),'_',1);
 instant:=quote->>'sj_div'='BS';
 amount_key:=term||CASE WHEN NOT instant AND quote->>'reprt_code'<>'11011' THEN '_add_amount' ELSE '_amount' END;
 amount:=trim(quote->>amount_key);
 IF split_part(item->>'location','/',4) IS DISTINCT FROM amount_key
  OR coalesce(amount,'')!~'^-?([0-9]{1,3}(,[0-9]{3})+|[0-9]+)([.][0-9]+)?$' OR length(amount)>150
 THEN RETURN false;END IF;
 dates:=app_content_private.dart_financial_dates(trim(quote->>(term||'_dt')),instant);
 RETURN item->>'taxonomy' IS NOT DISTINCT FROM 'dart'
  AND quote->>'stock_code' IS NOT DISTINCT FROM ticker
  AND (NOT quote ? 'corp_code' OR quote->>'corp_code' IS NOT DISTINCT FROM corp)
  AND item->>'concept' IS NOT DISTINCT FROM quote->>'account_nm'
  AND item->>'label' IS NOT DISTINCT FROM quote->>'account_nm'
  AND item->>'scope' IS NOT DISTINCT FROM (CASE quote->>'fs_div' WHEN 'CFS' THEN 'consolidated' WHEN 'OFS' THEN 'separate' END)
  AND coalesce(quote->>'fs_div','') IN ('CFS','OFS')
  AND item->>'unit' IS NOT DISTINCT FROM quote->>'currency'
  AND coalesce(quote->>'currency','')~'^[A-Z]{3}$'
  AND replace(amount,',','')::numeric=(item->>'value_raw')::numeric
  AND item->>'period_label' IS NOT DISTINCT FROM trim(quote->>(term||'_dt'))
  AND item->>'period_kind' IS NOT DISTINCT FROM (CASE WHEN instant THEN 'instant' ELSE 'duration' END)
  AND item->>'period_start' IS NOT DISTINCT FROM dates->>'start'
  AND item->>'period_end' IS NOT DISTINCT FROM dates->>'end'
  AND item->>'fiscal_period' IS NOT DISTINCT FROM quote->>'reprt_code'
  AND item->'fiscal_year' IS NOT DISTINCT FROM (CASE WHEN term='thstrm' THEN to_jsonb((quote->>'bsns_year')::integer) ELSE 'null'::jsonb END)
  AND item->>'accounting_standard' IS NULL AND item->>'filed_on' IS NULL
  AND item->>'accession' IS NOT DISTINCT FROM quote->>'rcept_no'
  AND coalesce(item->>'accession','')~'^[0-9]{14}$'
  AND item->>'form' IS NOT DISTINCT FROM quote->>'reprt_code'
  AND item->>'source_url' IS NOT DISTINCT FROM ('https://dart.fss.or.kr/dsaf001/main.do?rcpNo='||(quote->>'rcept_no'))
  AND source_url IS NOT DISTINCT FROM ('https://opendart.fss.or.kr/api/fnlttSinglAcnt.json?corp_code='||corp||'&bsns_year='||(quote->>'bsns_year')||'&reprt_code='||(quote->>'reprt_code'));
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN false;
END $$;
REVOKE ALL ON FUNCTION app_content_private.dart_financial_fact_valid(jsonb,jsonb,text,text,text) FROM PUBLIC,anon,authenticated;

DO $upgrade$
BEGIN
 -- Serialize source/version selection with a finishing worker; keep its lease.
 LOCK TABLE app_private.company_financial_sources,app_private.company_financial_snapshots IN SHARE ROW EXCLUSIVE MODE;
 ALTER TABLE app_private.company_financial_sources ADD COLUMN latest_parser_version text;
 UPDATE app_private.company_financial_sources s SET latest_parser_version=f.parser_version
 FROM app_private.company_financial_snapshots f WHERE f.company_id=s.company_id AND f.raw_sha256=s.latest_sha256;
 ALTER TABLE app_private.company_financial_snapshots DROP CONSTRAINT company_financial_snapshots_pkey;
 ALTER TABLE app_private.company_financial_snapshots ADD PRIMARY KEY(company_id,raw_sha256,parser_version);
END $upgrade$;

DO $admin$
DECLARE definition text;patch record;old_block text;start_at integer;end_at integer;
BEGIN
 SELECT pg_get_functiondef('app_content_private.company_financial_admin(text,jsonb)'::regprocedure) INTO definition;
 FOR patch IN SELECT * FROM (VALUES
  ('snap.raw_sha256=s.latest_sha256',
   'snap.raw_sha256=s.latest_sha256 AND snap.parser_version=s.latest_parser_version AND snap.parser_version=app_content_private.financial_parser_version(c.provider)'),
  ('p->>''parser_version'' IS DISTINCT FROM ''reported-financials-v1''',
   'p->>''parser_version'' IS DISTINCT FROM app_content_private.financial_parser_version(c.provider)'),
  ('WHERE company_id=c.id AND raw_sha256=body->>''raw_sha256'';',
   'WHERE company_id=c.id AND raw_sha256=body->>''raw_sha256'' AND parser_version=p->>''parser_version'';'),
  ('WHERE company_id=c.id AND raw_sha256=s.latest_sha256',
   'WHERE company_id=c.id AND raw_sha256=s.latest_sha256 AND parser_version=s.latest_parser_version AND parser_version=p->>''parser_version'''),
  ('latest_sha256=body->>''raw_sha256'',error_code=NULL',
   'latest_sha256=body->>''raw_sha256'',latest_parser_version=p->>''parser_version'',error_code=NULL')
 ) AS changes(before,after) LOOP
  IF (length(definition)-length(replace(definition,patch.before,'')))/length(patch.before)<>1 THEN
   RAISE EXCEPTION 'financial_period_admin_definition_changed';END IF;
  definition:=replace(definition,patch.before,patch.after);
 END LOOP;
 start_at:=strpos(definition,'    term:=CASE WHEN item->>''location''~''/thstrm_amount$''');
 IF start_at=0 THEN RAISE EXCEPTION 'financial_period_quote_definition_changed';END IF;
 end_at:=strpos(substring(definition FROM start_at),E'   END IF;\n  END LOOP;');
 IF end_at=0 THEN RAISE EXCEPTION 'financial_period_quote_definition_changed';END IF;
 old_block:=substring(definition FROM start_at FOR end_at-1);
 IF strpos(old_block,'quote->>(term||''_amount'')')=0 OR strpos(old_block,'financial_quote_mismatch')=0
  OR strpos(old_block,'fnlttSinglAcnt.json')=0 THEN RAISE EXCEPTION 'financial_period_quote_definition_changed';END IF;
 definition:=replace(definition,old_block,E'    IF NOT coalesce(app_content_private.dart_financial_fact_valid(item,quote,c.provider_company_id,c.ticker,body->>''source_url''),false) THEN\n     RAISE EXCEPTION ''financial_quote_mismatch'' USING ERRCODE=''PT422'';END IF;\n');
 EXECUTE definition;
END $admin$;

DO $read$
DECLARE definition text;patch record;
BEGIN
 SELECT pg_get_functiondef('app_content_private.company_financials(text)'::regprocedure) INTO definition;
 FOR patch IN SELECT * FROM (VALUES
  ('request app_private.company_analysis_requests%rowtype;',
   'request app_private.company_analysis_requests%rowtype;revalidation boolean:=false;'),
  ('f.raw_sha256=s.latest_sha256',
   'f.raw_sha256=s.latest_sha256 AND f.parser_version=s.latest_parser_version'),
  (' SELECT count(*) INTO approved',
   E' IF c.provider=''dart'' AND source IS NOT NULL AND s.latest_parser_version<>''reported-financials-dart-v2'' THEN\n  revalidation:=true;\n  source:=jsonb_set(source,''{items}'',coalesce((SELECT jsonb_agg(item ORDER BY ordinal) FROM jsonb_array_elements(source->''items'') WITH ORDINALITY AS facts(item,ordinal) WHERE item->>''period_kind''=''instant'' AND app_content_private.dart_financial_fact_valid(item,(item->>''source_quote'')::jsonb,c.provider_company_id,c.ticker,source->>''source_url'')),''[]''::jsonb));\n END IF;\n SELECT count(*) INTO approved'),
  ('WHEN s.status IN (''pending'',''collecting'') THEN ''pending''',
   'WHEN revalidation THEN CASE WHEN s.status IN (''pending'',''collecting'') THEN ''pending'' ELSE ''unavailable'' END WHEN s.status IN (''pending'',''collecting'') THEN ''pending'''),
  ('''error_code'',CASE WHEN s.status=''ready'' AND source IS NULL',
   '''error_code'',CASE WHEN revalidation THEN ''financial_period_revalidation_required'' WHEN s.status=''ready'' AND source IS NULL')
 ) AS changes(before,after) LOOP
  IF (length(definition)-length(replace(definition,patch.before,'')))/length(patch.before)<>1 THEN
   RAISE EXCEPTION 'financial_period_read_definition_changed';END IF;
  definition:=replace(definition,patch.before,patch.after);
 END LOOP;
 EXECUTE definition;
END $read$;

-- Queue a normal bounded recollection. No source bytes or old snapshot changes.
-- An old in-flight worker retains its lease but cannot persist v1 DART results.
UPDATE app_private.company_financial_sources s
SET status=CASE WHEN s.lease_until>now() THEN s.status ELSE 'pending' END,
 requested_at=now(),attempt_count=0,error_code='financial_period_revalidation_required'
FROM public.companies c WHERE c.id=s.company_id AND c.provider='dart'
 AND s.latest_sha256 IS NOT NULL AND s.latest_parser_version IS DISTINCT FROM 'reported-financials-dart-v2';
NOTIFY pgrst,'reload schema';
