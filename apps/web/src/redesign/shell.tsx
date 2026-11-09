"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import { useAuth } from "@/components/auth";
import { Icon } from "@/components/icons";
import WorkspaceLoading from "@/components/workspace-loading";
import { useContentNotifications } from "@/workspace/notification-state";
import { Notice, useMutation } from "@/workspace/ui";
import { SearchForm } from "./ui";
import { useNavigationPrefetch } from "./use-navigation-prefetch";
import "./styles.css";

const links = [
  ["/today", "홈"],
  ["/explore", "기업"],
  ["/watchlist", "관심 기업"],
  ["/calendar", "캘린더"],
  ["/saved", "저장"],
] as const;
export default function RedesignShell({ children }: { children: ReactNode }) {
  const auth = useAuth(),
    path = usePathname(),
    router = useRouter(),
    action = useMutation(),
    profile = useRef<HTMLDetailsElement>(null);
  const alerts = useContentNotifications(Boolean(auth.me?.onboarding_completed));
  const prefetch = useNavigationPrefetch(path);
  useEffect(() => {
    if (!auth.loading && !auth.token)
      router.replace(
        `/login?next=${encodeURIComponent(path + window.location.search)}`,
      );
    else if (auth.me && !auth.me.onboarding_completed)
      router.replace("/onboarding");
  }, [auth.loading, auth.token, auth.me, path, router]);
  useEffect(() => {
    if (profile.current) profile.current.open = false;
  }, [path]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        document.querySelector<HTMLInputElement>(".rd-header input")?.focus();
      }
      if (e.key === "Escape" && profile.current?.open) {
        profile.current.open = false;
        profile.current.querySelector("summary")?.focus();
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("keydown", key);
    };
  }, []);
  if (!auth.me?.onboarding_completed)
    return <WorkspaceLoading error={auth.loading ? null : auth.error} />;
  const active = (href: string) =>
    href === "/explore"
      ? /^\/(explore|companies|documents|search)(\/|$)/.test(path)
      : href === "/calendar"
        ? /^\/(calendar|events)(\/|$)/.test(path)
        : path === href;
  return (
    <div className="sb-redesign">
      <a className="rd-skip" href="#rd-main">
        본문으로 이동
      </a>
      <header className="rd-header">
        <Link href="/today" className="rd-brand" aria-label="SignalBrief 홈">
          <svg width="30" height="32" viewBox="0 0 30 32" aria-hidden="true">
            <rect x="1" y="18" width="6" height="13" rx="2" fill="#3375ff" />
            <rect x="11" y="10" width="6" height="21" rx="2" fill="#3375ff" />
            <rect x="21" y="2" width="6" height="29" rx="2" fill="#3375ff" />
          </svg>
          <strong>SignalBrief</strong>
        </Link>
        <nav aria-label="주 메뉴">
          {links.map(([href, title]) => (
            <Link
              key={href}
              href={href}
              className={active(href) ? "active" : ""}
              aria-current={active(href) ? "page" : undefined}
              onPointerEnter={() => { void prefetch(href); }}
              onFocus={() => { void prefetch(href); }}
              onTouchStart={() => { void prefetch(href); }}
            >
              {title}
            </Link>
          ))}
        </nav>
        <div className="rd-header-tools">
          <SearchForm compact />
          <Link
            className="rd-icon rd-bell"
            href="/alerts"
            aria-label={`알림${alerts.data?.unread_count ? ` · 읽지 않음 ${alerts.data.unread_count}개` : ""}`}
          >
            <Icon name="bell" size={24} />
            {Boolean(alerts.data?.unread_count) && <i />}
          </Link>
          <details ref={profile} className="rd-profile">
            <summary aria-label="계정 메뉴">
              <span>{auth.me.display_name.slice(0, 1)}</span>
            </summary>
            <div>
              <strong>{auth.me.display_name}</strong>
              <Link href="/settings/account">계정 설정</Link>
              <Link href="/settings/notifications">알림 설정</Link>
              <Link href="/help">도움말</Link>
              {auth.me.is_admin && <Link href="/ops">운영 현황</Link>}
              <button
                type="button"
                disabled={action.busy}
                onClick={() =>
                  void action.run(async () => {
                    await auth.logout();
                    router.replace("/login");
                  })
                }
              >
                로그아웃
              </button>
              <Notice action={action} />
            </div>
          </details>
        </div>
      </header>
      <main id="rd-main" className="rd-main" key={auth.me.id}>
        {children}
      </main>
    </div>
  );
}
