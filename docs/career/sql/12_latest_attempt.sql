WITH ranked AS (
  SELECT document_id, id, status,
    row_number() OVER (PARTITION BY document_id ORDER BY created_at DESC, id DESC) AS rn
  FROM ai_runs WHERE stage='extract_validate_compare' AND created_at <= :as_of
    AND document_id IS NOT NULL
)
SELECT document_id, id, status FROM ranked WHERE rn=1 ORDER BY document_id;
