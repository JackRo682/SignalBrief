첨부한 SignalBrief_Full_Source.zip을 기준으로 개발을 마무리하고 검증하라.
이 ZIP은 새로 작성한 독립 프로젝트다. 과거 프로젝트, 메모리, 다른 저장소를 조회하거나 병합하지 마라.

목표: 이 소스의 실제 기능을 실행·검수·수정하고, 승인된 외부 서비스 연결 후 배포 가능한 상태로 만든다.
기획서만 다시 쓰거나 코드 생성 프롬프트만 반환하지 말고 실제 파일과 명령으로 작업하라.

먼저 읽을 파일:
AGENTS.md
START_HERE_KO.md
README.md
docs/VERIFICATION.md
docs/IMPLEMENTATION_STATUS.md
docs/ARCHITECTURE.md
docs/SECURITY.md
docs/DEPLOYMENT.md
docs/ACCEPTANCE_CRITERIA.md

작업 순서:
1. ZIP을 풀고 실제 소스 구조와 검증 기록을 확인하라. 기존 납품 테스트 성공과 새 환경 결과를 구분하라.
2. Python 3.12+ / Node 22 환경에서 pip install -e '.[dev]' 및 apps/web의 npm install을 실행하라.
   설치된 정확한 버전을 확인하고 실제 package-lock.json을 생성·보존하라. lockfile이나 감사 결과를 위조하지 마라.
3. python scripts/verify.py --full을 실행하라. 현재 문서상 Ruff/ESLint/전체 타입검사/Next 빌드는 미검증이다.
   실제 오류를 고치고 다시 실행하라. 검사 기준 완화·테스트 삭제·실패 숨기기로 통과시키지 마라.
4. SQLite 회귀와 실제 폐기 가능한 PostgreSQL 테스트 DB에서 마이그레이션/RLS를 검증하라.
   SB_TEST_POSTGRES_URL은 테스트 전용 DB여야 한다. 운영 DB에 파괴적 테스트를 실행하지 마라.
5. python scripts/dev.py로 새 데모를 실행하고 Playwright 데스크톱/모바일을 실제 실행하라.
   로그인 → 온보딩 → 관심종목 → 오늘의 변화 → 상세 → 이전/현재 근거 → 질문 → 알림 → 로그아웃을 확인하라.
   운영자/일반 사용자 분리와 타인 보유종목 접근 차단도 검증하라. 발견한 UI 계약 오류를 수정하라.
6. python -m signalbrief.cli eval로 120개 합성 회귀를 실행하라.
   합성 결과를 실제 금융 공시 정확도나 인간 검수 Gold Dataset으로 표현하지 마라.
7. 외부 연결은 권한/키가 실제 제공된 경우에만 수행하라. 없는 비밀 값을 만들지 말고
   Supabase, Google OAuth, DART, SEC User-Agent, OpenAI, 배포 환경 설정 중 필요한 항목을 한 번에 정리하라.
   API 키는 배포 환경의 secret에 넣고 클라이언트 NEXT_PUBLIC 변수에 넣지 마라.
8. 실제 데이터는 SB_DEMO_MODE=false, SB_AUTH_MODE=supabase, production 설정과 영속 원본 저장소를 사용한다.
   공개 배포에서 demo auth, demo admin, seed, 공개 raw storage를 금지하라.
   첫 실제 DART와 SEC 공시를 각각 수집하고 원문 URL/해시/발행일 정밀도/검토 큐/재실행 안전성을 확인하라.
9. 자동 발행 기본값을 false로 유지하라. 근거 미지원/숫자 불일치/충돌을 임의 승인하지 마라.
   PDF/OCR, 장문 입력 초과, 자유형 의미 추론과 실제 Gold Dataset은 미완료 범위를 명시하라.
10. 실제 권한·비용 승인이 있는 경우 Vercel 웹 + Render API/worker/cron + Supabase로 배포하고,
    HTTPS 주소에서 Google 로그인, 데이터 분리, 원문 조회, 재시작 후 원본 보존을 확인하라.
    승인 없는 유료 리소스 생성이나 기존 자원 변경은 하지 마라.

금지: 과거 프로젝트 병합, 근거 없는 투자 주장, 매수/매도 추천, 임의 목표가, 뉴스 수집 범위 확대,
테스트를 실행하지 않고 성공 선언, 99%/production-ready라는 측정 없는 표현, API 키 유출.

질문은 최소화하되, 필수 계정 권한·비용·비밀 등록처럼 본인만 할 수 있는 항목은 묶어서 요청하라.
사용자 확인 없이 안전하게 진행할 수 있는 로컬 설치·검사·수정은 실제로 진행하라.

마지막 보고: 변경 파일, 실제 실행 명령, 검사별 PASS/FAIL/BLOCKED/SKIP, 실제 동작 URL,
배포 여부, 남은 P0/P1, 필요한 사용자 설정을 기록하라. 업데이트된 전체 소스도 제공하라.
