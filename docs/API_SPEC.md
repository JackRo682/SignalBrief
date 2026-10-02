# API specification

Machine-readable source: `packages/shared/openapi.json`; generated from the actual FastAPI routes.

Base paths are `/v1` and `/health`. Except health/config/development login, routes require a bearer JWT.
Ops additionally checks trusted admin identity. Response models define actual nullable/decimal/time fields; frontend Zod validates the same boundary.

Ownership is determined from verified subject, never a client-supplied owner ID. Errors have safe codes and request IDs.
Source URLs stay original; raw downloads require admin and use attachment delivery. API does not accept arbitrary upstream URLs.

| Method | Route | Operation |
|---|---|---|
| GET | `/health/live` | Live |
| GET | `/health/ready` | Ready |
| GET | `/v1/config` | Config |
| POST | `/v1/auth/demo` | Demo |
| GET | `/v1/me` | Me |
| PATCH | `/v1/me` | Update Me |
| POST | `/v1/onboarding` | Onboard |
| GET | `/v1/companies` | Companies |
| GET | `/v1/watchlist` | Watchlist |
| PUT | `/v1/watchlist/{company_id}` | Add Watchlist |
| DELETE | `/v1/watchlist/{company_id}` | Remove Watchlist |
| GET | `/v1/portfolio` | Portfolio |
| PUT | `/v1/portfolio/positions/{company_id}` | Set Position |
| DELETE | `/v1/portfolio/positions/{company_id}` | Remove Position |
| GET | `/v1/feed` | Feed |
| GET | `/v1/events/{event_id}` | Event Detail |
| GET | `/v1/companies/{company_id}/timeline` | Timeline |
| POST | `/v1/events/{event_id}/questions` | Ask |
| GET | `/v1/calendar` | Calendar |
| POST | `/v1/calendar` | Add Calendar |
| DELETE | `/v1/calendar/{item_id}` | Delete Calendar |
| GET | `/v1/alerts` | Alerts |
| POST | `/v1/alerts` | Create Alert |
| PUT | `/v1/alerts/{alert_id}` | Update Alert |
| DELETE | `/v1/alerts/{alert_id}` | Delete Alert |
| GET | `/v1/notifications` | Notifications |
| PUT | `/v1/notifications/{notification_id}/read` | Read Notification |
| POST | `/v1/events/{event_id}/feedback` | Feedback |
| POST | `/v1/analytics` | Analytics |
| GET | `/v1/ops/dashboard` | Dashboard |
| GET | `/v1/ops/queues` | Queues |
| GET | `/v1/ops/documents` | Documents |
| GET | `/v1/ops/documents/{document_id}` | Inspect Document |
| GET | `/v1/ops/documents/{document_id}/raw` | Raw Document |
| GET | `/v1/ops/runs/{run_id}` | Inspect Run |
| GET | `/v1/ops/prompts` | Prompts |
| POST | `/v1/ops/events/{event_id}/action` | Action |
| POST | `/v1/ops/ingest` | Ingest |
| POST | `/v1/ops/catalog/sync` | Catalog Sync |
| POST | `/v1/ops/jobs/{job_id}/retry` | Retry Job |
| POST | `/v1/ops/reports/{report_id}/resolve` | Resolve Report |
| GET | `/v1/ops/audit` | Audit |

## Main response concepts

Feed: items/total/has_more/truncated/latest_ingested_at/stale/demo_mode.
Event detail: event/document/facts/changes/evidence/brief/validations/run.
Each evidence item has current/previous role, location, quotation, source quality and publication precision.
Unknown cost and prior values are nullable; insufficient history does not become a manufactured prior result.
