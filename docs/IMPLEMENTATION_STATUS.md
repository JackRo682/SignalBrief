> **2026-11-01 calendar and Saved follow-up — local gates passed, web deployment pending:** NVIDIA's official feed, durable automatic collection for supported new companies, explicit pending/refresh states, scope selection, and real first-save entry points are implemented. The full local gate passed with 620 backend tests (zero skips), 1,143 frontend tests in 97 files, build, lint and TypeScript; six Deno entrypoints and the scope guard passed. All 90 desktop/mobile browser cases passed. The calendar migration and collector updates are deployed; the web update and actual-account acceptance are in progress. See [current follow-up report](CALENDAR_AUTOMATION_AND_SAVED_2026-11-01.md) for the evidence and exact source-coverage limits. The production release recorded below remains the baseline until this follow-up is deployed.

> **2026-11-01 최종 운영 기능 보완:** 검색·기업 소개·Micron 공식 일정 수집·저장 흐름과 추가 실화면 회귀를 수정해 `85d3667a1bed15e71a534cf6161686d58419d7f5`를 운영 배포했다. Vercel `dpl_5GwC4oZFMor1g7Wxuzq1CArKQMLT`는 READY이며 운영 `/api/release`가 같은 커밋과 main을 반환한다. 최종 frontend 1,054건·94개 파일, TypeScript·lint·build, 로컬 및 정확한 커밋 CI의 desktop/mobile 84건이 통과했다. 변경 없는 backend의 전체 실제 PostgreSQL 검증은 571건·건너뜀 0건이다. 운영에서 LS 추가·새로고침, NAVER/LS/Micron 소개, SNDK 일반 공식 소개, Micron 과거 일정 3건, 저장 4개 왕복·필터·해제, 상세 회사 요약, 개인 기업 검색 Enter 방어를 확인했다. **검색 결과의 상세→뒤로→새로고침 최종 운영 단계는 Cold Turkey 차단으로 제한되며, 해당 자동 회귀는 통과했다.** 자료 지원 범위와 증거는 [최종 보고서](CROSS_SCREEN_RELIABILITY_2026-11-01.md)와 [구조화된 결과](../verification/cross-screen-2026-11-01.json)에 명시한다.
>
> 아래의 대기·이전 테스트 숫자는 각 기록 시점의 이력이다. 모든 종목의 자료 완비나 전체 제품의 버그 0개를 보증하지 않는다.

> 2026-11-01 07:23 UTC cross-screen repair: final8-stage local gate PASS (571 backend, zero skips;1,041 frontend/94files),84 desktop/mobile browser cases,6 Deno entrypoints and scope guard passed. Shared official pickers, source-backed introductions, Saved handling, and Micron Q4 calendar ingestion are implemented. Migrations20261101072153/55/57 and discovery5/calendar2 are live; actual Micron ingestion verified3events. Exact new commit CI, frontend deployment and signed-in production acceptance are pending. See [repair report](CROSS_SCREEN_RELIABILITY_2026-11-01.md).

> 최신 화면 간 기능 보완 — 2026-11-01 06:59:08 UTC: 관심기업·캘린더의 공식 기업 검색/선택, 기업 검색의 상충 안내와 결과 제한 순서, 공식 기본정보 소개, 저장 분류·필터·상태 문제를 수정했다. 전체 로컬 verifier 8단계가 **backend 545건/0 skip, frontend 1,005건/93개 파일**, production build·lint·typecheck와 함께 통과했으며 별도 scope guard·5개 Deno 진입점도 통과했다. **브라우저 84개 시나리오·새 배포·운영 인수는 아직 대기**다. Micron 공개 Q4 일정 feed는 별도 검증 중이며 adapter 완료로 판정하지 않는다. 이전 `16a3c74`의 브랜치·main CI는 모두 통과했다. 아래 과거 기록의 대기 문구는 당시 시점의 상태다. [상세 보고서](CROSS_SCREEN_RELIABILITY_2026-11-01.md) · [구조화된 검증 결과](../verification/cross-screen-2026-11-01.json).

> Latest home follow-up: source-backed discovery and profile loading are verified live on `ccc0ca4` (SEC 10,430 entries, DART 4,009 entries, NAVER 37 disclosures and a persistent verified profile). The all-company home news default now selects from existing supported queries while explicit selections remain authoritative. All eight local gates pass: 517 backend tests (zero skips), 961 frontend tests, build/lint/typecheck and scope guard. This UI-only follow-up needs its own browser CI and live home acceptance; existing provider/API coverage is unchanged.

> Latest November 1 compatibility repair: the actual official DART directory includes 72 six-character alphanumeric codes. Parser, database, discovery and profile validators now accept that authoritative format, retaining all identity/provenance checks. Exact-source local replay passes 4,009 listed identities; the combined full gate passes 517 backend tests (zero skips), 958 frontend tests, build/lint/typecheck, three Deno entrypoints and scope guard. A repeated-CI scroll assertion race is corrected without changing app behavior. Deployment and actual directory acceptance remain separate; see [Verification](VERIFICATION.md).

> November 1, 2026 reliability repair: home date defaults, company discovery/collection recovery, normalized search, approved numeric-source excerpts, calendar scope/coverage, and personal-event company binding are implemented and regression-checked. See [POST_LOGIN_RELIABILITY_2026-11-01.md](POST_LOGIN_RELIABILITY_2026-11-01.md) for observed defects, deployment dependencies and remaining source-coverage limits. This implementation status is separate from live deployment verification.

> DART CPU-offload follow-up: a live discovery v2 refresh hit HTTP 546 `WORKER_RESOURCE_LIMIT` at 2,002 ms CPU after the SEC directory saved 10,430 entries. Original ZIP archival and a short-lived signed, HMAC-authenticated Node parser now replace full XML work in Edge. All eight local verifier stages passed: **506 backend tests with zero skips, 930 frontend tests in 90 files**, plus Deno discovery/collector/profiles checks; the last unchanged-UI browser result is **80/80**. The large synthetic integration passed, but **deploy the Node route before the new discovery Edge version and verify an actual DART cold warm; that live confirmation is pending**. Production `9708e0d` home counts, calendar selection/navigation/detail and Apple manual refresh have been checked separately. [Verification](VERIFICATION.md) records the evidence and limits.

> Earlier November 1, 2026 release: The ten Korean post-login screens from the screenshot package were implemented and deployed. The new dashboard/directory RPC and calendar-interest removal migration were applied. Release code: `7a7dbc1ef6d29edda60493039a35fba976c64b7b`. Historical status tables below are retained as originally recorded. See VERIFICATION for current validation and limits.

> New local execution results: [LOCAL_VERIFICATION_2026-10-02.md](LOCAL_VERIFICATION_2026-10-02.md). Supplier results below are historical.

# Implementation status and scope decisions

Statuses are evidence boundaries, not a percentage of completion. See VERIFICATION for measured results.

| Area | Code present | Current boundary |
|---|---|---|
| Next web / 13 screen categories | Yes, real API calls and states | Syntax checked; package install/build/lint/type/E2E still unverified here |
| FastAPI / identity / portfolios | Yes | Local regression and asymmetric JWT verification tested; live OAuth not tested |
| PostgreSQL schema / RLS | 29 tables, 2 migrations | SQLite upgrade/downgrade tested; actual Postgres role test pending |
| DART / SEC ingestion | Provider abstraction and CLI implemented | Mock transport fixtures tested; no live credentials/network verification |
| Original raw source / provenance | Local + private Supabase storage adapters | Local hashes, identity conflict, originals tested; live bucket not connected |
| Job queue | Retry/backoff, quota, leases, outbox | SQLite lifecycle/concurrency regressions tested; actual PG locks pending |
| Extraction / citations | Structured OpenAI, strict quote/number/context checks | Conservative; live financial semantic accuracy not claimed |
| Change comparison / ranking | Deterministic and evidence-linked | Real price reaction unavailable, membership not market value weighting |
| Brief / follow-up | Extractive answers + contextual templates | Not an unrestricted free-form financial analyst |
| Approval / Ops | Admin-only review/reject/rerun/duplicate/audit | Live defaults to manual review; operating team is not supplied |
| Alerts / calendar | App notifications, manual/explicit source dates | No email/push or inferred calendar coverage |
| pgvector | Optional model-specific index/query implemented | Not required by default flow; live SQL/embedding integration untested |
| PostHog / Sentry | Consent-aware export/error integration | Real project keys/account transport untested |
| Evaluation | Runner + 120 synthetic cases + reports | Not the independently expert-labeled 100–150 real-case Gold Dataset |
| Deployment | Docker, Render, CI, Vercel runbook | Not built/deployed on real accounts here |

## P0 before public beta
Install dependencies, fix any lint/type/build errors, lock versions and audit them. Run desktop/mobile E2E and actual PostgreSQL
RLS isolation tests. Configure Google OAuth/keys/private durable bucket and test real providers. Human-review real financial
extraction/false acceptance. Validate backups/restore and finalized privacy/operating information. Verify HTTPS production auth.

## Declared deferred/non-goal work
PDF/OCR and over-budget document support; unrestricted semantic entailment; full XBRL taxonomy; exhaustive issuer coverage;
market feed / stock-price overlays / market-value position weights; real-world labeled Gold Dataset; email/push; payments and
native apps. Some are extensions, some are deliberate non-goals. Do not rebrand them as already complete.
