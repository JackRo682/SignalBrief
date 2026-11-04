# Finite official calendar notices

Status: code and local evidence replay verified. Production deployment and native PostgreSQL / browser CI acceptance remain separate release gates.

## Evidence and authorization

The automatic IR collectors do not cover every official proxy, dividend notice,
capital-action disclosure or separately dated conference segment. This additive
path imports a finite researched notice; it never infers an earnings date,
replaces a complete calendar or approves an analysis. Unknown publication dates
and timezones remain null. Calendar dates are date-only; any source time remains
in the verbatim quote.

Stable source identity combines provider, canonical provider company ID and the
SHA-256 of the canonical notice URL. Existing company/source identities and Saved
IDs remain intact. A changed manifest at an existing URL raises
`notice_revision_requires_review`, requiring explicit reviewed reconciliation.

Trusted operations prepare actual downloaded original bytes. Service-only RPCs
validate the canonical issuer and official URL scope: issuer-specific corporate
prefix, SEC archive CIK, or existing DART issuer-bound receipt plus archived
official list. Date tokens, event roles, quote locations, publication metadata
and date ranges are independently checked in PostgreSQL. No new branch fetches
an input URL; this adds no arbitrary outbound URL or SSRF surface.

Bounded 64,000-byte chunks stage the original. Dispatch verifies its assembled
length and SHA-256, then uses the existing durable queue and one-use task nonce.
Both payload retrieval and ingestion require the claimed, unfinished, unexpired
task to match that running source. The worker uses its existing server client;
there is no new public authorization route or exported service credential.

The worker recomputes original, normalized and manifest hashes. HTML and the
explicit LS ELECTRIC news JSON format are deterministically re-normalized. It
uploads three immutable objects with `upsert:false`: original bytes, normalized
text and complete manifest. Ingestion then revalidates the staged evidence and
all three storage objects. No fabricated storage metadata is part of this flow.

PDF extraction uses genuine local `pdftotext -layout -enc UTF-8` output and records
the extractor version. The worker verifies the PDF signature and hashes but does
not independently rerun PDF extraction. This is an explicit trusted offline
extraction boundary; model-reconstructed text is not acceptable.

The new publication branch preserves `sb_calendar_confirmed`'s OID and grants,
so existing RLS, subscription and Saved callers all apply it. Old source
validators are copied unchanged to a private helper. Temporary chunks are
removed only after immutable archival and successful publication. Completed
task retries do not require deleted chunks. Finite sources are absent from
`calendar_source_catalog`, so ordinary refresh does not requeue them.

## Preparation

Use Node 22 with TypeScript stripping. To inspect exact normalized evidence:

```sh
node --experimental-strip-types scripts/prepare_calendar_notice.mjs \
  --normalize /absolute/path/original.html --format html --encoding utf-8 \
  --document-url https://official.example/path --out /absolute/path/normalized.txt
```

Use genuine DART raw bytes and their observed `euc-kr` or `utf-8` encoding.
The exact `dart4.xsd` viewer variant requires UTF-8. Supported formats are `html`,
`pdf` and the explicit LS ELECTRIC board `json` response.

Each input JSON object has `company_id`, `provider`, `provider_company_id`,
`ticker`, `source_url`, `document_url`, `raw_path`, `format`, `encoding`,
`fetched_at`, nullable `published_on` / `publication_timezone`, exact
`issuer_quote`, and an `entries` array. Each entry contains `key`, `title`,
`event_type`, `occurs_on`, exact `quote`, and exact `date_token`.

Event types: `annual_meeting`, `conference`, `exhibition`, `dividend_record`,
`dividend_payment`, `dividend_ex`, `bond_payment`, `equity_payment`,
`new_share_listing`. Combined record/ex-dates may be one record event with both
roles explicitly stated in its title and quote. A subsidiary action disclosed
by a parent must identify the actual subsidiary in its title.

Partial month/day tokens require a same-document `year_context_quote` and
`year_context_token`. A four-digit year must be in an explicit event context.
Ranges add `ends_on` and `end_date_token`, span at most 31 days, and include both
ISO dates in the title. Compressed end days use the verified start month/year.
The helper generates code-point offsets, hashes, paths and publication precision.

```sh
node --experimental-strip-types scripts/prepare_calendar_notice.mjs \
  --input /absolute/path/specs.json --out-dir /absolute/path/prepared
```

The index points to one JSON file per notice, containing `stage`, `chunks`,
`dispatch` and a readable `manifest`. Preserve the original files and prepared
operational evidence; real source documents are not committed as synthetic tests.

## Release and import

1. Pass exact-source `signalbrief-verification` (including browser E2E) and
   `official-calendar-verification`. Calendar CI runs native PostgreSQL 17 and
   all existing calendar suites plus `tests/test_calendar_curated_notices.py`.
   Run `python scripts/verify.py --full` as required by the repository contract.
2. Apply `20261104121333_curated_official_calendar_notices.sql`. It publishes
   nothing, dispatches nothing and leaves `notice_ready=false`.
3. Deploy the existing `signalbrief-calendar` function with the new module and
   entrypoint, preserving its existing authentication/configuration. No frontend
   change is necessary for the new data.
4. Call `sb_calendar_notice_worker_ready` with `{"version":"curated-notice-v1"}`
   only after verifying the deployed worker version.
5. For each prepared file, call `sb_calendar_notice_stage` with its exact `stage`
   object (`manifest_text`, `normalized_text`). Call `sb_calendar_notice_chunk`
   for each `chunks` object (`source`, `part`, `data_base64`) in order. Exact
   duplicate chunks are idempotent; changed chunks are rejected.
6. Call `sb_calendar_notice_dispatch` with its `dispatch` object. A zero result
   may mean the existing two-worker limit is busy; pending work is durable and
   hands off automatically. Never manufacture tokens or bypass ingestion.
7. Inspect source errors, `calendar_runs`, `calendar_refresh_queue`, staging
   completion and expected published rows. Verify `sb_calendar_confirmed(id)`,
   original/hash provenance, dates, quotes, ranges and signed-in company Upcoming
   sections. Avoid duplicate generic/segment entries. This path never withdraws
   another source's events.

Edge dependency closure: `signalbrief-calendar/{index,core,curated-notice,
micron-q4,dart-ir,sec-ir,source-relay,public-source}.ts`,
`signalbrief-collector/{core,dart-relay}.ts`, `signalbrief-api/us-core.ts` and any
imports in the exact deployed version. Preserve the existing npm dependencies.

## Pause and rollback

Set `calendar_worker_control.notice_ready=false` and disable affected source
rows where `adapter='curated-notice'`. Disabled sources become invisible through
the publication predicate. Keep originals, snapshots and Saved identities. Allow
the existing short lease of any running task to finish/expire, then inspect its
queue state before changing or re-enabling the deployment.

To restore the original predicate, keep curated sources disabled and obtain
`pg_get_functiondef('app_private.calendar_confirmed_before_notices(text)'::regprocedure)`.
Replace only that function name with `app_private.sb_calendar_confirmed` using
`CREATE OR REPLACE`, preserving the original OID and grants. Do not rename a
function, because existing RLS policies bind to OIDs. Do not delete referenced
snapshots or Saved records. Later corrections need explicit reviewed reconciliation.

## Local verification

- Shared preparation and dry-run archival accepted all 16 researched notices /
  27 proposed events, retaining genuine originals.
- PGlite applied the migration on the actual repository calendar test baseline,
  then staged, dispatched, claimed, ingested and verified visibility for all 16
  notices / 27 events. This is additional validation, not native PostgreSQL CI.
- Focused Vitest: 259 tests in five files passed, including evidence, immutable
  archival, worker authorization handoff and old source regressions. TypeScript,
  Ruff and diff whitespace checks passed. 51 native PostgreSQL tests collected.
- Local native PostgreSQL is unavailable: no installed binaries and the
  container cannot perform installation's required user/group changes.
- Local Deno check reached dependency resolution but could not connect to the
  npm registry. Calendar CI must complete the Deno and native database gates.
