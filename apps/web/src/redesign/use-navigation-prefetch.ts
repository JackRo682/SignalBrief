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
  const variant = resolveHomeVariant({
    userId: userId ?? "", isAdmin: false, preview: null,
    mode: homeRolloutMode(process.env.NEXT_PUBLIC_HOME_AB_MODE),
  }).variant;
  const warm = useCallback((href: NavigationPath) => {
    if (!enabled || !token || !pageDataCache.isCurrent(token)) return Promise.resolve();
    return prefetchNavigation(token, href, { timezone: value.timezone, homeVariant: variant });
  }, [enabled, token, value.timezone, variant]);

  useEffect(() => {
    if (!enabled) return;
    // Respect reduced-data connections; hover/focus can still express intent.
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    if (connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType ?? "")) return;
    let active = true;
    let idle: number | undefined;
    const run = async () => {
      // Start with the next primary tab. Sequential groups avoid competing with
      // the visible screen's initial requests or warming every route at once.
      const index = navigationPaths.indexOf(path as NavigationPath);
      const ordered = [...navigationPaths.slice(index + 1), ...navigationPaths.slice(0, Math.max(index, 0))];
      for (const href of ordered) {
        if (!active || document.visibilityState === "hidden") return;
        await warm(href);
      }
    };
    const timer = window.setTimeout(() => {
      if ("requestIdleCallback" in window) idle = window.requestIdleCallback(() => { void run(); }, { timeout: 1500 });
      else void run();
    }, 500);
    return () => {
      active = false;
      window.clearTimeout(timer);
      if (idle !== undefined) window.cancelIdleCallback(idle);
    };
  }, [enabled, path, warm]);
  return warm;
}
