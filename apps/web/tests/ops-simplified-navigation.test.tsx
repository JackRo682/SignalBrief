import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ResearchShell from '../src/research/shell';
import UserActivityLogs from '../src/admin-logs/page';

// Synthetic component-level fixtures only. Existing client and API suites are unchanged.
const fixture = vi.hoisted(() => ({
  admin: true, reload: vi.fn(),
  user: { id: 'synthetic-admin', display_name: 'Synthetic administrator' },
}));
vi.mock('@/components/auth', () => ({ useAuth: () => ({
  token: 'synthetic-test-token', me: { ...fixture.user, is_admin: fixture.admin },
  loading: false, error: null, logout: vi.fn(), refresh: vi.fn(),
}) }));
vi.mock('next/navigation', () => ({ usePathname: () => '/ops', useRouter: () => ({ replace: vi.fn() }) }));
vi.mock('../src/admin-logs/client', () => ({ useUserLogs: () => ({ data: null, error: null, loading: false, reload: fixture.reload }) }));
vi.mock('../src/admin-logs/overview-client', () => ({ useAdminOverview: () => ({ data: {}, error: null, loading: false, reload: fixture.reload }) }));
vi.mock('../src/admin-logs/overview', () => ({
  OverviewPanels: () => <section id="overview-metrics" aria-label="Synthetic aggregate metrics">Metrics</section>,
  OverviewLoading: () => <p>Loading metrics</p>,
}));
vi.mock('../src/admin-logs/operations-client', () => ({ useOperationsData: () => ({
  resources: {
    snapshot: { data: null, error: null, loading: false },
    documents: { data: [], error: null, loading: false },
    queues: { data: {failed_runs: []}, error: null, loading: false },
    users: { data: [], error: null, loading: false },
    audit: { data: [], error: null, loading: false },
  }, loading: false, accessError: null,
  reload: fixture.reload, deny: vi.fn(),
}) }));

beforeEach(() => vi.stubGlobal('fetch', vi.fn(async () => Response.json({
  generated_at: '2026-11-27T00:00:00Z',
  totals: {visitors: 0, pageviews: 0, starts: 0, requests: 0, signups: 0, onboarded: 0},
  daily: [], sources: [], journeys: [],
}))));
afterEach(() => { cleanup(); fixture.admin = true; vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe('one operations destination with analytics-first same-page navigation', () => {
  it('keeps one operations destination and connects each local jump link to one visible target', async () => {
    render(<ResearchShell><UserActivityLogs unified/></ResearchShell>);
    const menu = screen.getByRole('navigation', { name: '관리자 메뉴' });
    expect(within(menu).getAllByRole('link')).toHaveLength(1);
    expect(within(menu).getByRole('link', { name: '01 운영 현황' })).toHaveAttribute('href', '/ops');
    expect(within(menu).getByRole('link')).toHaveAttribute('aria-current', 'page');
    await screen.findByRole('region', { name: '세션별 방문 경로' });
    const jumpLinks = screen.getByRole('navigation', { name: '이 페이지 바로가기' });
    const targets = [
      ['방문·행동 분석', 'traffic-analytics'], ['세션별 경로', 'traffic-sessions'],
      ['로그인 후 이용', 'overview-metrics'], ['상세 활동 기록', 'activity-logs'],
      ['수집·운영 상태', 'operations-pipeline'],
    ];
    expect(within(jumpLinks).getAllByRole('link')).toHaveLength(targets.length);
    for (const [label, id] of targets) {
      expect(within(jumpLinks).getByRole('link', { name: label })).toHaveAttribute('href', `#${id}`);
      expect(document.querySelectorAll(`[id="${id}"]`)).toHaveLength(1);
      expect(document.getElementById(id)).toBeVisible();
    }
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('운영 현황');
    for (const name of ['A/B 실험 관리', 'AI 평가 관리', '금융정보 품질 검수', '장애·안전성 관리', '실험·평가 보고서']) {
      expect(within(menu).queryByText(name)).toBeNull();
    }
  });

  it('shows analytics then account metrics then logs and operations while retaining filters and audit access', async () => {
    render(<ResearchShell><UserActivityLogs unified/></ResearchShell>);
    await screen.findByRole('region', { name: '세션별 방문 경로' });
    const analytics = screen.getByRole('region', { name: '사람들이 어디까지 이용했나요?' });
    const activity = screen.getByRole('region', { name: '상세 활동 로그' });
    const metrics = screen.getByRole('region', { name: 'Synthetic aggregate metrics' });
    const operations = screen.getByRole('region', { name: '수집·AI 처리 현황' });
    const audit = screen.getByRole('region', { name: '운영 감사 로그' });
    expect(analytics.compareDocumentPosition(metrics) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(metrics.compareDocumentPosition(activity) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(activity.compareDocumentPosition(operations) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(operations.compareDocumentPosition(audit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    for (const name of ['활동 유형', '화면', '기기', '사용자 ID']) expect(within(activity).getByLabelText(name)).toBeVisible();
    expect(screen.getByRole('button', { name: '새로고침' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '기간 적용' })).toBeEnabled();
    expect(within(activity).getByRole('link', { name: '감사 로그' })).toHaveAttribute('href', '#operations-audit');
    expect(audit).toHaveAttribute('id', 'operations-audit');
  });

  it('still denies ordinary accounts without exposing logs or administrator navigation', () => {
    fixture.admin = false;
    render(<ResearchShell><UserActivityLogs unified/></ResearchShell>);
    expect(screen.getByRole('heading', { name: '관리자 권한이 필요합니다' })).toBeVisible();
    expect(screen.queryByRole('navigation', { name: '관리자 메뉴' })).toBeNull();
    expect(screen.queryByRole('region', { name: '상세 활동 로그' })).toBeNull();
  });
});
