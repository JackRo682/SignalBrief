# 최종 기술 검증 (2026-10-09)

기준 main: `f680feab8bee13996e71210c566e2cc4da3d2339`. 검토 시작 PR #13: `712810a49df27b4b72cd0762a2549caabee06377`.
기존 Apple 1쌍, 실제 AI 2회/16개 수치, 승인과 Today 표시 결과는 재개발하지 않는다.

## 수정 및 검증 계획

- 확인한 오류: Python 및 운영 Edge API의 `fact_summary`가 사실 ID 순서의 첫 인용을 골라 매출 제목 아래 영업이익 또는 다른 기간을 표시한다.
- 수정: 저장된 제목의 지표·방향·증감률과 연결된 current_fact_id를 매칭하고 최신 종료 기간으로 제한한다. 비교 이력이 없으면 같은 지표의 최신 분기를 선택한다. 모호하거나 일치하지 않는 근거는 null로 반환한다.
- 원문/분석/승인 기록, DB 스키마, 응답 계약과 기존 UI는 유지한다. Python과 TypeScript 회귀를 추가하고 Edge API 타입 검사를 CI에 추가한다.
- 승인 전 main 병합·운영 배포·유료 AI 호출·운영 DB 삭제는 금지한다. PR 브랜치에 수정과 검사 근거만 기록한다.
- 검증: 전체 verify.py --full, Python/웹 회귀, CI 브라우저, 폐기용 PostgreSQL RLS, 운영의 승인된 일반 테스트 계정 2개.
- 롤백: 이번 근거 선택 코드 커밋만 revert. 기존 DB 마이그레이션·공시 재처리 불필요.

## 현재 확인된 보안 경고

`npm audit --omit=dev`: 취약점 0개. 전체 감사: high 5개, 모두 개발 의존성 `braces` → `micromatch` → `fast-glob` → Next ESLint 계열.
[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)는 3.0.3 이하가 영향받고 수정 버전이 없다고 명시한다(2026-10-09 확인).
Next 14로 자동 강등하지 않는다. 신뢰할 수 없는 glob 패턴 실행을 피하고 상위 패키지 패치를 기다리는 미해결 위험이다. 전체 감사는 FAIL이며 운영 의존성 감사 PASS와 구분한다.

최종 검사 결과·운영 계정 검증·원문 대조 및 10쌍 비용 산출은 완료 후 이 문서에 추가한다.
