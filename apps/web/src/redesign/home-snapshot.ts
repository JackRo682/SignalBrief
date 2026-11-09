"use client";

import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { useAuth } from "@/components/auth";
import { pageDataCache } from "@/lib/page-data-cache";
import { workspace } from "@/workspace/client";
import { homeSnapshotSchema, type HomeSnapshot } from "./home-snapshot-contract";

export const homeSnapshotRequest = (today: string) => ({
  action: "home_snapshot", p: { today },
}) as const;
export const homeSnapshotKey = (today: string) =>
  "workspace:" + JSON.stringify(homeSnapshotRequest(today));

let knownScope: string | null = null;
const knownKeys = new Map<string, { onboardingConfirmed: boolean }>();
function remember(token: string, key: string) {
  if (knownScope !== token) {
    knownScope = token;
    knownKeys.clear();
  }
  if (!knownKeys.has(key)) knownKeys.set(key, { onboardingConfirmed: false });
  // Only current/recent date windows can still be displayed by the shared cache.
  if (knownKeys.size > 8) knownKeys.delete(knownKeys.keys().next().value!);
  return knownKeys.get(key)!;
}

export function confirmHomeSnapshotReadiness(token: string, today: string) {
  if (pageDataCache.isCurrent(token)) remember(token, homeSnapshotKey(today)).onboardingConfirmed = true;
}

/** The two designs share the same validated response, including in-flight reads. */
export function loadHomeSnapshot(token: string, today: string, onboardingConfirmed = true): Promise<HomeSnapshot> {
  const key = homeSnapshotKey(today);
  if (!pageDataCache.isCurrent(token)) return Promise.reject(new Error("home_scope_changed"));
  const readiness = remember(token, key);
  if (onboardingConfirmed) readiness.onboardingConfirmed = true;
  return pageDataCache.request(token, key, "GET", async () => {
    const startedReady = readiness.onboardingConfirmed;
    const fetchSnapshot = () => workspace(token, homeSnapshotRequest(today), homeSnapshotSchema, AbortSignal.timeout(25000));
    let data: HomeSnapshot;
    try { data = await fetchSnapshot(); }
    catch (error) {
      // /me may initialize an existing account while the early read is pending.
      // Retry only this prerequisite failure, once, after verified onboarding.
      if (!startedReady && readiness.onboardingConfirmed && pageDataCache.isCurrent(token) &&
          error && typeof error === "object" && "status" in error && error.status === 403 &&
          "code" in error && error.code === "onboarding_required") data = await fetchSnapshot();
      else throw error;
    }
    if (data.today !== today) throw new z.ZodError([{
      code: "custom", path: ["today"], message: "Home response does not match the requested day",
    }]);
    return data;
  });
}

/** Keep a later Home mount from restoring notifications acknowledged elsewhere. */
export function updateHomeSnapshotNotifications(
  token: string,
  update: (notifications: HomeSnapshot["notifications"]) => HomeSnapshot["notifications"],
) {
  if (!pageDataCache.isCurrent(token) || knownScope !== token) return;
  for (const key of knownKeys.keys()) {
    // Replacing the cache entry also detaches a snapshot started before the write.
    pageDataCache.update<HomeSnapshot>(token, key,
      data => data ? { ...data, notifications: update(data.notifications) } : undefined);
  }
}

/** Rollout/service failures can use the existing reads; authorization failures cannot. */
export function canFallbackFromHomeSnapshot(error: unknown): boolean {
  if (error instanceof z.ZodError) return true;
  if (error && typeof error === "object" && "status" in error) {
    const status = Number(error.status);
    if ([401, 403, 429].includes(status)) return false;
    const code = "code" in error ? error.code : undefined;
    return status >= 500 && status <= 599 ||
      [404, 422].includes(status) && code === "unsupported_action";
  }
  return error instanceof TypeError || (error instanceof Error || error instanceof DOMException) &&
    ["AbortError", "TimeoutError"].includes(error.name);
}

export type HomeSnapshotState = {
  data: HomeSnapshot | null;
  loading: boolean;
  error: string;
  fallback: boolean;
  reload: () => void;
};

export function useHomeSnapshot(today: string): HomeSnapshotState {
  const { token } = useAuth();
  const key = homeSnapshotKey(today);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{
    scope: string | null; key: string; data: HomeSnapshot | null; loading: boolean; error: unknown;
  }>({ scope: null, key: "", data: null, loading: false, error: null });
  const snapshot = token ? pageDataCache.peek<HomeSnapshot>(token, key) : undefined;
  const current = state.scope === token && state.key === key;
  const data = current ? state.data ?? snapshot ?? null : snapshot ?? null;
  const error = current ? state.error : null;
  const reload = useCallback(() => {
    pageDataCache.invalidate(token, key);
    setRevision(value => value + 1);
  }, [token, key, setRevision]);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    const saved = pageDataCache.peek<HomeSnapshot>(token, key);
    setState({ scope: token, key, data: saved ?? null, loading: !saved, error: null });
    // Auth's token-reset effects run before this shared request starts.
    void Promise.resolve().then(() => {
      if (!alive || !pageDataCache.isCurrent(token)) return;
      return loadHomeSnapshot(token, today)
        .then(value => { if (alive && pageDataCache.isCurrent(token)) setState({ scope: token, key, data: value, loading: false, error: null }); })
        .catch((failure: unknown) => {
          if (alive && pageDataCache.isCurrent(token)) setState({ scope: token, key,
            data: pageDataCache.peek<HomeSnapshot>(token, key) ?? null, loading: false, error: failure });
        });
    });
    return () => { alive = false; };
  }, [token, today, key, revision]);

  return {
    data,
    loading: Boolean(token && !data && (!current || state.loading)),
    error: error instanceof Error ? error.message : error ? "홈 데이터를 불러오지 못했습니다." : "",
    fallback: !data && canFallbackFromHomeSnapshot(error),
    reload,
  };
}

export function homeSnapshotSlice<K extends keyof HomeSnapshot>(state: HomeSnapshotState, field: K) {
  return { data: state.data?.[field] ?? null, loading: state.loading,
    error: state.data ? "" : state.error, reload: state.reload };
}
