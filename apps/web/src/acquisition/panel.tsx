'use client';
import {useCallback, useEffect, useState} from 'react';
import Link from 'next/link';
import {useAuth} from '@/components/auth';
import {trafficSummary, type TrafficSummary} from './contracts';
import {fetchTrafficReport, TrafficReportError} from './report-client';
import {deviceLabels, downloadCsv, koreanTime, percentage, sourceLabels, sumJourneys, trafficCsv} from './report';
import ComparisonPanel from './comparison-panel';
import SessionsPanel from './sessions-panel';
import JourneyPanel from './journey-panel';
import SurfacePanel from './surface-panel';
import ProductFunnelPanel from './product-panel';
import './traffic.css';

const count = (value: number | undefined) => value === undefined ? '미측정' : value.toLocaleString('ko-KR');

function JourneyOverview({data}: {data: TrafficSummary}) {
  const total = sumJourneys(data);
  if (!total) return <section className="traffic-report-card"><h3>로그인 전 이용 흐름</h3><p>이 기간의 세션 측정 자료가 없습니다. 과거 방문에서 세션을 추정하지 않습니다.</p></section>;
  const stages = [
    {name: '방문 시작', value: total.sessions, note: '첫 화면 도착이 관측된 세션'},
    {name: '가입·로그인 선택', value: total.auth_cta, note: '같은 세션에서 인증 버튼 선택'},
    {name: '선택한 인증 화면 도착', value: total.auth_arrived, note: '선택한 가입 또는 로그인 화면에 도착'},
    {name: '인증 시도', value: total.auth_attempt, note: '도착한 화면에서 이메일·Google 인증 시도'},
  ];
  return <section className="traffic-report-card" aria-labelledby="traffic-flow-title"><h3 id="traffic-flow-title">로그인 전 이용 흐름</h3><p>같은 세션에서 아래 순서대로 진행했을 때만 다음 단계에 포함합니다.</p>
    <ol className="traffic-flow">{stages.map((stage, i) => <li key={stage.name}><div className="traffic-flow-line"><div><span className="traffic-flow-index">0{i + 1}</span><strong>{stage.name}</strong></div><span className="traffic-flow-count">{count(stage.value)}<small>세션</small></span></div><p>{stage.note}</p>
      <div className="traffic-progress" aria-hidden="true"><span style={{width: `${total.sessions ? stage.value / total.sessions * 100 : 0}%`}}/></div>
      <small>{i ? `이전 단계 대비 ${percentage(stage.value, stages[i - 1].value)} · 방문 대비 ${percentage(stage.value, total.sessions)}` : '중복 행동은 세션별로 한 번만 집계'}</small></li>)}</ol>
    <p className="overview-note">가입·로그인 화면 직접 진입 {total.direct_auth_entries}세션은 별도로 기록합니다. 인증 시도와 인증된 신규 가입은 서로 다른 지표입니다.</p>
  </section>;
}

function SignupOverview({data}: {data: TrafficSummary}) {
  const metrics = [
    ['가입·Google 시작', data.totals.starts, '가입을 시작한 브라우저'],
    ['이메일 가입 요청', data.totals.requests, '인증 전 요청이 기록된 브라우저'],
    ['인증된 신규 가입', data.totals.signups, '서버에서 신규 계정임을 확인'],
    ['초기 설정 완료', data.totals.onboarded, '서버에서 초기 설정 완료를 확인'],
  ] as const;
  return <section className="traffic-report-card" aria-labelledby="traffic-signup-title"><h3 id="traffic-signup-title">가입 시도와 완료 확인</h3><p>버튼 선택과 실제 가입 완료를 구분합니다.</p>
    <dl className="traffic-outcomes">{metrics.map(([label, value, note]) => <div key={label}><dt>{label}<small>{note}</small></dt><dd>{count(value)}<small>브라우저</small></dd></div>)}</dl>
    <div className="traffic-conversion"><span>방문 → 신규 가입 전환율</span><strong>{percentage(data.totals.signups, data.totals.visitors)}</strong></div>
    <p className="overview-note">기간 내 신규 가입 브라우저 ÷ 방문 브라우저입니다. 첫 가입 시작 후 7일 이내 생성된 계정만 연결하며 기존 계정 로그인과 인증된 관리자는 가입 완료에서 제외합니다. 같은 세션의 순차 전환율과 다릅니다.</p>
  </section>;
}

function DailyChart({data}: {data: TrafficSummary}) {
  const bySession = data.journey_daily !== undefined;
  const days = new Map<string, number>();
  if (bySession) for (const row of data.journey_daily ?? []) days.set(row.day, (days.get(row.day) ?? 0) + row.sessions);
  else for (const row of data.daily) days.set(row.day, row.visitors);
  const rows = [...days].sort(([a], [b]) => a.localeCompare(b)), max = Math.max(1, ...rows.map(([, value]) => value)), unit = bySession ? '세션' : '브라우저';
  return <section className="traffic-report-card traffic-daily" aria-labelledby="traffic-daily-title"><div className="traffic-card-heading"><div><h3 id="traffic-daily-title">일별 이용</h3><p>{bySession ? '세션의 첫 방문일' : '방문·가입 기록일'} · 한국 시간</p></div><span className="traffic-legend"><i/>방문 {unit}</span></div>
    {rows.length ? <><ol className="traffic-chart" aria-label={`날짜별 방문 ${unit}`}>{rows.map(([day, value], i) => <li key={day} aria-label={`${day}: ${value}${unit}`}><div className="traffic-chart-track"><span title={`${day} · ${value}${unit}`} style={{height: `${value / max * 100}%`}}/></div><small>{i % Math.ceil(rows.length / 12) === 0 || i === rows.length - 1 ? day.slice(5).replace('-', '/') : ''}</small></li>)}</ol>
      <details className="traffic-data-details"><summary>날짜별 수치 보기</summary><div className="traffic-table-scroll"><table><thead><tr><th>한국 날짜</th><th>방문 {unit}</th></tr></thead><tbody>{rows.map(([day, value]) => <tr key={day}><th scope="row">{day}</th><td>{value}</td></tr>)}</tbody></table></div></details></> : <p className="traffic-empty" role="status">선택한 기간에 기록된 {bySession ? '방문 세션' : '방문 브라우저'}이 없습니다.</p>}
    <p className="overview-note">기록이 있는 날짜만 표시합니다. 동의 전·설치 전 방문은 포함되지 않으며 오늘은 아직 진행 중입니다.</p>
  </section>;
}

function SourceAndDevice({data}: {data: TrafficSummary}) {
  const sourceNames = [...new Set([...data.sources.map(row => row.source), ...(data.journeys ?? []).map(row => row.source)])];
  const devices = data.journey_devices, deviceTotal = devices?.reduce((sum, row) => sum + row.sessions, 0) ?? 0;
  return <div className="traffic-report-grid"><section className="traffic-report-card" aria-labelledby="traffic-source-title"><h3 id="traffic-source-title">최초 유입 경로</h3><p>광고·검색·직접 방문이 실제 이용으로 이어지는지 확인하세요.</p>
    {sourceNames.length ? <div className="traffic-table-scroll"><table><thead><tr>{['경로', '방문 브라우저', '로그인 전 세션', '순차 인증 시도', '신규 가입'].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{sourceNames.map(source => {
      const acquisition = data.sources.find(row => row.source === source), journey = data.journeys?.find(row => row.source === source);
      return <tr key={source}><th scope="row"><span className={`traffic-source-dot traffic-source-${source}`}/>{sourceLabels[source]}</th><td>{acquisition?.visitors ?? 0}</td><td>{data.journeys ? journey?.sessions ?? 0 : '미측정'}</td><td>{data.journeys ? journey?.auth_attempt ?? 0 : '미측정'}</td><td>{acquisition?.signups ?? 0}</td></tr>;
    })}</tbody></table></div> : <p className="traffic-empty">이 기간에 관측된 유입 경로가 없습니다.</p>}
    <p className="overview-note">처음 동의한 브라우저의 유입 분류를 유지합니다. 전체 URL이나 UTM 원문을 저장하지 않습니다.</p>
  </section><section className="traffic-report-card" aria-labelledby="traffic-device-title"><h3 id="traffic-device-title">접속 화면 크기</h3><p>세션 시작 시 화면 너비에 따른 기기 분류입니다.</p>
    {devices?.length ? <ul className="traffic-device-list">{devices.map(row => <li key={row.device}><div><span>{deviceLabels[row.device]}</span><strong>{count(row.sessions)}<small>세션 · {percentage(row.sessions, deviceTotal)}</small></strong></div><div className="traffic-progress" aria-hidden="true"><span style={{width: `${deviceTotal ? row.sessions / deviceTotal * 100 : 0}%`}}/></div></li>)}</ul> : <p className="traffic-empty">기기 분류가 포함된 방문 기록을 기다리고 있습니다.</p>}
    <p className="overview-note">모바일 768px 미만 · 태블릿 1024px 미만 · 그 외 데스크톱. 실제 기종을 식별하지 않습니다. 이전 기록의 기기는 미측정으로 표시합니다.</p>
  </section></div>;
}

export default function AcquisitionPanel({from, to, revision = 0, onDenied}: {from: string; to: string; revision?: number; onDenied?: (status: 401 | 403) => void}) {
  const auth = useAuth(), {token, me} = auth, [attempt, setAttempt] = useState(0);
  const allowed = !!token && !!me?.is_admin && !auth.loading && !auth.error;
  const key = JSON.stringify([from, to, revision, attempt, token, me?.id, allowed]);
  const [result, setResult] = useState<{key: string; data?: TrafficSummary; error?: string}>({key: ''});
  const [previous, setPrevious] = useState<{key: string; data?: TrafficSummary}>({key: ''});
  const onLoaded = useCallback((data: TrafficSummary | undefined) => setPrevious({key, data}), [key]);
  const onAccessDenied = useCallback((message: string, status?: number) => {
    setResult({key, error: message}); setPrevious({key: ''});
    if (status === 401 || status === 403) onDenied?.(status);
  }, [key, onDenied]);
  useEffect(() => {
    if (!allowed || !token) return;
    const controller = new AbortController();
    void fetchTrafficReport(token, {action: 'summary', from, to}, trafficSummary, controller.signal)
      .then(data => {if (!controller.signal.aborted) setResult({key, data});})
      .catch(cause => {if (!controller.signal.aborted) {
        const message = cause instanceof TrafficReportError ? cause.message : '방문 통계를 불러오지 못했습니다. 다시 조회해 주세요.';
        setResult({key, error: message});
        if (cause instanceof TrafficReportError && [401, 403].includes(cause.status)) onAccessDenied(message, cause.status);
      }});
    return () => controller.abort();
  }, [from, to, key, token, allowed, onAccessDenied]);
  if (!allowed) return null;
  const data = result.key === key ? result.data : undefined, error = result.key === key ? result.error : undefined;
  const totals = data ? sumJourneys(data) : null;
  return <section id="traffic-analytics" className="traffic-panel traffic-dashboard overview-section" aria-labelledby="traffic-title">
    <header className="traffic-report-header"><div><p className="traffic-eyebrow">PRODUCT ANALYTICS</p><h2 id="traffic-title">사람들이 어디까지 이용했나요?</h2><p>방문부터 화면 이동, 인증 시도와 기능 이용까지 실제로 관측한 행동을 확인하세요.</p></div>
      <button type="button" className="button secondary" disabled={!data} onClick={() => data && downloadCsv(trafficCsv(data, {from, to}, previous.key === key ? previous.data : undefined), `signalbrief-analytics-${from}-${to}.csv`)}><span aria-hidden="true">↓</span> CSV 저장</button></header>
    {!data && !error && <div className="traffic-loading" role="status"><span className="traffic-loading-dot"/>방문 통계를 불러오는 중입니다.</div>}
    {error && <div className="traffic-report-error" role="alert"><p>{error}</p><button type="button" className="button secondary" onClick={() => setAttempt(value => value + 1)}>다시 조회</button></div>}
    {data && <>
      <div className="traffic-status"><span className="traffic-status-label"><i/>{data.totals.visitors || totals?.sessions ? '실제 수집 기록 연결' : '관측 데이터 수집 대기'}</span><span>선택적 동의 브라우저 · 최근 90일 보관</span><Link href="/privacy#analytics">수집 범위·설정 ↗</Link></div>
      <div className="traffic-kpis">{[
        {title: '방문 브라우저', value: data.totals.visitors, unit: '개', note: '방문·가입 기록 · 기간 내 중복 제거'},
        {title: '로그인 전 세션', value: totals?.sessions, unit: '세션', note: '동의 후 첫 화면 도착을 관측'},
        {title: '순차 인증 시도', value: totals?.auth_attempt, unit: '세션', note: `선택 → 도착 → 시도 · 방문 대비 ${totals ? percentage(totals.auth_attempt, totals.sessions) : '—'}`},
        {title: '인증된 신규 가입', value: data.totals.signups, unit: '브라우저', note: `서버에서 확인 · 방문 대비 ${percentage(data.totals.signups, data.totals.visitors)}`},
      ].map(metric => <article className="traffic-kpi" key={metric.title} aria-label={metric.title}><h3>{metric.title}</h3><strong>{count(metric.value)}{metric.value !== undefined && <small>{metric.unit}</small>}</strong><p>{metric.note}</p></article>)}</div>
      <p className="traffic-context-note">공개 페이지 조회 <strong>{count(data.totals.pageviews)}회</strong> · 사람 수·브라우저 수·세션 수는 서로 다릅니다. 로그인 후 이용 통계는 아래 별도 영역에서 확인합니다.</p>
      <div className="traffic-report-grid"><JourneyOverview data={data}/><SignupOverview data={data}/></div>
      <DailyChart data={data}/><SourceAndDevice data={data}/>
      <SessionsPanel from={from} to={to} revision={revision + attempt} onAccessDenied={onAccessDenied}/>
      <div className="traffic-deep-reports"><SurfacePanel data={data}/><JourneyPanel data={data}/>{data.product && <ProductFunnelPanel data={data.product}/>}</div>
      <ComparisonPanel data={data} range={{from, to}} revision={revision + attempt} onLoaded={onLoaded} onAccessDenied={onAccessDenied}/>
      <footer className="traffic-measurement-notes"><h3>수치 읽는 방법</h3><p>이 보고서는 수집에 동의한 브라우저의 관측 기록입니다. 동의 거절, 추적 차단, 전송 실패로 빠진 방문을 포함한 전체 방문자 수는 아닙니다. 인증된 운영자와 QA 표시가 있는 방문은 수집에서 제외합니다.</p><p>이메일·IP·검색어·질문·키 입력 내용과 화면 녹화는 이 내부 분석에 저장하지 않습니다. 브라우저 식별자는 사람을 식별하지 않으며 동의를 철회하면 연결된 기록 삭제를 요청합니다.</p>
        {data.measurement && <p>보관 중인 첫 방문·가입 기록: {data.measurement.first_acquisition_at ? koreanTime(data.measurement.first_acquisition_at) : '아직 없음'} · 세션 기록: {data.measurement.first_journey_at ? koreanTime(data.measurement.first_journey_at) : '아직 없음'}. 설치 이전 기록은 소급 수집하지 않습니다.</p>}
        <p>조회 시각: <time dateTime={data.generated_at}>{koreanTime(data.generated_at)}</time> (한국 시간)</p></footer>
    </>}
  </section>;
}
