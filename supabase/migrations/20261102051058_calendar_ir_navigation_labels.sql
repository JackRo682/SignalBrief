-- Q4 and other official IR pages may include several navigation breadcrumbs.
-- Remove only the existing navigation-label whitelist, at most four passes.
-- The issuer/legal-name comparison and the helper's existing ACL stay unchanged.
CREATE OR REPLACE FUNCTION app_private.calendar_ir_issuer_label(value text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE label text; previous_label text;
BEGIN
 label:=trim(regexp_replace(normalize(value,NFKC),'[[:space:]]+',' ','g'));
 FOR pass IN 1..4 LOOP
  previous_label:=label;
  label:=trim(regexp_replace(regexp_replace(label,
   '^(investor relations|investor overview|events calendar|events (&|and) presentations|events)([[:space:]]*[|–—-][[:space:]]*|[[:space:]]+)','','i'),
   '([[:space:]]*[|–—-][[:space:]]*|[[:space:]]+)(investor relations|investor overview|events calendar|events (&|and) presentations|events)$','','i'));
  EXIT WHEN label IS NOT DISTINCT FROM previous_label;
 END LOOP;
 RETURN label;
END $$;
