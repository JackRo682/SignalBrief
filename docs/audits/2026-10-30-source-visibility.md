# SignalBrief 화면 정보 누락 감사 및 수정

검사일: 2026-10-30 (한국시간). 기준 main: `27c3e58e6009d4ea60c4db90de0324dd8dac33c5`.
작업 브랜치: `audit/screen-data-visibility-20261030`.

## 범위와 배포 상태

GitHub 코드/PR, Supabase 운영 DB의 읽기 전용 쿼리와 Edge 목록, Vercel 프로젝트 상태 및 제공된 다섯 종류의 화면을 비교했다. 마지막 이미지는 포트폴리오 설정 화면의 중복이다. 새 변경은 운영 DB/Edge/Vercel에 적용하지 않았다. 브랜치에 한정한 `git.deploymentEnabled: false`로 자동 미리보기 배포도 비활성화한다. 운영 데이터 삭제/AI 자동 승인/유료 모델 호출/시세 권한 활성화/실제 사용자 이메일 발송은 수행하지 않았다. 로그인한 운영 사용자 화면 전체를 검증했다고 주장하지 않는다.

PR #31/#32/#33은 이미 병합됐다. #15는 main에 포함된 뒤 별도 PR이 미병합 종료되었으므로 다시 병합할 대상이 아니다. main의 통합 커밋과 각 PR 상태를 재확인했다. 기존 기업 프로필, 출처 연결, 가격 권한 검사, 종가 기준일 보존, IR 수집, 평가 파이프라인을 중복 구현하거나 배포하지 않았다.

## 운영 수치 재검증

| 항목 | 실제 수치 | 해석 |
|---|---:|---|
| SEC 공시 메타데이터 | 125 | 분석 공개 여부와 별개 |
| OpenDART 공시 메타데이터 | 54 | 같은 기준 |
| 분석 검토 대기 | 51 | US 7 + DART 44, 공개 분석이 아님 |
| supported 사실 | 22 | 공개 이벤트 소속 16 + rejected 이벤트 소속 6 |
| 비데모 기업 | 7 | 미국 4, 한국 3 |
| 확인된 공식 일정 | 8 | 아래 날짜 범위 문제 참고 |
| 공개 이벤트 | 2 | 거절된 이벤트 1개는 비공개 유지 |
| AI 일일 예산 | USD 1 | 설정 변경 없음 |
| FMP/KIS 공개 표시 | 모두 false | 라이선스 차단 유지 |

공개된 두 분석은 Apple의 2026-05-01, 2026-07-31 게시 자료다. 단순히 `supported`인 사실을 모두 표시하면 거절된 이벤트의 사실까지 노출한다. 이번 변경도 `sb_event_visible`/`sb_document_visible`를 그대로 사용한다.

## 화면별 원인과 수정

| 우선순위/원래 문제 | 검증된 원인 분류 | 이번 수정/남은 범위 |
|---|---|---|
| P0 최근 중요 변화가 비어 있음 | 날짜 필터 + 공개 요건. PC/모바일 기본 30일에 해당하는 공개 분석이 없음. 수집 공시가 이 피드와 연결되지 않음 | 새로운 공식 자료 패널: 관심/보유 기업의 공시 메타데이터 8건, 전체 수집 건수, 공개 분석 4건의 이력. 원문/내부 상세 링크, 실제 게시일 표시. AI 승인 없이 메타데이터 접근 가능 |
| P0 검색 `2차전지` 0건 | 기존 이름/티커/제목 부분 검색, 한국어 브랜드 4개만 치환, 원문 검색 없음. 시장 필터가 SEC 기업만 조회 | 한·영 회사/키워드 동의어, 공개 문서의 PostgreSQL 원문 전문 검색과 GIN 인덱스, 한국 시장 필터. 실제 관련 원문이 없으면 여전히 0이 정상이며 관련 기업이나 사실을 생성하지 않음 |
| P0 설정에서 미국 기업 4개만 표시 | 이전 reference 화면이 API 결과에서 `provider==='sec'`만 남김. DB companies RLS는 비데모 기업을 이미 허용함 | 브라우저 필터 제거. 인증/MFA/요청 제한을 유지하는 `company_lookup`을 기존 API에 연결. 이름/티커/한국어 별칭으로 등록된 국내외 기업을 검색 |
| P0 지수/주가/등락률 `—`, 시세 확인 0/2 | FMP/KIS 공개 표시 false. 값이 0이라는 뜻이 아님 | 권한 차단 유지, PC/모바일 관심종목에 종목별 권한/인증/한도/지원 여부 설명. 기존 외부 TradingView 위젯과 정확한 종가 날짜 보존 기능 유지 |
| P0 포트폴리오 평가 `—`, 평가 가능 0/1 | 실제 보유 수량이 있어도 가격이 없으면 평가 불가. 평균단가도 미입력 | 보유 수량으로 가격/수익률을 추정하지 않음. 기존 완전한 가격·환율 범위에서만 합계 계산하는 경로 보존. CSV/직접입력/소유권 동작 유지 |
| P1 주요 일정 0 | 다음 30일 필터는 정상. 확인된 일정 8건 중 7건은 과거, 다음 MSFT 일정은 12월 8일이라 10월 30일부터 30일 밖 | 기존 다음 30일 패널 보존. 새 공식 자료 패널에 미래 최대 4건 + 과거 최대 4건을 실제 날짜/출처/시간대와 함께 표시. 취소·미확인 일정, 다른 사용자 소유 일정 제외 |
| P1 알림은 있는데 최근 변화가 없음 | 알림 생성 시각과 원래 이벤트 게시 시각이 다름. 알림이 새로운 공시라는 뜻이 아님 | PC 대시보드 알림에 수신일과 원문 게시일 분리 표시. 과거 분석을 최근 공시처럼 재게시하지 않음 |
| P1 기업 재무 지표 부족 | 22건 전부를 공개할 수 없음. 기존 최대 12건 + UUID 순서가 기간 표시를 제한 | 공개 사실 최대 48건, 게시 시각/기간/필드/기준의 일관된 순서로 반환. 원값/단위/기간/근거 링크 보존. TTM·컨센서스·PER을 임의 계산하지 않음 |
| P1 모바일 한국 기업에 SEC 태그 | 회사 카드의 공급자 표기가 SEC EDGAR로 고정 | 한국 시장 기업을 OpenDART로 표시 |
| P2 최근 상승 종목 없음 | 주가/등락률 범위 0이면 상승 종목을 판정할 수 없음 | 시세 미확인 사유를 표시하고 0%/수익률을 만들지 않음 |
| P2 알캡처 업데이트 팝업 | 업로드된 스크린샷의 별도 데스크톱 프로그램 | SignalBrief 버그나 배포 요소가 아님 |

## 구현 경로와 보안

- `source_overview`는 `auth.uid()`의 관심종목과 보유종목 합집합에만 접근한다. 사용자 ID를 받지 않는다. 공식 일정도 소유권, confirmed, verified_at, 출처 존재와 기존 `sb_calendar_confirmed` 원문 검증을 확인한다.
- 원문 전문 검색은 기존 공개 리소스 집합 안에서만 수행한다. 미공개 AI 제목/요약/근거 및 거절된 이벤트는 검색으로 우회하지 못한다. 수집된 179건 전체의 텍스트가 파싱·공개됐다는 뜻은 아니다.
- DB 함수의 기존 인증, MFA, rate limit, 소유권, 저장/설정/문의 동작을 보존하기 위해 운영에서 읽은 고정 함수 정의를 마이그레이션에 포함했다. 런타임에 임의 SQL 문자열을 조립하지 않는다.
- 브라우저 응답은 Zod로 검사한다. DB 오류는 재시도 가능한 오류로 표시하고 0건으로 바꾸지 않는다. 원문 링크는 기존 HTTPS 검사와 noreferrer를 사용한다.
- 캐시는 기존 사용자 토큰별 page-data-cache만 사용한다. 공시/분석의 AI 추가 비용은 없다. 원문 색인은 기존 DB의 저장공간·계산량을 사용한다.
- 모바일 기준 스냅샷은 이번 요청에 따른 6개 파일만 갱신했다. 이전/새 SHA와 이유를 `docs/desktop-mobile-baseline.json`에 기록했으며, 나머지 파일·21개 모바일 경로·셸·PC CSS 범위 검사는 유지한다.

## 기존 구현과 남은 작업

| 기능 | 확인 상태 | 남은 제약/사용자 작업 |
|---|---|---|
| SEC/OpenDART 수집 | 운영 Edge 활성, DB에 125/54건 | 최근 원문 수집 주기/백로그의 지속 관찰 필요. 수집만으로 분석을 공개하지 않음 |
| 기업 프로필 | 기존 SEC/DART 프로필 서비스 v3 활성 | 지원 기업 7개. 전체 시장 등록/과거 프로필 수집은 별도 범위 |
| PDF/XML/XBRL | 기존 파서/원문 해시/근거 구조 유지 | 모든 파일 유형·기업·기간을 실제 원문으로 완전 검증한 상태 아님. 스캔 PDF OCR, DART 연결재무 자동 지표 확대는 미완료 |
| 출처 기반 분석/공시 비교 | 기존 검증·이전 사실 연결·평가 도구 보존 | 검토 대기 51건은 자동 승인하지 않음. 재무전문가 검토와 불일치/추출실패 보완 필요. 미평가 held-out 자료의 품질을 입증한 것으로 보지 않음 |
| 공식 IR | MSFT/Samsung 수집 + 확인 일정 8건 | 다른 기업용 공식 페이지별 수집기 필요. 현재 7개 모두의 미래 일정을 보장하지 않음 |
| 이메일/알림 | 기존 notifications/delivery Edge 활성, 사용자 설정 유지 | 실제 이메일을 보내는 수신/스팸함/DKIM/구독해지 종단 검증은 이번에 하지 않음. 대시보드 unread 0은 오늘 도착한 안 읽은 알림 0이지 전체 공시 0이 아님 |
| 관심종목/포트폴리오 | 기존 사용자 데이터·CSV·직접입력·RLS 보존 | 증권사 연결은 화면에도 예정으로 표시된 미구현 기능. 가격 권한 없이는 평가 불가 |
| 최신 시세/지수 | 코드 경로와 차단 사유 존재 | 합법적 계약/권한 없이 활성화하지 않음 |
| 사용자 보안 | 기존 권한/관리자/MFA 유지 | Supabase 유출 비밀번호 방지 비활성 WARN은 운영 Auth 설정 검토 필요. security-definer WARN은 함수별 허용범위 검토 필요; 무조건 공개 기능을 끄면 기존 기능 손상 가능 |

## 무료·저비용 대안과 계정

1. SEC EDGAR submissions/XBRL companyfacts는 공식 무료 기업·재무 원천이다. 서버 식별 User-Agent와 공정 접근 제한을 지킨다. 이 PR은 별도 재무 수집기를 새로 배포하지 않는다.
2. OpenDART는 기존 서버 키를 유지한다. 새 키를 코드/브라우저에 넣지 않았다. 공개 공시를 확인하고 검토된 사실로 연결하는 경로를 우선 활용한다.
3. 금융위원회 **기업기본정보(15043184)**와 **공시정보(15059649)**는 공식 페이지상 이용허락범위 제한 없음이다. 무료 활용 신청/서버 전용 서비스 키가 필요하며 이 PR에서는 연결·운영하지 않았다. 데이터는 실시간이 아니다.
4. 금융위원회 **주식시세(15094808)**, **지수시세(15094807)**는 공식 카탈로그상 제4유형 및 제3자 권리/재배포 제한이 있다. 무료 키만으로 이 상업 서비스에 재배포할 수 있다고 판단하지 않았다. KRX 이용 범위 확인이 선행돼야 한다.
5. 주식발행/권리일정 등 일부 KSD 데이터는 제2유형·상업적 이용금지다. 금융위원회 이름으로 제공된다고 전부 동일 라이선스가 아니다.
6. 기존 클릭 후 로드되는 TradingView 공식 위젯은 제공자 화면 안에서 조회하는 무료 대안이다. 위젯 데이터를 추출해 포트폴리오 계산/DB에 재배포하는 대안은 아니다. 공급자가 제공하지 않는 한국 종목을 임의 심볼로 대체하지 않는다.
7. FMP EOD는 기존에 선택 가능한 경로가 있으나 공개 표시·캐시·재배포의 서면 허용과 API 플랜 확인 전에는 비활성 상태를 유지한다. 지수 권한은 주식 권한과 별도다. 새 유료 계약/청구는 발생시키지 않았다.

공식 참고:
- https://www.sec.gov/search-filings/edgar-application-programming-interfaces
- https://opendart.fss.or.kr/guide/main.do
- https://www.data.go.kr/data/15043184/openapi.do
- https://www.data.go.kr/data/15059649/openapi.do
- https://www.data.go.kr/catalog/15094808/openapi.json
- https://www.data.go.kr/catalog/15094807/openapi.json
- https://www.data.go.kr/data/15043423/openapi.do
- https://vercel.com/docs/project-configuration/git-configuration
- https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

## 배포/롤백 절차 — 승인 후 수행

1. PR 리뷰와 CI의 실제 PostgreSQL·PC/모바일 E2E 결과 확인. 기존 운영 커밋/함수 버전과 DB 함수 정의 백업.
2. `supabase/workspace-migrations/20261030120000_source_visibility.sql`을 한 트랜잭션으로 적용. 데이터 변경은 없지만 GIN 인덱스 생성 동안의 부하/잠금 고려. 사용자별 공시 범위와 익명/다른 사용자 거부 재검사.
3. `supabase/functions/signalbrief-api/index.ts`를 기존 설정·비밀값을 보존하여 배포. `/v1/companies`가 새 `company_lookup`을 사용하므로 DB 마이그레이션을 먼저 적용한다.
4. 승인된 프런트엔드를 배포. `/today`, `/watchlist`, 한국어 검색, 설정의 한국 기업, 오류/재시도, 작은 화면 가로 넘침, 원문 링크, 기존 저장·보유·알림 동작을 실제 계정으로 점검. 새 키/유료 API/새 스케줄러는 필요 없다.
5. 롤백은 프런트엔드와 API를 이전 운영 버전으로 되돌린 뒤 `supabase/workspace-rollbacks/20261030120000_source_visibility.sql` 적용. 공시/사용자 행을 삭제하지 않는다.

운영 `/status` 화면에서도 OpenDART 최근 수집, Google 제공자·콜백 설정 확인, FMP/국내 시세 라이선스 확인 대기, AI 예산 설정을 직접 확인했다. 실제 OAuth 동의/로그인 완료와 사용자별 전체 화면 검사는 별도다. 메일 outbox에는 기존 delivered 상태 2건이 있었으며 실제 수신함 도달은 검사하지 않았다.

운영에서 읽은 현재 버전: API 15, US 20, profiles 3, collector 14, calendar 1, notifications/delivery 각 3. Vercel production READY: `dpl_5Q5rDT2iwUqP6eSN4esTt1TDjwet`, 사용자 URL https://signalbrief.online. 이번 변경의 배포가 완료됐다는 뜻이 아니다.

## 테스트

- 프런트엔드 639개 테스트 통과, TypeScript 통과, lint 오류 0개(기존 navigation 경고 5개), 프로덕션 빌드 통과.
- 새 PGlite 실제 SQL 실행: 마이그레이션/롤백, 미승인 분석 제외, 한국어 동의어·원문 검색, 한국 시장, 다른 사용자 데이터 차단, MFA/익명/잘못된 입력 거부 통과. 합성 자료로 실행했으며 운영 DB에 테스트 행을 만들지 않았다.
- 실제 PostgreSQL replay 2개와 데스크톱/모바일 E2E 4개를 추가해 CI에 연결했다. 로컬 Chromium 다운로드는 손상된 응답으로 실패했으므로 이 단계에서 로컬 E2E를 통과했다고 주장하지 않는다. 최종 CI 결과는 PR에서 확인한다.
- `scripts/verify.py --full` 실행. 초기 서버 5개 실패는 로컬 프록시에 필요한 socksio 누락이 원인이었다. 환경 의존성 보완 후 전체 release gate 8개 항목이 통과했다. 서버 테스트 340개 통과, 실제 PostgreSQL 미설정 등의 사유로 106개는 건너뛰었다. DB 미설정으로 건너뛴 테스트는 통과 수에 포함하지 않는다.

## 정확한 변경 파일

- DB/API: `supabase/workspace-migrations/20261030120000_source_visibility.sql`, `supabase/workspace-rollbacks/20261030120000_source_visibility.sql`, `supabase/functions/signalbrief-api/index.ts`.
- 공통 UI/계약: `apps/web/src/components/source-overview.tsx`, `apps/web/src/components/source-overview.css`, `apps/web/src/workspace/contracts.ts`.
- PC: `apps/web/src/desktop/today.tsx`, `apps/web/src/desktop/watchlist.tsx`, `apps/web/src/desktop/search.tsx`.
- 모바일/설정: `apps/web/src/mobile/today.tsx`, `apps/web/src/mobile/watchlist.tsx`, `apps/web/src/mobile/search.tsx`, `apps/web/src/reference/reference-app.tsx`.
- 테스트: `apps/web/tests/source-visibility-sql.test.ts`, `apps/web/tests/workspace.test.ts`, `apps/web/tests/desktop-today.test.tsx`, `apps/web/e2e/source-visibility.spec.ts`, `apps/web/e2e/mobile-fixture.ts`, `tests/workspace/test_source_visibility.py`, `tests/workspace/test_workspace_schema.py`, `apps/web/tests/desktop-questions.test.tsx`.
- 검증/배포 설정: `.github/workflows/ci.yml`, `apps/web/vercel.json`, `docs/desktop-mobile-baseline.json`.
- 보고서/검사 기록: 이 파일, `docs/audits/2026-10-30-source-visibility-checks.json`.
