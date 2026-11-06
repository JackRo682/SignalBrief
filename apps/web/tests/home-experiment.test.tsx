import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import HomeExperiment from '@/redesign/home-experiment';

const state = vi.hoisted(() => ({
  me: null as null | { id: string; is_admin: boolean; onboarding_completed: boolean },
  loading: false, error: null as string | null, query: '', replace: vi.fn(),
}));
vi.mock('@/components/auth', () => ({ useAuth: () => ({ me: state.me, loading: state.loading, error: state.error }) }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: state.replace }),
  useSearchParams: () => new URLSearchParams(state.query),
}));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
vi.mock('@/components/workspace-loading', () => ({ default: () => <div role="status">Loading</div> }));
vi.mock('@/redesign/home', () => ({ default: () => <div className="rd-home" data-testid="original-home">Shared real home renderer</div> }));
const a = '00000000-0000-4000-8000-000000000001';
const b = '00000000-0000-4000-8000-000000000002';
function user(id = a, admin = false) { return { id, is_admin: admin, onboarding_completed: true }; }
function marker(container: HTMLElement) { return container.querySelector('[data-home-experiment]'); }

beforeEach(() => {
  state.me = user(); state.loading = false; state.error = null; state.query = ''; state.replace.mockReset();
  vi.stubEnv('NEXT_PUBLIC_HOME_AB_MODE', 'split');
});
afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

describe('home experiment rendering', () => {
  it('preserves A as a direct child with only one mounted data renderer', () => {
    const { container } = render(<HomeExperiment />);
    expect(marker(container)?.getAttribute('data-home-variant')).toBe('A');
    expect(container.querySelector(':scope > .rd-home')).not.toBeNull();
    expect(container.querySelector('.sb-home-b')).toBeNull();
    expect(screen.getAllByTestId('original-home')).toHaveLength(1);
    expect(screen.queryByRole('region', { name: '관리자 홈 화면 비교' })).toBeNull();
  });
  it('renders B with the same single data renderer and functional navigation', () => {
    state.me = user(b);
    const { container } = render(<HomeExperiment />);
    expect(marker(container)?.getAttribute('data-home-variant')).toBe('B');
    expect(container.querySelector('.sb-home-b .rd-home')).not.toBeNull();
    expect(screen.getAllByTestId('original-home')).toHaveLength(1);
    expect(screen.getByRole('link', { name: /저장한 자료/ }).getAttribute('href')).toBe('/saved');
    expect(screen.getByRole('link', { name: /최근 소식으로 이동/ }).getAttribute('href')).toBe('#recent-activity');
  });
  it('does not render A while authentication or onboarding is unresolved', () => {
    state.loading = true;
    const { container, rerender } = render(<HomeExperiment />);
    expect(marker(container)).toBeNull();
    expect(screen.queryByTestId('original-home')).toBeNull();
    state.loading = false; state.me = null; rerender(<HomeExperiment />);
    expect(screen.queryByTestId('original-home')).toBeNull();
    state.me = { ...user(), onboarding_completed: false }; rerender(<HomeExperiment />);
    expect(screen.queryByTestId('original-home')).toBeNull();
  });
  it('keeps assignment over rerenders and handles account changes and logout', () => {
    const { container, rerender } = render(<HomeExperiment />);
    rerender(<HomeExperiment />);
    expect(marker(container)?.getAttribute('data-home-variant')).toBe('A');
    state.me = user(b); rerender(<HomeExperiment />);
    expect(marker(container)?.getAttribute('data-home-variant')).toBe('B');
    state.me = null; rerender(<HomeExperiment />);
    expect(marker(container)).toBeNull();
    expect(screen.queryByTestId('original-home')).toBeNull();
  });
  it('rejects ordinary-user query overrides', () => {
    state.query = 'home_preview=B';
    const { container } = render(<HomeExperiment />);
    expect(marker(container)?.getAttribute('data-home-variant')).toBe('A');
    expect(marker(container)?.getAttribute('data-home-preview')).toBe('false');
    expect(screen.queryByRole('button', { name: 'B 미리보기' })).toBeNull();
  });
  it('allows administrator previews and preserves unrelated query parameters', () => {
    state.me = user(a, true); state.query = 'home_preview=B&keep=1';
    const { container } = render(<HomeExperiment />);
    expect(marker(container)?.getAttribute('data-home-variant')).toBe('B');
    expect(marker(container)?.getAttribute('data-home-preview')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '자동 배정' }));
    expect(state.replace).toHaveBeenLastCalledWith('/today?keep=1', { scroll: false });
    fireEvent.click(screen.getByRole('button', { name: 'A 미리보기' }));
    expect(state.replace).toHaveBeenLastCalledWith('/today?home_preview=A&keep=1', { scroll: false });
  });
  it('forces A when disabled and does not expose misleading preview controls', () => {
    vi.stubEnv('NEXT_PUBLIC_HOME_AB_MODE', 'A'); state.me = user(b, true); state.query = 'home_preview=B';
    const { container } = render(<HomeExperiment />);
    expect(marker(container)?.getAttribute('data-home-variant')).toBe('A');
    expect((screen.getByRole('button', { name: 'B 미리보기' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
