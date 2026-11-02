-- Serialize the revision check and upsert for both SEC calendar evidence branches.
-- The original IR/Q4 branch already uses this exact per-source transaction lock;
-- taking it before dispatch also protects the newer SEC-filing fallback branch.
DO $$ DECLARE definition text; marker text:=E'BEGIN\n m:=manifest_text::jsonb;'; BEGIN
 definition:=pg_get_functiondef('public.sb_calendar_ingest_sec_ir(text,text,text,text)'::regprocedure);
 IF position(marker IN definition)=0 OR position('signalbrief.calendar.sec-filing.v1' IN definition)=0 THEN
  RAISE EXCEPTION 'calendar_filing_lock_precondition_failed'; END IF;
 EXECUTE replace(definition,marker,E'BEGIN\n PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(''calendar:''||source,0));\n m:=manifest_text::jsonb;');
END $$;
