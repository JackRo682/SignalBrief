/** Fictional presentation fixtures only. These are not canonical API DTOs or gold data. */
export const companies = [
  {
    id: "moabit",
    name: "모아빛 테크",
    mark: "모",
    sector: "기술 · 가상 기업",
    color: "mint",
  },
  {
    id: "pureun",
    name: "푸른결 에너지",
    mark: "푸",
    sector: "에너지 · 가상 기업",
    color: "blue",
  },
  {
    id: "onyu",
    name: "온유 물류",
    mark: "온",
    sector: "물류 · 가상 기업",
    color: "amber",
  },
  {
    id: "dali",
    name: "달이 연구소",
    mark: "달",
    sector: "연구 · 가상 기업",
    color: "purple",
  },
];

export const events = [
  {
    id: "moabit-review",
    company: "moabit",
    tag: "실적",
    title: "매출 예시가 늘었지만, 비용도 함께 늘었습니다",
    summary:
      "분기 매출 예시 120 → 135. 변화의 크기보다 이익과 비용의 흐름을 함께 살펴볼 장면입니다.",
    why: "관심 기업 · 실적 비교",
    status: "비교 예시",
    time: "09:00",
    before: "120",
    after: "135",
    metric: "분기 매출",
    delta: "+15",
    unit: "가상 단위",
    next: "일회성 비용인지, 다음 분기에도 이어지는지 확인하기",
    explanation:
      "매출 변화만으로 수익성 개선을 판단할 수 없습니다. 비용 항목을 같은 기준으로 확인해야 합니다.",
  },
  {
    id: "pureun-plan",
    company: "pureun",
    tag: "자본 배분",
    title: "투자 계획의 규모보다, 일정의 변화에 주목합니다",
    summary:
      "가상 프로젝트의 계획 일정이 한 분기 뒤로 조정된 예시입니다. 실제 공시나 예측이 아닙니다.",
    why: "관심 기업 · 계획 변경",
    status: "비교 제한",
    time: "08:30",
    before: "2분기",
    after: "3분기",
    metric: "계획 일정",
    delta: "1분기 이동",
    unit: "예시 일정",
    next: "계획의 확정 여부와 변경 사유를 다시 확인하기",
    explanation:
      "일정 변경은 완료나 성과를 보장하지 않습니다. 계획과 확정된 사실을 구분합니다.",
  },
  {
    id: "onyu-notice",
    company: "onyu",
    tag: "중요 위험",
    title: "새로운 공지 예시, 이전 기준은 아직 없습니다",
    summary:
      "가상 회사의 운영 관련 공지를 처음 읽는 장면입니다. 비교 자료가 없어 증감률을 제시하지 않습니다.",
    why: "관심 기업 · 새 공지",
    status: "이전 정보 없음",
    time: "08:00",
    before: "정보 없음",
    after: "예시 공지",
    metric: "운영 공지",
    delta: "비교 불가",
    unit: "정성 정보",
    next: "추가 설명과 후속 공지의 공개 여부 확인하기",
    explanation:
      "처음 확인했다는 사실이 새로운 회사 사건을 뜻하지는 않습니다. 자료가 공개된 때를 따로 봅니다.",
  },
];

export type Screen =
  | "today"
  | "login"
  | "onboarding"
  | "watchlist"
  | "portfolio"
  | "event"
  | "evidence"
  | "timeline"
  | "question"
  | "calendar"
  | "alerts"
  | "settings"
  | "ops";
export const screens: {
  screen: Screen;
  path: string;
  label: string;
  group: string;
}[] = [
  { screen: "today", path: "/today", label: "오늘의 변화", group: "살펴보기" },
  {
    screen: "watchlist",
    path: "/watchlist",
    label: "관심 기업",
    group: "살펴보기",
  },
  {
    screen: "portfolio",
    path: "/portfolio",
    label: "예시 포트폴리오",
    group: "살펴보기",
  },
  {
    screen: "calendar",
    path: "/calendar",
    label: "확인 캘린더",
    group: "살펴보기",
  },
  { screen: "alerts", path: "/alerts", label: "알림 센터", group: "살펴보기" },
  {
    screen: "event",
    path: "/events/moabit-review",
    label: "변화 상세",
    group: "화면 둘러보기",
  },
  {
    screen: "evidence",
    path: "/events/moabit-review/evidence",
    label: "근거 패널",
    group: "화면 둘러보기",
  },
  {
    screen: "timeline",
    path: "/companies/moabit/timeline",
    label: "기업 타임라인",
    group: "화면 둘러보기",
  },
  {
    screen: "question",
    path: "/events/moabit-review/question",
    label: "질문 예시",
    group: "화면 둘러보기",
  },
  {
    screen: "login",
    path: "/login",
    label: "로그인 화면",
    group: "시작 · 설정",
  },
  {
    screen: "onboarding",
    path: "/onboarding",
    label: "시작 안내",
    group: "시작 · 설정",
  },
  {
    screen: "settings",
    path: "/settings",
    label: "설정",
    group: "시작 · 설정",
  },
  { screen: "ops", path: "/ops", label: "운영 데모", group: "시작 · 설정" },
];

export const headings: Record<
  Screen,
  { eyebrow: string; title: string; subtitle: string }
> = {
  today: {
    eyebrow: "YOUR DAILY BRIEF",
    title: "오늘, 무엇이 달라졌나요?",
    subtitle:
      "관심 기업의 변화부터, 판단의 근거까지. 필요한 맥락을 차분히 살펴보세요.",
  },
  login: {
    eyebrow: "WELCOME TO SIGNALBRIEF",
    title: "변화를 읽는 더 나은 시작",
    subtitle: "공식 정보의 변화와 근거를 연결하는 경험을 미리 둘러보세요.",
  },
  onboarding: {
    eyebrow: "GET STARTED · 1 / 2",
    title: "먼저, 읽는 기준을 맞춥니다",
    subtitle:
      "정보의 범위와 한계를 알고 시작하는 것이 좋은 판단의 첫 단계입니다.",
  },
  watchlist: {
    eyebrow: "YOUR WATCHLIST",
    title: "관심 기업에 집중하세요",
    subtitle:
      "기업 이름뿐 아니라, 어떤 정보까지 볼 수 있는지도 함께 확인합니다.",
  },
  portfolio: {
    eyebrow: "OPTIONAL · PREVIEW",
    title: "예시 보유 기업을 살펴보세요",
    subtitle:
      "포트폴리오 없이도 관심 기업을 읽을 수 있습니다. 실제 보유 정보는 입력하지 마세요.",
  },
  event: {
    eyebrow: "THE CHANGE · FICTIONAL CASE",
    title: "숫자 다음의 맥락을 읽습니다",
    subtitle: "바뀐 사실, 가능한 해석, 아직 모르는 점을 나누어 봅니다.",
  },
  evidence: {
    eyebrow: "FOLLOW THE EVIDENCE",
    title: "이 문장의 근거는 무엇인가요?",
    subtitle: "결론보다 먼저, 원래 표현과 비교 기준을 직접 확인합니다.",
  },
  timeline: {
    eyebrow: "COMPANY HISTORY",
    title: "변화에는 이전의 맥락이 있습니다",
    subtitle: "가상 기업의 자료와 정정 흐름을 시간 순으로 살펴봅니다.",
  },
  question: {
    eyebrow: "ASK ABOUT THIS EVENT · P1 PREVIEW",
    title: "한 가지 더 확인하고 싶다면",
    subtitle:
      "이 사건의 근거 안에서 질문하는 화면입니다. 실제 AI는 연결되어 있지 않습니다.",
  },
  calendar: {
    eyebrow: "WHAT TO CHECK NEXT · P1 PREVIEW",
    title: "다음에 확인할 장면들",
    subtitle: "확인된 날짜와 예상 날짜를 구분합니다. 모두 가상 일정입니다.",
  },
  alerts: {
    eyebrow: "STAY INFORMED · P1 PREVIEW",
    title: "중요한 변화만, 조용히",
    subtitle: "선택 알림과 정확성 안내는 서로 다른 목적을 갖습니다.",
  },
  settings: {
    eyebrow: "YOUR PREFERENCES",
    title: "나에게 맞는 읽기 환경",
    subtitle:
      "이 탭의 예시 설정만 바뀝니다. 실제 계정·개인정보·서버 저장은 없습니다.",
  },
  ops: {
    eyebrow: "INTERNAL OPS · DEMO ONLY",
    title: "발행 전에, 근거부터 확인합니다",
    subtitle:
      "가상 운영 화면입니다. 관리자 인증이나 실제 승인·발행 권한이 없습니다.",
  },
};
