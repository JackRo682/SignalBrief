-- Structural and verbatim-quote check only; does not establish semantic correctness.
SELECT f.id AS fact_id FROM facts f
LEFT JOIN document_chunks c ON c.id=f.chunk_id
LEFT JOIN documents d ON d.id=c.document_id
WHERE c.id IS NULL OR d.id IS NULL OR nullif(btrim(d.source_url),'') IS NULL
  OR nullif(btrim(f.quote),'') IS NULL OR strpos(c.text,f.quote)=0
ORDER BY f.id;
