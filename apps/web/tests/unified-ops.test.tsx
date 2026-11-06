import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import UserActivityLogs from '../src/admin-logs/page';
import { useOperationsData } from '../src/admin-logs/operations-client';
import { collectionMetricKeys, deliveryMetricKeys, operationMetricKeys, publicationMetricKeys, operationsSnapshotSchema, type OperationsSnapshot } from '../src/admin-logs/operations-contracts';
import { overviewFixture } from '../e2e/admin-overview-fixture';
import OpsPage from '../src/app/(workspace)/ops/page';
import OldLogsPage from '../src/app/(workspace)/ops/user-logs/page';
import OldAnalyticsPage from '../src/app/(workspace)/ops/analytics/page';

// Every identity and record in this file is synthetic; no production reads or writes.
const mock = vi.hoisted(() => ({
  token: 'synthetic-ops-admin-token' as string | null, id: '10000000-0000-4000-8000-000000000001',
  admin: true, loading: false, error: null as string | null,
  fetch: vi.fn(), rpc: vi.fn(), logout: vi.fn(), replace: vi.fn(), redirect: vi.fn(),
}));
vi.mock('@/components/auth', () => ({ useAuth: () => ({
  token: mock.token, me: mock.token ? { id: mock.id, is_admin: mock.admin, display_name: 'Synthetic administrator' } : null,
  loading: mock.loading, error: mock.error, logout: mock.logout,
}) }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(window.location.search), useRouter: () => ({ replace: mock.replace }), redirect: mock.redirect }));
vi.mock('@/lib/supabase', () => ({ getSupabase: () => ({
  rpc: (name: string, params: unknown) => ({ abortSignal: (signal: AbortSignal) => mock.rpc(name, params, signal) }),
}) }));

const eventId = '20000000-0000-4000-8000-000000000001';
const documentId = '30000000-0000-4000-8000-000000000001';
const runId = '40000000-0000-4000-8000-000000000001';
const reportId = '50000000-0000-4000-8000-000000000001';
const timestamp = '2026-11-05T01:00:00Z';
const period = { from: '2026-10-30', to: '2026-11-05' };
function snapshot(): OperationsSnapshot {
  return operationsSnapshotSchema.parse({
    since: '2026-10-29T15:00:00Z', until: '2026-11-05T15:00:00Z',
    metrics: Object.fromEntries(operationMetricKeys.map(key => [key, {
      value: key === 'pipeline_latency' || key === 'ai_cost' ? null : key === 'documents' ? 12 : 0,
      delta: null, spark: [], note: key === 'ai_cost' ? '기록된 비용만 합산 · USD' : '선택 기간의 기록',
    }])),
    review: [{ id: eventId, document_id: documentId, title: 'Synthetic review item', state: 'needs_review', symbol: 'SYN', created_at: timestamp }],
    failures: [{ id: runId, title: 'Synthetic failed run', status: 'failed', error_code: 'synthetic_failure', created_at: timestamp }],
    citations: [{ id: eventId, document_id: documentId, title: 'Synthetic citation issue', state: 'needs_review', symbol: 'missing_source', created_at: timestamp }],
    duplicates: [{ id: eventId, document_id: documentId, title: 'Synthetic duplicate item', state: 'duplicate', symbol: 'SYN', created_at: timestamp }],
    reports: [{ id: reportId, comment: 'Synthetic user feedback', rating: 'report', state: 'open', created_at: timestamp }],
  });
}
function snapshotV2(): OperationsSnapshot {
  const data = snapshot();
  data.schema_version = 2; data.generated_at = timestamp;
  data.review_total = 110; data.failure_total = 120; data.list_limit = 100;
  for (const key of [...collectionMetricKeys, ...publicationMetricKeys, ...deliveryMetricKeys]) {
    data.metrics[key] = { value: key === 'collector_latency' ? null : 0, delta: null, spark: [], note: 'Synthetic source note · includes test records' };
  }
  data.metrics.documents.spark = [3, 1, 2];
  data.metrics.ai_cost.recorded_value = 0;
  data.review.push({ id: `dart_analysis:${documentId}`, kind: 'dart_analysis', document_id: null, title: 'Synthetic provider analysis', symbol: 'SYN', state: 'needs_review', created_at: timestamp, source_url: 'https://www.sec.gov/Archives/synthetic-source.htm' });
  data.failures.push({ id: `collector:${runId}`, kind: 'collector', title: 'Synthetic collector failure', status: 'failed', symbol: 'SYN-COLLECTOR', error_code: 'synthetic_source_error', created_at: timestamp, source_url: 'https://www.sec.gov/Archives/synthetic-collector.htm' });
  data.activity = [
    { id: `${runId}:document-stage`, kind: 'stage', title: 'Synthetic pipeline stage', symbol: 'SYN', status: 'failed', error_code: 'synthetic_stage_error', created_at: timestamp, source_url: null, duration_ms: 0 },
    { id: 'synthetic-external-email-id', kind: 'email_event', title: 'Synthetic delivery update', symbol: null, status: 'delivered', error_code: null, created_at: timestamp, source_url: null, duration_ms: null },
  ];
  return operationsSnapshotSchema.parse(data);
}
function userLogs() {
  return {
    items: [], next_cursor: null, has_more: false, summary: { events: 0, users: 0, sessions: 0, active_ms: 0 },
    retention_days: 90, timezone: 'Asia/Seoul', consented_users: 0, generated_at: timestamp,
  };
}
function rpcResponse(name: string) {
  return { status: 200, error: null, data: name === 'sb_reference_ops' ? snapshot() : [
    { display_name: 'Synthetic member', created_at: timestamp, onboarding_completed: true, email: 'must-not-display@example.invalid' },
  ] };
}
async function fetchResponse(input: string, init?: RequestInit) {
  const path = new URL(input, 'http://localhost').pathname;
  if (path === '/api/research') return Response.json({});
  if (path === '/api/admin/user-logs') return Response.json(userLogs());
  if (path === '/api/admin/overview') return Response.json(overviewFixture(JSON.parse(String(init?.body)), true));
  if (path === '/v1/ops/documents') return Response.json([{ id: documentId, title: 'Synthetic original document', provider: 'sec', state: 'parsed', publication_date: '2026-11-05' }]);
  if (path === '/v1/ops/queues') return Response.json({ failed_runs: [{ id: runId, model: 'Synthetic model', status: 'failed', prompt_version: 'synthetic-v1', error_code: 'synthetic_failure', created_at: timestamp }] });
  if (path === '/v1/ops/audit') return Response.json([{ id: '60000000-0000-4000-8000-000000000001', action: 'synthetic_review', target_id: eventId, details: { reason: 'Synthetic audit reason', private_trace: 'must-not-display-trace' }, created_at: timestamp }]);
  if (path === `/v1/ops/events/${eventId}/action`) return Response.json({ saved: true });
  if (path === `/v1/ops/reports/${reportId}/resolve`) return new Response(null, { status: 204 });
  throw new Error(`Unexpected synthetic request ${path}`);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(timestamp));
  vi.clearAllMocks(); mock.fetch.mockReset(); mock.rpc.mockReset();
  mock.token = 'synthetic-ops-admin-token'; mock.id = '10000000-0000-4000-8000-000000000001';
  mock.admin = true; mock.loading = false; mock.error = null;
  mock.fetch.mockImplementation(fetchResponse);
  mock.rpc.mockImplementation(async (name: string) => rpcResponse(name));
  mock.logout.mockResolvedValue(undefined);
  vi.stubGlobal('fetch', mock.fetch);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('canonical operations routing', () => {
  it('renders the combined page at /ops and redirects both old overview routes there', async () => {
    const page = await OpsPage({ searchParams: Promise.resolve({}) });
    expect(page.type).toBe(UserActivityLogs);
    expect(page.props.unified).toBe(true);
    OldLogsPage(); OldAnalyticsPage();
    expect(mock.redirect.mock.calls).toEqual([['/ops'], ['/ops']]);
  });
  it.each([['data', 'operations-data'], ['model', 'operations-data'], ['users', 'operations-users'], ['audit', 'operations-audit']])('maps the former %s view to a visible section', async (view, anchor) => {
    await OpsPage({ searchParams: Promise.resolve({ view }) });
    expect(mock.redirect).toHaveBeenCalledWith(`/ops#${anchor}`);
  });
  it.each(['https://invalid.example', '__proto__', ['data', 'audit']])('does not turn an unknown view into navigation: %s', async view => {
    await OpsPage({ searchParams: Promise.resolve({ view }) });
    expect(mock.redirect).not.toHaveBeenCalled();
  });
});

describe('private operations request lifecycle', () => {
  it.each(['non-admin', 'missing-token', 'auth-loading', 'auth-error', 'disabled'])('does not read operations with %s', async condition => {
    if (condition === 'non-admin') mock.admin = false;
    if (condition === 'missing-token') mock.token = null;
    if (condition === 'auth-loading') mock.loading = true;
    if (condition === 'auth-error') mock.error = 'Cannot verify session';
    const view = renderHook(() => useOperationsData(period, condition !== 'disabled'));
    await act(async () => { await Promise.resolve(); });
    expect(mock.rpc).not.toHaveBeenCalled(); expect(mock.fetch).not.toHaveBeenCalled();
    expect(view.result.current.resources.snapshot.data).toBeNull();
  });
  it('deduplicates Strict Mode reads, shares dates and drops records immediately on permission loss', async () => {
    const view = renderHook(() => useOperationsData(period, true), { wrapper: StrictMode });
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    expect(mock.rpc.mock.calls.map(([name]) => name)).toEqual(['sb_reference_ops', 'sb_reference_users']);
    expect(mock.rpc).toHaveBeenCalledWith('sb_reference_ops', { p: { range: 'custom', start: period.from, end: period.to } }, expect.any(AbortSignal));
    expect(mock.fetch).toHaveBeenCalledTimes(3);
    expect(view.result.current.resources.snapshot.data?.metrics.documents.value).toBe(12);
    expect(JSON.stringify(view.result.current.resources)).not.toContain('must-not-display');
    mock.admin = false; view.rerender();
    expect(view.result.current.resources.snapshot.data).toBeNull();
    expect(view.result.current.resources.audit.data).toBeNull();
  });
  it('keeps a temporary source failure local and retries it without inventing empty data', async () => {
    mock.fetch.mockImplementation((input: string, init?: RequestInit) => input.includes('/ops/audit')
      ? Promise.resolve(Response.json({ error: { code: 'temporary_failure' } }, { status: 503 })) : fetchResponse(input, init));
    const view = renderHook(() => useOperationsData(period, true));
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    expect(view.result.current.resources.audit.data).toBeNull();
    expect(view.result.current.resources.audit.error?.status).toBe(503);
    expect(view.result.current.resources.documents.data).toHaveLength(1);
    expect(view.result.current.accessError).toBeNull();
    mock.fetch.mockImplementation(fetchResponse);
    act(() => view.result.current.reload());
    await waitFor(() => expect(view.result.current.resources.audit.data).toHaveLength(1));
  });
  it.each([401, 403])('hides every operations resource when any endpoint returns %s', async status => {
    mock.fetch.mockImplementation((input: string, init?: RequestInit) => input.includes('/ops/audit')
      ? Promise.resolve(Response.json({ error: { code: status === 403 ? 'mfa_required' : 'authentication_required' } }, { status })) : fetchResponse(input, init));
    const view = renderHook(() => useOperationsData(period, true));
    await waitFor(() => expect(view.result.current.accessError?.status).toBe(status));
    for (const resource of Object.values(view.result.current.resources)) expect(resource.data).toBeNull();
  });
  it('honors the direct RPC MFA denial and never exposes a database error', async () => {
    mock.rpc.mockImplementation(async name => name === 'sb_reference_ops'
      ? { data: null, status: 403, error: { message: 'mfa_required', code: 'PT403', details: 'private sql/hostname' } } : rpcResponse(name));
    const view = renderHook(() => useOperationsData(period, true));
    await waitFor(() => expect(view.result.current.accessError?.code).toBe('mfa_required'));
    expect(JSON.stringify(view.result.current)).not.toContain('private sql');
    expect(view.result.current.resources.users.data).toBeNull();
  });
  it('ignores old responses after a date change and rejects stale action denials after identity changes', async () => {
    let finish!: (value: ReturnType<typeof rpcResponse>) => void;
    mock.rpc.mockImplementationOnce(() => new Promise<ReturnType<typeof rpcResponse>>(resolve => { finish = resolve; }));
    const view = renderHook(({ from }) => useOperationsData({ ...period, from }, true), { initialProps: { from: period.from } });
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledTimes(2));
    const originalSignal = mock.rpc.mock.calls[0][2] as AbortSignal;
    view.rerender({ from: '2026-11-01' });
    expect(view.result.current.resources.snapshot.data).toBeNull();
    await waitFor(() => expect(view.result.current.resources.snapshot.data?.metrics.documents.value).toBe(12));
    expect(originalSignal.aborted).toBe(true);
    const old = rpcResponse('sb_reference_ops');
    (old.data as OperationsSnapshot).metrics.documents.value = 999;
    await act(async () => { finish(old); });
    expect(view.result.current.resources.snapshot.data?.metrics.documents.value).toBe(12);
    const oldDeny = view.result.current.deny;
    mock.token = 'synthetic-new-admin-token'; view.rerender({ from: '2026-11-01' });
    await waitFor(() => expect(view.result.current.resources.snapshot.data?.metrics.documents.value).toBe(12));
    const { UserLogsError } = await import('../src/admin-logs/client');
    act(() => oldDeny(new UserLogsError(403, 'admin_required')));
    expect(view.result.current.accessError).toBeNull();
    expect(view.result.current.resources.snapshot.data?.metrics.documents.value).toBe(12);
  });
});

describe('one continuous operations page', () => {
  it('accepts live additive v2 metrics and preserves provider/activity rows without unsafe legacy actions', async () => {
    mock.rpc.mockImplementation(async name => name === 'sb_reference_ops'
      ? { error: null, status: 200, data: snapshotV2() } : rpcResponse(name));
    render(<UserActivityLogs unified/>);
    await screen.findByText('Synthetic provider analysis');
    const pipeline = screen.getByRole('region', { name: '수집·AI 처리 현황' });
    expect(within(pipeline).getAllByRole('article')).toHaveLength(24);
    expect(screen.getByText('Synthetic pipeline stage')).toBeVisible();
    expect(screen.getByText('Synthetic delivery update')).toBeVisible();
    expect(screen.getByText('전체 기간 · 현재 대기 · 110개 중 2개 표시 · 최근 100개까지')).toBeVisible();
    expect(screen.getByText('선택 기간 · 120개 중 2개 표시 · 최근 100개까지')).toBeVisible();
    expect(screen.getByText('기록된 부분 합계 0 USD')).toBeVisible();
    expect(within(screen.getByRole('article', { name: '기록된 AI 비용' })).getByText('—')).toBeVisible();
    expect(screen.getByRole('img', { name: '수집 문서 기록 추이 · 3개 값' })).toBeVisible();
    const providerRow = screen.getByText('Synthetic provider analysis').closest('tr')!;
    expect(within(providerRow).queryByRole('button')).toBeNull();
    expect(within(providerRow).getByRole('link', { name: '원문 확인 ↗' })).toHaveAttribute('href', 'https://www.sec.gov/Archives/synthetic-source.htm');
    const collectorRow = screen.getByText('Synthetic collector failure').closest('tr')!;
    expect(within(collectorRow).getByText('synthetic_source_error')).toBeVisible();
    expect(within(collectorRow).getByText('SYN-COLLECTOR')).toBeVisible();
    expect(within(collectorRow).queryByRole('link', { name: '실행 보기' })).toBeNull();
    expect(within(collectorRow).getByRole('link')).toHaveAttribute('href', 'https://www.sec.gov/Archives/synthetic-collector.htm');
    expect(screen.getAllByRole('link').some(link => /\/ops\/(events|runs)\/.*(collector|analysis)/.test(link.getAttribute('href') ?? ''))).toBe(false);
  });
  it('rejects an unsafe source URL while preserving its read-only record', async () => {
    const data = snapshotV2(); data.review[1].source_url = 'javascript:alert(1)';
    mock.rpc.mockImplementation(async name => name === 'sb_reference_ops' ? { error: null, status: 200, data } : rpcResponse(name));
    render(<UserActivityLogs unified/>);
    const row = (await screen.findByText('Synthetic provider analysis')).closest('tr')!;
    expect(within(row).queryByRole('link')).toBeNull();
    expect(within(row).queryByRole('button')).toBeNull();
    expect(within(row).getByText('원문 링크 없음')).toBeVisible();
  });
  it('shows activity, analytics, pipeline, review, documents, models, users and audit with one heading', async () => {
    render(<UserActivityLogs unified/>);
    expect(await screen.findByText('Synthetic audit reason')).toBeVisible();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('운영 현황');
    for (const label of ['핵심 지표', '상세 활동 로그', '수집·AI 처리 현황', '검토·실패 기록', '원문·모델 실행', '가입 사용자', '운영 감사 로그']) expect(screen.getByRole('region', { name: label })).toBeVisible();
    expect(screen.getByText('Synthetic original document')).toBeVisible();
    expect(screen.getByText('Synthetic model · failed')).toBeVisible();
    expect(screen.getByText('Synthetic member')).toBeVisible();
    expect(screen.queryByText(/must-not-display/)).toBeNull();
    expect(screen.getByRole('link', { name: '감사 로그' })).toHaveAttribute('href', '#operations-audit');
    expect(within(screen.getByRole('article', { name: 'AI 실행' })).getByText('0')).toBeVisible();
    expect(within(screen.getByRole('article', { name: '기록된 AI 비용' })).getByText('—')).toBeVisible();
  });
  it('refreshes every source and applies dates to pipeline without sending activity-only filters to it', async () => {
    render(<UserActivityLogs unified/>);
    await screen.findByText('Synthetic audit reason');
    fireEvent.click(screen.getByRole('button', { name: '새로고침' }));
    await waitFor(() => expect(mock.rpc.mock.calls.filter(([name]) => name === 'sb_reference_ops')).toHaveLength(2));
    await screen.findByText('Synthetic audit reason');
    fireEvent.change(screen.getByLabelText('시작일', { exact: true }), { target: { value: '2026-11-01' } });
    fireEvent.click(screen.getByRole('button', { name: '기간 적용' }));
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith('sb_reference_ops', { p: { range: 'custom', start: '2026-11-01', end: period.to } }, expect.any(AbortSignal)));
    await screen.findByText('Synthetic audit reason');
    const before = mock.rpc.mock.calls.length;
    fireEvent.change(screen.getByLabelText('화면', { exact: true }), { target: { value: 'calendar' } });
    fireEvent.click(screen.getByRole('button', { name: '조회하기' }));
    await screen.findByRole('heading', { name: '조회할 기록이 없습니다' });
    expect(mock.rpc).toHaveBeenCalledTimes(before);
  });
  it('preserves actual event review mutations and enforces the reason before submitting', async () => {
    render(<UserActivityLogs unified/>);
    fireEvent.click(await screen.findByRole('button', { name: 'Synthetic review item 검토하기' }));
    const editor = screen.getByRole('region', { name: '운영 항목 검토' });
    expect(within(editor).getByRole('button', { name: '승인' })).toBeDisabled();
    fireEvent.change(within(editor).getByLabelText('검토 사유 (5자 이상)'), { target: { value: 'Synthetic verified reason' } });
    fireEvent.click(within(editor).getByRole('button', { name: '승인' }));
    await waitFor(() => expect(mock.fetch).toHaveBeenCalledWith(expect.stringContaining(`/ops/events/${eventId}/action`), expect.objectContaining({ method: 'POST', body: JSON.stringify({ action: 'approve', reason: 'Synthetic verified reason' }) })));
    await waitFor(() => expect(screen.queryByRole('region', { name: '운영 항목 검토' })).toBeNull());
  });
  it('preserves report resolution and deep document/run links', async () => {
    render(<UserActivityLogs unified/>);
    await screen.findByText('Synthetic audit reason');
    expect(screen.getByRole('link', { name: /^Synthetic original document / })).toHaveAttribute('href', `/ops?detail=document&id=${documentId}#operations-detail`);
    expect(screen.getByRole('link', { name: '실행 보기' })).toHaveAttribute('href', `/ops?detail=run&id=${runId}#operations-detail`);
    fireEvent.click(screen.getByRole('button', { name: 'Synthetic user feedback 검토하기' }));
    fireEvent.change(screen.getByLabelText('검토 사유 (5자 이상)'), { target: { value: 'Synthetic reviewed feedback' } });
    fireEvent.click(screen.getByRole('button', { name: '검토 완료' }));
    await waitFor(() => expect(mock.fetch).toHaveBeenCalledWith(expect.stringContaining(`/ops/reports/${reportId}/resolve`), expect.objectContaining({ method: 'POST' })));
  });
  it('closes an editor when its snapshot changes and does not restore its stale draft', async () => {
    render(<UserActivityLogs unified/>);
    fireEvent.click(await screen.findByRole('button', { name: 'Synthetic review item 검토하기' }));
    fireEvent.change(screen.getByLabelText('검토 사유 (5자 이상)'), { target: { value: 'Stale draft from previous date range' } });
    fireEvent.change(screen.getByLabelText('시작일'), { target: { value: '2026-11-01' } });
    fireEvent.click(screen.getByRole('button', { name: '기간 적용' }));
    await screen.findByText('Synthetic audit reason');
    expect(screen.queryByRole('region', { name: '운영 항목 검토' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Synthetic review item 검토하기' }));
    expect(screen.getByLabelText('검토 사유 (5자 이상)')).toHaveValue('');
  });
  it('clears analytics and operation records together when an operation read loses authorization', async () => {
    render(<UserActivityLogs unified/>);
    await screen.findByText('Synthetic audit reason');
    mock.fetch.mockImplementation((input: string, init?: RequestInit) => input.includes('/ops/audit')
      ? Promise.resolve(Response.json({ error: { code: 'mfa_required' } }, { status: 403 })) : fetchResponse(input, init));
    fireEvent.click(screen.getByRole('button', { name: '새로고침' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('추가 인증이 필요합니다');
    expect(screen.queryByRole('region', { name: '핵심 지표' })).toBeNull();
    expect(screen.queryByText('Synthetic member')).toBeNull();
    expect(screen.queryByText('Synthetic original document')).toBeNull();
    expect(screen.queryByText('Synthetic audit reason')).toBeNull();
  });
});
