import '@testing-library/jest-dom/vitest';
import {act, cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {useState} from 'react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import ResearchShell from '../src/research/shell';
import type {Me} from '../src/lib/contracts';

const mock = vi.hoisted(() => ({logout: vi.fn(), refresh: vi.fn(), replace: vi.fn()}));
const admin: Me = {id: 'synthetic-admin', display_name: 'Synthetic administrator', density: 'beginner', onboarding_completed: true, analytics_consent: false, is_admin: true, demo_mode: false};
let auth: {token: string | null; me: Me | null; loading: boolean; error: string | null; logout: typeof mock.logout; refresh: typeof mock.refresh};
vi.mock('../src/components/auth', () => ({useAuth: () => auth}));
vi.mock('../src/components/ui', () => ({Loading: () => <p role="status">Verifying access</p>}));
vi.mock('next/navigation', () => ({usePathname: () => '/ops/user-logs', useRouter: () => ({replace: mock.replace})}));

function ProtectedPanel() {
  const [value, setValue] = useState('');
  return <section aria-label="Private log records"><p>Synthetic private activity</p><input aria-label="Private selection" value={value} onChange={e => setValue(e.target.value)}/></section>;
}
function view() {return <ResearchShell><ProtectedPanel/></ResearchShell>;}
function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((ok, fail) => {resolve = ok; reject = fail;});
  return {promise, resolve, reject};
}

beforeEach(() => {
  vi.clearAllMocks();
  mock.logout.mockResolvedValue(undefined);
  mock.refresh.mockResolvedValue(undefined);
  auth = {token: 'synthetic-token', me: admin, loading: false, error: null, logout: mock.logout, refresh: mock.refresh};
});
afterEach(cleanup);

describe('private admin shell access states', () => {
  it('withholds all admin content until access verification finishes', () => {
    auth.loading = true;
    render(view());
    expect(screen.getByRole('status')).toHaveTextContent('Verifying access');
    expect(screen.queryByRole('region', {name: 'Private log records'})).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', {name: '관리자 메뉴'})).not.toBeInTheDocument();
  });

  it('sends signed-out visitors to login with a safe return path', () => {
    auth = {...auth, token: null, me: null};
    render(view());
    expect(screen.getByRole('link', {name: '로그인'})).toHaveAttribute('href', '/login?next=%2Fops%2Fuser-logs');
    expect(screen.queryByText('Synthetic private activity')).not.toBeInTheDocument();
    expect(screen.getByRole('link', {name: '서비스로 돌아가기'})).toHaveAttribute('href', '/today');
    expect(mock.logout).not.toHaveBeenCalled();
  });

  it('denies a signed-in ordinary account and exposes recovery controls without log data', () => {
    auth.me = {...admin, is_admin: false};
    render(view());
    expect(screen.getByRole('heading', {name: '관리자 권한이 필요합니다'})).toBeVisible();
    expect(screen.getByRole('button', {name: '다른 계정으로 로그인'})).toBeEnabled();
    expect(screen.getByRole('button', {name: '권한 다시 확인'})).toBeEnabled();
    expect(screen.queryByText('Synthetic private activity')).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', {name: '관리자 메뉴'})).not.toBeInTheDocument();
  });

  it('fails closed on an authentication error even when an old admin profile is still present', () => {
    auth.error = 'Synthetic authentication outage';
    render(view());
    expect(screen.getByRole('heading', {name: '계정 연결을 확인해 주세요'})).toBeVisible();
    expect(screen.queryByText('Synthetic private activity')).not.toBeInTheDocument();
    expect(screen.getByRole('button', {name: '권한 다시 확인'})).toBeEnabled();
  });

  it('waits for successful local sign-out before returning to administrator login', async () => {
    auth.me = {...admin, is_admin: false};
    const pending = deferred();
    mock.logout.mockReturnValueOnce(pending.promise);
    render(view());
    fireEvent.click(screen.getByRole('button', {name: '다른 계정으로 로그인'}));
    expect(screen.getByRole('button', {name: '처리 중…'})).toBeDisabled();
    expect(screen.getByRole('button', {name: '권한 다시 확인'})).toBeDisabled();
    expect(mock.replace).not.toHaveBeenCalled();
    await act(async () => pending.resolve());
    expect(mock.logout).toHaveBeenCalledTimes(1);
    expect(mock.replace).toHaveBeenCalledWith('/login?next=%2Fops%2Fuser-logs');
  });

  it('keeps account-switch controls recoverable when sign-out fails', async () => {
    auth.me = {...admin, is_admin: false};
    mock.logout.mockRejectedValueOnce(new Error('Synthetic sign-out failure'));
    render(view());
    fireEvent.click(screen.getByRole('button', {name: '다른 계정으로 로그인'}));
    expect(await screen.findByText('로그아웃을 완료하지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.')).toBeVisible();
    expect(screen.getByRole('button', {name: '다른 계정으로 로그인'})).toBeEnabled();
    expect(mock.replace).not.toHaveBeenCalled();
    expect(screen.queryByText('Synthetic private activity')).not.toBeInTheDocument();
  });

  it('rechecks permissions without rendering logs until a trusted admin profile arrives', async () => {
    auth.me = {...admin, is_admin: false};
    const pending = deferred();
    mock.refresh.mockReturnValueOnce(pending.promise);
    const mounted = render(view());
    fireEvent.click(screen.getByRole('button', {name: '권한 다시 확인'}));
    expect(mock.refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Synthetic private activity')).not.toBeInTheDocument();
    await act(async () => pending.resolve());
    expect(screen.queryByText('Synthetic private activity')).not.toBeInTheDocument();
    auth.me = admin;
    mounted.rerender(view());
    expect(screen.getByRole('region', {name: 'Private log records'})).toBeVisible();
    expect(screen.getByRole('link', {name: /운영 현황 · 사용자 로그/})).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('link', {name: /사용자 행동 분석/})).toBeNull();
  });

  it('shows a retry error and restores controls after a failed permission recheck', async () => {
    auth.error = 'Synthetic identity unavailable';
    auth.me = null;
    mock.refresh.mockRejectedValueOnce(new Error('Synthetic retry unavailable'));
    render(view());
    fireEvent.click(screen.getByRole('button', {name: '권한 다시 확인'}));
    expect(await screen.findByText('계정 권한을 확인하지 못했습니다. 잠시 후 다시 시도하거나 다시 로그인해 주세요.')).toBeVisible();
    await waitFor(() => expect(screen.getByRole('button', {name: '권한 다시 확인'})).toBeEnabled());
    expect(mock.replace).not.toHaveBeenCalled();
    expect(screen.queryByText('Synthetic private activity')).not.toBeInTheDocument();
  });

  it('removes previously displayed records when the session expires', () => {
    const mounted = render(view());
    expect(screen.getByRole('region', {name: 'Private log records'})).toBeVisible();
    auth = {...auth, token: null, me: null};
    mounted.rerender(view());
    expect(screen.queryByText('Synthetic private activity')).not.toBeInTheDocument();
    expect(screen.getByRole('link', {name: '로그인'})).toHaveAttribute('href', '/login?next=%2Fops%2Fuser-logs');
  });

  it('removes previously displayed records when admin privileges are revoked', () => {
    const mounted = render(view());
    auth.me = {...admin, is_admin: false};
    mounted.rerender(view());
    expect(screen.queryByText('Synthetic private activity')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', {name: '관리자 권한이 필요합니다'})).toBeVisible();
  });

  it('resets child state when the authenticated identity changes', () => {
    const mounted = render(view());
    fireEvent.change(screen.getByRole('textbox', {name: 'Private selection'}), {target: {value: 'Synthetic prior account selection'}});
    auth = {...auth, token: 'synthetic-other-admin-token', me: {...admin, id: 'synthetic-other-admin'}};
    mounted.rerender(view());
    expect(screen.getByRole('textbox', {name: 'Private selection'})).toHaveValue('');
  });

  it('provides account recovery links without an automatic privilege-grant control', () => {
    auth.me = {...admin, is_admin: false};
    render(view());
    expect(screen.getByRole('link', {name: '비밀번호를 재설정', hidden: true})).toHaveAttribute('href', '/forgot-password');
    expect(screen.getByText(/이 화면에서 권한을 자동으로 추가하지 않습니다/)).toBeInTheDocument();
    expect(mock.refresh).not.toHaveBeenCalled();
  });
});
