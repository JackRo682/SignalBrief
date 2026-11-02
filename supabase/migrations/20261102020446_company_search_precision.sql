-- Company identity search prefers exact identities and complete Latin words.
-- Evidence/document full-text search is deliberately unchanged.
CREATE FUNCTION app_private.sb_company_search_rank(q text,company_name text,ticker text,official_names text DEFAULT '') RETURNS integer
LANGUAGE sql IMMUTABLE PARALLEL SAFE SECURITY INVOKER SET search_path='' AS $$
 WITH terms AS (
  SELECT app_private.sb_search_normalize(term) AS compact,
   btrim(regexp_replace(lower(normalize(term,NFKC)),'[^a-z0-9]+',' ','g')) AS words,
   lower(normalize(term,NFKC)) ~ '[a-z]' AND lower(normalize(term,NFKC)) !~ '[^a-z0-9[:space:][:punct:]]' AS latin
  FROM unnest(app_private.sb_search_terms(q)) term
 ),names AS (
  SELECT app_private.sb_search_normalize(value) AS compact,
   ' '||btrim(regexp_replace(lower(normalize(coalesce(value,''),NFKC)),'[^a-z0-9]+',' ','g'))||' ' AS words
  FROM unnest(ARRAY[company_name,official_names]) value
 ) SELECT coalesce(min(CASE
  WHEN t.compact='' THEN 9
  WHEN t.compact=app_private.sb_search_normalize(ticker) THEN 0
  WHEN EXISTS(SELECT 1 FROM names n WHERE n.compact=t.compact) THEN 1
  WHEN t.latin AND t.words<>'' AND EXISTS(SELECT 1 FROM names n WHERE position(' '||t.words||' ' IN n.words)>0) THEN 2
  WHEN position(t.compact IN app_private.sb_search_normalize(concat_ws(' ',company_name,ticker,official_names)))>0 THEN 3
  ELSE 9 END),9) FROM terms t
$$;
REVOKE ALL ON FUNCTION app_private.sb_company_search_rank(text,text,text,text) FROM PUBLIC,anon,authenticated;

DO $migration$
DECLARE definition text; old_expression text; new_expression text; start_at integer; end_at integer;
BEGIN
 definition:=pg_get_functiondef('app_content_private.discovery_search_filtered(text,jsonb)'::regprocedure);
 old_expression:=$old$ ),matches AS MATERIALIZED (
  SELECT provider,provider_company_id,ticker,name,market,company_id,
   CASE WHEN app_private.sb_search_normalize(ticker)=app_private.sb_search_normalize(q) THEN 0
    WHEN app_private.sb_search_normalize(name)=app_private.sb_search_normalize(q)
     OR app_private.sb_search_normalize(official_english_name)=app_private.sb_search_normalize(q) THEN 1 ELSE 2 END AS rank
  FROM registry d WHERE (selected_market='' OR upper(d.market)=selected_market)
   AND (selected_group='all' OR d.market_group=selected_group)
   AND EXISTS(SELECT 1 FROM unnest(app_private.sb_search_terms(q)) term
    WHERE position(app_private.sb_search_normalize(term) IN app_private.sb_search_normalize(concat_ws(' ',d.name,d.ticker,d.official_english_name)))>0)
 ) SELECT jsonb_build_object$old$;
 new_expression:=$new$ ),scoped AS MATERIALIZED (
  SELECT * FROM registry d WHERE (selected_market='' OR upper(d.market)=selected_market)
   AND (selected_group='all' OR d.market_group=selected_group)
 ),ranked AS MATERIALIZED (
  SELECT provider,provider_company_id,ticker,name,market,company_id,
   app_private.sb_company_search_rank(q,name,ticker,official_english_name) AS rank FROM scoped
 ),matches AS MATERIALIZED (
  SELECT * FROM ranked WHERE rank<9 AND (
   NOT(lower(normalize(q,NFKC)) ~ '[a-z]' AND lower(normalize(q,NFKC)) !~ '[^a-z0-9[:space:][:punct:]]')
   OR rank<=(CASE WHEN EXISTS(SELECT 1 FROM ranked strong WHERE strong.rank=0) THEN 0
    WHEN EXISTS(SELECT 1 FROM ranked strong WHERE strong.rank<3) THEN 2 ELSE 3 END))
 ) SELECT jsonb_build_object$new$;
 IF length(definition)-length(replace(definition,old_expression,''))<>length(old_expression) THEN RAISE EXCEPTION 'discovery_precision_precondition_failed'; END IF;
 EXECUTE replace(definition,old_expression,new_expression);

 definition:=pg_get_functiondef('app_content_private.redesign(text,jsonb)'::regprocedure);
 old_expression:=$old$  ),matched AS MATERIALIZED ($old$;
 start_at:=strpos(definition,old_expression);
 end_at:=strpos(substring(definition FROM start_at),$end$  ) SELECT jsonb_build_object(
   'items',$end$);
 IF start_at=0 OR end_at=0 OR strpos(substring(definition FROM start_at+length(old_expression)),old_expression)>0
  OR strpos(substring(definition FROM 1 FOR start_at),$directory$ELSIF action='design_directory' THEN$directory$)=0
  THEN RAISE EXCEPTION 'registered_precision_precondition_failed'; END IF;
 old_expression:=substring(definition FROM start_at FOR end_at-1);
 new_expression:=$new$  ),scoped AS MATERIALIZED (
   SELECT c.* FROM companies c WHERE selected_market_group='all' OR c.market_group=selected_market_group
  ),ranked AS MATERIALIZED (
   SELECT c.*,app_private.sb_company_search_rank(q,c.company_name,c.ticker,app_private.sb_company_official_search_names(c.company_id)) AS search_rank FROM scoped c
  ),official_scoped AS MATERIALIZED (
   SELECT d.name,d.ticker,d.official_english_name,CASE WHEN d.provider='sec' THEN 'overseas'
    WHEN upper(coalesce(nullif(registered.market,''),d.market)) IN ('KOSPI','코스피','KRX:KOSPI') THEN 'kospi'
    WHEN upper(coalesce(nullif(registered.market,''),d.market)) IN ('KOSDAQ','코스닥','KRX:KOSDAQ') THEN 'kosdaq'
    ELSE 'unclassified' END AS market_group
   FROM app_private.company_directory d LEFT JOIN public.companies registered
    ON registered.provider=d.provider AND registered.provider_company_id=d.provider_company_id AND NOT registered.is_demo
   WHERE d.active AND q<>'' AND lower(normalize(q,NFKC)) ~ '[a-z]' AND lower(normalize(q,NFKC)) !~ '[^a-z0-9[:space:][:punct:]]'
  ),official_ranked AS MATERIALIZED (
   SELECT app_private.sb_company_search_rank(q,name,ticker,official_english_name) AS search_rank
   FROM official_scoped WHERE selected_market_group='all' OR market_group=selected_market_group
  ),matched AS MATERIALIZED (
   SELECT c.* FROM ranked c WHERE q='' OR c.search_rank<9 AND (
    NOT(lower(normalize(q,NFKC)) ~ '[a-z]' AND lower(normalize(q,NFKC)) !~ '[^a-z0-9[:space:][:punct:]]')
    OR c.search_rank<=(CASE WHEN EXISTS(SELECT 1 FROM ranked strong WHERE strong.search_rank=0)
     OR EXISTS(SELECT 1 FROM official_ranked strong WHERE strong.search_rank=0) THEN 0
     WHEN EXISTS(SELECT 1 FROM ranked strong WHERE strong.search_rank<3)
      OR EXISTS(SELECT 1 FROM official_ranked strong WHERE strong.search_rank<3) THEN 2 ELSE 3 END))
$new$;
 definition:=replace(definition,old_expression,new_expression);
 old_expression:=$old$to_jsonb(x)-'market_group'$old$;
 IF length(definition)-length(replace(definition,old_expression,''))<>length(old_expression) THEN RAISE EXCEPTION 'registered_precision_projection_precondition_failed'; END IF;
 definition:=replace(definition,old_expression,$new$to_jsonb(x)-'market_group'-'search_rank'$new$);
 old_expression:=$old$SELECT * FROM matched ORDER BY company_name,id$old$;
 IF length(definition)-length(replace(definition,old_expression,''))<>length(old_expression) THEN RAISE EXCEPTION 'registered_precision_order_precondition_failed'; END IF;
 EXECUTE replace(definition,old_expression,$new$SELECT * FROM matched ORDER BY search_rank,company_name,id$new$);
END $migration$;
NOTIFY pgrst,'reload schema';
