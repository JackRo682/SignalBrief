-- Prepare aliases once per request, then score only matching scoped candidates.
-- The earlier precision semantics, response shapes, freshness and auth gates stay intact.
-- No company activation, follow or event mutation is introduced by search.
DO $migration$
DECLARE definition text; old_expression text; new_expression text; marker text;
 start_at integer; end_at integer;
BEGIN
 definition:=pg_get_functiondef('app_content_private.discovery_search_filtered(text,jsonb)'::regprocedure);
 marker:=$marker$ ),scoped AS MATERIALIZED ($marker$;
 start_at:=strpos(definition,marker);
 end_at:=strpos(substring(definition FROM start_at),$end$ ) SELECT jsonb_build_object$end$);
 IF start_at=0 OR end_at=0 OR length(definition)-length(replace(definition,marker,''))<>length(marker)
  THEN RAISE EXCEPTION 'discovery_catalogue_precondition_failed'; END IF;
 old_expression:=substring(definition FROM start_at FOR end_at-1);
 IF strpos(old_expression,'app_private.sb_company_search_rank(q,name,ticker,official_english_name)')=0
  OR strpos(old_expression,'selected_group')=0 OR strpos(old_expression,'rank<=')=0
  THEN RAISE EXCEPTION 'discovery_catalogue_precision_missing'; END IF;
 new_expression:=$new$ ),query_terms AS MATERIALIZED (
   SELECT coalesce(array_agg(DISTINCT compact) FILTER(WHERE compact<>''),'{}'::text[]) AS compact_terms,
    coalesce(array_agg(DISTINCT words) FILTER(WHERE latin AND words<>''),'{}'::text[]) AS word_terms,
    lower(normalize(q,NFKC)) ~ '[a-z]' AND lower(normalize(q,NFKC)) !~ '[^a-z0-9[:space:][:punct:]]' AS latin_query
   FROM (
    SELECT app_private.sb_search_normalize(term) AS compact,
     btrim(regexp_replace(lower(normalize(term,NFKC)),'[^a-z0-9]+',' ','g')) AS words,
     lower(normalize(term,NFKC)) ~ '[a-z]' AND lower(normalize(term,NFKC)) !~ '[^a-z0-9[:space:][:punct:]]' AS latin
    FROM unnest(app_private.sb_search_terms(q)) term
   ) expanded
  ),scoped AS MATERIALIZED (
   SELECT * FROM registry d WHERE (selected_market='' OR upper(d.market)=selected_market)
    AND (selected_group='all' OR d.market_group=selected_group)
  ),searchable AS MATERIALIZED (
   SELECT d.*,app_private.sb_search_normalize(concat_ws(' ',d.name,d.ticker,d.official_english_name)) AS search_text FROM scoped d
  ),candidates AS MATERIALIZED (
   SELECT d.*,app_private.sb_search_normalize(d.name) AS normalized_name,
    app_private.sb_search_normalize(d.ticker) AS normalized_ticker,
    app_private.sb_search_normalize(d.official_english_name) AS normalized_official,
    ' '||btrim(regexp_replace(lower(normalize(coalesce(d.name,''),NFKC)),'[^a-z0-9]+',' ','g'))||' ' AS name_words,
    ' '||btrim(regexp_replace(lower(normalize(coalesce(d.official_english_name,''),NFKC)),'[^a-z0-9]+',' ','g'))||' ' AS official_words
   FROM searchable d CROSS JOIN query_terms t
   WHERE EXISTS(SELECT 1 FROM unnest(t.compact_terms) term WHERE position(term IN d.search_text)>0)
  ),ranked AS MATERIALIZED (
   SELECT d.provider,d.provider_company_id,d.ticker,d.name,d.market,d.company_id,
    CASE WHEN d.normalized_ticker=ANY(t.compact_terms) THEN 0
    WHEN d.normalized_name=ANY(t.compact_terms) OR d.normalized_official=ANY(t.compact_terms) THEN 1
    WHEN EXISTS(SELECT 1 FROM unnest(t.word_terms) words
     WHERE position(' '||words||' ' IN d.name_words)>0 OR position(' '||words||' ' IN d.official_words)>0) THEN 2 ELSE 3 END AS rank
   FROM candidates d CROSS JOIN query_terms t
  ),rank_limit AS MATERIALIZED (
   SELECT CASE WHEN min(rank)=0 THEN 0 WHEN min(rank)<3 THEN 2 ELSE 3 END AS threshold FROM ranked
  ),matches AS MATERIALIZED (
   SELECT d.* FROM ranked d CROSS JOIN query_terms t CROSS JOIN rank_limit r
   WHERE NOT t.latin_query OR d.rank<=r.threshold
$new$;
 EXECUTE replace(definition,old_expression,new_expression);

 definition:=pg_get_functiondef('app_content_private.redesign(text,jsonb)'::regprocedure);
 marker:=$marker$  ),scoped AS MATERIALIZED ($marker$;
 start_at:=strpos(definition,marker);
 end_at:=strpos(substring(definition FROM start_at),$end$  ) SELECT jsonb_build_object(
   'items',$end$);
 IF start_at=0 OR end_at=0 OR length(definition)-length(replace(definition,marker,''))<>length(marker)
  OR strpos(substring(definition FROM 1 FOR start_at),$directory$ELSIF action='design_directory' THEN$directory$)=0
  THEN RAISE EXCEPTION 'registered_catalogue_precondition_failed'; END IF;
 old_expression:=substring(definition FROM start_at FOR end_at-1);
 IF strpos(old_expression,'app_private.sb_company_search_rank(q,c.company_name,c.ticker,app_private.sb_company_official_search_names(c.company_id))')=0
  OR strpos(old_expression,'official_ranked')=0 OR strpos(old_expression,'c.search_rank<=')=0
  THEN RAISE EXCEPTION 'registered_catalogue_precision_missing'; END IF;
 new_expression:=$new$  ),query_terms AS MATERIALIZED (
   SELECT coalesce(array_agg(DISTINCT compact) FILTER(WHERE compact<>''),'{}'::text[]) AS compact_terms,
    coalesce(array_agg(DISTINCT words) FILTER(WHERE latin AND words<>''),'{}'::text[]) AS word_terms,
    lower(normalize(q,NFKC)) ~ '[a-z]' AND lower(normalize(q,NFKC)) !~ '[^a-z0-9[:space:][:punct:]]' AS latin_query
   FROM (
    SELECT app_private.sb_search_normalize(term) AS compact,
     btrim(regexp_replace(lower(normalize(term,NFKC)),'[^a-z0-9]+',' ','g')) AS words,
     lower(normalize(term,NFKC)) ~ '[a-z]' AND lower(normalize(term,NFKC)) !~ '[^a-z0-9[:space:][:punct:]]' AS latin
    FROM unnest(app_private.sb_search_terms(q)) term
   ) expanded
  ),scoped AS MATERIALIZED (
   SELECT c.* FROM companies c WHERE selected_market_group='all' OR c.market_group=selected_market_group
  ),registered_names AS MATERIALIZED (
   SELECT c.id,c.company_name AS name,c.ticker,
    CASE WHEN q='' THEN '' ELSE app_private.sb_company_official_search_names(c.company_id) END AS official_english_name
   FROM scoped c
  ),registered_searchable AS MATERIALIZED (
   SELECT d.*,CASE WHEN q='' THEN '' ELSE app_private.sb_search_normalize(concat_ws(' ',d.name,d.ticker,d.official_english_name)) END AS search_text
   FROM registered_names d
  ),registered_candidates AS MATERIALIZED (
   SELECT d.*,app_private.sb_search_normalize(d.name) AS normalized_name,
    app_private.sb_search_normalize(d.ticker) AS normalized_ticker,
    app_private.sb_search_normalize(d.official_english_name) AS normalized_official,
    ' '||btrim(regexp_replace(lower(normalize(coalesce(d.name,''),NFKC)),'[^a-z0-9]+',' ','g'))||' ' AS name_words,
    ' '||btrim(regexp_replace(lower(normalize(coalesce(d.official_english_name,''),NFKC)),'[^a-z0-9]+',' ','g'))||' ' AS official_words
   FROM registered_searchable d CROSS JOIN query_terms t
   WHERE q='' OR EXISTS(SELECT 1 FROM unnest(t.compact_terms) term WHERE position(term IN d.search_text)>0)
  ),registered_ranks AS MATERIALIZED (
   SELECT d.id,CASE WHEN q='' THEN 9 ELSE CASE WHEN d.normalized_ticker=ANY(t.compact_terms) THEN 0
    WHEN d.normalized_name=ANY(t.compact_terms) OR d.normalized_official=ANY(t.compact_terms) THEN 1
    WHEN EXISTS(SELECT 1 FROM unnest(t.word_terms) words
     WHERE position(' '||words||' ' IN d.name_words)>0 OR position(' '||words||' ' IN d.official_words)>0) THEN 2 ELSE 3 END END AS search_rank
   FROM registered_candidates d CROSS JOIN query_terms t
  ),ranked AS MATERIALIZED (
   SELECT c.*,r.search_rank FROM scoped c JOIN registered_ranks r ON r.id=c.id
  ),official_scoped AS MATERIALIZED (
   SELECT d.name,d.ticker,d.official_english_name,CASE WHEN d.provider='sec' THEN 'overseas'
    WHEN upper(coalesce(nullif(registered.market,''),d.market)) IN ('KOSPI','코스피','KRX:KOSPI') THEN 'kospi'
    WHEN upper(coalesce(nullif(registered.market,''),d.market)) IN ('KOSDAQ','코스닥','KRX:KOSDAQ') THEN 'kosdaq'
    ELSE 'unclassified' END AS market_group
   FROM app_private.company_directory d LEFT JOIN public.companies registered
    ON registered.provider=d.provider AND registered.provider_company_id=d.provider_company_id AND NOT registered.is_demo
   CROSS JOIN query_terms t WHERE d.active AND q<>'' AND t.latin_query
  ),official_searchable AS MATERIALIZED (
   SELECT d.*,app_private.sb_search_normalize(concat_ws(' ',d.name,d.ticker,d.official_english_name)) AS search_text
   FROM official_scoped d WHERE selected_market_group='all' OR d.market_group=selected_market_group
  ),official_candidates AS MATERIALIZED (
   SELECT d.*,app_private.sb_search_normalize(d.name) AS normalized_name,
    app_private.sb_search_normalize(d.ticker) AS normalized_ticker,
    app_private.sb_search_normalize(d.official_english_name) AS normalized_official,
    ' '||btrim(regexp_replace(lower(normalize(coalesce(d.name,''),NFKC)),'[^a-z0-9]+',' ','g'))||' ' AS name_words,
    ' '||btrim(regexp_replace(lower(normalize(coalesce(d.official_english_name,''),NFKC)),'[^a-z0-9]+',' ','g'))||' ' AS official_words
   FROM official_searchable d CROSS JOIN query_terms t
   WHERE EXISTS(SELECT 1 FROM unnest(t.compact_terms) term WHERE position(term IN d.search_text)>0)
  ),official_ranked AS MATERIALIZED (
   SELECT CASE WHEN d.normalized_ticker=ANY(t.compact_terms) THEN 0
    WHEN d.normalized_name=ANY(t.compact_terms) OR d.normalized_official=ANY(t.compact_terms) THEN 1
    WHEN EXISTS(SELECT 1 FROM unnest(t.word_terms) words
     WHERE position(' '||words||' ' IN d.name_words)>0 OR position(' '||words||' ' IN d.official_words)>0) THEN 2 ELSE 3 END AS search_rank
   FROM official_candidates d CROSS JOIN query_terms t
  ),rank_limit AS MATERIALIZED (
   SELECT CASE WHEN min(search_rank)=0 THEN 0 WHEN min(search_rank)<3 THEN 2 ELSE 3 END AS threshold
   FROM (SELECT search_rank FROM ranked UNION ALL SELECT search_rank FROM official_ranked) scores
  ),matched AS MATERIALIZED (
   SELECT c.* FROM ranked c CROSS JOIN query_terms t CROSS JOIN rank_limit r
   WHERE q='' OR NOT t.latin_query OR c.search_rank<=r.threshold
$new$;
 EXECUTE replace(definition,old_expression,new_expression);
END $migration$;
NOTIFY pgrst,'reload schema';
