-- Reuse the authoritative per-user projection within ONE request only.
-- No cross-user/global cache, visibility change, or quota bypass.
DO $migration$
DECLARE
  definition text := pg_get_functiondef('app_content_private.workspace(text,jsonb)'::regprocedure);
  spec record; first_pos integer; last_pos integer; original text; updated text;
  needle constant text := 'app_private.sb_customer_resources()';
BEGIN
  FOR spec IN SELECT * FROM (VALUES
    ('source_overview','catalog','  WITH scope AS MATERIALIZED (',2),
    ('catalog','resource','  WITH all_matches AS MATERIALIZED (',2),
    ('saved_list','save','  WITH entries AS (',5)
  ) AS operations(action,next_action,anchor,expected_calls)
  LOOP
    first_pos := strpos(definition,' WHEN '||quote_literal(spec.action)||' THEN');
    last_pos := strpos(definition,' WHEN '||quote_literal(spec.next_action)||' THEN');
    IF first_pos=0 OR last_pos<=first_pos THEN RAISE EXCEPTION 'workspace_branch_not_found: %',spec.action; END IF;
    original := substring(definition FROM first_pos FOR last_pos-first_pos);
    IF (length(original)-length(replace(original,needle,'')))/length(needle) <> spec.expected_calls
      OR strpos(original,spec.anchor)=0 THEN
      RAISE EXCEPTION 'workspace_source_changed: %',spec.action;
    END IF;
    updated := replace(original,needle,'request_resources');
    updated := replace(updated,spec.anchor,
      '  WITH request_resources AS MATERIALIZED (SELECT * FROM '||needle||'), '||substring(spec.anchor FROM 8));
    IF spec.action='source_overview' THEN
      updated := replace(updated,
        '(SELECT count(*) FROM app_private.sb_customer_notifications() n WHERE n.read_at IS NULL)',
        $count$(SELECT count(*) FROM (
          SELECT n.id::text FROM public.notifications n JOIN request_resources r ON r.kind='event' AND r.id=n.event_id
          WHERE n.user_id=u AND n.read_at IS NULL
          UNION ALL
          SELECT n.id::text FROM public.content_notifications n JOIN request_resources r ON r.kind=n.kind AND r.id=n.resource_id::text
          WHERE n.user_id=u AND n.read_at IS NULL
        ) visible_unread)$count$);
      IF strpos(updated,'sb_customer_notifications()')>0 THEN RAISE EXCEPTION 'notification_source_changed'; END IF;
    END IF;
    definition := replace(definition,original,updated);
  END LOOP;
  first_pos := strpos(definition,' WHEN ''content_notifications'' THEN');
  last_pos := strpos(definition,' WHEN ''content_notification_read'' THEN');
  original := substring(definition FROM first_pos FOR last_pos-first_pos);
  IF first_pos=0 OR last_pos<=first_pos OR strpos(original,'RETURN jsonb_build_object(')=0
    OR (length(original)-length(replace(original,'app_private.sb_customer_notifications()','')))/length('app_private.sb_customer_notifications()')<>2 THEN
    RAISE EXCEPTION 'notification_branch_changed';
  END IF;
  updated := replace(original,'app_private.sb_customer_notifications()','request_notifications');
  updated := replace(updated,'RETURN jsonb_build_object(',
    'WITH request_notifications AS MATERIALIZED (SELECT * FROM app_private.sb_customer_notifications()) SELECT jsonb_build_object(');
  updated := replace(updated,'WHERE read_at IS NULL));','WHERE read_at IS NULL)) INTO r;RETURN r;');
  definition := replace(definition,original,updated);
  EXECUTE definition;
END $migration$;

CREATE OR REPLACE FUNCTION app_private.sb_customer_notifications()
RETURNS TABLE(id text,created_at timestamptz,read_at timestamptz,resource jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $notifications$
 WITH entries AS MATERIALIZED (
  SELECT n.id::text,n.created_at,n.read_at,'event'::text AS kind,n.event_id::text AS resource_id
  FROM public.notifications n WHERE n.user_id=(SELECT auth.uid())::text
  UNION ALL
  SELECT n.id::text,n.created_at,n.read_at,n.kind,n.resource_id::text
  FROM public.content_notifications n WHERE n.user_id=(SELECT auth.uid())::text
 ), resources AS MATERIALIZED (
  SELECT * FROM app_private.sb_customer_resources() WHERE EXISTS(SELECT 1 FROM entries)
 )
 SELECT n.id,n.created_at,n.read_at,to_jsonb(r)
 FROM entries n JOIN resources r ON r.kind=n.kind AND r.id=n.resource_id
$notifications$;
-- CREATE OR REPLACE retains ownership/ACLs; explicitly keep this helper private.
REVOKE ALL ON FUNCTION app_private.sb_customer_notifications() FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';
