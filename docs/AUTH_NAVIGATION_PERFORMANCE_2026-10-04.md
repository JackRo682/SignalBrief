# 로그인·화면 전환·요청 개선 — 2026-10-04

작업 기준은 GitHub `main`의 `1283796a5f887f00067779d945d7e439a4251cec`이다. 이 문서는 배포 전 소스 수정과 개발 검증을 설명한다. 운영 배포 여부와 실제 OAuth 완료를 증명하는 기록은 아니다.

Google 로그인은 인증 코드를 한 번만 교환하는 기존 처리를 유지한다. `NEXT_PUBLIC_SITE_URL`로 callback origin을 통일하며, 운영 기본값은 `https://signalbrief-beta.vercel.app`이다. 다른 origin에서 로그인 버튼을 누르면 PKCE verifier를 만들기 **전에** canonical `/login`으로 이동한다. Vercel production alias의 페이지 요청도 Next Proxy에서 canonical origin으로 이동한다. Preview 페이지는 개발에 사용할 수 있지만, Google 로그인은 canonical origin에서 시작한다. 리다이렉트 목적지에 요청 경로를 붙일 때도 외부 origin으로 바뀌지 않도록 처리한다.

기존 RootLayout의 AuthProvider는 그대로 유지한다. 템플릿에서 생성한 내부 링크를 Next 라우터로 연결해 메뉴와 상세 링크의 문서 재로드를 없앴다. 수정키, 새 탭, 다운로드, 외부 링크, 같은 페이지의 근거 앵커는 브라우저 동작을 유지한다. 전체 Sidebar/Topbar를 React 컴포넌트와 별도 route group으로 옮기는 구조 변경은 이번 수정에 포함하지 않았다. 인증 유지에 필요한 동작은 실제 Next 앱에서 검증했다.

추가로 확인한 버그는 정보 밀도 설정의 이벤트 선택자였다. 화면 루트에도 `data-density`가 붙어 있어 메뉴를 포함한 모든 클릭이 `/v1/me` PATCH를 발생시켰다. 실제 정보 밀도 버튼만 이벤트 대상으로 제한했다.

Today와 Timeline은 이벤트별 상세 API 호출 대신 목록에 포함된 `fact_summary`, `change_summary`, `interpretation`, `source_document`를 사용한다. FastAPI와 운영 Supabase Edge API의 응답을 함께 변경했고 Pydantic, Zod, OpenAPI도 갱신했다. 현재 검증된 인용과 저장된 비교·해석을 사용하며, 새 금융 해석을 생성하지 않는다. 요약 관련 회사·문서·브리핑·비교·사실 조회는 배치 쿼리 5회이며 membership/auth 조회는 별도다.

Today는 feed/calendar/portfolio를 함께 요청하고 각각 완료되는 대로 표시한다. Today와 Timeline의 시세·차트는 본문을 막지 않고 나중에 채운다. 조회 데이터는 메모리에서 토큰별로 분리해 15초, 시세는 30초 캐시한다. 같은 요청은 합치고, 계정 변경·로그아웃·수정 시 캐시를 비운다. 읽기 전용 RPC는 캐시를 지우지 않는다. 개인 데이터는 CDN 또는 디스크 캐시에 저장하지 않는다. 운영 `/v1/config`는 DB health RPC를 호출하지 않으며 5분간 캐시할 수 있다. 실제 `/health/ready` 검사는 그대로 남아 있다.

검증 결과:

- `scripts/verify.py --full`: Python compile, backend tests, OpenAPI, Ruff, ESLint, TypeScript, Vitest, Next production build 통과. 생성된 기존 검증 기록을 덮어쓰지 않도록 현재 소스의 임시 복사본에서 실행했다.
- Backend: 243 통과, PostgreSQL 2개는 기본 실행에서 건너뜀. 해당 2개는 별도의 임시 PostgreSQL 16 컨테이너에서 실제 마이그레이션과 권한 격리를 실행해 모두 통과했다. 컨테이너는 종료했다.
- Frontend: 181 테스트 통과. ESLint 오류 없음; 기존 경고는 남아 있다.
- `e2e/performance.spec.ts`: 데스크톱·모바일에서 compact/legacy 응답 4개 통과. 실제 Next 앱과 격리 API fixture를 사용했다. 느린 시세/calendar/portfolio 응답 전에 본문 표시, 메뉴 이동 시 문서 재로드 0회, 초기 config/me 조회 각 1회, 메뉴 클릭의 profile PATCH 0회, 재방문 watchlist 캐시를 확인했다.
- 기존 `tests/reference/browser_checks.py`: 데스크톱·모바일 10개 화면에서 fixture 기반 브라우저 검사 72개 통과.
- 새 브라우저 성능 회귀 테스트를 GitHub Actions web job에도 추가했다. Workflow YAML을 검증했고 원격 GitHub CI도 통과했다.
- 기존 `apps/web/e2e`의 이전 화면용 테스트는 새 UI와 선택자가 달라 전체 통과를 주장하지 않는다. 새 성능 회귀 테스트는 그 테스트를 제거하거나 완화하지 않고 추가했다.

운영 API를 먼저 갱신하는 것이 권장 순서다. 다만 배포 인증이 없을 때도 프론트를 안전하게 먼저 배포할 수 있도록 이전 응답 형식과 호환된다. compact 필드가 없는 목록만 본문을 먼저 렌더링한 후 최대 4개 동시 상세 요청으로 보강한다(Today 최대 12개, Timeline 최대 30개). 새 API 응답은 상세 요청을 하지 않는다. API 배포 전에는 N+1 요청 자체가 완전히 제거됐다고 주장하지 않는다. 수동 운영 배포 워크플로는 GitHub Production 환경의 `SUPABASE_ACCESS_TOKEN`을 사용하며 기존 gateway 정책 확인 후 함수만 배포한다. Vercel의 `NEXT_PUBLIC_SITE_URL`, Supabase Auth Site URL을 `https://signalbrief-beta.vercel.app`로 맞추고 `/auth/callback`을 redirect allowlist에 등록한다. 이 작업에서 운영 설정을 변경하거나 비밀값을 요청하지 않았다. 실제 Google 계정의 동의·callback·로그아웃 후 재로그인과 모바일 체감 속도는 배포 후 확인해야 하며, 로컬 fixture 결과로 실제 OAuth 성공이나 모바일망 지연 시간을 보장하지 않는다.
