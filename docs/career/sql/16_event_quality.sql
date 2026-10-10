SELECT e.id, CASE WHEN u.id IS NULL THEN 'orphan_user'
  WHEN e.event_name IN ('brief_opened','evidence_opened','followup_asked','feedback_submitted')
    AND nullif(e.properties->>'event_id','') IS NULL THEN 'missing_event_id'
  WHEN e.created_at > :as_of THEN 'future_timestamp'
  WHEN json_typeof(e.properties) <> 'object' THEN 'invalid_properties'
  ELSE 'unexpected_property' END AS issue
FROM user_events e LEFT JOIN users u ON u.id=e.user_id
WHERE u.id IS NULL OR e.created_at > :as_of OR json_typeof(e.properties) <> 'object'
  OR (e.event_name IN ('brief_opened','evidence_opened','followup_asked','feedback_submitted')
    AND nullif(e.properties->>'event_id','') IS NULL)
  OR EXISTS (SELECT 1 FROM json_object_keys(CASE WHEN json_typeof(e.properties)='object'
    THEN e.properties ELSE '{}'::json END) k WHERE k NOT IN ('event_id','company_id','screen','density','count'))
ORDER BY e.id;
