# Listed-universe registration and coverage

## Purpose and evidence boundary

The company directory already contained many official SEC and DART identities, but registration and collection covered only selected issuers. This change imports authoritative listing snapshots, preserves each observed security alias, registers mapped issuers in bounded batches, and measures content coverage separately from registration. It does not approve analysis or infer an event when no official future date is available.

`companies` remains the canonical disclosure issuer, with its existing unique `(provider, provider_company_id)` identity. A listed security is a separate `universe_listings` row keyed by source, exchange and symbol. Several share classes may point to one company. Existing company IDs, names and canonical tickers are preserved. Newly registered companies use the authoritative provider directory's issuer name and prefer a common or ordinary equity ticker over a preferred class.

### Reviewed listing sources

| Source | Declared coverage | Evidence boundary |
|---|---|---|
| [Nasdaq Trader consolidated symbol directory](https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqtraded.txt) | All listed securities represented by that official export | Preserve test, ETF and other instrument flags; eligible equity scope is an explicit deterministic classification. A missing classification remains an identified gap. `Nasdaq Traded=N` is not a delisting flag. |
| [KIND company export](https://kind.krx.co.kr/corpgeneral/corpList.do), `marketType=stockMkt` | KOSPI issuer primary listings | The export is an issuer directory, not a complete inventory of preferred or additional share classes. |
| [KIND company export](https://kind.krx.co.kr/corpgeneral/corpList.do), `marketType=kosdaqMkt` | KOSDAQ issuer primary listings | The same limitation applies. Exact POST fields and all observed table cells are retained. |
| [SEC exchange directory](https://www.sec.gov/files/company_tickers_exchange.json) | Issuer/CIK mapping evidence | This source alone does not establish current exchange eligibility; it also contains OTC and unclassified entries. |
| [OpenDART corporation directory](https://opendart.fss.or.kr/api/corpCode.xml) | Issuer/corporation-code mapping evidence | A generic `KR` row alone does not establish KOSPI/KOSDAQ classification. |

At the research checkpoint on November 4, the current KIND primary exports contained 829 KOSPI and 1,829 KOSDAQ rows. Two same-day KOSDAQ listings were not in the latest archived DART stock-code directory and remain eligible but unresolved. They are counted in the requested listing denominator and do not receive guessed company IDs. A separate November 3 security summary cannot be represented as November 4 complete share-class coverage.

The initial U.S. export contained 13,275 rows. All rows remain evidence, including tests and excluded products. The deterministic reviewed classifier identified 6,286 eligible securities, with 6,278 mapped rows representing 5,790 CIKs and eight unresolved eligible rows. An additional 113 rows had unresolved instrument classification. These are research/import inputs, not a claim that all companies already have collected filings, future calendar events, or approved analysis.

## Archive and import contract

The `listed-universe-v1` manifest contains the exact authority, request method and fields, declared coverage scope, source date, fetch time, raw SHA-256 and byte length, parser version, completeness flag, and every normalized row. Each row retains the observed source row index and source fields. Mapped rows name the canonical provider ID, exact directory ticker and archived directory SHA. Unresolved and ambiguous rows have null mapping fields.

The database validates source/market/request bindings, freshness, row bounds, duplicate identities and source coordinates. Mappings require an active canonical directory identity backed by its immutable archive. A ticker shared by multiple active provider IDs is rejected. KIND mappings also require the exact issuer name. The worker independently reparses the supplied original bytes and verifies every normalized source row, classification, alias, completeness count and source date before uploading anything.

Originals and normalized manifests are uploaded with `upsert=false` to the private `signalbrief-raw` bucket:

- `universe/raw/<source_key>/<raw_sha256>.bin`
- `universe/manifests/<manifest_sha256>.json`

An existing object is accepted only after its actual bytes, length and hash are verified. The completion RPC requires both real Storage objects with exact metadata byte lengths, the claimed one-use task, and the declared hashes. SQL and worker source validation complement each other; neither a fabricated archive row nor a caller-supplied company ID is sufficient.

Large manifests use bounded UTF-8 text parts. Raw originals use bounded binary parts. Changed parts are rejected, complete byte length and SHA are checked before use, and successful completion removes temporary chunks. Snapshot manifests remain immutable. A complete new snapshot marks absent records `missing_from_latest`; it does not invent a confirmed delisting. An issuer identity change becomes an explicit conflict. A greater-than-10% snapshot shrink stops for review rather than silently removing a market.

### Service-only RPC sequence

All mutation and worker RPCs reject `anon` and `authenticated`. No user identity is impersonated and the existing user activation limit of 25 new companies per day is unchanged.

1. Prepare and inspect the complete normalized manifest and actual original file.
2. For small inputs, call `sb_universe_stage(manifest_text)`. For large inputs, call `sb_universe_manifest_begin(digest, total_bytes, total_parts)`, upload zero-based `sb_universe_manifest_part(digest, part, text_chunk)` parts, then call `sb_universe_manifest_commit(digest)`. Each text part is at most 64,000 UTF-8 bytes and must end at a Unicode character boundary; total text is at most 20 MB and 313 parts.
3. Upload original bytes using zero-based `sb_universe_chunk(snapshot_id, part, data_base64)`. Each decoded part is 64,000 bytes except the final part; total raw size is at most 10 MB.
4. Deploy the matching Edge worker, then explicitly call `sb_universe_worker_ready('listed-universe-v1')`.
5. Call `sb_universe_dispatch(snapshot_id)`. It creates a five-minute, one-use token and dispatches through `pg_net`. It never returns the plaintext token to a client.
6. The worker claims with `sb_universe_claim(h)`, independently validates the originals and rows, archives both objects, and completes with `sb_universe_finish(h, raw_sha256, raw_object_key, manifest_sha256, manifest_object_key)`. A failed task records a bounded error with `sb_universe_fail(h, code)`; at most three dispatch attempts are allowed.
7. After checking applied counts and unresolved cases, call `sb_universe_register(batch_size)` repeatedly. Each transaction creates at most 100 issuers; the default is 50. Replays attach existing aliases and create no duplicate issuers.

Registry activation preserves the existing calendar and reported-data onboarding triggers. It does not synchronously hydrate thousands of companies or add them to anyone's personal watchlist, holdings or calendar. Source sync is explicit and repeatable; this change does not claim an unattended daily listing-download job is enabled.

## Bounded collection and quotas

The existing `sb_us_reserve` function and model review functions are unchanged. Provider reservations remain 500 per provider per UTC day, and OpenAI remains capped at 20 calls and the configured approved daily budget, currently $1. Calendar SEC/DART requests now reserve through `sb_calendar_provider_reserve`; its 250-call suballocation is inside the global 500, leaving at least 250 reservations for the other paths. This is a reservation limit, not a throughput or complete-content guarantee.

The calendar dispatcher retains its two-worker concurrency limit. It skips SEC/DART-backed sources when their calendar allocation or global provider capacity is exhausted, without launching a worker or consuming a retry. Other adapters retain their existing behavior. Known daily quota errors defer work to the next UTC day and refund the queue attempt. A transient HTTP rate-limit response is not automatically treated as an exhausted daily allowance.

Metadata candidates remain at most one SEC issuer and one DART issuer per collector run. Each candidate receives a five-minute lease. Three of every four selection turns prefer issuers without a completed first collection; the fourth services stale previously collected issuers, prioritizing watched or held issuers within that group. Failed work rotates with backoff. A pre-upgrade collector that cannot call the new finish RPC is reconciled using its actual persisted ingestion timestamp after lease expiry.

A DART issuer with no completed collection first requests the previous 550 days of final periodic-report metadata through the already deployed signed `periodic_list` relay. This is one provider reservation, with `pblntf_ty=A`, `last_reprt_at=Y`, page 1 and count 100. The issuer-scoped window is allowed by the [official OpenDART list contract](https://opendart.fss.or.kr/guide/detail.do?apiGrpCd=DS001&apiId=2019001); its three-month restriction applies when no issuer is specified. The collector requires a complete single-page response, validates issuer/ticker, receipt, dates and supported periodic titles, archives original UTF-8 bytes, and saves every validated row before advancing `last_ingested_at`. Multi-page, inconsistent or unsupported responses remain explicit failures. Official no-data status remains `not_available`. This metadata pass uses no model calls; document processing and human review remain separate. Previously collected issuers retain seven-day, amendment-inclusive polling.

The collector must pass `collection_lease_id` to `sb_collection_finish(company_id, result_status, result_code, lease_id)`. An expired or wrong lease cannot clear a newer claim. Financial collection, SEC analysis and DART document processing distinguish daily quota deferral from a permanent parsing or evidence error. Deferral does not exhaust the existing retry budget or approve a draft.

At the unchanged 15-minute collector schedule there are at most 96 runs per day. First collection for thousands of issuers therefore takes sustained background work. The 20-call model cap alone allows at most 20 new drafts per day; one draft for approximately 8,446 mapped issuers would require at least 423 days if every call succeeded and served a distinct issuer. Human review remains a separate necessary step. Registration counts must never be presented as content completion.

## Customer coverage and search

`sb_universe_coverage()` is authenticated, MFA/rate checked, and returns compact per-market counts for observed listings, eligible listings, known exclusions, held instrument classifications, unresolved identities, mapped and registered issuers, issuers with collected filings, issuers with pending review, issuers with approved analysis, and issuers with verified upcoming calendar events. The 113 held U.S. classifications are separate from both known nonstock exclusions and the eight unresolved eligible issuer mappings. Counts are aggregated by issuer within each market; they must not be summed into a global unique-issuer total because a company may have listings in multiple markets.

Source rows include their original public URL, exact coverage scope, source date, fetch time and freshness status. A source older than 72 hours is labeled stale. Calendar dates use the user's saved timezone, defaulting to Asia/Seoul. Private raw paths, worker tokens and staged manifests are not returned.

Existing filtered discovery gains current market classification and registered listing aliases. It retains canonical SEC aliases and the existing activation contract. Unresolved listings do not receive an activatable company ID. The company-page monitoring request accepts only an explicit set of at most 50 UUIDs; an empty set yields empty monitoring. This prevents the visible page from requesting a full-market per-company monitoring payload.

## Verification and release sequence

The focused PostgreSQL tests replay the actual repository baseline and migrations with synthetic Auth, Storage and `pg_net` platform fixtures. They cover role isolation, source/identity ambiguity, immutable chunks and manifests, complete archives, canonical alias registration, snapshot correction conflicts, missing-record semantics, bounded page monitoring, quota allocation and rollback, leases, fair selection and quota retry behavior.

Local supplemental PGlite replay is available as development evidence, and is explicitly not native PostgreSQL acceptance. The required release gate remains the repository's `Workspace schema security replay` workflow with native PostgreSQL 17, plus the full verifier and browser checks required by `AGENTS.md`.

Deploy the tested SQL migrations and matching collector/calendar/universe workers before enabling the universe archive worker or importing data. Verify archive byte lengths and hashes, snapshot row counts, all registration deltas, unchanged original company IDs and approval counts, and actual coverage predicates after each import. No production import or all-market content completion is claimed by this document.

Rollback is operationally reversible: stop new universe dispatches, disable the private universe worker readiness flag, and stop batch registration. Retain immutable snapshots and existing issuer/content records for audit. Do not delete canonical companies or lower evidence/approval predicates to reverse an import. A mapping conflict or materially smaller snapshot requires a new reviewed correction path.

## Local release validation recorded before deployment

The final local full verifier completed all eight stages successfully. Frontend tests passed 1,920 cases in 130 files; TypeScript, lint and production build passed. The local Python run passed 364 cases and skipped 840 database-dependent cases because a native disposable PostgreSQL service is unavailable in this workspace. Those skips are not database acceptance. The existing CI workflows provide native PostgreSQL and browser gates before deployment. The independently reviewed supplemental universe SQL replay passed 36 cases.

The full 13,275-row U.S. original and both Korean issuer exports pass the actual offline source validator. The worker-shaped full U.S. payload passed a separate Node transport replay; that result does not replace live Edge memory/CPU acceptance. Imports must be dispatched serially and observed before activation.
