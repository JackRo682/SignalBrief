# 실제 공시 검증 재개 절차

> 2026-10-08 후속 점검에서 기존 로컬 비밀 설정을 찾아 Python 연결을 완료했다. 재설정은 필요 없다. 현재 중단 원인은 실제 재무표 근거 검증 실패이며 [실행 결과](LIVE_CONNECTED_PILOT_20261008.md)를 먼저 확인한다. 아래 설정 절차는 새 환경을 위한 안내다.

기존 PRD·UX·API·DB·AI 평가 문서를 유지한다. 이 절차는 기존 Python 분석기와 기존 Supabase 테이블, 기존 `/ops` 승인 화면, 기존 `/today`를 사용한다. `/us`의 별도 발췌 분석을 Today 분석 완료로 간주하지 않는다.

## 연결할 비밀 설정

저장소 루트의 `.env.production.example`를 `.env`로 복사한다. `.env`는 Git 제외 대상이다. 비밀키를 채팅, 문서, PR, 스크린샷에 붙이지 않는다.

1. [기존 Supabase 프로젝트 Connect](https://supabase.com/dashboard/project/xabzzhtdmqsaqdauthbu?showConnect=true&method=session)에서 Session pooler 연결 문자열을 `SB_DATABASE_URL`로 설정한다. DB 암호는 기존 암호를 사용하고, URL 특수문자는 인코딩한다. TLS를 사용한다. 이 작업 때문에 운영 DB 암호를 임의로 재설정하지 않는다.
2. [프로젝트 API Keys](https://supabase.com/dashboard/project/xabzzhtdmqsaqdauthbu/settings/api-keys)의 서버용 키를 `SB_SUPABASE_SERVICE_KEY`로 설정한다. 브라우저용 publishable 키로 대체하지 않는다.
3. [OpenAI API Keys](https://platform.openai.com/api-keys)에서 접근 가능한 키를 `SB_OPENAI_API_KEY`로 설정한다. 기존 Edge Function에 등록된 키는 Python 환경으로 자동 공유되지 않는다. 키가 조회 불가능하면 별도 서버용 키가 필요하다.
4. `SB_SEC_USER_AGENT`에 실제 연락처를 넣는다. 이번 작업에 사용자가 지정한 이메일은 로컬 환경에만 넣고 공개 저장소에는 기록하지 않는다.
5. 이번 작업의 승인된 총 한도는 100 USD다. `SB_AI_TOTAL_BUDGET_USD=100`으로 설정한다. 모델은 기존에 사용하던 `gpt-4.1-mini-2025-04-14`로 고정하고 입력/출력 단가는 공식 페이지와 대조한다. 현재 예시는 100만 토큰당 0.4/1.6 USD다.
6. Python API도 실행한다면 `SB_ADMIN_USER_IDS`에 승인된 관리자의 Supabase UUID를 설정한다. 호스팅 Edge API는 `app_private.sb_admin_users`를 사용한다. 두 권한 저장소는 자동 동기화되지 않는다.

누적 한도는 같은 DB를 사용하는 Python 구조화 모델 호출의 사전 예약 상한이다. 재시도마다 예약하며 타임아웃은 환불하지 않는다. DB의 `openai-lifetime-reserved-microusd-v1` 카운터를 지우지 않는다. OpenAI 계정 전체의 결제 한도, 별도 Edge 호출, 임베딩 비용을 제한하는 설정은 아니다. 이번 검증에서는 별도 Edge AI 예산과 임베딩은 활성화하지 않는다. 설정 단가가 실제 단가와 다르면 상한 추정도 달라지므로 모델 변경 전에 재확인이 필요하다.

## 1쌍 → 승인 → 비교

Python 3.12 이상과 프로젝트 의존성이 필요하다. 아래 명령은 저장소 루트에서 실행한다.

```sh
python -m signalbrief.cli check-config
python -m signalbrief.live_trial collect --directory var/live-trial/pilot-new --pairs 1
python -m signalbrief.live_trial analyze --directory var/live-trial/pilot-new
```

이번에 이미 수집한 로컬 원문이 있다면 `var/live-trial/pilot-xsl-complete` 디렉터리로 analyze를 재개한다. 수집 명령은 기존 manifest를 덮어쓰지 않는다. 원문은 SHA-256 주소로 저장되며 결과에는 SEC 접수번호·출처 URL·정규화 길이·전체 청크 수가 남는다.

분석은 이전 공시를 먼저 기존 테이블에 적재하고 `needs_review`에서 멈춘다. `/ops`에서 원문, 수치, 기간, 범위, 단위, 검증 결과를 검토한다. 차단된 근거를 승인으로 우회하지 않는다. 이전 공시 승인 후 같은 analyze 명령을 재실행하면 현재 공시를 처리한다. 기존 파이프라인이 승인된 이전 사실만 비교 대상으로 사용하기 때문이다. 승인 대기 중에는 별도의 자동 작업자를 실행하지 않는다.

현재 공시를 승인한 뒤 해당 기업을 관심종목에 둔 일반 사용자로 `/today`와 이벤트 상세에서 이전/현재 근거를 확인한다. 관리자만 볼 수 있는 대기 결과를 일반 사용자에게 보이는 결과로 혼동하지 않는다. 반려 결과의 비노출, 비관리자 승인 요청의 거부, 잘못된 토큰·로그아웃 요청의 거부, 새 로그인 후 데이터 재조회도 검증한다. 인증 토큰을 보고서에 넣지 않는다.

## 10쌍 확대 조건

선정 기업: Apple(AAPL), Microsoft(MSFT), NVIDIA(NVDA). 10쌍은 각각 4/3/3쌍이며 같은 기업의 인접 10-Q를 사용한다. 연간 공시·정정 공시는 섞지 않는다. 회계기간의 실제 비교 가능 여부는 기존 비교 엔진에서 다시 검증한다.

1쌍의 AI·검증·승인·반려·일반 사용자 Today·로그인까지 실제로 통과한 후에만 검토자가 `pair_count: 1`, `status: "PASS"` 및 각 단계 근거를 포함한 pilot-e2e.json을 작성한다. 수집 성공 manifest를 PASS 보고서로 이름만 바꾸지 않는다. 이 파일은 운영자의 검증 기록이지 암호학적 인증서가 아니다.

```sh
python -m signalbrief.live_trial collect --directory var/live-trial/ten \
  --pairs 10 --pilot-report var/live-trial/pilot-e2e.json
python -m signalbrief.live_trial analyze --directory var/live-trial/ten
```

각 쌍의 접수번호, 원본 해시, 이전/현재 이벤트 ID, 모델·프롬프트, 근거/수치 판정, 승인 감사 기록, Today 확인 결과, 비용·토큰, 오류와 수정 사항을 기록한다. 미검증은 별도 목록으로 남긴다. 합성 회귀 테스트 통과를 실제 금융 정확도나 배포 완료로 표현하지 않는다.
