import type {TrafficSummary} from './contracts';

export const sourceLabels: Record<string, string> = {
  direct: '직접·내부 이동', google: 'Google', naver: '네이버', kakao: '카카오',
  disquiet: '디스콰이엇', geeknews: 'GeekNews', youtube: 'YouTube', x: 'X / Twitter', other: '기타',
};
export const pageLabels: Record<string, string> = {
  home: '공개 홈', features: '기능 소개', pricing: '요금', login: '로그인', signup: '가입',
  about: '소개', sources: '출처', customers: '이용 대상', privacy: '개인정보', terms: '약관',
  disclaimer: '고지', onboarding: '초기 설정', app_home: '앱 홈', today: '오늘',
  search: '검색', calendar: '캘린더', event_detail: '이벤트 상세',
};
export const stepLabels: Record<string, string> = {
  view: '화면 도착', features_cta: '기능 보기 선택', pricing_cta: '요금 보기 선택',
  signup_cta: '가입 선택', login_cta: '로그인 선택', signup_submit: '이메일 가입 시도',
  login_submit: '이메일 로그인 시도', google_start: 'Google 인증 시도',
  search_used: '검색 실행', filter_used: '필터 변경', event_detail_click: '상세 클릭', event_detail_view: '상세 열람',
};
export const deviceLabels: Record<string, string> = {mobile: '모바일', tablet: '태블릿', desktop: '데스크톱', unknown: '미측정'};
export type ReportRange = {from: string; to: string};
const DAY = 86_400_000;
const dayStamp = (day: string) => Date.parse(day + 'T00:00:00Z');
export function previousRange({from, to}: ReportRange): ReportRange {
  const days = Math.round((dayStamp(to) - dayStamp(from)) / DAY) + 1;
  return {from: new Date(dayStamp(from) - days * DAY).toISOString().slice(0, 10), to: new Date(dayStamp(from) - DAY).toISOString().slice(0, 10)};
}
export function percentage(numerator: number, denominator: number) {
  return denominator > 0 ? (100 * numerator / denominator).toFixed(1) + '%' : '—';
}
export function koreanTime(value: string) {
  return new Intl.DateTimeFormat('ko-KR', {timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'short'}).format(new Date(value));
}
export function sumJourneys(data: TrafficSummary) {
  if (!data.journeys) return null;
  return data.journeys.reduce((a, r) => ({
    sessions: a.sessions + r.sessions, auth_cta: a.auth_cta + r.auth_cta,
    auth_arrived: a.auth_arrived + r.auth_arrived, auth_attempt: a.auth_attempt + r.auth_attempt,
    closed: a.closed + r.closed, closed_without_attempt: a.closed_without_attempt + r.closed_without_attempt,
    direct_auth_entries: a.direct_auth_entries + r.direct_auth_entries,
  }), {sessions: 0, auth_cta: 0, auth_arrived: 0, auth_attempt: 0, closed: 0, closed_without_attempt: 0, direct_auth_entries: 0});
}

/** A first observation is only a conservative coverage boundary, never proof of complete capture. */
export function comparisonNote(data: TrafficSummary, range: ReportRange, kind: 'acquisition' | 'journey') {
  const prior = previousRange(range), start = Date.parse(prior.from + 'T00:00:00+09:00');
  if (Date.parse(range.to + 'T23:59:59.999+09:00') >= Date.parse(data.generated_at)) return '오늘 포함 · 기간 미완료';
  const first = kind === 'journey' ? data.measurement?.first_journey_at : data.measurement?.first_acquisition_at;
  if (!first || !data.measurement || start < Date.parse(data.measurement.retained_from) || Date.parse(first) > start) return '비교 기간 자료 부족';
  return null;
}
export function changeLabel(current: number, previous: number, unavailable: string | null) {
  if (unavailable) return unavailable;
  if (!previous) return '이전 값 0 · 증감률 미계산';
  const change = (current - previous) * 100 / previous;
  return `${change > 0 ? '+' : ''}${change.toFixed(1)}%`;
}

type CsvCell = string | number | null | undefined;
export function csvCell(value: CsvCell) {
  let text = value == null ? '' : String(value);
  // Spreadsheet formula injection also applies to strings such as untrusted release labels.
  if (/^[\s]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
export function trafficCsv(data: TrafficSummary, range: ReportRange, prior?: TrafficSummary) {
  const rows: CsvCell[][] = [['section', 'period', 'from_kst', 'to_kst', 'day_kst', 'source', 'surface', 'audience', 'device', 'release', 'metric', 'value', 'unit', 'note']];
  function append(report: TrafficSummary, dates: ReportRange, period: string) {
    const base = (section: string, day = '', source = '', surface = '', audience = '', device = '', release = '') => [section, period, dates.from, dates.to, day, source, surface, audience, device, release];
    rows.push([...base('metadata'), 'generated_at', report.generated_at, 'timestamp', 'Consented observations only; browser IDs are not people.']);
    if (report.measurement) for (const [key, value] of Object.entries(report.measurement)) rows.push([...base('measurement'), key, value, 'timestamp', 'First retained observation; not proof of complete coverage.']);
    for (const [key, value] of Object.entries(report.totals)) rows.push([...base('acquisition'), key, value, key === 'pageviews' ? 'events' : 'browsers', 'Distinct within this period; not a same-session conversion.']);
    for (const r of report.daily) for (const [key, value] of Object.entries(r)) if (key !== 'day') rows.push([...base('acquisition_daily', r.day), key, value, key === 'pageviews' ? 'events' : 'browsers', 'KST event date.']);
    for (const r of report.sources) for (const [key, value] of Object.entries(r)) if (key !== 'source') rows.push([...base('acquisition_source', '', r.source), key, value, key === 'pageviews' ? 'events' : 'browsers', 'First-touch source.']);
    for (const r of report.journeys ?? []) for (const [key, value] of Object.entries(r)) if (key !== 'source') rows.push([...base('journey', '', r.source), key, value, 'sessions', 'Entry cohort; ordered auth stages; follows subsequent observations.']);
    for (const r of report.journey_daily ?? []) for (const [key, value] of Object.entries(r)) if (key !== 'source' && key !== 'day') rows.push([...base('journey_daily', r.day, r.source), key, value, 'sessions', 'KST session entry date.']);
    for (const r of report.journey_devices ?? []) rows.push([...base('device', '', '', '', '', r.device), 'sessions', r.sessions, 'sessions', 'Viewport category at session entry; unknown is not inferred.']);
    for (const r of report.journey_exits ?? []) rows.push([...base('journey_exit', '', r.source, r.page), r.step, r.sessions, 'sessions', 'No auth attempt and at least 30 minutes without an observed event; not a confirmed browser close.']);
    for (const r of report.journey_actions ?? []) for (const key of ['events', 'sessions'] as const) rows.push([...base('journey_action', '', r.source, r.page), r.step, r[key], key, 'Repeated actions and distinct sessions are different measures.']);
    for (const r of report.surface_times ?? []) for (const key of ['views', 'browsers', 'mean_ms', 'median_ms'] as const) rows.push([...base('surface', '', r.source, r.surface, r.audience ?? 'unknown', '', r.release), key, r[key], key.endsWith('_ms') ? 'milliseconds' : key, 'Per exposure; zero-time views included. Compare matching source/surface/audience.']);
    for (const r of report.feature_actions ?? []) for (const key of ['events', 'browsers'] as const) rows.push([...base('feature', '', '', r.page), r.kind, r[key], key, 'Consented signed-in product actions.']);
    for (const [key, value] of Object.entries(report.product ?? {})) rows.push([...base('product_funnel'), key, value, key.endsWith('_events') ? 'events' : 'browsers', 'Ordered within the selected period, not necessarily one session.']);
  }
  append(data, range, 'current');
  if (prior) {
    append(prior, previousRange(range), 'previous');
    for (const kind of ['acquisition', 'journey'] as const) rows.push(['comparison', 'current_vs_previous', range.from, range.to, '', '', '', '', '', '', kind + '_coverage', comparisonNote(data, range, kind) ?? 'retained_observation_boundary_covered', '', 'No causal or statistical significance claim.']);
  }
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
}

export function downloadCsv(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], {type: 'text/csv;charset=utf-8'}));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; document.body.appendChild(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
