'use client';
import {Fragment, useEffect, useState} from 'react';
import {useAuth} from '@/components/auth';
import {sources, trafficSessions, type TrafficSessions} from './contracts';
import {fetchTrafficReport, TrafficReportError} from './report-client';
import {deviceLabels, koreanTime, pageLabels, sourceLabels, stepLabels} from './report';

const LIMIT = 20;
export default function SessionsPanel({from, to, revision, onAccessDenied}: {
  from: string; to: string; revision: number; onAccessDenied: (message: string, status?: number) => void;
}) {
  const {token, me} = useAuth(), [open, setOpen] = useState(false), [source, setSource] = useState(''), [attempt, setAttempt] = useState(0);
  const [cursor, setCursor] = useState({scope: '', offset: 0}), [expanded, setExpanded] = useState<string | null>(null);
  const scope = JSON.stringify([from, to, revision, source, token, me?.id]);
  const offset = cursor.scope === scope ? cursor.offset : 0;
  const key = JSON.stringify([scope, offset, attempt]);
  const [result, setResult] = useState<{key: string; data?: TrafficSessions; error?: string}>({key: ''});
  const data = result.key === key ? result.data : undefined, error = result.key === key ? result.error : undefined;
  useEffect(() => {
    if (!open || !token || !me?.is_admin) return;
    const controller = new AbortController();
    void fetchTrafficReport(token, {action: 'sessions', from, to, offset, limit: LIMIT, ...(source ? {source} : {})}, trafficSessions, controller.signal)
      .then(value => {if (!controller.signal.aborted) setResult({key, data: value});})
      .catch(cause => {if (!controller.signal.aborted) {
        const message = cause instanceof TrafficReportError ? cause.message : '세션 경로를 불러오지 못했습니다. 다시 조회해 주세요.';
        setResult({key, error: message});
        if (cause instanceof TrafficReportError && [401, 403].includes(cause.status)) onAccessDenied(message, cause.status);
      }});
    return () => controller.abort();
  }, [key, open, token, me?.is_admin, from, to, source, offset, onAccessDenied]);
  return <section className="traffic-report-card traffic-session-panel" id="traffic-sessions" aria-labelledby="traffic-sessions-title">
    <div className="traffic-card-heading"><div><h3 id="traffic-sessions-title">세션별 방문 경로</h3><p>한 세션이 어떤 화면에서 시작해서 어디까지 이동했는지 확인합니다.</p></div>
      <button type="button" className="button secondary" aria-expanded={open} aria-controls="traffic-sessions-data" onClick={() => setOpen(v => !v)}>{open ? '세션 경로 접기' : '세션별 경로 보기'}</button></div>
    {open && <div id="traffic-sessions-data">
      <label className="traffic-session-filter">세션의 최초 유입<select value={source} onChange={event => {setSource(event.target.value); setExpanded(null);}}><option value="">전체 유입</option>{sources.map(value => <option key={value} value={value}>{sourceLabels[value]}</option>)}</select></label>
      {!data && !error && <p role="status">세션 경로를 불러오는 중입니다.</p>}
      {error && <div role="alert"><p>{error}</p><button type="button" className="button secondary" onClick={() => setAttempt(v => v + 1)}>세션 다시 조회</button></div>}
      {data && <>
        <p className="overview-note">{data.total.toLocaleString('ko-KR')}개 세션{data.rows.length > 0 && <> · {offset + 1} ~ {offset + data.rows.length}번째</>} · 한국 시간</p>
        {data.rows.length ? <div className="traffic-table-scroll" tabIndex={0} role="region" aria-label="익명 세션 경로 목록"><table><thead><tr>{['시작 시각', '세션', '최초 유입 · 기기', '처음 → 마지막 화면', '관측 행동', '상태', '경로'].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>
          {data.rows.map(row => <Fragment key={row.session_id}>
            <tr><td><time dateTime={row.started_at}>{koreanTime(row.started_at)}</time></td><td><code title={row.session_id}>{row.session_id.slice(0, 8)}</code></td><td>{sourceLabels[row.source]}<small>{deviceLabels[row.device]}</small></td>
              <td>{pageLabels[row.entry_page]} → {pageLabels[row.last_page]}<small>{stepLabels[row.last_step]}</small></td><td>{row.events.toLocaleString('ko-KR')}회</td><td>{row.any_auth_attempt ? '인증 시도 관측' : row.closed ? '시도 없이 관측 종료' : '관측 대기'}<small>{row.closed ? '30분 이상 후속 행동 없음' : '후속 행동 관찰 중'}</small></td>
              <td><button type="button" className="traffic-text-button" aria-expanded={expanded === row.session_id} aria-controls={`journey-${row.session_id}`} aria-label={`${row.session_id.slice(0, 8)} 세션 경로 ${expanded === row.session_id ? '닫기' : '보기'}`} onClick={() => setExpanded(value => value === row.session_id ? null : row.session_id)}>{expanded === row.session_id ? '닫기' : '보기 →'}</button></td></tr>
            {expanded === row.session_id && <tr className="traffic-session-detail" id={`journey-${row.session_id}`}><td colSpan={7}>
              <ol className="traffic-step-list" aria-label="세션의 관측 순서">{row.steps.map(step => <li key={step.seq}><span className="traffic-step-number">{step.seq}</span><div><strong>{pageLabels[step.page]} · {stepLabels[step.step]}</strong><time dateTime={step.at}>{koreanTime(step.at)}</time></div></li>)}</ol>
              {row.steps_truncated && <p>이 세션의 처음 100개 행동을 표시합니다. 전체 관측 행동은 {row.events}회입니다.</p>}
              <p className="overview-note">화면에서 발생한 순서로 정렬합니다. 시각은 서버 수신 시각이므로 전송 지연으로 순서와 다를 수 있습니다. 인증 시도는 로그인·가입 완료를 뜻하지 않습니다.</p>
            </td></tr>}
          </Fragment>)}
        </tbody></table></div> : <p role="status">선택한 기간과 유입 경로에 측정된 세션이 없습니다.</p>}
        <div className="traffic-pagination"><span>{Math.floor(offset / LIMIT) + 1}페이지</span><div><button type="button" className="button secondary" disabled={!offset} onClick={() => {setCursor({scope, offset: Math.max(0, offset - LIMIT)}); setExpanded(null);}}>이전 세션</button><button type="button" className="button secondary" disabled={offset + data.rows.length >= data.total || offset + LIMIT > 10000} onClick={() => {setCursor({scope, offset: offset + LIMIT}); setExpanded(null);}}>다음 세션</button></div></div>
      </>}
    </div>}
    <p className="overview-note">임의 세션 식별자와 정해진 화면·행동만 표시합니다. 같은 사람이 여러 세션으로 집계될 수 있으며, 마지막 관측 단계는 실제 이탈 이유를 설명하지 않습니다.</p>
  </section>;
}
