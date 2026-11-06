'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '@/components/auth';
import { ActionNotice, Loading, useAction } from '@/components/ui';
import { body, emptySchema, externalUrl, request } from '@/lib/api';
import { jsonObjectSchema } from '@/lib/contracts';
import { Badge, Field, Panel } from '@/research/ui';
import type { UserLogsError } from './client';
import { formatLogTime } from './display';
import { operationError, type OperationResource, type OperationResources } from './operations-client';
import { collectionMetricKeys, deliveryMetricKeys, operationMetricKeys, publicationMetricKeys, type OperationRow, type OperationsSnapshot } from './operations-contracts';

const metricLabels: Record<string, string> = {
  documents: '수집 문서', events: '감지된 이벤트', ai_runs: 'AI 실행', ai_failures: 'AI 실패',
  low_confidence: '저신뢰도 분석', citation_failures: '인용 출처 실패', number_mismatch: '수치 불일치',
  duplicates: '중복 이벤트 후보', pipeline_latency: '평균 처리 지연', ai_cost: '기록된 AI 비용',
  collector_runs: '공식 수집 실행', collector_errors: '공식 수집 오류', dart_filings: 'DART 공시',
  sec_filings: 'SEC 공시', dart_documents: 'DART 원문', provider_analyses: '공식 공시 분석',
  collector_latency: '평균 수집 지연', review_pending: '전체 검토 대기', published_events: '게시 이벤트',
  published_briefs: '게시 브리핑', delivery_queued: '이메일 생성', delivery_submitted: '이메일 제출',
  delivery_delivered: '이메일 전달 완료', delivery_failed: '이메일 발송 실패',
};
const activityLabels: Record<string, string> = { collector: '자료 수집', stage: '처리 단계', email: '이메일 발송', email_event: '이메일 전달 이벤트', analysis_attempt: '분석 시도', document_attempt: '원문 처리', dart_analysis: 'DART 분석', sec_analysis: 'SEC 분석', event: '이벤트', run: 'AI 실행' };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function hasAction(row: OperationRow, kind: 'event' | 'run' | 'report') {
  return uuid.test(row.id) && (kind === 'report' || !row.kind || row.kind === kind);
}
function sourceLink(url: string | null | undefined) {
  const safe = url ? externalUrl(url) : undefined;
  return safe ? <a className="user-log-link" href={safe} target="_blank" rel="noopener noreferrer">원문 확인 ↗</a> : <span className="user-log-small">원문 링크 없음</span>;
}

function operationTime(value?: string | null) {
  return value && Number.isFinite(Date.parse(value)) ? formatLogTime(value) : '미기록';
}

function ResourceState<T>({ resource, retry, children }: { resource: OperationResource<T>; retry: () => void; children: (data: T) => ReactNode }) {
  if (resource.loading) return <Loading label="운영 기록을 불러오고 있습니다."/>;
  if (resource.error) return <div className="ops-section-error" role="alert"><p>이 영역의 기록을 불러오지 못했습니다. 다른 영역의 정보는 계속 확인할 수 있습니다.</p><button type="button" className="button secondary" onClick={retry}>운영 기록 다시 조회</button></div>;
  return resource.data === null ? null : <>{children(resource.data)}</>;
}

function NoRecords({ children }: { children: ReactNode }) {
  return <div className="ops-empty"><p>{children}</p></div>;
}

function RecordedTrend({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2) return null;
  const low = Math.min(...values), high = Math.max(...values);
  const points = values.map((value, index) => `${2 + index / (values.length - 1) * 96},${high === low ? 16 : 28 - (value - low) / (high - low) * 24}`).join(' ');
  return <figure className="ops-recorded-trend">
    <svg viewBox="0 0 100 32" role="img" aria-label={`${label} 기록 추이 · ${values.length}개 값`}><title>{values.join(', ')}</title><polyline fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" points={points}/></svg>
    <figcaption className="sr-only">서버에 기록된 값: {values.join(', ')}</figcaption>
  </figure>;
}

function MetricGroup({ data, keys }: { data: OperationsSnapshot; keys: readonly string[] }) {
  return <div className="ops-overview-metrics">
    {keys.filter(key => data.metrics[key] !== undefined).map(key => {
      const metric = data.metrics[key];
      const value = metric.value === null ? '—' : metric.display ?? metric.value.toLocaleString('ko-KR', { maximumFractionDigits: key === 'ai_cost' ? 6 : 2 });
      return <article className="ops-overview-metric" aria-label={metricLabels[key]} key={key}>
        <h3>{metricLabels[key]}</h3>
        <strong>{value}{metric.value !== null && <small>{key === 'pipeline_latency' || key === 'collector_latency' ? 'ms' : key === 'ai_cost' ? 'USD' : '건'}</small>}</strong>
        {metric.delta !== null && <span className="ops-metric-change">이전 기간 대비 {metric.delta > 0 ? '+' : ''}{metric.delta.toLocaleString('ko-KR', { maximumFractionDigits: 1 })}%</span>}
        {key === 'ai_cost' && metric.value === null && metric.recorded_value !== undefined && metric.recorded_value !== null && <span className="ops-metric-change">기록된 부분 합계 {metric.recorded_value.toLocaleString('ko-KR', { maximumFractionDigits: 6 })} USD</span>}
        <RecordedTrend values={metric.spark} label={metricLabels[key]}/>
        <p>{metric.note}</p>
      </article>;
    })}
  </div>;
}

function OperationsMetrics({ data }: { data: OperationsSnapshot }) {
  const groups = [
    { title: '공식 자료 수집', keys: collectionMetricKeys },
    { title: '검토·게시', keys: publicationMetricKeys },
    { title: '이메일 전달', keys: deliveryMetricKeys },
  ];
  return <>
    <MetricGroup data={data} keys={operationMetricKeys}/>
    {groups.filter(group => group.keys.some(key => data.metrics[key] !== undefined)).map(group => <div className="ops-metric-group" key={group.title}><h3>{group.title}</h3><MetricGroup data={data} keys={group.keys}/></div>)}
  </>;
}

type ReviewSelection = { kind: 'event' | 'report'; row: OperationRow };

function ReviewTable({ title, rows, kind, onReview, total, limit = 100, currentBacklog = false }: {
  title: string; rows: OperationRow[]; kind: 'event' | 'run' | 'report'; onReview: (value: ReviewSelection) => void; total?: number; limit?: number; currentBacklog?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [state, setState] = useState('');
  const states = [...new Set(rows.map(row => row.state || row.status).filter((value): value is string => !!value))];
  const filtered = rows.filter(row => (!query || `${row.title || row.comment || row.question || ''} ${row.symbol ?? ''} ${row.error_code ?? ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) && (!state || (row.state || row.status) === state));
  return <Panel title={title} aside={<span className="user-log-small">{currentBacklog ? '전체 기간 · 현재 대기' : '선택 기간'} · {total === undefined ? `${rows.length.toLocaleString('ko-KR')}개` : `${total.toLocaleString('ko-KR')}개 중 ${rows.length.toLocaleString('ko-KR')}개 표시`} · 최근 {limit}개까지</span>}>
    {rows.length > 0 && <div className="ops-table-filters">
      <Field label={`${title} 검색`}><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="제목·내용·종목 검색"/></Field>
      <Field label={`${title} 상태`}><select value={state} onChange={event => setState(event.target.value)}><option value="">전체 상태</option>{states.map(value => <option value={value} key={value}>{value}</option>)}</select></Field>
    </div>}
    {filtered.length ? <div className="ops-record-table-wrap" role="region" aria-label={`${title} 목록`} tabIndex={0}><table className="ops-record-table">
      <thead><tr><th scope="col">발생 시각 (한국 시간)</th><th scope="col">{kind === 'report' ? '의견 내용' : '문서·이벤트'}</th><th scope="col">{kind === 'run' ? '오류 유형' : kind === 'report' ? '구분' : '종목·문제 유형'}</th><th scope="col">상태</th><th scope="col">작업</th></tr></thead>
      <tbody>{filtered.map((row, index) => <tr key={`${row.id}:${row.symbol ?? ''}:${index}`}>
        <td><time dateTime={row.created_at ?? undefined}>{operationTime(row.created_at)}</time></td>
        <td>{row.document_id && uuid.test(row.document_id) ? <Link href={`/ops/documents/${encodeURIComponent(row.document_id)}`}>{row.title || '제목 없음'}</Link> : row.title || row.comment || row.question || '내용 없음'}{row.kind && <small className="ops-record-kind">{activityLabels[row.kind] ?? row.kind}</small>}</td>
        <td>{kind === 'run' ? <>{row.error_code || '오류 코드 없음'}{row.symbol && <small className="ops-record-kind">{row.symbol}</small>}{row.rating && <small className="ops-record-kind">{row.rating}</small>}</> : <>{row.symbol || row.rating || row.error_code || '—'}{row.symbol && row.rating && <small className="ops-record-kind">{row.rating}</small>}{row.error_code && (row.symbol || row.rating) && <small className="ops-record-kind">{row.error_code}</small>}</>}</td>
        <td><Badge value={row.state || row.status || 'pending'}/></td>
        <td>{!hasAction(row, kind) ? sourceLink(row.source_url) : kind === 'run' ? <Link className="button secondary" href={`/ops/runs/${encodeURIComponent(row.id)}`}>실행 보기</Link> : <button type="button" className="button secondary" aria-label={`${row.title || row.comment || row.question || title} 검토하기`} onClick={() => onReview({ kind, row })}>검토하기</button>}</td>
      </tr>)}</tbody>
    </table></div> : <NoRecords>{rows.length ? '검색 조건에 맞는 항목이 없습니다.' : `${currentBacklog ? '현재' : '선택 기간에'} ${title} 기록이 없습니다.`}</NoRecords>}
  </Panel>;
}

function ReviewEditor({ selection, close, refresh, deny }: {
  selection: ReviewSelection; close: () => void; refresh: () => void; deny: (error: UserLogsError) => void;
}) {
  const auth = useAuth();
  const action = useAction();
  const [reason, setReason] = useState('');
  const reasonInput = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    reasonInput.current?.focus({ preventScroll: true });
    reasonInput.current?.scrollIntoView?.({ block: 'center' });
  }, []);
  async function submit(kind: 'approve' | 'reject' | 'rerun' | 'resolve_report') {
    if (action.busy || reason.trim().length < 5 || !auth.token || !auth.me?.is_admin || auth.error || !hasAction(selection.row, selection.kind)) return;
    const success = await action.run(async () => {
      try {
        const id = encodeURIComponent(selection.row.id);
        if (kind === 'resolve_report') await request(`/v1/ops/reports/${id}/resolve`, auth.token, emptySchema, body('POST'));
        else await request(`/v1/ops/events/${id}/action`, auth.token, jsonObjectSchema, body('POST', { action: kind, reason: reason.trim() }));
      } catch (error) {
        const safe = operationError(error);
        if (safe.status === 401 || safe.status === 403) deny(safe);
        throw error;
      }
    });
    if (success) { close(); refresh(); }
  }
  return <section className="ops-review-editor" aria-label="운영 항목 검토">
    <header><h3>{selection.kind === 'report' ? '사용자 의견 검토' : '이벤트 검토'}</h3><button type="button" className="button secondary" onClick={close} disabled={action.busy}>검토 닫기</button></header>
    <p>{selection.row.title || selection.row.comment || selection.row.question || '내용 없음'}</p>
    {selection.row.document_id && <Link className="user-log-link" href={`/ops/documents/${encodeURIComponent(selection.row.document_id)}`}>원문·검증 이력 확인</Link>}
    <Field label="검토 사유 (5자 이상)"><textarea ref={reasonInput} value={reason} minLength={5} maxLength={500} onChange={event => setReason(event.target.value)}/></Field>
    <ActionNotice action={action}/>
    <div className="user-log-actions">{(selection.kind === 'report' ? [['resolve_report', '검토 완료']] as const : [['approve', '승인'], ['reject', '거절'], ['rerun', '재분석 요청']] as const).map(([kind, label]) => <button type="button" key={kind} className={`button ${kind === 'approve' || kind === 'resolve_report' ? 'primary' : 'secondary'}`} disabled={action.busy || reason.trim().length < 5} onClick={() => void submit(kind)}>{label}</button>)}</div>
    <p className="overview-note">승인은 서버의 근거 검증을 통과해야 합니다. 재분석 요청은 처리 작업으로 등록됩니다.</p>
  </section>;
}

export function OperationsPanels({ resources, reload, refresh, deny }: {
  resources: OperationResources; reload: () => void; refresh: () => void; deny: (error: UserLogsError) => void;
}) {
  const [selected, setSelected] = useState<{ review: ReviewSelection; snapshot: OperationsSnapshot } | null>(null);
  // A period change or refresh replaces the records; do not retain an editor for an old row.
  const selectedStillVisible = selected && selected.snapshot === resources.snapshot.data && (selected.review.kind === 'report'
    ? resources.snapshot.data.reports
    : [...resources.snapshot.data.review, ...resources.snapshot.data.citations, ...resources.snapshot.data.duplicates]).some(row => row.id === selected.review.row.id);
  return <div className="ops-consolidated-sections">
    <section id="operations-pipeline" className="overview-section" aria-label="수집·AI 처리 현황">
      <div className="overview-section-heading"><h2>수집·AI 처리 현황</h2><span>위 조회 기간 기준</span></div>
      <ResourceState resource={resources.snapshot} retry={reload}>{data => <>
        <OperationsMetrics data={data}/>
        <section id="operations-review" className="overview-section" aria-label="검토·실패 기록">
          <div className="overview-section-heading"><h2>검토·실패 기록</h2><span>목록별 검색·상태 필터</span></div>
          <ReviewTable title="검토 대기 이벤트·분석" rows={data.review} kind="event" onReview={review => setSelected({ review, snapshot: data })} total={data.review_total} limit={data.list_limit} currentBacklog={(data.schema_version ?? 1) >= 2}/>
          <ReviewTable title="수집·처리·AI 실패" rows={data.failures} kind="run" onReview={review => setSelected({ review, snapshot: data })} total={data.failure_total} limit={data.list_limit}/>
          <ReviewTable title="인용·수치 검증 문제" rows={data.citations} kind="event" onReview={review => setSelected({ review, snapshot: data })}/>
          <ReviewTable title="중복 이벤트 후보" rows={data.duplicates} kind="event" onReview={review => setSelected({ review, snapshot: data })}/>
          <ReviewTable title="사용자 의견" rows={data.reports} kind="report" onReview={review => setSelected({ review, snapshot: data })}/>
          {selectedStillVisible && <ReviewEditor key={`${selected.review.kind}:${selected.review.row.id}`} selection={selected.review} close={() => setSelected(null)} refresh={refresh} deny={deny}/>}
        </section>
        {data.activity !== undefined && <section id="operations-activity" className="overview-section" aria-label="수집·발송 활동 기록">
          <Panel title="수집·발송 활동 기록" aside={<span className="user-log-small">선택 기간 · 최신 {data.list_limit ?? 100}개까지</span>}>
            {data.activity.length ? <div className="ops-record-table-wrap" role="region" aria-label="수집·발송 활동 목록" tabIndex={0}><table className="ops-record-table">
              <thead><tr><th scope="col">발생 시각 (한국 시간)</th><th scope="col">활동</th><th scope="col">내용</th><th scope="col">상태·오류</th><th scope="col">소요 시간</th><th scope="col">출처</th></tr></thead>
              <tbody>{data.activity.map((item, index) => <tr key={`${item.kind}:${item.id}:${index}`}>
                <td><time dateTime={item.created_at ?? undefined}>{operationTime(item.created_at)}</time></td>
                <td>{activityLabels[item.kind] ?? item.kind}</td>
                <td>{item.title || '내용 없음'}{item.symbol && <small className="ops-record-kind">{item.symbol}</small>}</td>
                <td>{item.status || '미기록'}{item.error_code && <small className="ops-record-kind">{item.error_code}</small>}</td>
                <td>{item.duration_ms === null ? '미측정' : `${item.duration_ms.toLocaleString('ko-KR')} ms`}</td>
                <td>{sourceLink(item.source_url)}</td>
              </tr>)}</tbody>
            </table></div> : <NoRecords>선택 기간에 수집·발송 활동 기록이 없습니다.</NoRecords>}
          </Panel>
        </section>}
        {data.generated_at && <p className="overview-updated">수집·AI 처리 조회 시각: {operationTime(data.generated_at)} (한국 시간)</p>}
      </>}</ResourceState>
    </section>

    <section id="operations-data" className="overview-section" aria-label="원문·모델 실행">
      <div className="overview-section-heading"><h2>원문·모델 실행</h2><span>전체 기간의 최신 기록</span></div>
      <div className="overview-two-column">
        <Panel title="최근 원본 문서" aside={<span className="user-log-small">최신 100개까지</span>}>
          <ResourceState resource={resources.documents} retry={reload}>{data => data.length ? <ul className="ops-record-list">{data.map(document => <li key={document.id}><Link href={`/ops/documents/${encodeURIComponent(document.id)}`}><strong>{document.title}</strong><span>{document.provider.toUpperCase()} · {document.state}{document.publication_date ? ` · ${document.publication_date}` : ''}</span></Link></li>)}</ul> : <NoRecords>수집된 원본 문서가 없습니다.</NoRecords>}</ResourceState>
        </Panel>
        <Panel title="모델·분석 실행 기록" aside={<span className="user-log-small">최근 실패 실행 50개까지</span>}>
          <ResourceState resource={resources.queues} retry={reload}>{data => data.failed_runs.length ? <ul className="ops-record-list">{data.failed_runs.map(run => <li key={run.id}><Link href={`/ops/runs/${encodeURIComponent(run.id)}`}><strong>{run.model} · {run.status}</strong><span>프롬프트 {run.prompt_version || '미기록'} · {run.error_code || '오류 코드 없음'}</span></Link></li>)}</ul> : <NoRecords>기록된 실패 실행이 없습니다.</NoRecords>}</ResourceState>
          <p className="overview-note">실제 저장된 실행 이력을 표시합니다. 모델 설정은 실행 상세에서 확인할 수 있습니다.</p>
        </Panel>
      </div>
    </section>

    <section id="operations-users" className="overview-section" aria-label="가입 사용자">
      <Panel title="가입 사용자" aside={<span className="user-log-small">최근 가입 100명까지 · 전체 기간</span>}>
        <ResourceState resource={resources.users} retry={reload}>{data => data.length ? <div className="ops-record-table-wrap" role="region" aria-label="가입 사용자 목록" tabIndex={0}><table className="ops-record-table">
          <thead><tr><th scope="col">표시 이름</th><th scope="col">가입일 (한국 시간)</th><th scope="col">설정 완료</th></tr></thead>
          <tbody>{data.map((user, index) => <tr key={`${user.created_at}:${index}`}><td>{user.display_name || '이름 없음'}</td><td><time dateTime={user.created_at}>{operationTime(user.created_at)}</time></td><td>{user.onboarding_completed ? '완료' : '진행 중'}</td></tr>)}</tbody>
        </table></div> : <NoRecords>가입한 사용자가 없습니다.</NoRecords>}</ResourceState>
        <p className="overview-note">운영 확인에 필요한 표시 이름·가입일·설정 상태만 제공합니다.</p>
      </Panel>
    </section>

    <section id="operations-audit" className="overview-section" aria-label="운영 감사 로그">
      <Panel title="운영 감사 로그" aside={<span className="user-log-small">최근 100개까지 · 전체 기간</span>}>
        <ResourceState resource={resources.audit} retry={reload}>{data => data.length ? <div className="ops-record-table-wrap" role="region" aria-label="운영 감사 기록" tabIndex={0}><table className="ops-record-table">
          <thead><tr><th scope="col">발생 시각 (한국 시간)</th><th scope="col">작업</th><th scope="col">대상</th><th scope="col">사유</th></tr></thead>
          <tbody>{data.map(item => <tr key={item.id}><td><time dateTime={item.created_at}>{operationTime(item.created_at)}</time></td><td>{item.action}</td><td className="ops-record-id">{item.target_id || '—'}</td><td>{item.details?.reason || '미기록'}</td></tr>)}</tbody>
        </table></div> : <NoRecords>기록된 운영 행동이 없습니다.</NoRecords>}</ResourceState>
      </Panel>
    </section>
  </div>;
}
