'use client';
import {useEffect, useState} from 'react';
import {useAuth} from '@/components/auth';
import {trafficSummary, type TrafficSummary} from './contracts';
import {fetchTrafficReport, TrafficReportError} from './report-client';
import {changeLabel, comparisonNote, previousRange, sourceLabels, sumJourneys, type ReportRange} from './report';

export default function ComparisonPanel({data, range, revision, onLoaded, onAccessDenied}: {
  data: TrafficSummary; range: ReportRange; revision: number;
  onLoaded: (previous: TrafficSummary | undefined) => void;
  onAccessDenied: (message: string, status?: number) => void;
}) {
  const {token, me} = useAuth(), [open, setOpen] = useState(false), [attempt, setAttempt] = useState(0);
  const priorRange = previousRange(range);
  const key = JSON.stringify([priorRange.from, priorRange.to, revision, attempt, token, me?.id]);
  const [result, setResult] = useState<{key: string; data?: TrafficSummary; error?: string}>({key: ''});
  const prior = result.key === key ? result.data : undefined, error = result.key === key ? result.error : undefined;
  useEffect(() => {
    onLoaded(undefined);
    if (!open || !token || !me?.is_admin) return;
    const controller = new AbortController();
    void fetchTrafficReport(token, {action: 'summary', ...priorRange}, trafficSummary, controller.signal)
      .then(value => {if (!controller.signal.aborted) {setResult({key, data: value}); onLoaded(value);}})
      .catch(cause => {if (!controller.signal.aborted) {
        const message = cause instanceof TrafficReportError ? cause.message : '이전 기간을 불러오지 못했습니다. 다시 조회해 주세요.';
        setResult({key, error: message});
        if (cause instanceof TrafficReportError && [401, 403].includes(cause.status)) onAccessDenied(message, cause.status);
      }});
    return () => controller.abort();
    // The key contains the exact dates and identity. Use primitive dependencies to avoid duplicate reads.
  }, [key, open, token, me?.is_admin, priorRange.from, priorRange.to, onLoaded, onAccessDenied]);
  const currentJourney = sumJourneys(data), previousJourney = prior ? sumJourneys(prior) : null;
  const acquisitionNote = comparisonNote(data, range, 'acquisition'), journeyNote = comparisonNote(data, range, 'journey');
  const rows = prior ? [
    {label: '방문 브라우저', current: data.totals.visitors, previous: prior.totals.visitors, note: acquisitionNote},
    {label: '공개 페이지 조회', current: data.totals.pageviews, previous: prior.totals.pageviews, note: acquisitionNote},
    ...(currentJourney && previousJourney ? [
      {label: '로그인 전 세션', current: currentJourney.sessions, previous: previousJourney.sessions, note: journeyNote},
      {label: '순차 인증 시도 세션', current: currentJourney.auth_attempt, previous: previousJourney.auth_attempt, note: journeyNote},
    ] : []),
    {label: '인증된 신규 가입 브라우저', current: data.totals.signups, previous: prior.totals.signups, note: acquisitionNote},
  ] : [];
  const sources = prior ? [...new Set([...data.sources.map(r => r.source), ...prior.sources.map(r => r.source)])] : [];
  return <section className="traffic-report-card traffic-comparison" aria-labelledby="traffic-comparison-title">
    <div className="traffic-card-heading"><div><h3 id="traffic-comparison-title">이전 기간과 비교</h3><p>현재 {range.from} ~ {range.to} · 이전 {priorRange.from} ~ {priorRange.to}</p></div>
      <button className="button secondary" type="button" aria-expanded={open} aria-controls="traffic-comparison-data" onClick={() => setOpen(v => !v)}>{open ? '비교 접기' : '이전 기간 비교'}</button></div>
    <p className="overview-note">같은 길이의 한국 날짜 범위입니다. 오늘이 포함되거나 이전 수집 자료가 부족하면 증감률을 계산하지 않습니다. 유입 경로와 표본 수를 함께 보세요.</p>
    {open && <div id="traffic-comparison-data">
      {!prior && !error && <p role="status">이전 기간 통계를 불러오는 중입니다.</p>}
      {error && <div role="alert"><p>{error}</p><button className="button secondary" onClick={() => setAttempt(v => v + 1)}>비교 다시 조회</button></div>}
      {prior && <><div className="traffic-table-scroll"><table><caption className="sr-only">동일한 길이의 이전 기간과 현재 기간</caption><thead><tr><th>지표</th><th>현재</th><th>이전</th><th>변화</th></tr></thead><tbody>
        {rows.map(r => <tr key={r.label}><th scope="row">{r.label}</th><td>{r.current.toLocaleString('ko-KR')}</td><td>{r.previous.toLocaleString('ko-KR')}</td><td>{changeLabel(r.current, r.previous, r.note)}</td></tr>)}
      </tbody></table></div>
      {sources.length > 0 && <div className="traffic-table-scroll"><table><caption>같은 유입 경로의 방문 브라우저</caption><thead><tr><th>최초 유입</th><th>현재</th><th>이전</th><th>변화</th></tr></thead><tbody>{sources.map(source => {
        const current = data.sources.find(r => r.source === source)?.visitors ?? 0, previous = prior.sources.find(r => r.source === source)?.visitors ?? 0;
        return <tr key={source}><th scope="row">{sourceLabels[source]}</th><td>{current}</td><td>{previous}</td><td>{changeLabel(current, previous, acquisitionNote)}</td></tr>;
      })}</tbody></table></div>}
      <p className="overview-note">차이는 개선의 인과 효과나 A/B 테스트의 통계적 유의성을 증명하지 않습니다. 이전 기간을 조회하면 CSV에도 두 기간이 함께 포함됩니다.</p></>}
    </div>}
  </section>;
}
