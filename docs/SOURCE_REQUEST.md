네. 지금 단계에서는 \*\*“ChatGPT에 한 번에 앱 전체를 만들어 달라”\*\*고 하는 방식보다, `ChatGPT Project → Work → Codex → Work 검수`로 역할을 나누는 게 훨씬 낫습니다.

OpenAI도 현재 **Work는 조사·분석·문서/사이트 등 결과물 제작**, **Codex는 코드 작성·디버깅·테스트·리포지토리 작업**으로 구분하고 있습니다. Project는 파일·채팅·지침을 장기적으로 묶어두는 컨텍스트 허브 역할을 합니다. [OpenAI 도움말 센터](https://help.openai.com/ko-kr/articles/20001275-chatgpt-work-and-codex?utm_source=chatgpt.com "링크 열기")

그리고 지금 올린 자료를 보면 이미 제품 정의는 상당히 구체적입니다. 핵심은 단순 AI 주식 챗봇이 아니라 \*\*“무엇이 바뀌었는가 → 왜 중요한가 → 근거 → 다음 확인 포인트”\*\*를 포트폴리오별로 제공하는 SignalBrief입니다.    붙여넣은 텍스트(1) 또한 원래 설계에 `Change Detection → Relevance → Evidence → Citation Validation → Safety → Publish` 흐름까지 이미 잡혀 있습니다.    붙여넣은 텍스트(1)

아래 순서대로 그대로 하시면 됩니다.

전체 그림

```
① ChatGPT Project
   ↓
자료/설문/기획을 한곳에 저장

② ChatGPT Work
   ↓
시장조사
설문 분석
PRD 확정
UX 설계
DB/API/AI 구조 설계
Codex 작업명세 작성

③ Codex
   ↓
실제 Git repository 생성
Frontend / Backend / DB
AI pipeline
테스트
배포 설정

④ ChatGPT Work
   ↓
실제 사이트 사용
QA
UX 검수
요구사항 대조
문제점 목록 생성

⑤ Codex
   ↓
버그/UX 수정

⑥ 실제 배포
   ↓
Beta 사용자
PostHog 데이터
Feedback

⑦ Work
   ↓
사용자 행동 분석
다음 iteration 결정
```

즉 **Work = Product Lead + PM + QA**, **Codex = 개발팀**이라고 생각하면 가장 쉽습니다.

1\. 먼저 ChatGPT Project를 하나 만드세요

ChatGPT 왼쪽 사이드바에서:

**New project → `SignalBrief`**

로 만드세요.

현재 Project는 파일·채팅·Project instructions를 한곳에 유지하고, 그 프로젝트 안의 Work에서도 해당 컨텍스트를 활용할 수 있습니다. [OpenAI 도움말 센터](https://help.openai.com/en/articles/10169521-projects-in-chatgpt?utm_source=chatgpt.com "링크 열기")

그리고 지금 저한테 올린 두 파일을 그대로 넣습니다.

Project Sources

```
01_Product_Vision_SignalBrief.txt
02_User_Survey_Result.pdf
```

첫 번째가 지금 올린:

> 붙여넣은 텍스트(1).txt

두 번째가:

> 개인투자자의 투자정보 탐색 경험 및\
> AI 기반 투자정보 서비스 콘셉트 수요 조사_RESULT...

입니다.

나중에는 여기에 계속 추가하세요.

```
03_PRD.md
04_USER_RESEARCH.md
05_MVP_SCOPE.md
06_ARCHITECTURE.md
07_DATA_MODEL.md
08_AI_SPEC.md
09_DESIGN_SYSTEM.md
10_ANALYTICS.md
11_EVAL_SPEC.md
12_BUILD_PLAN.md
13_BETA_RESULTS.md
```

2\. Project Instructions에는 이것을 넣으세요

Project 오른쪽 상단 `••• → Project settings → Project instructions`.

OpenAI 공식 문서상 Project instructions는 해당 프로젝트 안에서 지속적으로 적용되며 전역 지침보다 우선합니다. [OpenAI 도움말 센터](https://help.openai.com/en/articles/10169521-projects-in-chatgpt?utm_source=chatgpt.com "링크 열기")

아래를 **통째로 복사해서 붙여넣으세요.**

```
이 프로젝트의 이름은 SignalBrief이다.

당신은 이 프로젝트에서 Senior Product Manager, AI Product Architect,
Financial Data Product Designer, UX Designer, Technical Program Manager 역할을 수행한다.

최종 목표는 단순한 데모나 포트폴리오용 목업이 아니라,
실제 사용자가 가입하여 사용할 수 있고 실제 서버에 배포 가능한
Evidence-First Portfolio Intelligence 서비스를 만드는 것이다.

==============================
1. PRODUCT MISSION
==============================

SignalBrief의 Mission:

매일 쏟아지는 금융정보 속에서 사용자의 보유종목 및 관심종목에
실제로 중요한 변화를 감지하고,

1. 무엇이 바뀌었는가
2. 왜 중요한가
3. 근거가 무엇인가
4. 이전과 무엇이 다른가
5. 앞으로 무엇을 확인해야 하는가

를 신뢰 가능한 원문 출처와 함께 제공한다.

SignalBrief는 투자 추천 서비스가 아니다.

다음은 금지한다.

- Buy/Sell 추천
- 목표주가 생성
- 자동매매
- 알고리즘 트레이딩
- 확정적인 주가 전망
- 근거 없는 금융 주장

==============================
2. CORE PRODUCT PRINCIPLES
==============================

모든 중요한 분석은 Evidence First 원칙을 따른다.

사실 → 근거 → 비교 → 해석 → 불확실성

순서로 처리한다.

AI가 사실을 임의로 만들어서는 안 된다.

Source 우선순위:

Tier 1:
규제기관 및 공식 공시
OpenDART
SEC EDGAR
거래소 공시

Tier 2:
기업 IR
Earnings Presentation
기업 공식 발표

Tier 3:
신뢰 가능한 언론/데이터

Tier 4:
기타 secondary source

낮은 Tier의 정보가 높은 Tier의 정보를 덮어쓰지 못하게 한다.

출처가 충돌하는 경우 임의의 결론을 만들지 말고
conflicting evidence 상태로 처리한다.

==============================
3. CORE PRODUCT LOOP
==============================

Portfolio / Watchlist
→ 새로운 금융 이벤트 수집
→ Event extraction
→ Previous event retrieval
→ Change detection
→ Portfolio relevance scoring
→ Evidence retrieval
→ Analysis generation
→ Citation validation
→ Safety validation
→ 사용자에게 제공
→ 사용자 feedback
→ ranking 및 product 개선

==============================
4. MVP
==============================

우선 다음 기능만 구현한다.

1. Google Login
2. Watchlist
3. Portfolio
4. Today's Important Changes
5. Event Detail
6. Evidence / Sources
7. Company Change Timeline
8. AI Follow-up Question
9. Event Calendar
10. Alert Center
11. Internal AI Ops Console

MVP의 핵심은 기능 숫자가 아니라 Change Detection과 Evidence이다.

==============================
5. AI WORKFLOW
==============================

AI pipeline은 대략 다음 구조를 따른다.

Raw Source
→ Document Parser
→ Company Resolver
→ Event Extractor
→ Event Classifier
→ Previous Event Retriever
→ Change Detector
→ Relevance Engine
→ Evidence Retrieval
→ Analysis Generator
→ Citation Validator
→ Risk / Policy Validator
→ Publish

가능하면 Python 기반 orchestration을 사용한다.

AI workflow가 단순한
Prompt → LLM → Answer
구조가 되지 않게 한다.

==============================
6. PRODUCT QUALITY
==============================

AI output에는 다음을 기록할 수 있어야 한다.

- source document
- source location
- model
- model version
- prompt version
- timestamp
- confidence
- latency
- token usage
- cost
- validation result

모든 중요한 claim은 source와 연결될 수 있어야 한다.

==============================
7. TECH STACK
==============================

기본 stack:

Frontend:
Next.js
TypeScript
React

Backend:
Python
FastAPI

Database/Auth:
PostgreSQL
Supabase

Vector:
pgvector

AI:
OpenAI API
Python orchestration
필요시 LangGraph 또는 이에 준하는 명시적 workflow

Analytics:
PostHog

Error monitoring:
Sentry

Frontend deploy:
Vercel

Backend / Worker:
Render 또는 동등 서비스

Source:
OpenDART
SEC EDGAR

==============================
8. ENGINEERING PRINCIPLES
==============================

항상 production-quality를 기준으로 한다.

다음을 필수로 고려한다.

- type safety
- schema validation
- authentication
- authorization
- secrets management
- API rate limiting
- retry
- timeout
- idempotency
- structured logging
- observability
- error handling
- migrations
- automated tests
- security
- responsive UI
- accessibility

API key나 secret을 source code에 hard-code하지 않는다.

==============================
9. PRODUCT DECISION RULE
==============================

기능을 추가할 때 항상 다음 질문을 먼저 한다.

"이 기능이 SignalBrief의 핵심 가설을 검증하는 데 필요한가?"

필요하지 않으면 MVP에서 제외한다.

과도한 scope expansion을 하지 않는다.

==============================
10. USER RESEARCH
==============================

프로젝트에 첨부된 사용자 설문조사를 실제 제품 의사결정의 근거로 사용한다.

단, 설문 결과를 절대적 사실로 취급하지 말고
표본 수, 질문 방식, sampling bias 및 통계적 한계를 고려한다.

설문과 Product Vision이 충돌할 경우
임의로 하나를 선택하지 말고 충돌을 명시한다.

==============================
11. WORKING METHOD
==============================

중대한 작업에서는 바로 구현하지 말고 먼저:

1. 현재 상태 분석
2. 요구사항
3. assumptions
4. dependency
5. risk
6. implementation plan
7. acceptance criteria

를 정의한다.

그 다음 구현한다.

이미 구현된 기능을 불필요하게 다시 작성하지 않는다.

항상 기존 파일과 코드 구조를 먼저 조사한다.

==============================
12. DEFINITION OF DONE
==============================

"코드를 작성했다"는 완료가 아니다.

완료의 의미는:

- 실제 실행 가능
- build 성공
- relevant test 성공
- 주요 user flow 정상 작동
- error state 처리
- empty state 처리
- loading state 처리
- mobile에서도 사용 가능
- README 업데이트
- 필요한 환경변수 문서화
- acceptance criteria 충족

이다.
```

이 지침은 꽤 중요합니다. **매번 긴 설명을 반복하는 대신 프로젝트 전체의 헌법**이 됩니다.

3\. 이제 첫 번째 Work를 실행합니다

SignalBrief Project 안에서 **Work**를 선택하세요.

Work는 단순 채팅보다 긴 작업을 수행하고, 자료를 분석하고, 완성된 결과물을 만드는 용도로 설계되어 있습니다. [OpenAI 도움말 센터](https://help.openai.com/ko-kr/articles/20001275-chatgpt-work-and-codex?utm_source=chatgpt.com "링크 열기")

첫 번째 Work에서는 **절대 코딩부터 하지 않습니다.**

Work Prompt #1 — Product Foundation

그대로 붙여넣으세요.

```
SignalBrief 프로젝트의 Lead Product Manager 겸 AI Product Architect로 작업해라.

Project Sources에 있는 모든 문서를 먼저 읽어라.

특히 다음 두 자료를 반드시 함께 사용해라.

1. SignalBrief Product Vision 문서
2. 개인투자자 105명 대상 투자정보 탐색 및 AI 투자정보 서비스 설문 결과

아직 코드를 작성하지 마라.

이번 작업의 목적은 이 프로젝트를 실제 개발 가능한 수준까지
Product Specification으로 확정하는 것이다.

===================================
PHASE 1 — SOURCE AUDIT
===================================

먼저 모든 자료에서 다음을 추출해라.

- Product mission
- Target user
- Jobs To Be Done
- User pain points
- Existing behavior
- Product hypothesis
- Feature hypothesis
- Trust requirements
- AI risks
- MVP scope
- Explicitly excluded scope

각 항목마다 다음을 구분해라.

A. 자료에서 직접 확인되는 내용
B. 설문에서 확인되는 내용
C. 합리적인 inference
D. 아직 검증되지 않은 assumption

임의로 자료에 없는 내용을 사실처럼 만들지 마라.

===================================
PHASE 2 — SURVEY ANALYSIS
===================================

105명 설문을 Product Discovery 관점에서 분석해라.

단순히 문항별 숫자를 다시 나열하지 말고 다음을 찾아라.

1. 가장 강한 pain point
2. 현재 사용자의 실제 정보탐색 workflow
3. 정보 source hierarchy
4. AI에 대한 trust barrier
5. SignalBrief concept validation 정도
6. 가장 강하게 검증된 feature
7. 예상과 달랐던 결과
8. MVP에서 낮춰도 되는 feature
9. 추가 검증이 필요한 부분
10. survey design상의 한계

가능하면 다음 segment도 분석해라.

- 투자경력
- 한국주식 / 미국주식
- 정보탐색 시간이 많은 사용자
- 급등락 경험 사용자

데이터가 segment 분석을 지원하지 않으면
가능한 것처럼 만들어내지 말고 데이터가 부족하다고 명시해라.

===================================
PHASE 3 — PRODUCT DEFINITION
===================================

조사 결과를 이용해 SignalBrief V1을 정의해라.

다음을 명확히 작성해라.

- Persona
- JTBD
- Core user journey
- Primary use case
- Secondary use case
- Product promise
- Core loop
- Activation event
- Retention mechanism
- North Star Metric
- Guardrail metrics

===================================
PHASE 4 — MVP SCOPE
===================================

모든 기능을 아래 네 그룹으로 분류해라.

P0 - 없으면 제품의 핵심 가설을 테스트할 수 없음
P1 - beta에 매우 중요
P2 - product-market signal 이후
Not Now - 명시적으로 제외

각 기능에 대해서:

- user problem
- expected outcome
- acceptance criteria
- dependency
- engineering complexity
- data dependency
- AI dependency

를 작성해라.

===================================
PHASE 5 — UX
===================================

다음 화면을 실제 개발 가능한 수준으로 정의해라.

1. Login
2. Onboarding
3. Watchlist setup
4. Portfolio setup
5. Today's Changes
6. Event Detail
7. Evidence panel
8. Company Timeline
9. AI Follow-up
10. Calendar
11. Alert Center
12. Settings
13. Internal Ops Console

각 화면마다:

- screen goal
- information hierarchy
- components
- user actions
- empty state
- loading state
- error state
- mobile behavior

를 정의해라.

===================================
PHASE 6 — AI SYSTEM
===================================

다음을 설계해라.

Document ingestion
Event extraction
Event normalization
Previous-event matching
Change detection
Materiality scoring
Portfolio relevance scoring
Evidence retrieval
Analysis generation
Citation validation
Uncertainty handling
Policy validation

각 단계별로:

Input
Output schema
Rules
LLM 사용 여부
Deterministic logic 여부
Failure mode
Fallback

를 작성해라.

===================================
PHASE 7 — DATA / SYSTEM
===================================

다음을 설계해라.

- system architecture
- database model
- API boundaries
- background jobs
- ingestion pipeline
- authentication
- authorization
- analytics
- observability
- deployment
- secrets management

가능하면 overengineering을 피하고
1인 개발자가 beta까지 완성 가능한 구조를 우선한다.

===================================
PHASE 8 — AI EVALUATION
===================================

Gold Dataset 100~150개를 전제로 평가체계를 설계해라.

Metric:

- Event Classification F1
- Fact Extraction Accuracy
- Change Detection Accuracy
- Citation Coverage
- Citation Correctness
- Numeric Consistency
- Hallucination Rate
- Abstention Accuracy
- Latency
- Cost per analysis

각 metric의 구체적인 계산법까지 제안해라.

===================================
PHASE 9 — ANALYTICS
===================================

PostHog event taxonomy를 설계해라.

Acquisition
Activation
Engagement
Trust
Retention
AI Quality
Alert Quality
Reliability

각 metric과 event 연결 관계까지 정의해라.

===================================
PHASE 10 — BUILD PLAN
===================================

개발을 실제 Codex에게 넘길 수 있도록
Implementation Plan을 작성해라.

Epic → Feature → Task → Acceptance Criteria 구조로 작성한다.

각 Task는 가능하면 Codex가 한 번의 작업으로 구현하고 검증할 수 있는
크기로 나눈다.

dependency 순서도 고려한다.

===================================
FINAL DELIVERABLES
===================================

최종적으로 다음 파일을 만들어라.

docs/
  PRODUCT_VISION.md
  USER_RESEARCH.md
  PRD.md
  MVP_SCOPE.md
  USER_FLOWS.md
  UX_SPEC.md
  AI_SYSTEM.md
  DATA_MODEL.md
  ARCHITECTURE.md
  API_SPEC.md
  ANALYTICS.md
  AI_EVAL.md
  SECURITY.md
  BUILD_PLAN.md
  ACCEPTANCE_CRITERIA.md

그리고 마지막에는

"Codex가 가장 먼저 수행해야 하는 Task 10개"

를 dependency 순서대로 별도 작성해라.

중요:

아직 application code는 구현하지 마라.

먼저 specification을 완성해라.
```

이 작업은 Work가 꽤 오래 해도 괜찮습니다.

4\. 설문 결과는 그냥 첨부만 하는 게 아니라 제품 요구사항으로 넣으세요

이번 설문은 꽤 쓸 만합니다.

105명 중 **89.5%가 투자 의사결정을 직접 내리고**, 한국주식 투자 경험자는 80.0%, 미국주식은 51.4%였습니다.     (Dataspace)\_개인투자자의 투자정보 탐색 경험 및…

그리고 제품 관점에서 더 중요한 건 다음입니다.

\*\*“정보가 너무 많아서 무엇을 봐야 할지 모르겠다”가 46.7%\*\*로 가장 큰 불편이었습니다.     (Dataspace)\_개인투자자의 투자정보 탐색 경험 및…

그러니까 홈 화면은 검색창보다는:

> **오늘 내 종목에서 정말 중요한 변화**

가 맞습니다.

또 SignalBrief 콘셉트 자체에 대해 **57.1%가 4\~5점으로 도움이 될 것이라고 답했고**, BOTTOM2는 1%뿐이었습니다.     (Dataspace)\_개인투자자의 투자정보 탐색 경험 및…

특히 유용하다고 응답한 기능은:

- 가격변동과 연결된 이슈 타임라인: **44.8%**
- 공시·발표 자동 모니터링: **41.0%**
- 쉬운 설명: **36.2%**
- 변경점 요약: **34.3%**
- 출처/근거: **30.5%**
- 개인화: **28.6%**

였습니다.     (Dataspace)\_개인투자자의 투자정보 탐색 경험 및…

즉 Codex에게도 **Timeline + Monitoring + Change Detection + Explanation + Evidence**를 먼저 만들라고 해야 합니다.

AI 신뢰 문제도 매우 명확합니다. 환각 우려가 **45.7%**, 편향된 해석 우려가 36.2%, 출처 불명확과 선정기준 불투명이 각각 29.5% 수준입니다.     (Dataspace)\_개인투자자의 투자정보 탐색 경험 및…

그래서 Citation Validator와 Ops Console은 장식 기능이 아닙니다.

5\. Work가 완료되면 Codex로 갑니다

여기서 매우 중요합니다.

하지 말아야 할 것

Codex에 처음부터 이렇게 주면 안 됩니다.

> “SignalBrief 웹사이트 전부 만들어줘.”

너무 넓습니다.

대신:

```
Repository
      ↓
AGENTS.md
      ↓
docs/
      ↓
Build Plan
      ↓
작은 Task
      ↓
구현
      ↓
테스트
      ↓
commit
      ↓
다음 Task
```

로 가야 합니다.

Codex는 현재 repository를 읽고, 코드를 작성하고, 명령어와 테스트를 실행하는 개발용 에이전트입니다. Codex Cloud를 쓰면 OpenAI가 관리하는 환경에서 작업을 실행할 수도 있습니다. [OpenAI 도움말 센터](https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan?utm_source=chatgpt.com "링크 열기")

6\. GitHub Repository를 하나 만드세요

이름:

```
signalbrief
```

추천 구조:

```
signalbrief/
│
├─ apps/
│   ├─ web/
│   └─ api/
│
├─ workers/
│
├─ packages/
│   └─ shared/
│
├─ docs/
│
├─ evals/
│
├─ scripts/
│
├─ supabase/
│
├─ .github/
│   └─ workflows/
│
├─ AGENTS.md
├─ README.md
├─ docker-compose.yml
└─ .env.example
```

초기에는 **monorepo**가 관리하기 편합니다.

7\. 그리고 `AGENTS.md`를 꼭 만드세요

이거 꽤 중요합니다.

Codex는 `AGENTS.md`를 자동으로 읽어 작업 지침으로 활용할 수 있습니다. OpenAI도 장시간/복잡한 coding task에는 `AGENTS.md`와 별도의 계획 문서를 두는 패턴을 권장합니다. [OpenAI Developers](https://developers.openai.com/api/docs/guides/latest-model?gallery=open\&galleryItem=trivia-quiz-game\&model=gpt-5.3-codex\&translationFallback=de-DE\&utm_source=chatgpt.com "링크 열기")

Codex에게 처음 이렇게 시킵니다.

Codex 첫 Prompt

```
이 repository는 SignalBrief라는 금융 AI 서비스이다.

먼저 어떤 application code도 구현하지 마라.

repository의 전체 구조와 docs/ 문서를 모두 읽어라.

그 다음 다음 파일을 생성해라.

AGENTS.md
.agent/PLANS.md

AGENTS.md에는 이 repository에서 Codex가 항상 따라야 할
engineering contract를 정의해라.

반드시 포함할 내용:

- product mission
- architecture constraints
- frontend/backend boundaries
- coding conventions
- schema validation policy
- database migration policy
- testing requirements
- security requirements
- AI safety requirements
- financial data evidence rules
- definition of done
- documentation requirements

특히 금융 정보와 AI 관련 코드에는 다음 원칙을 강제해라.

1. source 없는 claim을 publish하지 않는다.
2. numeric value에는 source reference가 있어야 한다.
3. LLM output을 신뢰하지 말고 schema validation을 거친다.
4. financial interpretation과 raw fact를 구분한다.
5. prompt/model version을 기록할 수 있게 한다.
6. confidential key를 repository에 저장하지 않는다.
7. 테스트 없이 주요 AI pipeline을 변경하지 않는다.

PLANS.md에는 복잡한 feature를 구현할 때 사용하는
execution plan format을 정의해라.

각 plan은 최소한:

Context
Goal
Non-goals
Current state
Implementation
Database changes
API changes
Risk
Tests
Verification
Rollback
Acceptance criteria

를 포함한다.

기존 docs와 충돌되는 내용을 임의로 만들지 마라.

완료 후 변경한 파일 목록과 핵심 의사결정을 보고해라.
```

8\. 그 다음 Codex에게 Foundation을 만듭니다

Codex Prompt #2 — Repository Foundation

```
docs/와 AGENTS.md를 모두 읽어라.

이번 task는 SignalBrief의 production-ready repository foundation을 구축하는 것이다.

아직 AI 기능은 구현하지 않는다.

다음 구조를 구현해라.

Frontend:
Next.js + TypeScript

Backend:
FastAPI + Python

Database/Auth:
Supabase/PostgreSQL

Analytics:
PostHog integration 준비

Monitoring:
Sentry integration 준비

Tooling:
lint
format
typecheck
unit test
environment validation

다음을 만들어라.

apps/web
apps/api
packages/shared
workers
docs
evals
scripts
supabase

환경변수는 모두 .env.example에 작성하고
실제 secret은 저장하지 마라.

Frontend와 backend 각각:

- health check
- environment config
- structured error handling
- logging
- basic test

를 구현해라.

CI도 만들어라.

Pull request 기준 CI에서 최소한:

frontend lint
frontend typecheck
frontend test
frontend build

backend lint
backend test

가 실행되도록 한다.

모든 작업이 끝난 뒤 직접 command를 실행해서 검증해라.

실패하는 build나 test를 남긴 상태로 task를 완료했다고 하지 마라.

마지막 보고에는:

1. 생성/수정한 파일
2. 실행한 command
3. test 결과
4. 남은 issue
5. 다음 권장 task

를 작성해라.
```

9\. 그 다음 Database

```
Implement the SignalBrief database foundation.

Read:

docs/PRD.md
docs/DATA_MODEL.md
docs/ARCHITECTURE.md
AGENTS.md

before modifying anything.

Use PostgreSQL / Supabase migrations.

Implement the minimum production schema for:

users
companies
watchlists
watchlist_items
portfolios
positions

documents
document_chunks
events
event_sources

briefs
brief_sources

alerts
notifications

user_events
feedback

ai_runs
eval_results
experiments

Requirements:

- proper PK/FK
- created_at / updated_at where appropriate
- indexes for expected queries
- uniqueness constraints
- cascading rules must be intentional
- user-owned data protected through RLS
- migrations reversible where practical

Do not store arbitrary unvalidated JSON when a proper typed schema is justified.

Create seed data for development.

Add migration tests or verification script.

Generate documentation describing relationships.

Run the migrations in the development environment and verify the schema.

Do not implement unrelated application UI.

At the end report:
schema created,
migration status,
security decisions,
tests,
known limitations.
```

10\. Login / Onboarding

```
Implement SignalBrief authentication and onboarding.

Scope:

- Google authentication through Supabase Auth
- authenticated route protection
- logout
- session handling
- onboarding
- watchlist creation
- add/remove company
- first-use empty states

Do not implement portfolio AI analysis yet.

User flow:

Landing
→ Sign in with Google
→ Onboarding
→ select at least 3 watchlist companies
→ Today page

Requirements:

- mobile responsive
- loading state
- error state
- auth callback handling
- session expiration handling
- accessible form controls
- analytics events

Track:

sign_up
login
onboarding_started
watchlist_added
onboarding_completed

Add automated tests for critical behavior.

Run:
lint
typecheck
test
build

before finishing.
```

11\. DART / SEC 데이터 수집

이게 실제 제품에서 굉장히 중요합니다.

```
Implement the first financial-document ingestion pipeline.

Scope:

1. OpenDART
2. SEC EDGAR

Do not implement general news aggregation.

Create a provider abstraction so additional providers can be added later.

Pipeline:

fetch
→ normalize
→ deduplicate
→ persist document metadata
→ persist source URL
→ enqueue parsing

Requirements:

- retry
- exponential backoff
- request timeout
- rate-limit awareness
- idempotency
- duplicate detection
- structured logs
- ingestion timestamp
- original publication timestamp
- provider metadata
- raw-document reference

Every stored document must preserve provenance.

A document must never lose the original source URL.

Create fixtures so tests do not rely entirely on live APIs.

Implement integration tests where reasonable.

Create CLI commands or scripts to:

ingest one company
ingest one document
run scheduled ingestion

Update architecture documentation.

Run tests and show the result.
```

12\. Event Extractor

이 단계부터 AI가 들어갑니다.

```
Implement SignalBrief Event Extractor V1.

Read the AI system specification and evaluation specification first.

The extractor converts financial source documents into validated structured events.

Output schema should include at minimum:

company_id
event_type
event_date
source_document_id

important_facts
numeric_facts

revenue
operating_income
guidance
capex
dividend
management_change
risk_change

source_evidence
confidence

Every extracted fact must be traceable to evidence.

Use strict structured output validation.

Never persist unvalidated model output directly.

If information is unavailable:
use null or explicit unknown state.

Never infer a numeric fact without evidence.

Store:

model
model_version
prompt_version
latency
token_usage
run_status

in ai_runs.

Create representative fixtures and automated tests.

Include failure cases:

malformed output
unsupported claim
missing evidence
wrong number
timeout
API failure

Do not implement change detection yet.

Finish only when tests pass.
```

13\. Change Detection은 따로 시키세요

```
Implement Change Detection Engine V1.

Goal:

Given a new structured event and relevant historical events,
identify materially changed facts.

Do not ask the model simply:
"what changed?"

Build an explicit comparison pipeline.

Examples:

guidance:
previous → current

CAPEX:
previous → current

revenue expectation:
previous → current

risk wording:
previous → current

management:
previous → current

Required output:

change_type
field
previous_value
current_value
absolute_change
percentage_change where meaningful
evidence_previous
evidence_current
materiality
confidence

Separate:

deterministic numeric comparison

from

LLM-assisted semantic comparison.

Numbers should be compared deterministically whenever possible.

Every detected change must have both old and new evidence.

If a reliable previous comparison point cannot be found,
return insufficient_history rather than manufacturing a comparison.

Create unit tests and Gold Dataset cases.

Run evaluation and report metrics.
```

이게 **SignalBrief 핵심 엔진**입니다.

14\. Relevance Engine

기존 프로젝트 정의에서 중요도는 아예 수식으로 제안돼 있습니다.    붙여넣은 텍스트(1)

Codex에는:

```
Implement Portfolio Relevance / Event Ranking V1.

Do not use a single LLM prompt to determine importance.

Create explicit scoring components:

P = portfolio relevance
M = materiality
N = novelty
S = source quality
A = abnormal market reaction
T = recency

Initial formula:

EventScore =
0.30 P +
0.20 M +
0.15 N +
0.15 S +
0.10 A +
0.10 T

Treat these weights as versioned product configuration,
not hard-coded business logic scattered throughout the code.

Store score breakdown for every ranked event.

UI must later be able to explain:
"Why am I seeing this?"

Implement tests for ranking behavior.

Do not claim that these weights are scientifically optimized.
They are V1 product hypotheses that will later be calibrated
using user feedback and analytics.
```

15\. Citation Validator

이건 반드시 별도 Task로 주세요.

```
Implement Citation Validator V1.

Purpose:

No important generated financial claim should be published
without supporting evidence.

For every generated claim:

1. identify claim
2. identify cited evidence
3. verify evidence exists
4. verify evidence supports the claim
5. verify numeric consistency
6. produce validation status

Statuses:

supported
partially_supported
unsupported
conflicting_sources
numeric_mismatch
missing_source

Publishing policy:

unsupported -> block
missing_source -> block
numeric_mismatch -> block
conflicting_sources -> show uncertainty and route to review
partially_supported -> downgrade confidence or review

Store the validation result.

Add Ops Console visibility.

Create test fixtures containing deliberately incorrect claims.

Report precision / false acceptance cases where possible.
```

16\. 홈 화면은 그 다음입니다

Codex에:

```
Implement SignalBrief Today's Changes page.

This is the main product surface.

Do NOT create a conventional stock dashboard.

The primary hierarchy is:

오늘 내 포트폴리오에서 중요한 변화

Each card must show:

company
change headline
what changed
importance
confidence
portfolio relevance
timestamp
source quality
CTA

Example CTA:

60초 Brief 보기

Below the main feed show upcoming important events.

Do not prioritize:

stock price
PER
technical chart

over product changes.

Support:

loading
empty
error
stale-data state

Responsive design:
desktop
tablet
mobile

Add analytics:

brief_impression
brief_opened

Use real backend data contracts.
Do not hard-code product cards except development fixtures.

Add screenshot-based or component tests where appropriate.
```

17\. Event Detail

```
Implement Event Detail page.

Required information hierarchy:

1. What happened?
2. What changed?
3. Why does it matter?
4. Why is it relevant to this user?
5. Evidence
6. What should be monitored next?

Clearly distinguish:

FACT
CHANGE
INTERPRETATION
UNCERTAINTY

Evidence section must include:

source name
source tier
publication timestamp
source excerpt
source location where available
original-source link

User must be able to inspect the evidence without leaving the main context.

Support Beginner and Advanced information density.

Do not provide buy/sell advice.
```

18\. Beginner / Advanced Mode

이것도 원래 기획에 있습니다.    붙여넣은 텍스트(1)

```
Implement Beginner Mode and Advanced Mode.

Do not create two independent analysis systems.

Both modes consume the exact same structured event and evidence.

Beginner Mode:
plain-language explanation
minimal jargon
short summaries

Advanced Mode:
more numerical detail
historical comparison
guidance detail
source context
technical terminology where appropriate

No factual information may differ between modes.

Only information density and presentation differ.

Persist user preference.
```

19\. Ops Console

이 프로젝트에서 꽤 강한 포트폴리오 포인트입니다.

원래 설계에도 문서 수, 이벤트 수, AI 생성 실패, citation 누락, latency, 비용, model/prompt version 등을 보는 내부 콘솔을 넣도록 되어 있습니다.    붙여넣은 텍스트(1)

Codex에는:

```
Implement SignalBrief Ops Console.

This route must be admin-only.

Dashboard metrics:

documents ingested today
events detected
AI runs
AI failures
low-confidence analyses
unsupported claims
citation failures
numeric mismatches
duplicate events
pipeline latency
LLM latency
estimated AI cost
user reports

Provide queues:

Needs Review
Failed Runs
Citation Issues
Duplicate Candidates
User Reports

Admin actions:

review
reject
rerun
mark duplicate
approve
inspect source
inspect prompt/model/run

Never expose this page to normal users.

Audit admin actions.

Add authorization tests.
```

20\. AI Eval도 Codex에게 실제 구현하게 합니다

```
Implement SignalBrief AI evaluation harness.

Directory:

evals/

Support Gold Dataset JSONL or equivalent.

Each case contains:

source document
event_type
important_facts
changed_facts
correct_sources
materiality
allowed_interpretation
unsupported_interpretation

Implement metrics:

event classification F1
fact extraction accuracy
change detection accuracy
citation coverage
citation correctness
numeric consistency
hallucination rate
abstention accuracy
latency
cost

Provide a single command such as:

make eval

or equivalent.

The command must produce a machine-readable result
and a human-readable report.

Store evaluation history so model/prompt versions can be compared.

Do not optimize prompts solely against the test dataset.

Document methodology and limitations.
```

21\. Codex에는 한 번에 1\~2개 Task만 주세요

이게 아주 중요합니다.

예를 들어:

나쁜 방식

```
로그인하고
DART 만들고
SEC 만들고
AI 만들고
UI 만들고
배포까지 해줘.
```

좋은 방식

```
Implement Google authentication and onboarding.
Run tests.
Do not touch the AI pipeline.
```

완료 후:

```
Review your previous implementation against
docs/ACCEPTANCE_CRITERIA.md.

Fix any violations.

Run all relevant tests again.
Do not implement the next feature.
```

그 뒤:

```
Implement Watchlist.
```

이런 식입니다.

22\. Codex의 `/goal` 기능을 쓸 수 있다면 이런 식도 좋습니다

최근 Codex는 지속적인 목표를 두고 조건이 충족될 때까지 반복 작업하는 **Goals** 패턴을 지원합니다. 일반 prompt는 “이 작업을 해라”, Goal은 “이 상태가 될 때까지 계속 작업하라”에 가깝습니다. [OpenAI Developers](https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex?utm_source=chatgpt.com "링크 열기")

예를 들면:

```
/goal SignalBrief repository가 lint, typecheck, test, build를 모두 통과하고
critical user flow인 Login → Onboarding → Watchlist → Today's Changes가
development environment에서 정상 동작할 때까지 문제를 찾아 수정하고 검증하라.
```

다만 개발 초반부터 거대한 Goal 하나를 걸기보다는 **feature 단위**로 쓰는 게 낫습니다.

23\. 각 Codex 작업 마지막에는 항상 이 문장을 넣으세요

엄청 유용합니다.

```
Before claiming completion:

1. inspect the diff
2. run relevant tests
3. run type checking
4. run lint
5. run build if affected
6. test failure paths
7. compare implementation against acceptance criteria
8. check for security regressions
9. update documentation if behavior changed

Do not report success if any required verification failed.

At the end provide:

- what changed
- why
- files changed
- commands executed
- tests and results
- remaining limitations
- recommended next task
```

단순히 “다 됐습니다”라고 하는 걸 크게 줄여줍니다.

OpenAI의 현재 개발 가이드도 coding task에서 **명확한 역할·workflow·테스트/validation을 요구하는 방식**을 권장합니다. [OpenAI Developers](https://developers.openai.com/api/docs/guides/prompt-engineering?utm_source=chatgpt.com "링크 열기")

24\. 한 기능이 끝날 때마다 바로 Work로 검수시키세요

예를 들어 Codex가 Homepage를 만들었다고 합시다.

다시 ChatGPT Project → **Work**로 가서:

```
SignalBrief의 현재 개발 버전을 Senior Product Manager + QA Lead 관점에서 검수해라.

Project의 다음 문서를 source of truth로 사용해라.

PRD
UX_SPEC
MVP_SCOPE
ACCEPTANCE_CRITERIA

현재 구현을 실제 사용자처럼 사용해라.

다음 critical flow를 직접 확인해라.

Login
→ Onboarding
→ Watchlist 생성
→ Today's Changes
→ Event Detail
→ Evidence 확인
→ AI Follow-up

각 화면에서 다음을 확인한다.

- 요구사항 일치
- navigation
- copy
- information hierarchy
- loading
- empty
- error
- mobile
- accessibility
- trust UX
- evidence UX
- 금융정보 오해 가능성

문제가 있으면 severity를:

P0
P1
P2
P3

로 분류한다.

단순 의견이 아니라 다음 형식으로 작성한다.

Issue
Current behavior
Expected behavior
Reproduction
Severity
Suggested fix
Acceptance criteria

마지막에 Codex에 그대로 전달할 수 있는
FIX_TASKS.md를 만들어라.

코드를 직접 수정하지 말고 우선 검수만 수행해라.
```

그리고 생성된 FIX_TASKS를 Codex에게 줍니다.

```
Read FIX_TASKS.md.

Resolve all P0 and P1 issues.

Do not implement unrelated features.

For each resolved issue:
add or update regression tests where appropriate.

After fixing:
run the entire relevant verification suite.

Update FIX_TASKS.md with completion status.
```

**이 Work ↔ Codex 왕복이 핵심입니다.**

25\. 프로젝트를 만드는 실제 순서를 정리하면

처음에는 아래 15단계만 따라가세요.

| 순서 | 도구           | 작업                             |
| -- | ------------ | ------------------------------ |
| 1  | Project      | SignalBrief 프로젝트 생성            |
| 2  | Project      | 기획 TXT + 설문 PDF 업로드            |
| 3  | Project      | 위 Project Instructions 입력      |
| 4  | Work         | Product Foundation 작성          |
| 5  | Work         | PRD/Architecture/Build Plan 완성 |
| 6  | GitHub       | `signalbrief` repo 생성          |
| 7  | Codex        | AGENTS.md + PLANS.md           |
| 8  | Codex        | Repository Foundation          |
| 9  | Codex        | DB                             |
| 10 | Codex        | Login/Onboarding/Watchlist     |
| 11 | Codex        | DART/SEC ingestion             |
| 12 | Codex        | Event Extractor                |
| 13 | Codex        | Change Detector + Relevance    |
| 14 | Codex        | Main UI + Evidence + Ops       |
| 15 | Work → Codex | QA → 수정 → 배포                   |

이 순서입니다.

26\. 초보자 입장에서 “나는 실제로 뭘 해야 하나?”

의외로 당신이 직접 코딩할 일은 많지 않을 수 있습니다.

당신의 역할은 주로:

```
문서 업로드
↓
Work Prompt 붙여넣기
↓
결과 검토
↓
Codex Prompt 붙여넣기
↓
Codex 변경사항 확인
↓
사이트 실행
↓
문제 있으면 Work에게 QA
↓
FIX_TASKS를 Codex에 전달
```

입니다.

다만 **Codex가 설계 결정을 전부 대신하게 하면 안 됩니다.**

당신이 직접 결정해야 하는 것은:

- 어떤 사용자 문제를 풀 것인가
- 어떤 기능을 MVP에 넣을 것인가
- 무엇이 “중요한 이벤트”인가
- AI가 어디까지 말할 수 있는가
- 어떤 UX가 원하는 UX인가
- 어떤 metric으로 성공을 볼 것인가

입니다.

코드 구현은 상당 부분 맡길 수 있습니다.

27\. 그리고 처음부터 디자인에 시간 너무 쓰지 마세요

순서는:

```
데이터 들어옴
↓
Event 추출 가능
↓
Change 검출 가능
↓
Evidence 연결 가능
↓
사용자별 ranking 가능
↓
UI
↓
예쁜 UI
```

입니다.

반대로:

```
멋진 Landing page
↓
예쁜 카드
↓
애니메이션
↓
근데 실제 데이터 pipeline 없음
```

이렇게 가면 전형적인 포트폴리오용 AI 사이트가 됩니다.

SignalBrief에서 가장 돈 되는(?) 부분은 프론트가 아니라:

> **Change Engine + Evidence Architecture + Evaluation + Ops**

입니다.

28\. 제가 지금이라면 실제로 오늘 이렇게 시작합니다

오늘 1단계

**SignalBrief Project 생성**

두 자료 upload.

Project Instructions 붙여넣기.

오늘 2단계

위의 **Work Prompt #1** 실행.

여기까지는 코딩 X.

오늘 3단계

Work 결과가 나오면:

```
지금 작성한 모든 specification을 다시 감사해라.

서로 모순되는 요구사항,
불필요한 overengineering,
1인 개발자가 8주 안에 구현하기 어려운 요소,
사용자 설문과 맞지 않는 요소를 찾아라.

그 결과를 이용해 V1 specification을 수정하라.

그 다음 Codex에게 전달 가능한
dependency-ordered BUILD_PLAN을 최종 확정해라.

P0만 구현했을 때도 실제 beta 사용자가
end-to-end로 사용할 수 있어야 한다.
```

한 번 더 실행하세요.

오늘 4단계

그 뒤 Codex로 가서:

**AGENTS.md 생성 → Repository Foundation.**

이것까지만 해도 첫날 작업으로 충분합니다.

가장 중요한 한 가지

처음부터 Codex에 \*\*“다 만들어”\*\*라고 하지 마세요.

가장 좋은 패턴은:

> **Work가 무엇을 만들지 정의 → Codex가 하나를 구현 → Codex가 테스트 → Work가 실제 제품 관점에서 검수 → Codex가 수정**

입니다.

이렇게 하면 “AI가 만들어준 웹사이트”가 아니라, 실제로 **당신이 PM/PO처럼 요구사항과 가설을 통제하면서 AI 개발팀을 운영한 프로젝트**가 됩니다.

그리고 이 방식은 지금 목표로 잡은 SignalBrief의 핵심인 **Change Detection, 근거 기반 분석, Eval, Ops Console**을 구현하는 데 특히 잘 맞습니다. 원래 프로젝트 문서에서도 이 네 축을 가장 깊게 구현하는 것이 핵심으로 정리돼 있습니다.    붙여넣은 텍스트(1)

원하시면 다음 단계에서는 제가 **“SignalBrief 프로젝트에 처음 넣을 Project Instructions + Work용 Master Prompt + Codex용 AGENTS.md + PLANS.md + 30개 Codex 작업 프롬프트”를 아예 한 세트로 만들어서**, 당신이 **1번부터 30번까지 순서대로 복붙만 하면 개발이 진행되도록** 구성해드릴 수 있습니다.