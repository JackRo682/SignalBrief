# Data model

29 relational tables. Primary keys, foreign keys and unique constraints are implemented in SQLAlchemy and frozen migrations.

## Relationships

users → watchlists → watchlist_items → companies; users → portfolios → positions → companies.
companies → documents → document_chunks; raw_blobs SHA-256 keys preserve originals.
documents → events → facts/changes/validations/briefs; changes reference current and optional previous facts.
event_sources and brief_sources preserve explicit evidence links; ai_runs record extraction/validation execution.
users own alerts/notifications/calendar items/feedback/ranked events/consented analytics. Jobs/rate limits/audit records are server-only.

Date/time columns normalize to UTC. Source date, precision and source timezone remain separate metadata.
Financial values use typed raw decimal strings or fixed precision numeric fields, not floating-point currency calculations.
Deletion policies preserve public provenance and intentionally cascade personal collections. RLS client access is separate from API ownership predicates.

## users

| Column | SQL type | Nullable | Relationship / constraint |
|---|---|---|---|
| display_name | VARCHAR(100) | False |  |
| density | VARCHAR(20) | False |  |
| onboarding_completed | BOOLEAN | False |  |
| analytics_consent | BOOLEAN | False |  |
| updated_at | DATETIME | False |  |
| id | VARCHAR(36) | False | PK  |
| created_at | DATETIME | False |  |

## companies

| Column | SQL type | Nullable | Relationship / constraint |
|---|---|---|---|
| name | VARCHAR(200) | False |  |
| ticker | VARCHAR(30) | False |  |
| market | VARCHAR(30) | False |  |
| provider | VARCHAR(20) | False |  |
| provider_company_id | VARCHAR(30) | False |  |
| is_demo | BOOLEAN | False |  |
| last_ingested_at | DATETIME | True |  |
| id | VARCHAR(36) | False | PK  |
| created_at | DATETIME | False |  |

## watchlists

| Column | SQL type | Nullable | Relationship / constraint |
|---|---|---|---|
| user_id | VARCHAR(36) | False | users.id |
| name | VARCHAR(100) | False |  |
| id | VARCHAR(36) | False | PK  |
| created_at | DATETIME | False |  |

## watchlist_items

| Column | SQL type | Nullable | Relationship / constraint |
|---|---|---|---|
| watchlist_id | VARCHAR(36) | False | PK watchlists.id |
| company_id | VARCHAR(36) | False | PK companies.id |
| created_at | DATETIME | False |  |

## portfolios

| Column | SQL type | Nullable | Relationship / constraint |
|---|---|---|---|
| user_id | VARCHAR(36) | False | users.id |
| name | VARCHAR(100) | False |  |
| id | VARCHAR(36) | False | PK  |
| created_at | DATETIME | False |  |

## positions

| Column | SQL type | Nullable | Relationship / constraint |
|---|---|---|---|
| portfolio_id | VARCHAR(36) | False | portfolios.id |
| company_id | VARCHAR(36) | False | companies.id |
| quantity | NUMERIC(28, 8) | False |  |
| average_cost | NUMERIC(28, 8) | True |  |
| currency | VARCHAR(3) | False |  |
| updated_at | DATETIME | False |  |
| id | VARCHAR(36) | False | PK  |
| created_at | DATETIME | False |  |

## raw_blobs

| Column | SQL type | Nullable | Relationship / constraint |
|---|---|---|---|
| sha256 | VARCHAR(64) | False | PK  |
| object_key | VARCHAR(150) | False | unique  |
| byte_length | INTEGER | False |  |
| content_type | VARCHAR(100) | False |  |
| created_at | DATETIME | False |  |

## documents

| Column | SQL type | Nullable | Relationship / constraint |
|---|---|---|---|
| company_id | VARCHAR(36) | False | companies.id |
| provider | VARCHAR(20) | False |  |
| external_id | VARCHAR(100) | False |  |
| title | VARCHAR(500) | False |  |
| form_type | VARCHAR(100) | False |  |
| source_url | TEXT | False |  |
| download_url | TEXT | False |  |
| published_at | DATETIME | False |  |
| publication_date | DATE | False |  |
| publication_precision | VARCHAR(20) | False |  |
| publication_timezone | VARCHAR(60) | False |  |
| ingested_at | DATETIME | False |  |
| provider_metadata | JSON | False |  |
| raw_sha256 | VARCHAR(64) | False | raw_blobs.sha256 |
| state | VARCHAR(30) | False |  |
| is_demo | BOOLEAN | False |  |
| id | VARCHAR(36) | False | PK  |
| created_at | DATETIME | False |  |

## document_chunks

| Column | SQL type | Nullable | Relationship / constraint |
|---|---|---|---|
| document_id | VARCHAR(36) | False | documents.id |
| ordinal | INTEGER | False |  |
| parser_version | VARCHAR(40) | False |  |
| text | TEXT | False |  |
| text_sha256 | VARCHAR(64) | False |  |
| char_start | INTEGER | False |  |
| char_end | INTEGER | False |  |
| location | VARCHAR(250) | False |  |
| id | VARCHAR(36) | False | PK  |
| created_at | DATETIME | False |  |

## ai_runs

| Column | SQL type | Nullable | Relationship / constraint |
|---|---|---|---|
| document_id | VARCHAR(36) | True | documents.id |
| user_id | VARCHAR(36) | True | users.id |
| stage | VARCHAR(40) | False |  |
| model | VARCHAR(100) | False |  |
| model_version | VARCHAR(100) | True |  |
| prompt_version | VARCHAR(80) | False |  |
| pipeline_version | VARCHAR(80) | False |  |
| status | VARCHAR(30) | False |  |
| latency_ms | INTEGER | True |  |
| input_tokens | INTEGER | True |  |
| output_tokens | INTEGER | True |  |
| cost_usd | NUMERIC(20, 8) | True |  |
| error_code | VARCHAR(100) | True |  |
| validation_result | JSON | False |  |
| finished_at | DATETIME | True |  |
| id | VARCHAR(36) | False | PK  |
| created_at | DATETIME | False |  |

## events

| Column | SQL type | Nullable | Relationship / constraint |
|---|---|---|---|
| company_id | VARCHAR(36) | False | companies.id |
| document_id | VARCHAR(36) | False | documents.id |
| run_id | VARCHAR(36) | False | ai_runs.id |
| revision | VARCHAR(100) | False |  |
| title | VARCHAR(500) | False |  |
| event_type | VARCHAR(40) | False |  |
| state | VARCHAR(30) | False |  |
| confidence | FLOAT | False |  |
| materiality | FLOAT | False |  |
| published_at | DATETIME | False |  |
| duplicate_of | VARCHAR(36) | True | events.id |
| published_to_users_at | DATETIME | True |  |
| id | VARCHAR(36) | False | PK  |
| created_at | DATETIME | False |  |

## facts

| Column | SQL type | Nullable | Relationship / constraint |
|---|---|---|---|
| event_id | VARCHAR(36) | False | events.id |
| chunk_id | VARCHAR(36) | False | document_chunks.id |
| field | VARCHAR(40) | False |  |
| quote | TEXT | False |  |
| value_raw | VARCHAR(100) | True |  |
| unit | VARCHAR(40) | True |  |
| period | VARCHAR(40) | True |  |
| scope | VARCHAR(30) | False |  |
| basis | VARCHAR(30) | False |  |
| validation_status | VARCHAR(30) | False |  |
| id | VARCHAR(36) | False | PK  |
| created_at | DATETIME | False |  |

## changes

| Column | SQL type | Nullable | Relationship / constraint |
|---|---|---|---|
| event_id | VARCHAR(36) | False | events.id |
| current_fact_id | VARCHAR(36) | False | facts.id |
| previous_fact_id | VARCHAR(36) | True | facts.id |
| field | VARCHAR(40) | False |  |
| change_type | VARCHAR(40) | False |  |
| comparison_kind | VARCHAR(40) | True |  |
| previous_value | TEXT | True |  |
| current_value | TEXT | True |  |
| absolute_change | VARCHAR(100) | True |  |
| percentage_change | VARCHAR(100) | True |  |
| materiality | FLOAT | False |  |
| confidence | FLOAT | False |  |
| id | VARCHAR(36) | False | PK  |
| created_at | DATETIME | False |  |

## event_sources

| Column | SQL type | Nullable | Relationship / constraint |
|---|---|---|---|
| event_id | VARCHAR(36) | False | PK events.id |
| chunk_id | VARCHAR(36) | False | PK document_chunks.id |
| role | VARCHAR(20) | False | PK  |

## briefs

| Column | SQL type | Nullable | Relationship / constraint |
|---|---|---|---|
| event_id | VARCHAR(36) | False | unique events.id |
| headline | VARCHAR(500) | False |  |
| what_happened | TEXT | False |  |
| interpretation | TEXT | False |  |
| uncertainty | TEXT | False |  |
| monitor_next | TEXT | False |  |
| template_version | VARCHAR(40) | False |  |
| id | VARCHAR(36) | False | PK  |
| created_at | DATETIME | False |  |

## brief_sources

| Column | SQL type | Nullable | Relationship / constraint |
|---|---|---|---|
| brief_id | VARCHAR(36) | False | PK briefs.id |
| fact_id | VARCHAR(36) | False | PK facts.id |

## validations

| Column | SQL type | Nullable | Relationship / constraint |
|---|---|---|---|
| event_id | VARCHAR(36) | False | events.id |
| claim_key | VARCHAR(120) | False |  |
| status | VARCHAR(40) | False |  |
| reason | VARCHAR(500) | False |  |
| validator_version | VARCHAR(60) | False |  |
| id | VARCHAR(36) | False | PK  |
| created_at | DATETIME | False |  |

## ranked_events

| Column | SQL type | Nullable | Relationship / constraint |
|---|---|---|---|
| user_id | VARCHAR(36) | False | users.id |
| event_id | VARCHAR(36) | False | events.id |
| score | FLOAT | False |  |
| breakdown | JSON | False |  |
| scoring_version | VARCHAR(40) | False |  |
| updated_at | DATETIME | False |  |
| id | VARCHAR(36) | False | PK  |
| created_at | DATETIME | False |  |

## alerts

| Column | SQL type | Nullable | Relationship / constraint |
|---|---|---|---|
| user_id | VARCHAR(36) | False | users.id |
| name | VARCHAR(100) | False |  |
| event_types | JSON | False |  |
| min_score | FLOAT | False |  |
| enabled | BOOLEAN | False |  |
| id | VARCHAR(36) | False | PK  |
| created_at | DATETIME | False |  |

## notifications

| Column | SQL type | Nullable | Relationship / constraint |
|---|---|---|---|
| user_id | VARCHAR(36) | False | users.id |
| alert_id | VARCHAR(36) | False | alerts.id |
| event_id | VARCHAR(36) | False | events.id |
| read_at | DATETIME | True |  |
| id | VARCHAR(36) | False | PK  |
| created_at | DATETIME | False |  |

## calendar_items

| Column | SQL type | Nullable | Relationship / constraint |
|---|---|---|---|
| user_id | VARCHAR(36) | True | users.id |
| company_id | VARCHAR(36) | True | companies.id |
| event_id | VARCHAR(36) | True | events.id |
| title | VARCHAR(200) | False |  |
| occurs_on | DATE | False |  |
| origin | VARCHAR(20) | False |  |
| chunk_id | VARCHAR(36) | True | document_chunks.id |
| quote | TEXT | True |  |
| id | VARCHAR(36) | False | PK  |
| created_at | DATETIME | False |  |

## feedback

| Column | SQL type | Nullable | Relationship / constraint |
|---|---|---|---|
| user_id | VARCHAR(36) | False | users.id |
| event_id | VARCHAR(36) | False | events.id |
| rating | VARCHAR(30) | False |  |
| comment | VARCHAR(1000) | False |  |
| state | VARCHAR(30) | False |  |
| id | VARCHAR(36) | False | PK  |
| created_at | DATETIME | False |  |

## user_events

| Column | SQL type | Nullable | Relationship / constraint |
|---|---|---|---|
| user_id | VARCHAR(36) | False | users.id |
| event_name | VARCHAR(60) | False |  |
| properties | JSON | False |  |
| id | VARCHAR(36) | False | PK  |
| created_at | DATETIME | False |  |

## jobs

| Column | SQL type | Nullable | Relationship / constraint |
|---|---|---|---|
| kind | VARCHAR(40) | False |  |
| dedupe_key | VARCHAR(250) | False | unique  |
| payload | JSON | False |  |
| state | VARCHAR(20) | False |  |
| attempts | INTEGER | False |  |
| max_attempts | INTEGER | False |  |
| available_at | DATETIME | False |  |
| lease_until | DATETIME | True |  |
| lease_token | VARCHAR(36) | True |  |
| worker_id | VARCHAR(100) | True |  |
| last_error | VARCHAR(500) | True |  |
| finished_at | DATETIME | True |  |
| id | VARCHAR(36) | False | PK  |
| created_at | DATETIME | False |  |

## provider_limits

| Column | SQL type | Nullable | Relationship / constraint |
|---|---|---|---|
| provider | VARCHAR(40) | False | PK  |
| next_request_at | DATETIME | False |  |

## rate_buckets

| Column | SQL type | Nullable | Relationship / constraint |
|---|---|---|---|
| key | VARCHAR(180) | False | PK  |
| hits | INTEGER | False |  |
| expires_at | DATETIME | False |  |

## audit_logs

| Column | SQL type | Nullable | Relationship / constraint |
|---|---|---|---|
| actor_id | VARCHAR(36) | True | users.id |
| action | VARCHAR(60) | False |  |
| target_id | VARCHAR(100) | False |  |
| details | JSON | False |  |
| id | VARCHAR(36) | False | PK  |
| created_at | DATETIME | False |  |

## eval_results

| Column | SQL type | Nullable | Relationship / constraint |
|---|---|---|---|
| dataset_name | VARCHAR(100) | False |  |
| dataset_sha256 | VARCHAR(64) | False |  |
| model_version | VARCHAR(100) | False |  |
| prompt_version | VARCHAR(80) | False |  |
| metrics | JSON | False |  |
| id | VARCHAR(36) | False | PK  |
| created_at | DATETIME | False |  |

## experiments

| Column | SQL type | Nullable | Relationship / constraint |
|---|---|---|---|
| name | VARCHAR(100) | False | unique  |
| hypothesis | TEXT | False |  |
| config | JSON | False |  |
| enabled | BOOLEAN | False |  |
| id | VARCHAR(36) | False | PK  |
| created_at | DATETIME | False |  |
