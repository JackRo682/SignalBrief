import Link from 'next/link';

export default function WorkspaceLoading({ error }: { error?: string | null }) {
  return <main className="referenceLoadingShell" aria-busy={!error}>
    <aside className="referenceLoadingSidebar"><Link href="/" className="auth-brand">SignalBrief</Link></aside>
    <section className="referenceLoadingMain">
      {error ? <div className="login-box"><h2>로그인 연결을 확인해 주세요</h2><p role="alert">{error}</p><Link href="/login" className="button primary">로그인으로 이동</Link></div> : <div role="status">
        <div className="referenceLoadingBar short" /><div className="referenceLoadingBar" /><div className="referenceLoadingCard" />
        <span className="sr-only">페이지를 불러오는 중</span>
      </div>}
    </section>
  </main>;
}
