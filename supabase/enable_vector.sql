-- Optional, run with psql after alembic upgrade head. Not required for exact-evidence retrieval.
-- This script targets a PostgreSQL/Supabase DB where installing pgvector is authorized.
BEGIN;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;
SET LOCAL search_path=public,extensions;
CREATE TABLE IF NOT EXISTS public.chunk_embeddings (
  chunk_id varchar(36) NOT NULL REFERENCES public.document_chunks(id) ON DELETE CASCADE,
  model varchar(120) NOT NULL,
  embedding vector(1536) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chunk_id, model)
);
CREATE INDEX IF NOT EXISTS chunk_embeddings_cosine_idx ON public.chunk_embeddings USING hnsw(embedding vector_cosine_ops);
ALTER TABLE public.chunk_embeddings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.chunk_embeddings FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.chunk_embeddings FROM anon'; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE 'REVOKE ALL ON public.chunk_embeddings FROM authenticated'; END IF;
END $$;
COMMIT;
