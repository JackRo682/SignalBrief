-- Read-only document projections for the second set of mobile detail screens.
-- No generated summaries, sample financial rows, or changes to existing content.
-- The only write is the existing per-user request rate counter.
CREATE SCHEMA app_mobile_private;
REVOKE ALL ON SCHEMA app_mobile_private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA app_mobile_private TO authenticated;

CREATE FUNCTION app_mobile_private.document_detail(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  u text := (SELECT auth.uid())::text;
  selected_id text;
  selected_kind text;
  section_offset integer := 0;
  resource jsonb;
  metadata jsonb;
  summaries jsonb := '[]';
  facts jsonb := '[]';
  sections jsonb := '[]';
  events jsonb := '[]';
  related jsonb := '[]';
  summary_count bigint := 0;
  fact_count bigint := 0;
  section_count bigint := 0;
  event_count bigint := 0;
  related_count bigint := 0;
BEGIN
  IF u IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = u::uuid) THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = 'PT401';
  END IF;
  PERFORM public.sb_require_mfa();
  IF p IS NULL OR jsonb_typeof(p) <> 'object' OR octet_length(p::text) > 2048
     OR p - 'id' - 'kind' - 'section_offset' <> '{}'
     OR jsonb_typeof(p->'id') IS DISTINCT FROM 'string'
     OR p->>'id' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
     OR jsonb_typeof(p->'kind') IS DISTINCT FROM 'string'
     OR p->>'kind' NOT IN ('document', 'filing') THEN
    RAISE EXCEPTION 'invalid_document_request' USING ERRCODE = 'PT422';
  END IF;
  IF p ? 'section_offset' THEN
    IF jsonb_typeof(p->'section_offset') IS DISTINCT FROM 'number'
       OR p->>'section_offset' !~ '^(0|[1-9][0-9]*)$' THEN
      RAISE EXCEPTION 'invalid_document_offset' USING ERRCODE = 'PT422';
    END IF;
    IF (p->>'section_offset')::numeric > 2147483600 THEN
      RAISE EXCEPTION 'invalid_document_offset' USING ERRCODE = 'PT422';
    END IF;
    section_offset := (p->>'section_offset')::integer;
  END IF;
  PERFORM public.sb_rate_limit();
  selected_id := lower(p->>'id');
  selected_kind := p->>'kind';
  SELECT to_jsonb(r) INTO resource
    FROM app_private.sb_workspace_resources() r
    WHERE r.id = selected_id AND r.kind = selected_kind;
  IF resource IS NULL THEN
    RAISE EXCEPTION 'resource_not_available' USING ERRCODE = 'PT404';
  END IF;

  -- Only explicitly safe raw-blob metadata is projected. object_key, download_url,
  -- and arbitrary provider_metadata never cross the caller boundary.
  IF selected_kind = 'document' THEN
    SELECT jsonb_build_object(
      'mime_type', b.content_type, 'size_bytes', b.byte_length,
      'page_count', NULL, 'provider', d.provider,
      'publication_timezone', d.publication_timezone, 'ingested_at', d.ingested_at,
      'raw_sha256', d.raw_sha256
    ) INTO metadata
    FROM public.documents d LEFT JOIN public.raw_blobs b ON b.sha256 = d.raw_sha256
    WHERE d.id = selected_id;

    WITH approved AS MATERIALIZED (
      SELECT e.id AS event_id, b.headline AS title, b.what_happened AS text,
        e.published_at
      FROM public.events e JOIN public.briefs b ON b.event_id = e.id
      WHERE e.document_id = selected_id AND app_private.sb_event_visible(e.id)
    )
    SELECT (SELECT count(*) FROM approved), coalesce((SELECT jsonb_agg(
      jsonb_build_object('event_id', x.event_id, 'title', x.title, 'text', x.text)
      ORDER BY x.published_at DESC, x.event_id)
      FROM (SELECT * FROM approved ORDER BY published_at DESC, event_id LIMIT 50) x), '[]')
    INTO summary_count, summaries;

    -- Prior-period facts may be visible through a reviewed current comparison.
    -- Their event link targets that visible event, never an unpublished origin.
    WITH visible_resources AS MATERIALIZED (
      SELECT r.* FROM app_private.sb_workspace_resources() r WHERE r.kind = 'event'
    ), supported AS MATERIALIZED (
      SELECT f.id, f.field, f.value_raw, f.unit, f.period, f.basis, f.quote,
        linked.id AS event_id, f.event_id AS origin_event_id,
        d.source_url, c.location, c.ordinal
      FROM public.facts f JOIN public.document_chunks c ON c.id = f.chunk_id
      JOIN public.documents d ON d.id = c.document_id
      JOIN LATERAL (
        SELECT r.id FROM visible_resources r
        WHERE r.id = f.event_id OR EXISTS (
          SELECT 1 FROM public.changes ch WHERE ch.event_id = r.id AND ch.previous_fact_id = f.id
        )
        ORDER BY (r.id = f.event_id) DESC, r.published_at DESC, r.id LIMIT 1
      ) linked ON true
      WHERE c.document_id = selected_id AND app_private.sb_fact_visible(f.id)
    )
    SELECT (SELECT count(*) FROM supported), coalesce((SELECT jsonb_agg(
      to_jsonb(x) - 'ordinal' ORDER BY x.ordinal, x.id)
      FROM (SELECT * FROM supported ORDER BY ordinal, id LIMIT 50) x), '[]')
    INTO fact_count, facts;

    -- This matches document_chunks RLS. An approved event does not make every
    -- unreviewed chunk readable. Text and exact numeric strings are not truncated.
    WITH readable AS MATERIALIZED (
      SELECT c.id, c.location AS title, c.location, c.text AS content, c.ordinal,
        NULL::integer AS page_start, NULL::integer AS page_end
      FROM public.document_chunks c
      WHERE c.document_id = selected_id AND EXISTS (
        SELECT 1 FROM public.facts f WHERE f.chunk_id = c.id AND app_private.sb_fact_visible(f.id)
      )
    )
    SELECT (SELECT count(*) FROM readable), coalesce((SELECT jsonb_agg(
      to_jsonb(x) - 'ordinal' ORDER BY x.ordinal, x.id)
      FROM (SELECT * FROM readable ORDER BY ordinal, id OFFSET section_offset LIMIT 12) x), '[]')
    INTO section_count, sections;

    WITH linked_events AS MATERIALIZED (
      SELECT r.* FROM app_private.sb_workspace_resources() r
      JOIN public.events e ON e.id = r.id AND r.kind = 'event'
      WHERE e.document_id = selected_id OR EXISTS (
        SELECT 1 FROM public.changes ch JOIN public.facts f ON f.id = ch.previous_fact_id
        JOIN public.document_chunks c ON c.id = f.chunk_id
        WHERE ch.event_id = e.id AND c.document_id = selected_id AND app_private.sb_fact_visible(f.id)
      )
    )
    SELECT (SELECT count(*) FROM linked_events), coalesce((SELECT jsonb_agg(
      to_jsonb(x) ORDER BY x.published_at DESC, x.id)
      FROM (SELECT * FROM linked_events ORDER BY published_at DESC, id LIMIT 50) x), '[]')
    INTO event_count, events;
  ELSE
    -- SEC filing form is not a MIME type or proof of a PDF/page count. The separate
    -- us_analyses pipeline is deliberately not promoted into reviewed briefs here.
    -- source_sha256 identifies the archived SEC submissions envelope, not filing
    -- document bytes; the UI labels that different provenance explicitly.
    SELECT jsonb_build_object(
      'mime_type', NULL, 'size_bytes', NULL, 'page_count', NULL, 'provider', 'sec',
      'publication_timezone', NULL, 'ingested_at', f.fetched_at, 'raw_sha256', f.source_sha256
    ) INTO metadata FROM public.us_filings f WHERE f.id::text = selected_id;
  END IF;

  WITH other_documents AS MATERIALIZED (
    SELECT r.* FROM app_private.sb_workspace_resources() r
    WHERE r.company_id = resource->>'company_id' AND r.kind IN ('document', 'filing')
      AND NOT (r.id = selected_id AND r.kind = selected_kind)
  )
  SELECT (SELECT count(*) FROM other_documents), coalesce((SELECT jsonb_agg(
    to_jsonb(x) ORDER BY x.published_at DESC NULLS LAST, x.id, x.kind)
    FROM (SELECT * FROM other_documents ORDER BY published_at DESC NULLS LAST, id, kind LIMIT 50) x), '[]')
  INTO related_count, related;

  RETURN jsonb_build_object(
    'document', resource, 'metadata', metadata, 'summaries', summaries, 'facts', facts,
    'sections', sections, 'sections_total', section_count,
    'next_section_offset', CASE WHEN section_offset + 12 < section_count THEN section_offset + 12 ELSE NULL END,
    'events', events, 'related', related,
    'counts', jsonb_build_object('summaries', summary_count, 'facts', fact_count, 'events', event_count, 'related', related_count)
  );
END;
$$;
REVOKE ALL ON FUNCTION app_mobile_private.document_detail(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_mobile_private.document_detail(jsonb) TO authenticated;

-- Invoker entry point in the exposed API schema. Privileged logic is isolated in
-- the unexposed schema and performs its own Auth/MFA/visibility checks.
CREATE FUNCTION public.sb_document_detail(p jsonb)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT app_mobile_private.document_detail(p)
$$;
REVOKE ALL ON FUNCTION public.sb_document_detail(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sb_document_detail(jsonb) TO authenticated;
COMMENT ON FUNCTION public.sb_document_detail(jsonb) IS
  'Authenticated reviewed document detail with safe stored metadata, exact citations, explicit totals, and paginated RLS-visible source excerpts.';
NOTIFY pgrst, 'reload schema';
