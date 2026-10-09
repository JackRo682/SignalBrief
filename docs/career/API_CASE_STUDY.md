# Three SignalBrief API contracts, with product meaning

The case studies below document **the implemented FastAPI contracts** at `apps/api/signalbrief/routes.py` and `api_schemas.py`. They are not a claim that the hosted website runs FastAPI. The current web proxy and Supabase Edge/RPC implementation are a separate path with important differences listed below. No live authenticated production request was made for this work.

For a PM, an API contract defines what the interface may promise, which inputs it accepts and what it must say when a request fails. An HTTP 200 can still describe an appropriate AI refusal; a 204 saves a mutation without returning a body.

The [machine-readable OpenAPI extract](evidence/api-openapi.json) contains the exact three operations and all referenced request/response schemas. It is generated from the application, not reconstructed from the PRD. [New example tests](../../tests/test_career_api.py) exercise those contracts with synthetic fixtures. Existing [API tests](../../tests/test_api.py), [review regressions](../../tests/test_review_regressions.py) and [rate-limit tests](../../tests/test_cors_rate_limit.py) provide broader negative-case coverage.

## Shared contract

Requests send `Authorization: Bearer <access-token>`. In Supabase mode, FastAPI validates asymmetric ES256/RS256 signatures, issuer, audience, expiry and authenticated non-anonymous role. User IDs come from the validated token subject; admin rights come from a server allowlist, not user-editable metadata. The local demo path uses synthetic tokens and is prohibited in production settings. Authentication can initialize the application user and default empty watchlist/portfolio, which is why counting watchlist containers is not a user-activation metric.

Pydantic rejects unexpected JSON fields. Zod validates browser responses in `apps/web/src/lib/contracts.ts`. API errors normally use:

```json
{"error":{"code":"event_not_found","message":"event_not_found","request_id":"request-correlation-id"}}
```

Input validation uses HTTP 422 with `code=validation_error` and `fields:[{location:[...],message:"..."}]`. HTTP 401 asks the browser to reauthenticate; 404 avoids disclosing unavailable resources; 429 includes `Retry-After: 60`; 500 uses a generic message. Body-size middleware can reject oversized requests with 413. `X-Request-ID` supports troubleshooting without logging request contents.

FastAPI’s configured request budget defaults to 120/minute and uses persisted rate buckets. The follow-up route additionally enforces 10/minute per user. Treat these as application safeguards, not a proven denial-of-service defense or a measured throughput guarantee. Distributed concurrency and production proxy/IP behavior need their own tests. OpenAPI’s generated responses chiefly declare successful responses and input-validation errors; the runtime errors described here are enforced in application code and tests, not fully enumerated by the generated spec.

## 1. PUT /v1/watchlist/{company_id}

**Purpose and requirement:** persist a company the user wants to monitor. This supports the PRD’s relevant-company selection and personalized Today journey, without accepting personal holdings as analytics.

**Request schema:** required path parameter `company_id: string`; no request body or user_id field. FastAPI does not enforce UUID syntax on this path; company lookup determines validity. The company must exist in the active demo/live environment.

```http
PUT /v1/watchlist/<company-id>
Authorization: Bearer <access-token>
```

**Response schema:** HTTP 204, empty body. Follow with GET `/v1/watchlist` when the interface needs refreshed data; its `WatchlistOut` shape is `{id:string,name:string,items:CompanyOut[]}`. A successful 204 is not a JSON object and must not be parsed as one.

**Authentication and ownership:** the server resolves the principal’s default watchlist. Callers cannot pass another user’s watchlist ID. The composite `(watchlist_id,company_id)` identity and conflict-do-nothing insert make retries idempotent at the database level. A repeated PUT does not create a second item or a second FastAPI `watchlist_added` event.

**Validation and errors:** unauthenticated/invalid token → 401; unknown or wrong-environment company → 404 `company_not_found`; a new item beyond the 100-item check → 409 `watchlist_limit_100`; rate limit → 429. Existing items remain retryable at the limit. The count-then-insert limit check is not a fully serialized concurrency guarantee: simultaneous different-company additions near 100 require a separate lock/constraint design before claiming a hard cap.

**Rate-limiting/product implications:** debounce UI submissions and disable while saving, but preserve safe retries after transport failures. Do not emit success telemetry from the click handler before the server confirms the mutation.

**Executable examples:** `test_three_case_study_contracts` makes the same PUT twice and checks one saved item; `test_unknown_resources_are_not_success` checks 404. Existing API tests cover ownership and watchlist behavior. This tests persistence in a local synthetic database, not production storage.

**Hosted difference:** the same-origin `/api` proxy forwards to the Supabase Edge Function, whose mutation delegates to SQL RPCs. Mobile onboarding instead posts `/api/workspace` action `onboarding_complete` and can skip selection. FastAPI’s separate `/v1/onboarding` requires 3–20 distinct companies; the mobile RPC supports up to 10 selected companies, supports removal/positions and can complete with no selection. Do not describe one unified onboarding contract based on the old PRD.

## 2. GET /v1/events/{event_id}

**Purpose and requirement:** return a financial event with its facts, previous/current changes, preserved evidence and explicit uncertainty. The product promise is traceable explanation, not a trading recommendation.

**Request schema:** required `event_id:string` path parameter; no body. Authorization is required even when the event is broadly visible to signed-in users.

**Response schema:** HTTP 200 `EventDetailOut` with these required top-level fields:

| Field | Type and important nested contract | PM meaning |
|---|---|---|
| event | `EventCard`: id, company, type/state, headline, published_at/precision, is_demo, source URL/provider/tier, ranking, change summaries | What happened and why it appears for this user |
| document | `DocumentOut`: id/title/provider, source_url, download_url, publication date/time/precision/timezone, ingested_at, raw_sha256, is_demo | Where the statement came from and when it was known |
| facts | `FactOut[]`: id/field/quote/chunk_id, nullable value_raw/unit/period, scope/basis/validation_status | Source-supported facts, with missing values represented by null |
| changes | `ChangeOut[]`: current_fact_id, nullable previous_fact_id and values/deltas/comparison_kind, type, materiality/confidence | Comparable history or an explicit absence of comparable history |
| evidence | `EvidenceOut[]`: fact_id/chunk_id/document_id, quote/location, source_url/name/tier, published_at/precision, is_demo, role=current or previous | Both sides of the comparison remain inspectable |
| brief | `BriefOut`: headline, what_happened, interpretation, uncertainty, monitor_next, template_version | Facts and explanatory interpretation are separate |
| validations | `ValidationOut[]`: claim_key/status/reason/validator_version | Automated acceptance or rejection reasons |
| run | `RunOut`: model/prompt/pipeline versions, stage/status, timestamps, nullable latency/tokens/cost/error, validation_result | Provenance and operational limits |

Full field types, nullability and enums are in the linked OpenAPI extract. Financial delta values and costs are serialized as decimal strings where declared, preserving precision; the frontend must not invent zero for null. `confidence` is an implementation score, not independently measured correctness.

**Authentication and visibility:** regular users may read published or superseded events in the active environment. Admins can inspect additional states. Unlike a personal portfolio, a published financial event is not owned by a single user. The ranking is calculated for the requesting principal. Source evidence is exposed; raw private storage bytes remain outside this operation.

**Validation and errors:** missing event, unpublished event for a regular user or wrong demo/live mode → 404 `event_not_found`; missing/invalid identity → 401. A missing associated Brief is a data-integrity problem rather than an invented fallback; it can become a 500. Source availability and missing-comparison states must remain visible in the UI.

**Rate-limiting/product implications:** general API limits apply. Prefetching or repeated GETs must not count as people reading. The new mobile `brief_opened` event fires after loaded detail enters the rendered flow, with optional consent, separately from the GET itself. A detail view is not proof that the user read every quote.

**Executable examples:** the new contract test parses `EventDetailOut` and checks nonempty returned citation URL/quote; the unknown-resource example checks 404. Existing tests reject access to hidden events and raw pipeline records. The SQL citation check is a separate structural audit, not an entailment judgment.

**Hosted difference:** the Edge path uses hosted SQL data access and evidence serialization. The mobile page calls the same logical path but also uses `/api/workspace` for history/bookmarks. FastAPI OpenAPI does not specify all those workspace actions. Hosted behavior requires its own migration/RPC and browser tests.

## 3. POST /v1/events/{event_id}/questions

**Purpose and requirement:** let the user ask a follow-up about the event’s evidence. The answer must stay inside retained source quotes and disclose insufficient evidence. The PRD excludes buy/sell advice and target prices.

**Request schema:** required `event_id:string`; body exactly `{"question":string}` with length 2–1000 characters. Extra fields are forbidden. Empty/overlong values return 422 before the handler. The current mobile textarea allows up to 2000 characters, so a >1000-character question can fail against FastAPI; this is a documented existing contract mismatch, not silently changed in an analytics PR.

```json
{"question":"What evidence supports the revenue change?"}
```

**Response schema:** HTTP 200 `AnswerOut`:

```text
status: answered | abstained | unavailable | policy_blocked
message: string
evidence: [{source_id:string, quote:string, source_url:string, location:string}]
run_id: string | null
mode: extractive | demo
```

A refusal example (shape, not a claim of live execution):

```json
{"status":"policy_blocked","message":"Investment recommendations are outside this service.","evidence":[],"run_id":null,"mode":"demo"}
```

**Authentication and validation:** the same event-visibility rules apply. A per-user 10/minute budget is consumed after event lookup. Advice-pattern checks can return policy_blocked without an AI run. Otherwise an `ai_runs` record captures stage, model/prompt version and final outcome. Returned quotes are validated against retained evidence; unsupported model output cannot become an uncited answer.

**Errors and outcomes:** 401/404/422/429 are HTTP-level failures. `abstained` means evidence cannot support an answer; `unavailable` means processing failed and the response must not look like an answer. These are deliberate HTTP 200 domain statuses. A 200-only success dashboard would overstate AI success. Unknown token usage/pricing remains null; synthetic demo usage/cost does not estimate a production bill.

**Rate-limiting/product implications:** respect Retry-After and show a recoverable state, with no uncontrolled automatic retries that spend quota. The input commits telemetry before invoking the model so it does not keep a database transaction open across the network call. `followup_asked` therefore counts accepted attempts, including later refusals/unavailability, rather than answered questions.

**Executable examples:** the new contract test submits “Should I buy?” and requires policy_blocked, null run ID and empty evidence; parameterized tests reject length 1 and 1001; missing event returns 404. Existing tests cover follow-up budgets, extractive citations and abstention paths. No live OpenAI request is part of this verification.

**Hosted difference:** the Supabase Edge implementation uses deterministic evidence-bound answering and can persist question history. It is not equivalent to a deployed FastAPI LLM worker. Question history is user-facing storage, not optional analytics; never export its text as an engagement property.

## Interview evidence

You can demonstrate how to read an implemented API, derive exact schemas, distinguish authentication from object visibility, design retryable mutations, connect failure states to UI behavior and test refusal/invalid-input cases. You can also explain why HTTP success, consented telemetry, AI attempt counts and independent answer-quality evaluation are different measurements. This work does not prove production scale, live OAuth completion or real model correctness.
