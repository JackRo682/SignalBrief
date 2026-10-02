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
