# 실제 공시 연결 작업 현황 — 2026-10-08

> 후속 재검증: 기존 비공개 설정을 찾아 연결했고, 실제 모델 분석·운영 저장·로그인·반려를 실행했다. 첫 공시의 금융 근거 검증은 실패했다. 아래는 연결 전 기록이며 최신 판정은 [연결 후 실제 검증](LIVE_CONNECTED_PILOT_20261008.md)을 따른다.

**현재 판정: 실서비스 완성 아님. 실제 공시 1쌍의 수집·파싱·로컬 저장까지 검증했고, 라이브 AI·운영 DB 적재·승인 후 Today는 미검증이다.**

기준 main: `f680feab8bee13996e71210c566e2cc4da3d2339`. 기존 `PRD.md`, `UX_SPEC.md`, `API_SPEC.md`, `DATA_MODEL.md`, `AI_SYSTEM.md`, `AI_EVAL.md`, `VERIFICATION.md`, hosted/US release 문서를 재사용했다. 새 화면·시세·뉴스·결제 기능은 추가하지 않았다.

## 구현 여부와 실제 확인 결과

| 영역 | 기존 구현 | 이번 확인 |
|---|---|---|
| SEC/OpenDART 수집 | Python 공급자·원본 보존·작업 큐 | SEC Apple 실제 10-Q 2건 수집. OpenDART 미실행 |
| AI 추출·근거·수치 검증 | Python strict schema, 인용/수치 검사 | 코드와 회귀 테스트 있음. 실제 OpenAI 호출 0건 |
| 이전 공시 비교 | 승인된 이전 사실에 대한 Decimal 비교 | 실제 수치 비교 미검증. 이전 공시 승인 후 현재 공시를 분석해야 함 |
| 관리자 승인/반려 | Python Ops 및 hosted RPC | 기존 관리자 0명. 사용자 명시 승인으로 기존 소유자 계정 1명에 권한 부여하고 감사 기록 1건 저장 |
| Today | 기존 events/briefs 테이블의 승인 결과 조회 | 운영 documents/ai_runs/events가 작업 시작 시 각각 0건. 승인 결과 노출 미검증 |
| Python ↔ Supabase | 공통 테이블 구조·Storage 어댑터 | Python에 DB 연결 문자열/서버 저장소 키/OpenAI 키가 미설정. 작업자 미연결 |
| 별도 US 분석 | Edge의 us_filings/us_analyses | Today와 별도 흐름. 이를 Python 연결 또는 Today 완료로 간주하지 않음 |
| 로그인 | Supabase Google 인증 및 앱 로그인 화면 | Google 리디렉션과 callback 설정 확인. 대화형 로그인 완료 미검증 |
| 권한/오류 | RLS·관리자 RPC·JWT 검증 | 모든 public 테이블 RLS 활성. anon의 admin RPC 실행 권한 없음. 운영 API 미인증/잘못된 토큰/허용되지 않은 Origin 거부 확인 |
| 비공개 원본 | signalbrief-raw 버킷 | 버킷 비공개 확인. Python에서 이 버킷에 실제 적재하는 단계는 미검증 |

## 실제 1쌍 결과

Apple(AAPL), CIK `0000320193`의 SEC metadata에서 접수번호·날짜·원문 URL을 확인했다. 로컬 원본 파일은 Git 제외 `var/live-trial/pilot-xsl-complete/sources`에 보존한다.

| 구분 | 이전 | 현재 |
|---|---|---|
| 접수번호 | 0000320193-26-000013 | 0000320193-26-000020 |
| 공시일 | 2026-05-01 | 2026-07-31 |
| 형식 | 10-Q | 10-Q |
| 원본 바이트 | 999,919 | 1,018,319 |
| 정규화 문자 | 93,281 | 91,460 |
| 전체 청크 | 31 | 31 |
| SHA-256 | d54cffdda0bf920aa4c86be26586db24dbf6e048635f79e0940dc94c92e54b64 | 906ef0a0bc771267e9f7b8748d5711bae79f74ebcf96ef37f12f29883987767d |

원문: [이전 SEC 공시](https://www.sec.gov/Archives/edgar/data/320193/000032019326000013/aapl-20260328.htm), [현재 SEC 공시](https://www.sec.gov/Archives/edgar/data/320193/000032019326000020/aapl-20260627.htm).

수집·해시 보존·파싱·동일 문서 재수집의 멱등성·원본 재읽기 검증 통과. 실제 원문을 넣은 로컬 SQLite에서 2개 documents, 62개 chunks, 키 누락으로 실패한 분석 기록을 확인했고 events는 0개다. 이것은 hosted DB 저장 또는 AI 금융 분석 성공이 아니다.

## 오류와 수정

1. **실제 SEC 목록 처리 실패**: `xslF345X06/form4.xml`, `xsl144X01/primary_doc.xml`, `xslSCHEDULE_13G_X02/primary_doc.xml`, NVIDIA의 `xslN-PX_X01/primary_doc.xml` 등 정상 SEC 경로 때문에 전체 기업 목록 처리가 `sec_unsafe_primary_document`로 실패했다. 단일 SEC XSL 하위 디렉터리만 허용하고 임의 디렉터리·외부 URL·다중 경로·쿼리·상위 이동은 거부한다. 실제 응답 재수집과 보안 회귀 테스트 통과.
2. **총 비용 상한 부재**: 기존 Python은 일일 호출 횟수만 제한했다. 같은 DB의 영구 누적 예약 카운터를 사용해 요청 전 USD 상한을 검사한다. 동시 호출, 재시작, 예산 0, 잔액 부족, 타임아웃 후 재시도 테스트를 추가했다. 기본은 비활성 0 USD. 사용자가 이번 작업에 승인한 100 USD는 계정 결제 한도가 아니라 이 작업의 상한이다. 실제 유료 호출은 아직 없다.
3. **이전 공시 승인 전 분석**: 두 문서를 한꺼번에 처리하면 이전 공시가 미승인이라 비교 이력이 없다. 새 `signalbrief.live_trial` 실행기는 이전 공시 검토에서 멈추고 승인 후 재개한다. 승인 자체는 기존 운영 화면에서 수행한다.
4. **개발 환경**: Python 임시 디렉터리 접근 오류는 작업 폴더 내 임시 경로로 해결했다. 프론트엔드는 Windows native realpath의 EPERM으로 테스트·빌드가 시작 단계에서 실패했다. 저장소 접근 권한 부여 후에도 재현했다. 검사 삭제나 성공 처리 없이 Linux CI 결과를 별도로 확인한다.

## 테스트 기록

`verification/live-20261008/`에 실제 수집 manifest, 로컬 원문 저장 검사, 운영 HTTP 읽기 검사, 개인 PC 경로를 제거한 검사 요약을 보존한다. 원본 로그와 XML은 로컬에만 보관하며 Git에서 제외한다. 기존 `verification/`의 과거 결과와 구분한다.

- 로컬 백엔드: 263 passed / 37 skipped. 건너뛴 37건은 별도 PostgreSQL 요구 테스트다.
- Python 컴파일·Ruff·OpenAPI 내보내기: 통과.
- 프론트엔드 TypeScript: 통과. ESLint: 오류 0, 기존 경고 5.
- 프론트엔드 Vitest·Next 빌드: 로컬 환경 접근 오류로 실패. 성공으로 표기하지 않는다.
- 운영 HTTP 읽기 검사: 8항목 통과. DB/Edge 준비 상태, 데모 인증 비활성, 미인증·잘못된 토큰·허용되지 않은 Origin 거부, 잘못된 캘린더 토큰 거부, Google 활성화·리디렉션 설정 확인.
- 보안 Advisor: RLS 미적용 테이블 0. 의도적으로 공개된 health/캘린더 RPC 및 인증 후 SECURITY DEFINER RPC 경고, 유출 암호 보호 비활성 경고가 남는다. 경고를 모두 해결한 보안 인증으로 표현하지 않는다. [Supabase 권고 안내](https://supabase.com/docs/guides/database/database-linter).

## 미검증과 완료 조건

실제 AI 추출 정확도·수치 비교, Python의 hosted DB/Storage 연결, 실제 근거 승인/반려, 일반 사용자의 Today 노출/비노출, 대화형 로그인/로그아웃, 브라우저 종단 검증은 남아 있다. 실제 금융 Gold Dataset이나 정확도 수치를 만들지 않았다. 현재의 보수적인 문장 중심 수치 검증기가 실제 다열 재무표를 얼마나 처리하는지도 측정해야 한다.

후속 대상 기업은 Apple, Microsoft, NVIDIA이며 세 기업 모두 실제 SEC CIK·티커 일치를 확인했다. MSFT와 NVDA는 최근 목록에 각각 10-Q 18건이 있으나 원문 처리·AI 분석은 시작하지 않았다. 먼저 1쌍의 전체 흐름을 통과한 후 AAPL 4쌍/MSFT 3쌍/NVDA 3쌍, 총 10쌍으로 확대한다. 10쌍 처리는 아직 실행하지 않았다. [재개 절차](LIVE_TRIAL_RUNBOOK_KO.md)에 비밀 설정 위치와 명령, 승인 순서, 통과 기준을 정리했다.

실제로 통과하지 않은 기능을 완성으로 표기하거나 금융 결과를 임의 생성하지 않는다. main 병합·운영 코드 배포는 이 작업 결과와 별개다.
