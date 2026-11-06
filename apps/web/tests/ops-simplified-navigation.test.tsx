import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
  resources: { snapshot: { data: null } }, loading: false, accessError: null,
  reload: fixture.reload, deny: vi.fn(),
}) }));
vi.mock('../src/admin-logs/operations', () => ({ OperationsPanels: () => <section id="operations-audit" aria-label="Synthetic operation records">Records</section> }));

afterEach(() => { cleanup(); fixture.admin = true; vi.clearAllMocks(); });

describe('one administrator menu with existing logs first', () => {
  it('renders exactly one operations destination and no secondary menu or tabs', () => {
    render(<ResearchShell><UserActivityLogs unified/></ResearchShell>);
    const menu = screen.getByRole('navigation', { name: '관리자 메뉴' });
    expect(within(menu).getAllByRole('link')).toHaveLength(1);
    expect(within(menu).getByRole('link', { name: '01 운영 현황' })).toHaveAttribute('href', '/ops');
    expect(within(menu).getByRole('link')).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('navigation', { name: '이 페이지 바로가기' })).toBeNull();
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('운영 현황');
    for (const name of ['A/B 실험 관리', 'AI 평가 관리', '금융정보 품질 검수', '장애·안전성 관리', '실험·평가 보고서']) {
      expect(within(menu).queryByText(name)).toBeNull();
    }
  });

  it('shows activity logs before metrics while retaining filters and a same-page audit link', () => {
    render(<ResearchShell><UserActivityLogs unified/></ResearchShell>);
    const activity = screen.getByRole('region', { name: '상세 활동 로그' });
    const metrics = screen.getByRole('region', { name: 'Synthetic aggregate metrics' });
    const operations = screen.getByRole('region', { name: 'Synthetic operation records' });
    expect(activity.compareDocumentPosition(metrics) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(metrics.compareDocumentPosition(operations) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    for (const name of ['활동 유형', '화면', '기기', '사용자 ID']) expect(within(activity).getByLabelText(name)).toBeVisible();
    expect(screen.getByRole('button', { name: '새로고침' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '기간 적용' })).toBeEnabled();
    expect(within(activity).getByRole('link', { name: '감사 로그' })).toHaveAttribute('href', '#operations-audit');
  });

  it('still denies ordinary accounts without exposing logs or administrator navigation', () => {
    fixture.admin = false;
    render(<ResearchShell><UserActivityLogs unified/></ResearchShell>);
    expect(screen.getByRole('heading', { name: '관리자 권한이 필요합니다' })).toBeVisible();
    expect(screen.queryByRole('navigation', { name: '관리자 메뉴' })).toBeNull();
    expect(screen.queryByRole('region', { name: '상세 활동 로그' })).toBeNull();
  });
});
