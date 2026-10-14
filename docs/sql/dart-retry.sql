CREATE TABLE IF NOT EXISTS app_private.dart_document_retries(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),filing_id uuid NOT NULL REFERENCES public.dart_filings(id),
 requested_by uuid NOT NULL,previous_error text,previous_attempted_at timestamptz,requested_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON app_private.dart_document_retries FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.sb_dart_document_retry(fid uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE previous app_private.dart_document_attempts%rowtype;BEGIN
 IF (SELECT auth.uid()) IS NULL OR NOT app_private.sb_is_admin() THEN RAISE EXCEPTION 'admin_required' USING ERRCODE='PT403';END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(20261014,3);
 SELECT * INTO previous FROM app_private.dart_document_attempts WHERE filing_id=fid FOR UPDATE;
 IF NOT FOUND OR previous.state<>'blocked' OR EXISTS(SELECT 1 FROM public.dart_documents WHERE filing_id=fid) THEN RAISE EXCEPTION 'failed_document_required' USING ERRCODE='PT409';END IF;
 IF (SELECT count(*) FROM app_private.dart_document_retries WHERE filing_id=fid)>=2 THEN RAISE EXCEPTION 'document_retry_limit' USING ERRCODE='PT409';END IF;
 INSERT INTO app_private.dart_document_retries(filing_id,requested_by,previous_error,previous_attempted_at) VALUES(fid,(SELECT auth.uid()),previous.error_code,previous.attempted_at);
 UPDATE app_private.dart_document_attempts SET state='retry_requested' WHERE filing_id=fid;
 RETURN jsonb_build_object('status','queued','filing_id',fid);
END $$;
CREATE OR REPLACE FUNCTION public.sb_dart_document_claim() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE filing public.dart_filings%rowtype;BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(20261014,3);
 SELECT f.* INTO filing FROM public.dart_filings f LEFT JOIN app_private.dart_document_attempts a ON a.filing_id=f.id
 WHERE a.filing_id IS NULL OR a.state='retry_requested' ORDER BY f.filing_date DESC,f.id LIMIT 1;
 IF NOT FOUND THEN RETURN NULL;END IF;
 INSERT INTO app_private.dart_document_attempts(filing_id) VALUES(filing.id)
 ON CONFLICT(filing_id) DO UPDATE SET state='running',attempted_at=now(),error_code=NULL;
 RETURN to_jsonb(filing);
END $$;
REVOKE ALL ON FUNCTION public.sb_dart_document_claim() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sb_dart_document_claim() TO service_role;
REVOKE ALL ON FUNCTION public.sb_dart_document_retry(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.sb_dart_document_retry(uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
