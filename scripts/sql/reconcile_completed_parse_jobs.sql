-- Reconcile only legacy jobs whose source already has a later validated, published result.
-- This does not execute parsing, approve an analysis, or change source bytes.
BEGIN;
WITH completed AS (
 UPDATE public.jobs j SET state='succeeded',finished_at=now(),lease_until=NULL,lease_token=NULL,
 last_error='reconciled_existing_validated_published_result'
 FROM public.documents d
 WHERE j.kind='parse' AND j.state='queued' AND d.id=j.payload->>'document_id'
 AND d.state='processed'
 AND EXISTS(SELECT 1 FROM public.document_chunks c WHERE c.document_id=d.id)
 AND EXISTS(SELECT 1 FROM public.events e JOIN public.ai_runs a ON a.id=e.run_id
  WHERE e.document_id=d.id AND e.state='published' AND a.status='validated'
  AND a.finished_at>=j.created_at)
 RETURNING j.id,j.payload
)
INSERT INTO public.audit_logs(id,actor_id,action,target_id,details,created_at)
SELECT gen_random_uuid()::text,NULL,'queue_reconciled_existing_validated_run',id,
 json_build_object('payload',payload,'reason','Document already processed; later validated run and published event exist.'),now()
FROM completed;
COMMIT;
