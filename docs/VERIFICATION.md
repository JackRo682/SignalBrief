> **2026-11-01 calendar and Saved follow-up — web live, correction backend verified; new source CI/promotion pending:** Production https://signalbrief.online serves `a28ca633990b2e6dcd3dbeb54b7080e0566ecdeb` on Vercel `dpl_8iTtkirZK81iz1mrPci8vgHrUHVk` (READY); its exact CI and 90 desktop/mobile browser cases passed. Calendar Edge v4, discovery v6, migrations `20261101103903` and `20261101111341`, and the worker are active. The final correction-phase local gate passed all eight stages with 660 backend tests (zero skips) and 1,162 frontend tests in 97 files; parser 58, independent correction SQL 40 and combined calendar PostgreSQL 116 passed. Live NVIDIA, Kakao/SK correction ingestion, fresh LG Electronics registration with automatic collection, and the three-type Saved save/reload/filter/remove flow passed; test bookmarks and the temporary NVIDIA follow were removed, with history OFF preserved. The correction source is not yet committed/promoted through its own exact CI at this checkpoint. Samsung and unsupported-feed limitations remain explicit. See the [current follow-up report](CALENDAR_AUTOMATION_AND_SAVED_2026-11-01.md); older entries below retain their historical status.

> **2026-11-01 최종 운영 기능 보완:** 검색·기업 소개·Micron 공식 일정 수집·저장 흐름과 추가 실화면 회귀를 수정해 `85d3667a1bed15e71a534cf6161686d58419d7f5`를 운영 배포했다. Vercel `dpl_5GwC4oZFMor1g7Wxuzq1CArKQMLT`는 READY이며 운영 `/api/release`가 같은 커밋과 main을 반환한다. 최종 frontend 1,054건·94개 파일, TypeScript·lint·build, 로컬 및 정확한 커밋 CI의 desktop/mobile 84건이 통과했다. 변경 없는 backend의 전체 실제 PostgreSQL 검증은 571건·건너뜀 0건이다. 운영에서 LS 추가·새로고침, NAVER/LS/Micron 소개, SNDK 일반 공식 소개, Micron 과거 일정 3건, 저장 4개 왕복·필터·해제, 상세 회사 요약, 개인 기업 검색 Enter 방어를 확인했다. **검색 결과의 상세→뒤로→새로고침 최종 운영 단계는 Cold Turkey 차단으로 제한되며, 해당 자동 회귀는 통과했다.** 자료 지원 범위와 증거는 [최종 보고서](CROSS_SCREEN_RELIABILITY_2026-11-01.md)와 [구조화된 결과](../verification/cross-screen-2026-11-01.json)에 명시한다.
>
> 아래의 대기·이전 테스트 숫자는 각 기록 시점의 이력이다. 모든 종목의 자료 완비나 전체 제품의 버그 0개를 보증하지 않는다.

> 2026-11-01 07:23 UTC cross-screen repair: final8-stage local gate PASS (571 backend, zero skips;1,041 frontend/94files),84 desktop/mobile browser cases,6 Deno entrypoints and scope guard passed. Shared official pickers, source-backed introductions, Saved handling, and Micron Q4 calendar ingestion are implemented. Migrations20261101072153/55/57 and discovery5/calendar2 are live; actual Micron ingestion verified3events. Exact new commit CI, frontend deployment and signed-in production acceptance are pending. See [repair report](CROSS_SCREEN_RELIABILITY_2026-11-01.md).

> 최신 로컬 통합 검증 — 2026-11-01 06:59:08 UTC: 이번 검색·선택·소개·저장 보완의 `verify.py --full` 8단계가 통과했다. **Backend 545건·0 skip·기존 deprecation 2건, frontend 1,005건/93개 파일**, TypeScript·Ruff·Next production build 통과, ESLint 오류 0건·기존 경고 5건이다. 별도 scope guard(보호 파일 90개/유지 기능 17개/진입점 2개)와 Deno API·US·profiles·discovery·collector도 통과했다. **브라우저 84개 시나리오·새 릴리스 CI·배포·운영 인수는 대기**이며, 검토 중인 Micron Q4 adapter를 이 결과에 포함해 완료로 주장하지 않는다. 이전 `16a3c74` 브랜치·main CI는 모두 통과했다. 이번 실행은 별도 보존한 실행 결과를 근거로 하며, 아래 역사적 로그와 혼동하지 않는다. [보고서](CROSS_SCREEN_RELIABILITY_2026-11-01.md) · [구조화된 결과](../verification/cross-screen-2026-11-01.json).

> November 1, 2026 home-news follow-up: the full local gate passes all eight stages with **517 backend tests and zero skips**, **961 frontend tests in 90 files**, TypeScript, Ruff, lint and production build; the scope guard passes. Two default-news regressions failed before the fix, and all 20 focused component/API checks pass afterward. The already deployed `ccc0ca4` directory/profile repair passed both repair-branch and main CI, each with 80 browser cases, and actual production acceptance completed: SEC 10,430 / DART 4,009 entries (including 72 alphanumeric codes), NAVER profile plus 37 disclosures, reload, ticker/KOSPI search and alphanumeric lookup. Home shows 76 / 26 / 3. The small home-news follow-up still requires its own CI browser run and live default-news check before acceptance.

> November 1, 2026 final alphanumeric-compatibility gate: all eight full-verifier stages passed with **517 backend tests, zero skips**, **958 frontend tests in 90 files**, TypeScript, Ruff, production build and ESLint (zero errors; five existing warnings). Deno discovery/collector/profiles and the scope guard passed. The four real PostgreSQL databases cover 32 discovery/calendar regressions, including 11 new format cases. The exact archived official DART source now parses all **4,009 listed identities**, including **72 alphanumeric codes**, with its original SHA and archive checks intact. The prior `c1d43da` repair-branch CI passed its own **80 browser cases**; its repeated main run exposed an asynchronous test assertion, now fixed and included in this combined local gate. The latest commit still requires independent CI and a successful post-deployment directory warm. [Repair report](POST_LOGIN_RELIABILITY_2026-11-01.md) and [structured results](../verification/post-login-2026-11-01.json) retain the evidence and historical failures.

> November 1, 2026 earlier DART CPU-offload gate: `python scripts/verify.py --full` passed all eight stages, including **506 backend tests with zero skips** against four disposable loopback PostgreSQL databases and **930 frontend tests in 90 files**. TypeScript, Ruff, ESLint and production Next build passed; ESLint has zero errors and five existing navigation warnings. Deno checks passed for discovery, collector and profiles. The last browser result remains **80/80 desktop/mobile cases**; this server-only follow-up did not rerun the unchanged UI suite. The scope guard retains its 24 passing regressions, and discovery/calendar migrations have 21 real-PostgreSQL regressions. [Repair report](POST_LOGIN_RELIABILITY_2026-11-01.md) and [structured results](../verification/post-login-2026-11-01.json) separate local gates from live verification.

> The live discovery v2 refresh at **2026-11-01 05:12:13 UTC** hit **2,002 ms CPU**, HTTP **546 / WORKER_RESOURCE_LIMIT**, after SEC saved **10,430 entries**. The repair archives the original DART ZIP before a signed, HMAC-authenticated Node parse; Edge verifies only the bounded hash-bound result. The **Node route must deploy before the new discovery Edge version**. A local synthetic integration processed 224,000 issuers / 52,391,577 XML bytes, returning 4,000 listed identities: Node wall **1,173.32 ms**, CPU **1,271.36 ms**. This is not live timing evidence; the actual DART cold warm remains pending.

> Live UI checks on `9708e0d` confirmed the default home counts **63 / 26 / 3**, calendar Apple selection and coverage messaging, nearest-event navigation to October 29, and Microsoft future-event detail. Apple's manual official-data refresh succeeded at **14:22 KST (05:22 UTC)**. These checks do not certify DART registry completion or fresh OAuth login. Earlier verification history follows.

> Earlier November 1, 2026 workspace redesign: 792 frontend tests passed (82 files), TypeScript passed, ESLint passed with five existing warnings, Next.js production build passed, and Python compilation/Ruff/OpenAPI export passed. The backend recheck passed 357 tests with 121 PostgreSQL-dependent skips after installing the execution environment's missing SOCKS support. The supplied 41 source files matched the package byte-for-byte. Vercel preview and production builds reached READY. Production `/api/release` returned commit `7a7dbc1ef6d29edda60493039a35fba976c64b7b`. The migration was applied to the existing Supabase project; both new read operations returned real data in a rolled-back authenticated transaction, unauthenticated calls were rejected, and anonymous EXECUTE privileges are absent. Security advisors showed no new findings. A separate disposable PostgreSQL server and automated browser regression suite were unavailable; live browser smoke checks are separate from that suite. Live Google OAuth, calendar-provider refresh, and notification delivery are not newly validated by this release. Historical reports follow.

> New local execution results: [LOCAL_VERIFICATION_2026-10-02.md](LOCAL_VERIFICATION_2026-10-02.md). Supplier results below are historical.

# 실제 검증 결과 — SignalBrief

검증 기준 시각: 2026-10-02T10:34:04.134253+00:00 (UTC). 작성 환경: Python 3.13.5, Node 22.16.0.

## 실행한 검사

| 검사 | 결과 | 근거 |
|---|---|---|
| 백엔드 pytest | **210 통과 / 1 건너뜀 / 실패 0** | `verification/backend_tests.log`, `pytest.xml` |
| Python 컴파일 | 통과 | `verification/python_compile.log` |
| SQLite 고정 마이그레이션 왕복 | 통과 | `tests/test_migrations.py` 회귀 |
| 비대칭 JWT 서명·issuer/audience/role 거부 | 통과 | 실제 로컬 암호키 사용 테스트; Google 로그인 실검증은 아님 |
| 백엔드 실행문 커버리지 | **79.84%** (2428/3041) | `verification/coverage.json`, `coverage.log` |
| TypeScript/TSX 문법 변환 | 42개 파일, 문법 오류 0 | `verification/typescript-syntax.json`; 전체 타입 검사 아님 |
| OpenAPI 내보내기 | 36개 path 생성 | `packages/shared/openapi.json` |
| 합성 평가 실행 | 120개 사례 실행, 해당 회귀의 기대 결과 일치 | `evals/reports/` JSON/Markdown |
| YAML 문법 | Docker Compose / Render / CI 파싱 성공 | Python YAML parser; 실제 배포 검증 아님 |

pytest의 건너뜀 1개는 실제 PostgreSQL 서버가 필요한 마이그레이션/RLS 테스트입니다.
커버리지 수치는 실행문 기준이며 기능 완성도·보안 보증·제품 정확도 비율이 아닙니다.
커버리지 실행의 경고 2개는 로그에 그대로 남겼습니다.

## 합성 평가의 해석

분류/사실/변경/인용 회귀 지표가 이 합성 사례에서 1.0이고 잘못된 후보 수락이 0인 결과입니다.
**실제 공시에서 AI 정확도 100%라는 뜻이 아닙니다.** 외부 OpenAI 호출 없이 합성 문법 추출기와
근거/숫자/맥락 검사·Decimal 비교를 실행했습니다. 전문가가 독립 검수한 실제 Gold Dataset은 없습니다.
평가 파일의 데이터셋 해시와 사례별 분모·오류 조건을 확인할 수 있습니다.

## 미실행 / BLOCKED

이 환경에서는 `registry.npmjs.org` DNS 조회가 실패했고 JS 패키지와 Ruff가 설치되어 있지 않았습니다.
따라서 Ruff, ESLint, 전체 TypeScript 타입검사, Vitest, **Next.js production build**는 확인하지 못했습니다.
`python scripts/verify.py --full`은 이 항목을 BLOCKED로 기록하고 **종료 코드 1**을 반환합니다.
프론트 소스 작성·문법 검사를 빌드 성공으로 대신하지 않았습니다. 실제 설치 후 린트/타입/빌드 오류를 고쳐야 합니다.
Playwright 테스트 파일은 포함했지만 실제 브라우저 실행은 하지 않았습니다.

PostgreSQL/RLS 실제 역할 격리, Supabase 비공개 Storage, Google OAuth redirect,
실제 DART/SEC 다운로드, 실제 OpenAI 추출, pgvector SQL/embedding 연결, PostHog/Sentry 계정 전송,
Docker 이미지 및 Compose, Render/Vercel 배포, 의존성 감사와 백업 복원은 실행하지 않았습니다.
재현용 테스트/설정/실행 절차는 포함했지만 그 존재를 성공으로 간주하지 않습니다.

## 수정 후 통과한 주요 회귀

SQLite 작업 큐의 naive/aware 시각 비교를 UTC 컬럼 처리로 통일했습니다.
평가 이력의 ORM 필드명을 실제 schema와 일치시켰습니다.
마지막 요청 타임아웃 또는 불완전 usage가 비용 0으로 보고되지 않게 했습니다.
동일 공시 동시 처리에서 늦은 실행의 AI run을 duplicate_skipped로 완료 처리하도록 했습니다.
발행 재승인이 알림 시각을 바꾸지 않고, 거절된 이전 근거를 사용하는 변경이 재발행되지 않도록 검사합니다.

## 재실행

```bash
python -m pip install -e '.[dev]'
cd apps/web && npm install && cd ../..
python scripts/verify.py --full
python -m pytest --cov=signalbrief --cov-report=term-missing
signalbrief init-db  # 로컬 개발용만; 운영은 alembic upgrade head
signalbrief eval
```

브라우저/실제 PostgreSQL/외부 계정 점검은 `docs/DEPLOYMENT.md`와 `DOT_HANDOFF_KO.md`를 따릅니다.
현재 소스를 배포 완료 또는 측정된 99% 완성품으로 표현하지 않습니다.
