'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/components/auth';
import WorkspaceLoading from '@/components/workspace-loading';
import Home from './home';
import HomeB from './home-b';
import { HOME_EXPERIMENT_ID, homeRolloutMode, resolveHomeVariant, type HomeVariant } from './home-variant';
import './home-experiment.css';

export default function HomeExperiment() {
  const auth = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  // Read directly so Next.js can inline this public, non-secret build-time setting.
  const mode = homeRolloutMode(process.env.NEXT_PUBLIC_HOME_AB_MODE);
  // Never flash A before authentication resolves or briefly render a previous account.
  if (auth.loading || !auth.me?.onboarding_completed) {
    return <WorkspaceLoading error={auth.loading ? null : auth.error} />;
  }
  const selection = resolveHomeVariant({
    userId: auth.me.id, isAdmin: auth.me.is_admin,
    preview: params.get('home_preview'), mode,
  });
  function preview(variant: HomeVariant | null) {
    const next = new URLSearchParams(params.toString());
    if (variant) next.set('home_preview', variant);
    else next.delete('home_preview');
    const query = next.toString();
    router.replace(`/today${query ? `?${query}` : ''}`, { scroll: false });
  }
  return <>
    {/* Inspection metadata only. This is NOT an analytics exposure or conversion event. */}
    <span hidden data-home-experiment={HOME_EXPERIMENT_ID}
      data-home-variant={selection.variant} data-home-preview={String(selection.isPreview)} />
    {auth.me.is_admin && <section className="sb-home-experiment-tools" aria-label="관리자 홈 화면 비교">
      <div><strong>홈 화면 비교</strong><span aria-live="polite">
        {mode !== 'split' ? `${mode} 고정 모드` : selection.isPreview
          ? `${selection.variant} 미리보기 · 실제 배정은 ${selection.assigned}`
          : `자동 배정: ${selection.variant} · 사용자별 약 50:50`}
      </span></div>
      <div role="group" aria-label="홈 디자인 미리보기">
        <button type="button" aria-pressed={!selection.isPreview} disabled={mode !== 'split'} onClick={() => preview(null)}>자동 배정</button>
        {(['A', 'B'] as const).map(variant => <button key={variant} type="button"
          aria-pressed={selection.isPreview && selection.variant === variant}
          disabled={mode !== 'split'} onClick={() => preview(variant)}>{variant} 미리보기</button>)}
      </div>
    </section>}
    {selection.variant === 'A' ? <Home key={auth.me.id} /> : <HomeB key={auth.me.id} />}
  </>;
}
