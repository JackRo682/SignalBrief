-- Include real DART companies in existing authenticated company discovery and detail.
-- Evidence visibility, per-user saved state, private schema and caller grants are unchanged.
CREATE OR REPLACE FUNCTION app_private.sb_workspace_resources() RETURNS TABLE(
 id text,kind text,title text,summary text,company_id text,company_name text,ticker text,market text,
 source_url text,published_at timestamptz,publication_precision text,category text,is_saved boolean
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT x.*,EXISTS(SELECT 1 FROM public.workspace_saved s WHERE s.user_id=(SELECT auth.uid())::text AND s.kind=x.kind AND s.resource_id=x.id) FROM (
 SELECT c.id::text,'company',c.name::text,''::text,c.id::text,c.name::text,c.ticker::text,c.market::text,
 NULL::text,c.last_ingested_at,'timestamp','company' FROM public.companies c WHERE c.provider IN ('sec','dart') AND NOT c.is_demo
 UNION ALL
 SELECT e.id::text,'event',b.headline::text,b.what_happened,c.id::text,c.name::text,c.ticker::text,c.market::text,
 d.source_url,e.published_at,d.publication_precision::text,e.event_type::text
 FROM public.events e JOIN public.companies c ON c.id=e.company_id JOIN public.documents d ON d.id=e.document_id JOIN public.briefs b ON b.event_id=e.id
 WHERE c.provider='sec' AND NOT c.is_demo AND app_private.sb_event_visible(e.id)
 UNION ALL
 SELECT d.id::text,'document',d.title::text,''::text,c.id::text,c.name::text,c.ticker::text,c.market::text,
 d.source_url,coalesce(d.published_at,d.publication_date::timestamp AT TIME ZONE 'UTC'),d.publication_precision::text,d.form_type::text
 FROM public.documents d JOIN public.companies c ON c.id=d.company_id
 WHERE c.provider='sec' AND NOT c.is_demo AND NOT d.is_demo AND app_private.sb_document_visible(d.id)
 UNION ALL
 SELECT f.id::text,'filing',c.name||' · '||f.form,'SEC accession: '||f.accession,c.id::text,c.name::text,c.ticker::text,c.market::text,
 f.document_url,f.filing_date::timestamp AT TIME ZONE 'UTC','date',f.form
 FROM public.us_filings f JOIN public.companies c ON c.id=f.company_id WHERE c.provider='sec' AND NOT c.is_demo
 ) AS x(id,kind,title,summary,company_id,company_name,ticker,market,source_url,published_at,publication_precision,category)
$$;
REVOKE ALL ON FUNCTION app_private.sb_workspace_resources() FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';
