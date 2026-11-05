import { userLogEvents, userLogScreens } from './contracts';

export const eventLabels: Record<typeof userLogEvents[number], string> = {
  view: '화면 방문', click: '화면 클릭', heartbeat: '활성시간 기록', conversion: '전환 이벤트',
  sign_up: '회원가입', login: '로그인', onboarding_started: '온보딩 시작',
  watchlist_added: '관심 기업 추가', onboarding_completed: '온보딩 완료',
  brief_impression: '요약 노출', brief_opened: '분석 열기', evidence_opened: '근거 열기',
  followup_asked: '후속 질문', alert_created: '알림 생성', feedback_submitted: '피드백 제출',
};
export const screenLabels: Record<typeof userLogScreens[number], string> = {
  today: '홈', explore: '기업 탐색', search: '검색', watchlist: '관심 기업', portfolio: '포트폴리오',
  timeline: '타임라인', questions: '질문', calendar: '캘린더', alerts: '알림', saved: '저장',
  settings: '설정', onboarding: '온보딩', company: '기업 상세', event: '분석 상세',
  document: '문서 상세', help: '도움말',
};
const koreanTimestamp = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

export function formatLogTime(value: string): string {
  return koreanTimestamp.format(new Date(value));
}

export function formatActiveTime(value: number | null): string {
  if (value === null) return '미측정';
  if (value === 0) return '0초';
  const seconds = Math.floor(value / 1_000);
  if (seconds < 1) return '1초 미만';
  if (seconds < 60) return `${seconds}초`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}분 ${seconds % 60}초`;
  return `${Math.floor(seconds / 3_600).toLocaleString('ko-KR')}시간 ${Math.floor(seconds % 3_600 / 60)}분`;
}

