# SignalBrief API Specification

Version 1.1 • REST contract baseline; implement OpenAPI from these definitions in T02

## 1. Common contract

Internal service base `/v1`; browser accesses the same routes under `/api/v1` through the Next.js BFF. JSON UTF-8; snake_case; UUID strings; RFC3339 UTC timestamps; date-only `YYYY-MM-DD`; exact decimals encoded as strings. Unknown input fields rejected. IDs in bodies never establish ownership. User comes from verified JWT `sub` and active profile. Ops requires an active server-side role plus recent authentication/MFA as specified in SECURITY.

Success object: `{data: object, meta: {request_id, schema_version:"1", server_time}}`. Lists: `{data: [...], meta:{request_id,schema_version,server_time,next_cursor:null|string}}`. Cursor is opaque, signed, includes stable sort keys/filter hash/snapshot cutoff; limit default 20, max 100. Cursor replay with different filters → 400. No offset pagination for changing feeds.

Error: `{error:{code,message,retryable,field_errors?:[{field,code,message}],request_id},meta:{schema_version:"1"}}`. Messages are safe and localizable. 400 malformed cursor/query; 401 session invalid; 403 forbidden; 404 missing or not owned; 409 idempotency/version conflict; 422 field/domain invalid; 429 quota/rate limit with Retry-After; 503 provider/service unavailable. Never leak other users' object existence through different owner errors.

POST operations creating jobs or reports require `Idempotency-Key` (UUID recommended), stored 24h by owner+route. Replay same body returns the original resource/job and status; different body →409. PUT natural-key operations are idempotent. Mutable resources return `ETag` from row_version; updating preferences/portfolio/Ops decisions requires `If-Match`, otherwise 428. Stale value →409 `version_conflict` with current safe resource version. DELETE absent owned natural-key row returns 204.

Default authenticated limits: read 60/min/user, ordinary writes 20/min/user; questions 5/local day and 2 in flight plus 5/min; coverage requests 5/day; export/delete requests 3/day; Ops replay 5/min. All are D limits, enforced server-side across replicas. Question daily window uses stored timezone with timezone changes not resetting an already-open quota window. Public coverage/login starts have IP-based abuse limits. Private responses `no-store`; evidence URLs are server-resolved approved origins.

## 2. Resource shapes

| Name | Shape |
|---|---|
| Profile | id, timezone, locale, onboarding_completed_at?, analytics_consent, consent_version?, account_state, row_version |
| Company | id, display_name, legal_name, market, instruments:[{ticker,exchange}], coverage:{state,indexed_from,last_complete_poll_at,supported_forms,gaps} |
| WatchlistItem | id, company:Company, created_at |
| Portfolio | id, name, positions:[{id,company_id,manual_weight:null or string,weight_confirmed_at?}], known_weight_total:string, weights_complete:boolean, row_version |
| FeedItem | event_id, brief_id, revision, company, title, summary_claims[], event_type, change_status, publication_date, publication_at?, precision, evidence_status, source_count, ranking:{total,reason_codes,version}, read_state, correction_state |
| EventDetail | event_id, brief_id, revision, company, event_type, publication fields, state, facts[], comparisons[], claims[], limitations[], prior_event_ids[], canonical_event_id?, duplicate_state, source_refs[], interpretation_claim_ids[], next_check_claim_ids[] |
| EvidenceItem | span_id, parsed_artifact_id, parser_version, canonical_text_hash, document_id, source_tier, issuer_id, document_title, publication fields, locator, exact_excerpt, language, translation?, original_url, source_availability, document_hash |
| QuestionResult | id, brief_id, revision, state:queued/running/answered/abstained/refused/failed/canceled, claims[]?, limitations[]?, failure_code?, created_at, completed_at? |
| CalendarItem | id, company_id, kind, date_local?, time_at?, precision, timezone?, date_status, evidence_span_id, supersedes_id?, checked_at |
| AccuracyNotice (P0) | id, accuracy_action_id, event_id, affected_brief_id, replacement_brief_id?, kind:correction/withdrawal, reason_code, safe_summary, action_at, created_at, acknowledged_at?, visible_canonical_event_id? |
| Notification (P1) | id, event_id, brief_id, kind:normal, created_at, read_at? |
| OpsRun | id, subject_id, state, config_version, stage_summaries[], validators[], source_ids[], model_calls[], cost:{usd?,complete}, latency_ms?, review_state |

Fact/Comparison/Claim are canonical AI_SYSTEM schemas, with only user-safe fields exposed. Full prompts, chain-of-thought, secret configuration, private user metadata and raw provider errors never appear in public payloads.

## 3. Authentication and profile boundary

Google start/callback/logout are Next.js `/auth/google/start`, `/auth/callback`, `/auth/logout` routes using Supabase Auth; they are not custom password endpoints. Validate state/PKCE and allowed redirects. Tokens stay in protected cookies/server context. FastAPI still validates forwarded JWT independently.

| Method/path | Input | Success | Errors / rules |
|---|---|---|---|
| GET `/coverage` | market?, q? | 200 list Company coverage, no personalized fields | Public, bounded, no full roster financial claims |
| GET `/me` | — | 200 Profile | 401 disabled/invalid session |
| PATCH `/me` | timezone?, locale?, analytics_consent?, consent_version?, onboarding_completed? | 200 Profile, ETag | If-Match; allowed locales only; cannot set role/user ID; completion requires ≥1 subscription |
| GET `/companies` | q 1..120 chars, market?, cursor?, limit? | 200 list Company | Search supported directory, not model-generated companies |
| GET `/companies/{company_id}` | UUID | 200 Company | 404 unsupported/not in directory |
| POST `/coverage-requests` | query_text, market? | 201 {id,status} | Idempotency; 422 query too long; no promise of support |

## 4. Watchlist and portfolio

| Method/path | Input | Success | Rules |
|---|---|---|---|
| GET `/watchlist` | cursor?,limit? | 200 WatchlistItem[] | Own account |
| PUT `/watchlist/{company_id}` | empty body | 201 new / 200 existing WatchlistItem | Supported coverage required; atomic 30 cap; unsupported 422 |
| DELETE `/watchlist/{company_id}` | — | 204 | Does not remove held position |
| GET `/portfolio` | — | 200 Portfolio or {portfolio:null} | P1 flag; private |
| PUT `/portfolio` | name ≤80 | 201 create / 200 update Portfolio | One/account; If-Match on update |
| PUT `/portfolio/positions` | positions:[{company_id,manual_weight:null or string}] | 200 Portfolio | If-Match; full atomic replacement; ≤30; unique issuers; 0..1 and known sum≤1; confirmation time server set |
| DELETE `/portfolio` | — | 204 | If-Match for existing; holdings removed, independent watchlist preserved |

`manual_weight:"0.20"` means 20%, not quantity. `weights_complete` means all entered positions have known weights and total equals one; it does not certify the user's entire real portfolio is represented. API/UI call it “entered weights complete,” not complete financial coverage.

## 5. Feed, detail, evidence and feedback

| Method/path | Input | Success | Rules |
|---|---|---|---|
| GET `/feed` | scope:today/recent (default today), company_id?, event_type?, cursor?,limit? | 200 FeedItem[] + meta.coverage + meta.empty_reason + meta.ranking_version | Exact subscription union, validated substantive changes only, frozen ranking snapshot for pagination; recent window seven days |
| GET `/events/{event_id}` | revision? positive int, locale? | 200 EventDetail | Current by default; withdrawn/duplicate alias returns safe status/metadata with unsafe claims absent; canonical link only when visible to caller; unpublished target ID/narrative never leaked; unpublished 404 |
| GET `/events/{event_id}/evidence` | claim_id?,revision? | 200 EvidenceItem[] | Claim belongs to requested version; approved excerpt only |
| POST `/events/{event_id}/views` | brief_id,revision,session_id | 200 {recorded:true} | Version actually shown; idempotent per user/brief; validate served revision and reconcile any existing accuracy actions on late view; no activation merely from this call |
| GET `/companies/{company_id}/timeline` | type?,before?,cursor?,limit? | 200 event summaries + coverage | Canonical entries once, safe alias grouping and separate amendment links; no stock prices |
| POST `/feedback` | brief_id,kind,useful:boolean? (rating only),reason_code?,note? | 201 {id,state} | Exact version; one current rating per brief/user; error report links run; note ≤1,000 |

P0 accuracy notice routes are independent of P1 feature flags and analytics consent:

| Method/path | Input | Success | Rules |
|---|---|---|---|
| GET `/accuracy-notices` | acknowledged?,cursor?,limit? | 200 AccuracyNotice[] + meta.unacknowledged_count | Owner only; persistent list for Today banner and detail; no opt-in/mute/cap filtering; unsafe narrative absent |
| PATCH `/accuracy-notices/{id}` | acknowledged:true | 200 AccuracyNotice | Owner checked; idempotent acknowledgement timestamp; no destructive delete and no forced acknowledgement gate |

Content-bearing feed/detail responses persist minimal served exposure before returning the exact safe revision, independent of optional `/telemetry/events`; rendered `/views` updates are supplemental. A served record is conservative evidence of exposure, not proof the user read it. Late-view/withdrawal races follow DATA_MODEL §7.4. Feed metadata includes `unacknowledged_accuracy_notice_count` so notices remain discoverable even after the company is unfollowed or there are no feed events.

Feedback `kind` input is `rating|error`; store rating as useful/not_useful based on `useful`. Error reasons: wrong_number, wrong_source, wrong_comparison, unsupported_interpretation, stale, other. This adapter mapping avoids two competing public schemas.

Example feed with no events: `data:[]`, `meta.empty_reason:"no_new_changes"`, `meta.coverage:{state:"current",last_complete_poll_at:"...",supported_company_count:3}`. If source checks fail, use `source_delayed`/`coverage_pending` rather than no_new_changes. Placeholder timestamps in this prose are schema illustrations, not sample API test fixtures.

## 6. Follow-up, calendar, alerts and privacy (P1 except privacy)

| Method/path | Input | Success | Rules |
|---|---|---|---|
| POST `/events/{event_id}/questions` | brief_id,revision,question 1..1,000 chars | 202 {question_id,state,quota_remaining,poll_url} | Idempotency; 409 outdated_revision; 429 quota; published evidence required |
| GET `/questions/{id}` | — | 200 QuestionResult | Owner only; Retry-After:2 while pending; client polls max 90s then shows pending status, not a fake failure |
| GET `/calendar` | from/to dates, company_id?,cursor?,limit? | 200 CalendarItem[] | Max 90-day requested window; followed/held issuers; unknown dates separately flagged |
| GET `/alerts` | read_state?,cursor?,limit? | 200 Notification[] | Owner only; P1 normal alerts; Alert Center reads the separate P0 accuracy-notice API for corrections |
| PATCH `/alerts/{id}` | read:true | 200 Notification | Idempotent mark-read; owner checked |
| POST `/alerts/read-all` | through_timestamp | 200 {updated_count} | Idempotency; only existing items through cutoff |
| GET `/alert-preferences` | — | 200 prefs + ETag | Disabled default |
| PUT `/alert-preferences` | enabled,materiality_threshold,muted_company_ids | 200 prefs + ETag | If-Match; threshold range validated |
| POST `/me/export` | reauth_token | 202 {request_id,state} | Recent reauth; idempotency; no public download URL |
| POST `/me/deletion` | confirm:true,reauth_token | 202 {request_id,state} | Immediately disable; logout; process privacy job |
| GET `/me/privacy-requests/{id}` | authenticated request or scoped deletion receipt | 200 {state,completed_at?,download_path?} | Receipt only sees own deletion status; no other account access; export downloadable only with active authenticated owner |

Read-state mutations do not imply a useful session. Export download streams authenticated data with attachment headers, no shared cache; short-lived scoped token if required must be single-purpose and non-loggable. Delete receipt expires after 30 days and contains no personal payload.

## 7. Ops API

| Method/path | Input | Success | Hard conditions |
|---|---|---|---|
| GET `/ops/summary` | from?,to? | 200 lag,coverage,quality,cost aggregates | Active operator; scrubbed counts |
| GET `/ops/runs` | state?,class?,cursor?,limit? | 200 OpsRun summaries | No private portfolio text |
| GET `/ops/runs/{id}` | — | 200 OpsRun + source/validation detail | Role + audit of sensitive access |
| POST `/ops/runs/{id}/decision` | action:approve/reject, reason | 200 disposition | If-Match + Idempotency; approve requires every hard gate pass; no override field |
| POST `/ops/events/{id}/withdraw` | brief_id,reason | 200 withdrawn status | If-Match + Idempotency; transactional outbox |
| POST `/ops/events/{id}/duplicate` | canonical_event_id,reason | 200 {event_id,canonical_event_id,duplicate_state,row_version} | If-Match + Idempotency; same issuer/context; root-only relation; 422 self/cross-issuer/incompatible link, 409 cycle/stale state; audited transaction suppresses alias, preserves evidence and issues exposed-viewer notices; cannot merge amendments/contradictions |
| POST `/ops/runs/{id}/replay` | config_version,reason | 202 {run_id,job_id} | New run; preserved input hashes, budget; Idempotency |
| GET `/ops/evaluations/{id}` | — | 200 evaluation report under ANALYTICS §4.1 | Active operator; immutable completed report or explicit incomplete status |
| GET `/ops/evaluations/{id}/export` | format=json | 200 same versioned report, attachment headers | Active operator; read-only, no private user data/prompts; artifact hash and all ten metric records retained |
| GET `/ops/configs` | — | 200 evaluated config list | No secret values |
| POST `/ops/configs/{version}/activate` | reason | 200 active_version | Admin only; approved eval gate; If-Match + Idempotency |
| POST `/ops/publication/pause` | paused:boolean,reason | 200 status | Admin/operator kill switch; audited; resume requires incident resolution |

## 8. Reliability and health boundary

Telemetry contract (P0): `POST /telemetry/sessions` creates/reuses a server session for the authenticated user and returns `{session_id,expires_at}`; background polling cannot extend it. `POST /telemetry/events` accepts up to 20 allowlisted client events per request, each with event_uuid, session_id, name, occurred_at and typed properties. It returns 202 with accepted/discarded counts. Ownership, revision existence, consent and field schemas are checked server-side; schema-invalid events get 422, nonconsented product events are discarded without exporting. Heartbeat properties include foreground visibility and bounded active duration. Limit 120 event requests/minute/user, separate from ordinary write rate limits. Store no user-supplied identity override. These events are interaction observations, not cryptographic proof of reading. Signup, publication, feedback and job transitions are generated by server code and cannot be impersonated through this endpoint. Optional anonymous landing events use a separate consent-aware, IP-limited BFF capture path with no authenticated-data access.

`GET /health/live` returns process alive, no dependency secrets. `GET /health/ready` checks DB/connectivity/config sanity; internal or authenticated monitoring only. Provider unavailability does not necessarily make the read API unready, but appears in `/coverage` and Ops. No public generic job execution endpoint.

Safe retries: GET/PUT and idempotent DELETE; POST only with retained idempotency key. Browser retries 503 at most twice with jitter; no retry on 401 beyond one refresh, 403, 409 or 422. Unstable connectivity must not duplicate questions, reports, portfolio replacement or publications. API version changes require schema version and migration/deprecation plan; tests compare generated OpenAPI and frontend types.
