"use client";

import { useCallback, useEffect } from "react";
import { useAuth } from "@/components/auth";
import { pageDataCache } from "@/lib/page-data-cache";
import { usePrefs } from "@/workspace/preferences";
import { homeRolloutMode, resolveHomeVariant } from "./home-variant";
import { navigationPaths, prefetchNavigation, type NavigationPath } from "./navigation-data";

export function useNavigationPrefetch(path: string) {
  const { token, me } = useAuth();
  const { value, loaded } = usePrefs();
  const userId = me?.id;
  const enabled = Boolean(token && me?.onboarding_completed && loaded);
  const warm = useCallback((href: NavigationPath) => {
    if (!enabled || !token || !pageDataCache.isCurrent(token)) return Promise.resolve();
    // Read the current preview at intent time; query-only preview switches do not
    // change the pathname or rerun the shell's navigation effect.
    const variant = resolveHomeVariant({
      userId: userId ?? "", isAdmin: me?.is_admin ?? false,
      preview: path === "/today" ? new URLSearchParams(window.location.search).get("home_preview") : null,
      mode: homeRolloutMode(process.env.NEXT_PUBLIC_HOME_AB_MODE),
    }).variant;
    return prefetchNavigation(token, href, { timezone: value.timezone, homeVariant: variant });
  }, [enabled, token, value.timezone, userId, me?.is_admin, path]);

  useEffect(() => {
    if (!enabled) return;
    // Respect reduced-data connections; hover/focus can still express intent.
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    if (connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType ?? "")) return;
    let active = true;
    let running = false;
    let resume = false;
    let timer: number | undefined;
    let idle: number | undefined;
    const visible = () => document.visibilityState !== "hidden";
    const run = async () => {
      if (running || !active || !visible()) return;
      running = true;
      try {
        // Home is the first destination to prepare on other routes. On Home this
        // joins its critical requests before an expensive all-company overview.
        const ordered = ["/today" as const, ...navigationPaths.filter(href => href !== "/today" && href !== path)];
        for (const href of ordered) {
          if (!active || !visible()) return;
          await warm(href);
        }
      } finally {
        running = false;
        if (resume && active && visible()) {
          resume = false;
          schedule();
        }
      }
    };
    const schedule = () => {
      if (!active || !visible() || timer !== undefined || idle !== undefined) return;
      if (running) { resume = true; return; }
      timer = window.setTimeout(() => {
        timer = undefined;
        if ("requestIdleCallback" in window) idle = window.requestIdleCallback(() => {
          idle = undefined;
          void run();
        }, { timeout: 1500 });
        else void run();
      }, 500);
    };
    const visibility = () => {
      if (visible()) schedule();
      else {
        window.clearTimeout(timer);
        timer = undefined;
        if (idle !== undefined) window.cancelIdleCallback(idle);
        idle = undefined;
      }
    };
    schedule();
    document.addEventListener("visibilitychange", visibility);
    return () => {
      active = false;
      window.clearTimeout(timer);
      if (idle !== undefined) window.cancelIdleCallback(idle);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [enabled, path, warm]);
  return warm;
}
