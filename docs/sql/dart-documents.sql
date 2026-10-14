CREATE TABLE IF NOT EXISTS public.dart_documents(
 filing_id uuid PRIMARY KEY REFERENCES public.dart_filings(id),raw_sha256 text NOT NULL,normalized_sha256 text NOT NULL,
 raw_object_key text NOT NULL,normalized_object_key text NOT NULL,raw_bytes int NOT NULL,normalized_bytes int NOT NULL,
 member_count int NOT NULL,parser_version text NOT NULL,processed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.dart_analyses(
 filing_id uuid PRIMARY KEY REFERENCES public.dart_filings(id),status text NOT NULL CHECK(status IN ('needs_review','approved','rejected')),
 model text NOT NULL,source_sha256 text NOT NULL,normalized_sha256 text NOT NULL,result jsonb NOT NULL,input_tokens int,output_tokens int,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS app_private.dart_document_attempts(filing_id uuid PRIMARY KEY REFERENCES public.dart_filings(id),state text NOT NULL DEFAULT 'running',error_code text,attempted_at timestamptz NOT NULL DEFAULT now());
REVOKE ALL ON app_private.dart_document_attempts FROM PUBLIC,anon,authenticated;
ALTER TABLE public.dart_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dart_analyses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dart_documents,public.dart_analyses FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.dart_documents,public.dart_analyses TO authenticated;
GRANT ALL ON public.dart_documents,public.dart_analyses TO service_role;
CREATE POLICY dart_documents_read ON public.dart_documents FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.dart_filings f WHERE f.id=filing_id));
CREATE POLICY dart_analysis_read ON public.dart_analyses FOR SELECT TO authenticated USING(status='approved' OR app_private.sb_is_admin());
CREATE OR REPLACE FUNCTION public.sb_dart_document_claim() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE filing public.dart_filings%rowtype;BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(20261014,3);
 SELECT * INTO filing FROM public.dart_filings f WHERE NOT EXISTS(SELECT 1 FROM app_private.dart_document_attempts a WHERE a.filing_id=f.id) ORDER BY filing_date DESC,id LIMIT 1;
 IF NOT FOUND THEN RETURN NULL;END IF;INSERT INTO app_private.dart_document_attempts(filing_id) VALUES(filing.id);RETURN to_jsonb(filing);
END $$;
CREATE OR REPLACE FUNCTION public.sb_dart_document_finish(fid uuid,status text,error_code text DEFAULT NULL) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 UPDATE app_private.dart_document_attempts SET state=status,error_code=sb_dart_document_finish.error_code WHERE filing_id=fid
$$;
CREATE OR REPLACE FUNCTION public.sb_dart_review(fid uuid,decision text,reason text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF (SELECT auth.uid()) IS NULL OR NOT app_private.sb_is_admin() THEN RAISE EXCEPTION 'admin_required' USING ERRCODE='PT403';END IF;
 IF decision NOT IN ('approved','rejected') OR length(trim(reason))<5 THEN RAISE EXCEPTION 'review_reason_required' USING ERRCODE='PT422';END IF;
 UPDATE public.dart_analyses SET status=decision WHERE filing_id=fid AND result->>'validation'='quote_substring_and_numeric_check';
 IF NOT FOUND THEN RAISE EXCEPTION 'validated_analysis_required' USING ERRCODE='PT409';END IF;
 INSERT INTO app_private.dart_reviews VALUES(gen_random_uuid(),fid,(SELECT auth.uid()),decision,reason,now());
 RETURN jsonb_build_object('status',decision,'filing_id',fid);
END $$;
CREATE TABLE IF NOT EXISTS app_private.dart_reviews(id uuid PRIMARY KEY,filing_id uuid NOT NULL REFERENCES public.dart_filings(id),reviewer uuid NOT NULL,decision text NOT NULL,reason text NOT NULL,created_at timestamptz NOT NULL);
REVOKE ALL ON app_private.dart_reviews FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.sb_dart_document_claim(),public.sb_dart_document_finish(uuid,text,text),public.sb_dart_review(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sb_dart_document_claim(),public.sb_dart_document_finish(uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.sb_dart_review(uuid,text,text) TO authenticated;
NOTIFY pgrst,'reload schema';
