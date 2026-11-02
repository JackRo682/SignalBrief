# 기업 검색·프로필·수치·일정 신뢰성 보완 — 2026-11-02

## 현재 릴리스 상태

이번 보완은 로그인 후 기업을 검색하고 상세 정보를 여는 과정에서 발생한 실제 실패와 자료 연결 누락을 수정한다. 검색 정확도·성능, 공식 공시 기반 사업 소개와 제품·사업부문, 보고된 재무 수치, 회사 뉴스와 일정 수집을 함께 점검했다. 운영에서 추가로 발견한 시각 형식 오류, 개정 공시 처리, 회계 행 오분류와 일정 형식 미지원도 최종 소스에 포함했다.

**최종 운영 소스는 `d0a6de2b031896619b3cbafda55be403f0a7ddd0`, tree는 `8dc572e4731c3d3346c4be8609abe77bd47f1007`다.** main 승격과 Vercel `dpl_8bD58BeVs4kFFfnp58ThaU4yDG1V`의 READY를 확인했으며 운영 주소는 [signalbrief.online](https://signalbrief.online)이다. **07:34:58.178233 UTC**에 [공개 release endpoint](https://signalbrief.online/api/release)가 HTTP200과 정확한 d0/main을 반환했다. [최종 배포 관측](../verification/company-data-2026-11-02-release/d0a6de2b-deployment-observation.json), 정확한 소스의 CI, 로컬 검사와 실제 로그인 화면 증거를 구분해 보존한다. 문서 발행 커밋은 이 런타임 소스와 별개다.

운영 SNDK에서는 검색과 재무 수치40개가 정상 표시됐다. profiles10의06:57:13 프로필 갱신은 원문 부문명의 대소문자 불일치 때문에 `profile_persistence_unavailable`로 실패하고 이전 부분 자료를 보존했다. d0a6de2b/profiles11은 **원문의 대소문자를 그대로 유지하며 SQL 검증을 변경하지 않았다.** 정상 실패 대기가 지난 뒤 실제 브라우저의 다시 확인으로 **07:28:58.632046 UTC에 ready·오류 없음**, 사업2·제품2·부문1·CEO David V. Goeckeler(2026-08-17 공시 기준)·법인 설립2024-02-05와 재무40개를 확인했다. [07:33:21.920192 UTC 운영 관측](../verification/company-data-2026-11-02-live/production-observation-d0a6de2b.json)에서도 원본 해시·보관 식별과 NAVER의 이전 v1 fingerprint가 그대로 유지됐다.

d0a6de2b의 **정확한 커밋 CI 9개 workflow·17개 job, push 브라우저 92개와 PR 브라우저 92개가 각각 통과**했다. 로컬 최초 전체 실행은 **FAIL, 7/8단계**였다. Backend 1,104건은 통과했지만 frontend는 1,679통과·기존 desktop 테스트 1건 timeout으로 실패했다. 이후 소스·5,000ms 제한·assertion을 그대로 유지하고 `maxWorkers=2`로 **전체 frontend 단계를 다시 실행해 1,680건·117개 파일을 통과**했다. [최초 실행](../verification/company-data-2026-11-02-release/gate-d0a6de2b/verification-proof.json)과 [전체 frontend 대체 실행](../verification/company-data-2026-11-02-release/frontend-d0a6de2b/verification-proof.json)을 구분하며 d0의 단일8/8 실행 성공으로 설명하지 않는다. 최초 timeout의 원인을 자원 부족으로 단정하지 않는다. [정확한 커밋 CI](../verification/company-data-2026-11-02-release/d0a6de2b-ci-proof.json)는 이 두 로컬 실행과 독립된 증거다.

**profiles11은 ACTIVE로 배포됐고 12개 런타임 파일이 d0 소스와 정확히 일치한다.** 배포 패키지 SHA256은 `3c06cd2ba40e953238c1720d52659b7c175e751e4fbf26c873de7be8895be99b`이며 [배포 증거](../verification/company-data-2026-11-02-release/profiles11-deployment.json)를 보존한다. SNDK 실화면 인수, main의 d0 fast-forward와 Vercel 최종 배포·공개 release 확인을 완료했다.

### 최종 완료 판정

| 판정 항목 | 최종 결과와 증거 |
|---|---|
| 운영 소스·배포 | d0/main, Vercel `dpl_8bD58BeVs4kFFfnp58ThaU4yDG1V` READY, 운영 alias `signalbrief.online`.07:34:58.178233 UTC 공개 release HTTP200·정확한 소스 일치 |
| 정확한 소스 CI | 적용9개 workflow·17개 job PASS. push92개와 PR92개 브라우저 실행을 각각 확인. [최종 CI 증거](../verification/company-data-2026-11-02-release/d0a6de2b-ci-proof.json) |
| 로컬 검사 | 최초 전체 실행은 **FAIL·7/8**, backend1,104·0 skip 및 frontend1,679통과·기존 timeout1건. 같은 소스·5,000ms 제한·assertion의 전체 frontend 대체 실행은 `maxWorkers=2`에서 **1,680건·117파일 PASS**. 두 실행을 합쳐 단일8/8 통과라고 쓰지 않음 |
| Edge·SQL | profiles11 ACTIVE·런타임12개 파일 일치. US24·discovery9·collector19 및 calendar7 유지. 적용SQL16개 ledger 해시 일치, 추가 캐시 우회 없음 |
| SNDK 실제 인수 | 정상 대기 후 일반 재조회로07:28:58.632046 UTC ready·오류 없음. 사업2·제품2·원문 소문자 단일 부문1·공시 기준 CEO·법인 설립일과 재무40개를 [실제 화면](../verification/company-data-2026-11-02-live/sandisk-profile-final.jpg)에서 확인.07:33:21.920192 UTC 원본·보관 식별 재검증 완료 |


Drupal 일정 SQL은 **`20261102054530_calendar_drupal_event_lists.sql`로 적용됐다.** SHA256은 `5be047fa9ee3caf58120a91a53de35892756ef92c032adf0290cab41dfb2a056`이다. DART 제품 행 캐시 전환도 **06:00:38 UTC, `20261102060038_profile_dart_rows_refresh.sql`로 적용 완료**했으며 기존54123 파일과 SQL 바이트/SHA가 같다. SEC 부분 프로필 캐시 전환도 **06:56:27 UTC, `20261102065627_sec_profile_identity_fields_refresh.sql`로 적용됐다.** 기존60524의 SQL 바이트·SHA를 유지하고 파일명과 테스트 참조를 실제 ledger에 맞췄다. 총16개 ledger의 SQL 해시 일치를 확인했다. 문서가 별도 커밋으로 배포 기록을 갱신하더라도 위 런타임 커밋과 구분한다.

## 1. 확인한 결함과 정확한 수정 경로

| 증상·원인 | 관련 코드 | 수정과 결과 |
|---|---|---|
| `visa` 검색에 Televisa·VISANG 같은 약한 부분 일치가 섞임 | `supabase/migrations/20261102020446_company_search_precision.sql` | 선택한 시장·제공자 범위 안에서 정확한 ticker/이름·Latin 단어/구문을 우선한다. 강한 일치가 없을 때만 부분 검색을 유지하며 한국어 별칭도 보존한다. 일반 공시 본문 검색에는 적용하지 않는다. |
| 정밀 검색 변경 후 실제 14,439개 디렉터리에서 SQL57014 시간 초과 | `supabase/migrations/20261102022052_company_search_catalogue_performance.sql` | 모든 행에서 별칭을 다시 확장하던 계산을 한 번으로 줄이고 후보를 먼저 제한한다. 등록 기업과 외부 디렉터리 모두 같은 순위를 사용한다. 14,500개 합성 기업·3초 statement timeout으로 검증했다. |
| 기본 SEC 메타데이터만으로는 CEO·설립·제품·사업부문을 채울 수 없음 | `supabase/functions/signalbrief-profiles/enrichment-service.ts`, `supabase/functions/signalbrief-profiles/enrichment-sec.ts`, `supabase/functions/signalbrief-profiles/enrichment-types.ts` | 공식 연차/최신 보고서, 명시적인 같은 회사의 법인 문서와 검토된 공식 리더십 출처를 수집한다. 필드마다 원문·SHA·날짜·정확한 인용 위치를 보존한다. 일반 공시 추출이 중심이며 고정된 회사 소개 목록에만 의존하지 않는다. |
| Mastercard 소개가 규제 문단 중간에서 시작하고 CEO가 빠짐 | `supabase/functions/signalbrief-profiles/enrichment-sec.ts` | 목차·반복 머리글과 실제 사업 구간을 구분하고, 긴 문단의 유효 구간과 명시적인 제품/부문을 읽는다. CEO는 명시적인 서명·직책 연결만 사용하며 여러 열의 서명자 관계가 모호하면 채우지 않는다. |
| NAVER 등 DART 사업 소개가 비어 있음 | `supabase/functions/signalbrief-profiles/enrichment.ts`, `supabase/functions/signalbrief-profiles/enrichment-dart.ts`, `supabase/functions/signalbrief-profiles/enrichment-dart-core.ts`; `apps/web/src/server/dart-profile-archive.ts` | 환경 설정의 기존 DART 자격 정보를 전달하고, 최종 정기보고서 목록의 회사·접수번호를 확인한 뒤 원본 ZIP과 정규화 문서를 보관한다. ZIP/XML 처리는 인증된 Node 경로에서 수행한다. 복구한 문서는 복구 사실을 표시한다. |
| 정상 DB 프로필인데 첫 조회·갱신 중 화면은 로드 실패 | `apps/web/src/lib/company-profile-contract.ts`, `apps/web/src/components/use-company-profile.ts` | 기존 Z 전용 계약이 PostgreSQL의 유효한 `2026-11-02T05:21:48.272366+00:00`를 거부했다. 출처 `fetched_at`, 프로필 `checked_at`·`next_refresh_at`만 offset ISO8601을 허용한다. 시간대 없는 값·잘못된 날짜·다른 회사의 증거는 계속 거부한다. 기존 hook을 바꾸지 않고 캐시 표시와 갱신 polling을 회복한다. |
| Tesla의 실제10-K/A가 `profile_filing_identity_invalid`로 실패 | `supabase/functions/signalbrief-profiles/enrichment-sec.ts`, `supabase/functions/signalbrief-profiles/enrichment-service.ts` | 회사·서식·기간이 맞고 AmendmentFlag=false인 실제 공시는 Part III 보완과 관련 인증서 제출 목적, 원래 공시의 나머지 내용을 유지한다는 설명을 갖는다. 정확한 설명·원본 링크와 submissions 메타데이터가 함께 맞을 때만 원본10-K를 한 번 추가 수집한다. 누락/알 수 없는 flag, 다른 회사·기간·사업 수정 범위는 허용하지 않는다. |
| 삼성의 `부문간 내부거래 제거 등`이 제품으로 표시되고 `부 문` 헤더를 놓침 | `supabase/functions/signalbrief-profiles/enrichment-dart-core.ts`; `supabase/migrations/20261102060038_profile_dart_rows_refresh.sql` | 명시적인 회계 제거·조정·합계 행만 제외한다. `기타제품`과 실제 제품명 안의 관련 단어는 유지한다. 공백이 있는 명시적 부문 헤더를 읽되 `구분`·`지역`에서 부문을 추론하지 않는다. 새 파서·캐시 전환 후 운영에서 사업2·제품4·부문4를 확인했다. |
| 수치 패널이 옛 facts/events 연결에 의존 | `supabase/functions/signalbrief-api/company-financials.ts`, `supabase/functions/signalbrief-api/company-financials-core.ts`; `apps/web/src/components/company-financials.tsx` | SEC companyfacts와 OpenDART 재무자료를 별도의 출처 기반 수치 계약으로 제공한다. 원문 decimal·통화/단위·기간·연결/별도·접수번호·공시일을 유지한다. 승인 분석의 인용문과 정규화 수치는 별도로 취급한다. |
| DART 반기 손익의 분기 금액에 반기 누적기간을 붙임 | `supabase/functions/signalbrief-api/company-financials-core.ts`; `supabase/migrations/20261102051051_dart_financial_period_binding.sql` | 중간기간 IS/CIS는 명시된 누적 금액 `*_add_amount`와 보고된 누적기간을 함께 사용한다. 누적 값이 없으면 잘못된 기간을 추정해 채우지 않는다. BS 시점 금액과 SEC 문맥은 유지한다. DART v1 기간 수치를 즉시 공개 격리하고, 같은 원본 SHA의 v2 재파싱을 별도 불변 스냅샷으로 저장한다. |
| 신규 회사 뉴스가 고정 ticker 사전 밖에서 막힘 | `apps/web/src/app/api/news/route.ts`, `apps/web/src/lib/news-contract.ts` | 인증된 회사 ID를 확인한 뒤 서버에서 공식 회사명 기반의 제한된 질의를 만든다. 기존 공개 주제 endpoint의 허용 목록은 유지하고 임의 클라이언트 문자열을 전달하지 않는다. |
| 새 회사 분석 수집과 화면 갱신이 뒤처짐 | `supabase/functions/signalbrief-collector/index.ts`, `supabase/functions/signalbrief-api/analysis-excerpt.ts`, `apps/web/src/redesign/company.tsx` | 회사별 지속성 있는 수집 요청을 기존 제한된 collector에 연결하고 표지 대신 지원되는 재무 본문을 사용한다. 승인 수가 실제로 바뀌면 승인 목록을 제한적으로 다시 읽는다. 자동 수집을 자동 승인으로 연결하지 않는다. |
| SEC 신규 회사 일정 연결이 없거나 지원 형식 밖의 실제 페이지에서 실패 | `supabase/functions/signalbrief-calendar/sec-ir.ts`, `supabase/functions/signalbrief-calendar/public-source.ts`, `supabase/functions/signalbrief-calendar/source-relay.ts`; `apps/web/src/server/calendar-source.ts` | 같은 SEC 회사의 공시에 명시된 IR 주소와 목적지의 회사 표지를 검증한다. 공용 IP에 연결을 고정하는 인증된 HTTPS 경로에서 제한된 원본을 수집한다. Q4·구조화 표·명시적인 SEC 행사 공시와 일반 Nasdaq/Drupal 목록을 지원한다. |
| 동시 일정 수집이 오래된 revision으로 역전될 수 있음 | `supabase/migrations/20261102052159_calendar_sec_filing_ingest_lock.sql` | 같은 source의 검증과 upsert를 transaction advisory lock으로 직렬화한다. 최신 원본, 기존 일정 ID와 개인 저장 연결을 보존한다. |
| 상세 일정이 수집 완료 후에도 비어 있거나 빈 결과가 실패처럼 보임 | `apps/web/src/redesign/calendar-data.ts`, `apps/web/src/redesign/company.tsx` | 회사/계정 범위가 바뀌면 이전 응답을 버리고, 실제 수집 중일 때만 제한된 polling 후 자료를 다시 읽는다. 로딩·수집 중·오류·미공개·검토 대기를 구분한다. |

### SNDK에서 확인한 최종 후속 결함

다음 일반 추출 규칙은 e391에 포함됐다. 이어서 d0a6de2b는 단일 부문명과 SQL 저장 계약 사이의 실제 대소문자 불일치를 수정한다. 회사명·CEO·제품을 코드에 넣는 방식으로 해결하지 않았다.

| 실제 결함 | 정확한 수정 경로 | 처리와 보존 조건 |
|---|---|---|
| CEO 서명이 있어도 앞선 회계책임자와 혼동해 누락 | `supabase/functions/signalbrief-profiles/enrichment-sec.ts`의 `extractLeadership` | 완료된 부사장·회계/재무책임자 직책을 이전 서명 구간의 끝으로 인정한다. 다음 명시적인 CEO 서명을 연결하며, 해결되지 않은 복수 서명·상충 이름·재무책임자만 있는 자료는 계속 거부한다. |
| `Service and Warranty`의 보증 정책을 제품으로 표시 | 같은 파일의 `extractBusiness` | 실제 제공 대상이 보증인 문장은 제외한다. 기간이나 고객 표현이 붙은 보증도 거부한다. 실제 수리 서비스·연장 서비스 플랜은 유지하며 Tesla 실제 원본으로 확인했다. |
| `Our Data Solutions`라는 일반 제목만 제품으로 표시 | 같은 파일의 `extractBusiness` | 실제 제품 구간의 명시적인 제공·판매 문장에서 분명한 대상만 추출한다. 복잡한 나열을 임의로 쪼개거나 end market을 제품명으로 바꾸지 않는다. SNDK 원문에서는 enterprise SSD와 client portable SSD 문장을 확인했다. |
| 숫자 `3.1` 링크를 설명하는 정관 표 행을 놓쳐 법인 설립일 누락 | `supabase/functions/signalbrief-profiles/enrichment-html.ts`, `enrichment-sec.ts`의 `profileCharterLink` | 명시적인 정관 문구가 있는 기존 링크를 우선 유지하고, 후보가 없을 때만 같은 표 행의 숫자 링크와 정관 설명을 연결한다. 다른 행·중첩 표·모호한 복수 링크·다른 CIK는 거부한다. 정관 원문의 회사명 검증도 유지한다. Visa·Mastercard의 실제 기존 정관 URL이 유지됨을 별도로 확인했다. |
| 명명되지 않은 단일 보고 부문 공시가 비어 있음 | `enrichment-sec.ts`의 `extractSegments` | 회사가 명시적으로 공시한 단일 보고 부문 문장만 사용한다. d0a6de2b는 원문의 `single reportable operating segment` 구절을 대소문자까지 그대로 캡처한다. Datacenter·Edge·Consumer는 end market이므로 보고 부문으로 만들지 않는다. |
| 새 필드는 추출됐지만 SNDK 프로필 저장이 실패 | `enrichment-sec.ts`의 `extractSegments`; 검증 경로는 `enrichment.ts` → `sb_profile_enrichment_admin` | 기존 생성값 `Single reportable operating segment`가 원문 소문자와 달라 `PT422 / profile_quote_mismatch`로 거부됐다. 원문에서 캡처한 정확한 표현을 전달한다. 대소문자 구분 SQL·회사/원본/인용 검증은 그대로 유지한다. 현재 수집기의 실제 결과로 로컬 RPC 저장까지 재현했다. |
| 공식 companyfacts의 `"0002023554"`를 다른 회사 식별자로 오인 | `supabase/functions/signalbrief-api/company-financials-core.ts`의 `canonicalSecCik` | 안전한 양의 정수 또는1~10자리 십진 숫자 문자열만10자리 CIK로 정규화한 뒤 canonical 회사와 정확히 비교한다. 객체·배열·부호·소수·0·공백·비숫자·다른 CIK는 허용하지 않는다. 원본·정확한 금액·JSON 위치·SEC/DART 기간 규칙은 바뀌지 않는다. |

## 2. 원본·식별·날짜에 대한 공통 기준

프로필의 각 필드는 원본 보관, SHA256, 제공자/회사 식별, 공시일의 정밀도, 조회 시각과 정확한 인용에 연결한다. 오래된 공시의 CEO를 현재 재직 정보로 바꾸지 않으며, 공시 기반 리더십은 공시 기준일을 함께 표시한다. 법인 설립, 창립, 재편은 같은 의미로 합치지 않고 연도만 확인된 값은 연도로 유지한다. 임의의 CEO·사업 소개·수치·날짜를 하드코딩해 빈칸을 채우지 않는다.

DART는 회사코드와 접수번호를 공식 최종 정기보고서 목록에 대조한다. 원본 ZIP과 정규화 텍스트의 SHA를 각각 유지하고, 복구한 마크업은 추가 구조 검토가 필요하다는 제한을 표시한다. SEC 개정본의 원본 복구도 같은 회사·연차·정확한 URL·제출 순서를 다시 검증하며 개정본 자체를 근거로 함께 보관한다.

재무 수치는 값과 기간을 하나의 문맥으로 취급한다. 다른 회사로 매핑이 바뀐 캐시나 원본 보관이 사라진 캐시는 정상 데이터로 재사용하지 않는다. 같은 SHA라도 파서 버전이 다르면 별도 스냅샷이며, 같은 버전의 서로 다른 해석은 충돌로 거부한다. 수치 문맥 개수는 서로 다른 재무 지표 개수와 같지 않을 수 있다.

일정은 회사·공식 출처·명시된 개최일을 모두 확인한다. Drupal 목록은 `complete:false / published-event-list`, SEC 단일 행사 공시는 `complete:false / explicit-sec-announcement`다. 부분 목록에서 사라진 항목만으로 취소를 선언하지 않는다. 상세 링크를 가져오지 않았다면 그 링크를 원본으로 주장하지 않고 실제 보관한 목록 페이지에 인용을 연결한다. **SEC·Drupal 일정**의 같은 키에서 날짜가 충돌하거나 식별 형식이 바뀌면 검토 없이 덮어쓰지 않는다. **DART 공식 정정 공시**는 원본부터 최신 정정본까지 연결 관계와 보관 원문을 검증한 뒤 기존 일정 ID·개인 저장 연결을 유지하면서 정정 날짜를 반영한다.

## 3. 신규 회사 등록과 개인 저장 동작

등록은 canonical 제공자/회사/ticker를 확인한 뒤 회사별 수집 작업을 남긴다. 상세 페이지에서도 같은 멱등 수집 경로를 요청할 수 있으며 후속 polling은 읽기 요청이다. 프로필·수치·일정은 독립된 상태를 가져 한 제공자의 선택적 실패가 다른 정상 자료를 지우지 않는다. 수집 중복은 lease로 제한하고 계정 또는 회사를 바꾸면 이전 요청과 결과를 버린다.

공식 기업 검색이나 일정의 관련 회사 선택만으로 관심기업을 팔로우하거나 개인 일정을 저장하지 않는다. 회사 활성화로 공용 기업 레코드와 수집 작업은 생길 수 있지만, 개인 저장은 사용자의 명시적 동작으로만 생성한다. Saved는 실제 저장한 분석·공시·일정을 보여 주며 저장이 없을 때는 실제 공개 자료를 찾는 진입점을 제공한다. 저장 없음, 필터로 가려짐, 조회 오류를 구분하고 초기 개인 기록 비활성 설정을 유지한다. 과거 저장·새로고침 왕복 확인은 유지하되 이번 자동 수집으로 북마크나 승인 상태를 만들어 넣지 않는다.

## 4. 실제 운영에서 확인한 범위

다음은 단계별 실화면 인수와 최종 d0/profiles11에서 확인한 결과다. SNDK는 최신 일반 재조회·화면으로 인수했고,07:33:21.920192 UTC 운영 관측에서 다른 대상의 기존 수치와 원문 보존도 다시 확인했다. 각 화면의 확인 시점과 자료 기준일은 그대로 구분한다.

| 대상 | 이미 확인한 운영 결과 | 해석과 범위 |
|---|---|---|
| Visa | `visa` 검색이 무관한 Televisa/VISANG 없이 V를 반환. 사업2·제품10·부문1, 공식 페이지 기준 Ryan McInerney, 법인 설립2007-05-25. 수치44개 문맥, 일정 미래5·과거2 | 앞선 운영의 검색·소개·수치·일정 화면 증거를 유지한다. Offset 계약 보완은9c부터 운영에 포함됨 |
| Mastercard | 실제 기업 선택으로 등록 후 수치56개 문맥·뉴스10건. 규제 문단을 소개로 가져오던 문제 수정 후 사업2·제품8·부문1, Michael Miebach(2026-10-29 공시 기준), 법인 설립2001-05-09. 일정 미래2·과거2 | DB ready와 정상 프로필 재표시를 확인했다. 처음 병렬 조회에서의 offset 계약 실패를 추가로 수정했다. 모든 CEO가 실시간 확인됐다는 의미가 아님 |
| NAVER | DART 원문 사업 소개2개. **05:26:55 UTC에 reported-financials-dart-v2 ready,24개 문맥** 확인.2026년 상반기 연결 누적 매출6,629,816,183,195 KRW와2025년 상반기5,701,868,408,120 KRW가 실제 화면과 일치 | 이전 v1 기간 수치 격리 후 재수집 성공. 사업 원문의 복구 파싱 제한과 제품/부문 미확인 상태는 유지 |
| Tesla | 9c에서 프로필 사업2·제품9·부문2와 Elon Musk(2026-01-29 공시 기준), 재무52개 문맥을 실제 확인. SEC 원문의2026-10-21 실적 발표 행사1건 반영, 확인된 미래 일정0건 | 제한적 Part III 개정본 복구가 운영에서도 성공했다. CEO 기준일을 현재 재직 확인으로 바꾸지 않으며 법인 설립일은 미확인 |
| 삼성전자 | **06:01:31 UTC 새 프로필에서 사업2·제품4·부문4** 확인. `부문간 내부거래 제거 등`은 제거됨. 공식 일정의 최근 과거13건·미래0건 | 60038 DART 캐시 전환 후 실제 수집·화면 확인 완료. 실제 제품과 명시적 DX/DS/SDC/Harman 부문을 유지 |
| Sandisk | 실제 검색에서 Sandisk/SNDK만 반환, 재무40개·일정 미래1/과거5. profiles11의 **07:28:58.632046 UTC 일반 재조회에서 ready·오류 없음**: 사업2·제품2·원문 소문자 단일 부문1·David V. Goeckeler(2026-08-17 공시 기준)·법인 설립2024-02-05를 실제 로그인 UI에서 확인 | profiles10의 저장 실패를 최소 대소문자 수정으로 해결했다. 원본 해시·보관 식별은 유지. CEO 기준일을 현재 재직 확인으로 바꾸거나 현 법인의 설립일을 브랜드 창립/분리일로 해석하지 않음 |
| Apple | 05:25:43 UTC 운영 관측에서 공식 미래 일정1건 | 그 시점 프로필/수치 보완 스냅샷은 없었다. 일정 확인을 모든 상세 필드 검증으로 확대하지 않음 |
| NVIDIA | 9c Selected에서 미래1·과거3과11월17일 월간 그리드 항목 확인 | 해당 회사의 실제 공식 일정 범위 확인 |
| Micron | 9c Selected에서 미래0·과거3, 최근10월21일 항목 확인 | 미래0은 확인된 결과이며 과거 자료가 없다는 의미가 아님 |
| LS 관심기업 검색 | 실제 관심기업 추가 검색에서 LS와 공식 관련 회사 결과 확인 | 검색만으로 팔로우하지 않으며, 결과를 명시적으로 선택하는 단계와 구분 |
| 전체 일정 | 9c UI에서 등록15개/연결15개, 미래13·과거48 확인 | 연결은 해당 회사의 지원 출처가 연결됐다는 뜻이며 모든 미래 행사의 완전성을 뜻하지 않음 |
| Saved | 실제 명시적 저장·새로고침 유지 확인 후 테스트 저장 정리 완료 | 저장 성공과 정리 후 빈 개인 보관함을 구분한다. 자동 수집으로 북마크나 기록을 생성하지 않음 |

운영 일정 UI는 사용자 시간대 기준 **과거90일/미래365일**, 제공자 수집은 **과거90일/미래18개월**이다. 서로 다른 창의 개수를 같은 총계로 비교하지 않는다.

### NAVER v2 원본과 이전 스냅샷 보존

[공식 반기보고서 접수20260814002266](https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20260814002266)의 누적기간을 그대로 유지했다. 현재 기간은2026-01-01~2026-06-30, 비교 기간은2025-01-01~2025-06-30이며 모두 연결·KRW 문맥이다. 분기 금액3,388,755,080,295에 반기 누적기간을 붙이던 문제를 바로잡았다.

- 원본 SHA256: `c673aebd0defca11fcda93a100da04b08d62e94587041754aa7103afdd847281`.
- 이전 `reported-financials-v1` 스냅샷 fingerprint: `87a77ef83963c1858409733245256c3d10f4ddf0c9167a460b499bfa85e33b25`. v2 수집 후에도 보존됨을 확인했다.
- 실제 UI 증거: [누적 매출 수정 화면](../verification/company-data-2026-11-02-live/naver-cumulative-revenue-repaired.jpg).

`production-observation-052543.json`은05:25:43의 **재수집 직전** 관측으로 v1 격리/오류 상태를 담는다.05:26:55의 v2 성공과 시간순으로 구분하며, 이전 JSON을 수정 후 증거로 설명하지 않는다.

## 5. 실제 공식 원본 재생과 집중 회귀

### 실제 원본을 로컬에서 재생한 결과

| 자료 | 확인한 결과 | 증거 범위 |
|---|---|---|
| [Sandisk 공식 일정 목록](https://investor.sandisk.com/news-events/events) | HTML85,699바이트,26개 행 중 검증 창의 미래1·과거5.2026-11-17,10-29,09-09,09-08,08-13,08-05를 추출. 전체 collector와 실제 PG 저장/인증된 조회 재생 통과 | 원본 SHA256 `23d23017429bdbb52b9bbb41d9ac8907e7df0173a01f0474e4ba0109b1185d99`. 부분 목록이며 모든 미래 일정의 완전성을 주장하지 않음 |
| [Tesla 실제10-K/A](https://www.sec.gov/Archives/edgar/data/1318605/000110465926053166/tm2611837d1_10ka.htm)와 명시적으로 연결된 원본 | 사업2·제품9·부문2·CEO1·출처3, 정확한 인용 연결14건. 기존6개 실제 공시의46개 인용과 추출 결과 유지 | 개정본 SHA256 `ef65ead556eda2cdcbf9eeb034dbf5304defb97d26638e5508253ba5f63e5f0d`. CEO Elon Musk는2026-01-29 공시 기준. 설립/법인 설립일 미확인 |
| [삼성 DART 접수20260814003699](https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20260814003699)의 제품 표 | 정확한 `부 문 / 주요 제품 / 매출액 / 비중`과 제거 행을 합성 회귀에 재현. 이후9c 실제 재수집에서도 제품4개와 명시적 사업부문4개 확인 | 원본 SHA256 `b1799f30f4dbd6da79bced771eee139ed622cfd2a2edeb047824b9e1091f39ec` |
| [SNDK 연차보고서](https://www.sec.gov/Archives/edgar/data/2023554/000162828026057406/sndk-20260703.htm), 최신 분기보고서와 연결된 정관 | d0a6de2b 수집 함수를 실제 원본으로 재생하고 실제 로컬 RPC에 저장: ready, 사업2·명시적 SSD 제품2·단일 보고 부문1·CEO1·법인 설립1·원본3, 정확한 인용 연결7건. 기존 결과와의 유일한 필드 차이는 부문명의 원문 대소문자 보존이다. CEO David V. Goeckeler는2026-08-17 공시 기준; 법인 설립은2024-02-05 | **로컬 실제 원본 증거이며 이후 profiles11 운영 인수도 별도로 완료했다.** 연차 SHA256 `8b6963dfdfdca8f74c6b5f3d60a61a5182ddb7c7c29e2058cf120de217ff267c`; 정관 `820d07c43039e041adf7f5f39bda39e652bc825a1a5b0d88b4734adcc5c5d4be`; 분기 `5d900affe64cd2af6f18c94c5968893868123f34b3ffba36f11ca8f03baf5b1a`. 현 법인 설립일이며 브랜드 창립일/분리일로 바꾸지 않음 |
| [SNDK 공식 companyfacts](https://data.sec.gov/api/xbrl/companyfacts/CIK0002023554.json) | 실제 자료의 문자열 CIK를 정확히 정규화해40개 문맥·40개 원문 금액/JSON 위치 일치 확인 | **로컬 실제 원본 증거.** 587,614바이트, SHA256 `33374cf440b069e7563af577070e9cc66a43923f3e9b9fcf0dab800308435768`. 이후 e391 운영 UI에서도40개 문맥 표시를 확인함 |

### 수정별 집중 검증

| 범위 | 완료한 검증 | 저장소의 재현 경로 |
|---|---|---|
| 검색 정확도/규모 | 집중 PG20건·0 skip.14,500개 합성 기업,3초 statement timeout, endpoint별 별칭 확장1회 | `tests/workspace/test_company_search_precision.py`, `tests/workspace/test_company_search_performance.py` |
| profile offset 계약 | 신규15건 중 수정 전5건 실패. 관련39건 통과, TypeScript·ESLint 통과 | `apps/web/tests/company-profile-timestamps.test.tsx` |
| 일정 동시 수집 | 실제 두 DB 접속으로 최신 revision 보존·이전 요청 거부, 기존 IR/Q4와 권한 회귀 | `tests/test_calendar_sec_filing_lock.py` |
| Drupal 목록 | 신규TS21건(수정 전19건 실패), 관련TS145건 통과. 독립 실제PG65건·0 skip와 실제 원본 manifest PG재생1건 통과 | `apps/web/tests/calendar-drupal-events.test.ts`, `tests/test_calendar_drupal_events.py` |
| SEC 제한적 개정본 | 관련TS77건 통과. 신규20건과 누락/알 수 없는 flag 거부 회귀. TypeScript·lint·Deno 통과 | `apps/web/tests/company-profile-amendments.test.ts` |
| DART 제품/부문 행 | 신규12건 중 수정 전7건 실패. 관련47건 통과, TypeScript·ESLint·Deno 통과 | `apps/web/tests/company-profile-dart-rows.test.ts` |
| DART 캐시 재수집 | 실제PG11건·0 skip.UTC/Seoul 환경, 원문/필드 보존, 활성/만료lease, 실패 대기, 다른 제공자 격리. Ruff 통과 | `tests/workspace/test_company_profile_dart_rows_refresh.py` |
| SNDK에서 확인한 일반 SEC 프로필 규칙 | 신규24건 포함 관련101건 통과. 최초7건, 명시적 정관 링크2건, 기간/고객 표현 보증2건은 수정 전 실패를 확인. TypeScript·ESLint·Deno 통과. 기존6개 Visa/MA/Tesla 공시의 필드/정규화/46개 인용과 두 회사의 정관 선택 유지 | `apps/web/tests/company-profile-sec-offerings.test.ts`; [실제 원본 재생 증거](../verification/company-data-2026-11-02-release/sandisk-profile-replay.json) |
| 단일 부문명과 실제 저장 계약 | 대소문자3개 회귀는 수정 전 실패. 관련TS103건/5파일, 합성 실제PG5건, 현재 수집기의 SNDK 실제 원본 RPC 재생1건 통과. 변경·조작된 이름은 계속 거부하며7개 정확한 인용·3개 원본을 보존. TypeScript·ESLint·Ruff·Deno 통과 | `apps/web/tests/company-profile-sec-offerings.test.ts`, `tests/workspace/test_company_profile_segment_persistence.py`; [집중 검증](../verification/company-data-2026-11-02-release/segment-case-fix/focused-manifest.json), [실제 수집 결과](../verification/company-data-2026-11-02-release/segment-case-fix/actual-collector-proof.json), [실제 RPC 저장](../verification/company-data-2026-11-02-release/segment-case-fix/actual-snapshot-persistence.log) |
| SEC CIK 형식 호환 | 관련90건/3파일 통과, 신규 식별25건 중 수정 전2건 실패. 실제 SNDK40문맥·원문 연결 재생, TypeScript·ESLint·의존 Edge3개 Deno 통과 | `apps/web/tests/company-financials-core.test.ts`, `company-financials-edge.test.ts`, `company-financials-api.test.ts`; [CIK 검증 증거](../verification/company-data-2026-11-02-release/financial-cik-replay.json) |
| SEC 부분 프로필 재수집 | 실제PG31건·0 skip, 활성lease 중단·필드/원본 보존·실패 대기·기존 CEO/ready/다른 제공자 제외 확인 | `tests/workspace/test_company_profile_identity_fields_refresh.py`; [캐시 검증 증거](../verification/company-data-2026-11-02-release/sec-profile-cache-refresh-tests.json) |
| 독립 오류가 함께 있는 보유 정보 테스트 | 실패를 결정적으로 재현한 뒤 관련7건·TypeScript·ESLint 통과. HTTP503 프로필과 보유 정보 오류를 모두 표시하며 이름 있는 보유 dialog 안에서만 오류/재시도를 찾음. 실패 중 폼·저장·PUT 없음, 재시도 후 portfolio GET 정확히2회·profile fetch1회 유지·묵시적 쓰기 없음 확인 | `apps/web/tests/mobile-search-company.test.tsx`; [수정 전후 증거](../verification/company-data-2026-11-02-release/test-selector-fix/proof.json) |

집중 검사에는 중복 범위가 있으므로 합산하지 않는다. 실제 원본 재생은 제공자 형식·원문 연결 증거이고, 실제 운영 수집 및 UI 확인은 별도 단계다.

## 6. 배포 순서와 운영 보존 조건

Drupal SQL은 새 형식의 calendar Edge보다 먼저 적용한다. 적용된54530의 바이트와 로컬 파일을 맞췄다. SEC 일정 wrapper는52159의 동일 source 잠금을 유지하며 기존 함수 권한·회사 검증·원본 보관 조건을 약화하지 않는다.

DART 제품 행 추출은 Node 원본 parser에서 실행하므로 **새 Node/core와 profiles 코드 반영 후** 캐시 전환을 적용했다. 실제 ledger는60038이며 기존54123 파일을 이 버전으로 맞췄다. SQL은 캐시 테이블을 잠그고 활성 DART lease가 하나라도 있으면 `dart_profile_refresh_active_lease`로 전체 중단한다. lease를 지우거나 실패 후 대기를 우회하지 않는다. 이미 정상 파싱한 DART 정기보고서의 행/JSON 다음 수집 시각만 같은 UTC `Z` instant로 만료시키며, 필드·원본·검사/갱신 시각·오류·실패 대기·SEC 데이터는 보존한다.

DART 캐시 전환 SQL SHA256은 적용 전후 `6867a4da3d98a2beca00839c3234abfb1feb53433fb9866503564f92f723721f`로 같다. 삼성의06:01:31 후속 결과로 실제 재수집도 확인했다.

e391 운영에서는 **US24·profiles10·discovery9·collector19가 ACTIVE**이며 배포된 런타임50개 파일의 정확한 소스 일치를 확인했다. calendar7은 변경하지 않았다. profiles10 배포 후 **06:56:27 UTC에 SEC 캐시 전환65627을 적용**했다. `supabase/migrations/20261102065627_sec_profile_identity_fields_refresh.sql`의 SHA256은 `be13b53c89049018af49c4c83dfd71ee60da1e3d5dfedd791146adf1a566f27a`다. 활성 SEC lease가 하나라도 있으면 전체 중단하며, 오류 없는 정상 SEC 공시 기반 `partial` 프로필 중 `leadership=[]`인 행만 다음 수집 시각을 만료시킨다. 기존 CEO가 있는 프로필·ready·실패/오류 대기·DART 및 보관된 필드·원본·검사/갱신 시각은 보존한다. 같은 instant를 행과 JSON의 UTC `Z` 시각으로 기록한다.

d0a6de2b의 새 런타임 변경은 profiles11에만 필요하며, 해당 Edge는 이미 ACTIVE로 배포됐다. 12개 런타임 파일의 정확한 소스 일치와 패키지 SHA256 `3c06cd2ba40e953238c1720d52659b7c175e751e4fbf26c873de7be8895be99b`를 확인했다. 추가 SQL이나 캐시 수동 변경 없이 기존 실패 대기 이후 정상 조회로 재수집한다.

정상 조회·회사별 큐로 새 증거를 수집하며 수치·일정·완료 상태를 수동 생성하지 않는다. 오류가 나면 원본과 이전 검증 자료를 보존하고 원인을 표시한다. 변경된 함수의 배포와 SQL의 실제 ledger 정렬까지 확인했으며 최종 운영 판정을 상단 표에 기록했다.

## 7. 앞선 릴리스 검사 이력

| 소스/단계 | 당시 완료된 결과 | 현재 해석 |
|---|---|---|
| Node bridge `07d6f0d8` | 정확한 소스 CI와90개 브라우저 시나리오, Vercel READY 및 공개 release identity 확인 | 새 Node 전송 기능을 먼저 배포한 단계 |
| 초기 전체 소스 `cd31aeda` | 01:59:37 UTC 로컬8단계, backend829·0 skip, frontend1,474/111files. 정확한 소스의 필수push/PR workflow12개와92건 브라우저 두 실행 통과 | 카탈로그 규모 검색·후속 파서/시각 문제를 발견하기 전의 이력 |
| 직전 소스 `23a36f214376530b7dd6efc4f0230dc5c9d0624b` / tree `3f6f3521dcde7c8fe11ea7e0873bc21f0f732e24` | 05:21:04.850059 UTC 로컬8단계 PASS: backend988·0 skip, frontend1,561/112files, lint 오류0·기존 경고5, Deno6진입점·scope PASS.05:26:45 UTC 확인에서 필수workflow12개 SUCCESS; PR/push각각92개 브라우저 통과 | 이후 offset 계약·추가 일정 잠금/목록·개정본·DART 행/캐시 보완의 최종 인증으로 재사용하지 않음 |
| 앞선 운영 소스 `9c1507383fb513c23a4a33468b564cbbeafb71e2` / tree `83dfd0059308766381aad2e5b1dfeb2c1c069155` | 전체 로컬8단계 PASS: backend1,068·0 skip, frontend1,629/116files. 필수CI12개 SUCCESS, PR/push각각92개 브라우저 통과. Vercel `dpl_F8K6Ak7xMPCPL3JYX2xouZjkLfDk` 배포 완료, 공개 release HTTP200·9c/main 확인 | Tesla·삼성 프로필, SNDK/NVIDIA/Micron 일정, LS 검색, Saved 왕복·정리까지 실제 운영 인수 완료. 이후 ee의 SNDK 프로필/CIK 후속 수정에 대한 전체 인증으로 재사용하지 않음 |
| ee9cdc 전체 로컬 검사 첫 시도 | **FAIL**. Backend1,098통과·1실패:14,500개 카탈로그 `visa` 등록 기업 검색에서3초 statement timeout(SQLSTATE57014). Frontend1,678건은 통과 | [첫 시도 전체 증거](../verification/company-data-2026-11-02-release/local-first-attempt/verification-proof.json)와 [SQL 진단](../verification/company-data-2026-11-02-release/local-first-attempt/search-timeout-diagnosis.json)을 보존. 실패 원인을 자원 경쟁으로 단정하지 않음 |
| 변경 없는 검색 SQL의 제한된 후속 확인 | 같은3초 제한·SQL·assertion으로 실패 사례를 한 번 단독 실행해 통과. PostgreSQL17 workspace CI는355건·0 skip으로 통과했고, 해당 Visa 사례는0.781초에 통과 | [단독 실행](../verification/company-data-2026-11-02-release/search-diagnostic/diagnostic-run.json), [CI 증거](../verification/company-data-2026-11-02-release/ee9cdc78-workspace-ci-proof.json). 단독 통과를 첫 전체 검사의 성공으로 바꾸지 않음 |
| ee9cdc 전체 로컬 검사 두 번째 시도 | **FAIL**. Backend1,099건·0 skip 통과. Frontend1,677통과·1실패: 프로필 오류와 보유 dialog 오류가 함께 생겼을 때 전역 `findByRole('alert')`가 여러 요소를 찾음 | [두 번째 전체 증거](../verification/company-data-2026-11-02-release/local-second-attempt/verification-proof.json). 같은 상황을 결정적으로 재현한 뒤 테스트 선택자·명시적503 fixture만 수정했으며 앱의 오류 표시나 보호 조건은 유지 |
| 직전 운영 e391f352 / tree `df510f8fc1f8c9ced59781289da5e55b6b914bbe` | 전체8단계 PASS: backend1,099·0 skip, frontend1,678/117파일. 적용CI9개·17개 job SUCCESS, PR/push 각각92개 브라우저 통과. READY `dpl_CUiCzGy5WpLRos62fMPRwPiyzQEh`,07:00:45.827 UTC 공개release HTTP200·e391/main | ee의 테스트 한 파일만 수정한 자식이며 [나머지1,103개 blob/mode와 런타임 동일성](../verification/company-data-2026-11-02-release/e391f352-source-identity.json)을 확인했다. SNDK 수치40개 운영 성공과 별개로 프로필 저장 실패가 발견돼 d0a6de2b로 수정 |
| d0a6de2b 최초 전체 로컬 실행 | **FAIL, 7/8단계**. Backend1,104통과. Frontend1,679통과·기존 desktop timeout1건 | 실패 이력을 그대로 보존. 단일 전체8단계 성공으로 바꾸지 않음 |
| d0a6de2b 전체 frontend 재검증 | `maxWorkers=2`에서1,680건·117개 파일 통과. 소스·5,000ms timeout·assertion은 변경하지 않음 | 전체 frontend 단계의 별도 대체 실행이다. 최초7/8 실행과 구분 |
| d0a6de2b 정확한 커밋 CI·Edge | 적용workflow9개·job17개 PASS. push92개·PR92개 브라우저를 별도 통과. profiles11 ACTIVE·12개 런타임 파일 일치 | 소스 tree `8dc572e4731c3d3346c4be8609abe77bd47f1007`. SNDK 실화면 인수·main 승격·Vercel READY·공개 release 확인 완료. 최초 로컬 실행 실패와 별도 frontend 통과는 구분해 보존 |

초기 빌드의 앱 밖 import, 재사용된 테스트 DB와 실시간 타이머 경쟁은 단독 빌드 루트·격리된 빈 DB·결정적인 타이머 동기화로 고쳤다. 제품 검증 조건을 삭제하지 않았다. 과거 테스트 숫자는 해당 소스의 결과이며, 최종 판정 표도 최초 실패와 별도 재검증을 구분한다.

## 8. 남아 있는 자료 범위와 상용 운영 판단

공식 자료가 모든 필드나 미래 일정을 발표하지 않을 수 있다. 신규 회사는 동일한 공식 수집 경로를 사용하지만 지원 형식과 출처가 확인된 범위에서만 내용을 제공한다. 데이터가 없다는 사실과 수집 실패·파서 오류·승인 대기를 같은 상태로 표시하지 않는다. 검토 전 분석을 공개 승인하거나 개인 저장을 자동 생성하지 않는다.

07:08:41.856 UTC [Supabase advisor 관측](../verification/company-data-2026-11-02-release/production-advisors.json)에서는 **ERROR 0건**이지만 경고가 남아 있다. 보안 WARN은 anon의 SECURITY DEFINER 실행 권한6건, authenticated 실행 권한32건, 유출 비밀번호 보호1건이며, 성능 WARN은 여러 허용 정책16건이다. INFO에는 RLS 정책 없음32건, 외래 키 인덱스32건, 미사용 인덱스19건이 있다. 이를 보안·성능 문제가 모두 해소됐다는 판정으로 바꾸지 않는다. 함수 권한·정책의 필요한 범위와 비밀번호 보호 설정은 [DB linter 조치 기준](https://supabase.com/docs/guides/database/database-linter), [유출 비밀번호 보호 기준](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)에 따라 별도 운영 점검 대상으로 남긴다.

일부 회사의 최신 재직자·설립 의미·제품 분류가 명시적이지 않으면 확인되지 않았다고 표시한다. DART 복구 문서의 구조 제한, SEC/Drupal 부분 일정 범위, 문맥별 재무 단위·기간과 정보 기준일을 유지한다. 이 보고서는 위 결함의 수정과 검증 범위를 기록하며 모든 기업의 자료 완비, AI 분석 정확도100%, 전체 제품의 버그0개를 보증하지 않는다.
