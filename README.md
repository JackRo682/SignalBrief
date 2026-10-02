> New local execution results: [LOCAL_VERIFICATION_2026-10-02.md](docs/LOCAL_VERIFICATION_2026-10-02.md). Supplier results below are historical.

# SignalBrief

**근거 우선 포트폴리오 변화 브리핑.** Next.js/TypeScript + FastAPI/Python + PostgreSQL/Supabase.
새로 작성한 애플리케이션 소스이며, 코드 생성 프롬프트만 담은 패키지가 아닙니다.

> 먼저 `START_HERE_KO.md`를 읽으세요. 외부 계정 연결과 실제 운영 배포는 수행하지 않았습니다.
> 검증 기록은 `docs/VERIFICATION.md`와 `verification/`에 있습니다. 미실행 항목은 완료가 아닙니다.

## 로컬 데모

Python 3.12 이상, Node.js 22 및 인터넷 패키지 설치가 가능한 환경에서 저장소 루트에서 실행합니다.

```bash
python -m venv .venv
# Windows PowerShell: .venv\Scripts\Activate.ps1
# macOS/Linux: source .venv/bin/activate
python -m pip install -e '.[dev]'
cd apps/web
npm install
cd ../..
python scripts/dev.py
```

`http://localhost:3000` → 로그인 → **데모로 시작하기** → 합성 기업 3개 선택 → 오늘의 변화.
`.env`와 `apps/web/.env.local`이 없으면 예제에서 로컬용으로 생성됩니다.
데모는 실제 주식 정보가 아니며, API 키 없이 UI와 전체 데이터 흐름을 시험하는 용도입니다.
운영자 데모가 필요한 경우 로컬 `.env`의 `SB_DEMO_ADMIN=true`로 변경 후 재시작합니다.

Docker가 설치된 경우 대안: `docker compose up --build`.
Docker 구성도 합성 데모용입니다. 최초 이미지 빌드에는 인터넷이 필요합니다.
이 납품 환경에서 Docker 실행은 확인하지 못했습니다.

## 주요 코드

| 경로 | 구현 |
|---|---|
| apps/web/src | 로그인, 온보딩, 관심/보유종목, 브리핑, 근거, 타임라인, 질문, 캘린더, 알림, 설정, Ops |
| apps/api/signalbrief/providers | OpenDART / SEC 공급자와 공식 기업 목록 동기화 |
| apps/api/signalbrief/ingestion.py | 메타데이터·원본·원문 URL 보존 및 transactional outbox |
| apps/api/signalbrief/ai | 엄격한 출력 스키마, 근거/숫자 검사, OpenAI 연결, 합성 추출기 |
| apps/api/signalbrief/pipeline.py | 추출 → 검증 → 비교 → 브리핑 → 승인/발행 |
| apps/api/signalbrief/changes.py | 비교 가능한 기간·단위·범위에 대한 Decimal 연산 |
| apps/api/signalbrief/worker.py | DB 작업 큐, 재시도, 임대 갱신, 실패 작업 |
| supabase/migrations | 29개 테이블의 고정 DDL 및 RLS 마이그레이션 |
| evals | 120개 합성 회귀 사례, 평가 실행기, 실제 생성 결과 |
| tests | 백엔드 단위·통합·인증·마이그레이션 회귀 테스트 |
| packages/shared/openapi.json | 실제 FastAPI 애플리케이션에서 추출한 API 계약 |
| docs | 아키텍처, 보안, 배포, 제품 범위, 남은 검증 |

## 검증 명령

```bash
python -m pytest -q
python scripts/verify.py --full
python -m signalbrief.cli eval
cd apps/web
npm run lint
npm run typecheck
npm test
npm run build
# 별도 터미널에서 데모 서버를 실행한 후:
npx playwright install chromium
npm run test:e2e
```

`verify.py --full`은 도구가 없거나 검사에 실패하면 0이 아닌 종료 코드를 반환합니다.
실행하지 않은 테스트, 합성 데이터 정확도, 네트워크 모의 테스트를 실서비스 성공으로 표현하지 않습니다.

## 실제 데이터 연결

운영 모드에서는 Supabase Google OAuth와 비공개 Storage 버킷, 서버 DB 연결,
DART 키, SEC 실명 연락처 User-Agent, 사용 가능한 OpenAI 모델과 키가 필요합니다.
안전한 기본값은 **자동 발행 비활성화**입니다. 검증된 실제 분석도 운영자 검토 후 발행합니다.
자세한 단계는 `docs/DEPLOYMENT.md`와 `docs/OPERATIONS.md`를 사용하세요.

## 의도적으로 제외한 것

뉴스 통합, 실시간 시세/차트, 증권사 주문, 매매 추천, 목표가, 자동매매, 결제,
이메일/모바일 푸시는 구현하지 않았습니다. 알림은 앱 내부입니다.
PDF/OCR와 입력 예산을 넘는 장문 공시는 자동 처리하지 않고 검토/실패 상태로 남깁니다.
수치·원문 검사만으로 모든 금융 해석의 진실을 자동 증명할 수 있다고 주장하지 않습니다.
