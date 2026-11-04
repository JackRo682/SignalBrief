-- KOSDAQ IR notices use the independently verified DART K/70050 form. The
-- existing 99664 contract, archive checks, receipt families and grants remain.
CREATE OR REPLACE FUNCTION app_private.calendar_dart_ir_entry_format_valid(item jsonb,documents jsonb,market text,is_v2 boolean)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE matched jsonb; dates text[]; start_day date; end_day date;
BEGIN
 IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR jsonb_typeof(documents) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
 IF coalesce(item->>'location','')~'^99664/table/tr\[[0-9]{1,4}\]/일시$' THEN
  -- A 70050 document cannot be relabelled as the legacy form.
  RETURN NOT EXISTS(SELECT 1 FROM jsonb_array_elements(documents) d
   WHERE d->>'receipt_no'=coalesce(item->>'receipt_no',item->>'key') AND d ? 'template_id');
 END IF;
 IF NOT coalesce(is_v2,false) OR market IS DISTINCT FROM 'KOSDAQ'
 OR coalesce(item->>'location','')!~'^70050/table/tr\[[0-9]{1,4}\]/시작일$' THEN RETURN false; END IF;
 SELECT d INTO matched FROM jsonb_array_elements(documents) d WHERE d->>'receipt_no'=item->>'receipt_no';
 IF matched IS NULL OR matched->'template_id' IS DISTINCT FROM '"70050"'::jsonb THEN RETURN false; END IF;
 dates:=regexp_match(item->>'quote','^1[.][[:space:]]*일시[[:space:]]+행사일[[:space:]]+시간[(]현지시간[)][[:space:]]+시작일[[:space:]]+종료일[[:space:]]+시작시간[[:space:]]+종료시간[[:space:]]+([0-9]{4}-[0-9]{2}-[0-9]{2})[[:space:]]+([0-9]{4}-[0-9]{2}-[0-9]{2})([[:space:]]|$)');
 IF dates IS NULL OR item->>'occurs_on' IS DISTINCT FROM dates[1] THEN RETURN false; END IF;
 start_day:=dates[1]::date;end_day:=dates[2]::date;
 IF start_day::text<>dates[1] OR end_day::text<>dates[2] OR end_day<start_day OR end_day-start_day>31 THEN RETURN false; END IF;
 IF end_day=start_day THEN RETURN NOT (item ? 'ends_on'); END IF;
 RETURN coalesce(item->'ends_on'=to_jsonb(end_day::text),false)
  AND position('기간 시작 ('||start_day::text||'–'||end_day::text||')' IN coalesce(item->>'title',''))>0;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
REVOKE ALL ON FUNCTION app_private.calendar_dart_ir_entry_format_valid(jsonb,jsonb,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app_private.calendar_dart_ir_entry_format_valid(jsonb,jsonb,text,boolean) TO service_role;

-- Patch only the two explicit form boundaries of the existing ingest function.
-- Fail if its expected contract changed; keep its OID, owner and all other gates.
DO $migration$
DECLARE definition text; document_old text; document_new text; entry_old text; entry_new text;
BEGIN
 SELECT pg_get_functiondef('public.sb_calendar_ingest_dart_ir(text,text,text,text)'::regprocedure) INTO STRICT definition;
 document_old:=$old$IF jsonb_typeof(document) IS DISTINCT FROM 'object' OR coalesce(document->>'receipt_no','')!~'^[0-9]{14}$'$old$;
 document_new:=$new$IF jsonb_typeof(document) IS DISTINCT FROM 'object' OR coalesce(document->>'receipt_no','')!~'^[0-9]{14}$'
  OR (document ? 'template_id' AND (document->'template_id' IS DISTINCT FROM '"70050"'::jsonb
    OR cfg.market IS DISTINCT FROM 'KOSDAQ' OR NOT correction_manifest))$new$;
 entry_old:=$old$OR coalesce(item->>'location','')!~'^99664/table/tr\[[0-9]{1,4}\]/일시$'$old$;
 entry_new:=$new$OR NOT app_private.calendar_dart_ir_entry_format_valid(item,documents,cfg.market,correction_manifest)$new$;
 IF position(document_old IN definition)=0 OR position(entry_old IN definition)=0
 OR (length(definition)-length(replace(definition,document_old,'')))/length(document_old)<>1
 OR (length(definition)-length(replace(definition,entry_old,'')))/length(entry_old)<>1 THEN
  RAISE EXCEPTION 'dart_ir_70050_ingest_contract_changed';
 END IF;
 EXECUTE replace(replace(definition,document_old,document_new),entry_old,entry_new);
END $migration$;
