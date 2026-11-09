"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { useAuth } from "@/components/auth";
import { initializeSupabase } from "@/lib/supabase";
import { pageDataCache } from "@/lib/page-data-cache";
import { calendarDataKey, loadCalendarData, type CalendarQuery, type CalendarResult } from "./calendar-query";
export { calendarDataKey, loadCalendarData, type CalendarQuery, type CalendarResult } from "./calendar-query";

const coverageSchema = z.object({
  registered_companies: z.number().int().nonnegative(),
  covered_companies: z.number().int().nonnegative(),
  pending_companies: z.number().int().nonnegative().default(0),
  pending_company_ids: z.array(z.string().uuid()).default([]),
  selected: z.object({
    company_id: z.string().uuid(),
    source_count: z.number().int().nonnegative(),
    last_success_at: z.string().nullable(),
    has_error: z.boolean(),
    pending: z.boolean().default(false),
  }).nullable(),
});
type Coverage = z.infer<typeof coverageSchema>;
export const calendarCoverageKey = (companyId: string | null) => `calendar-coverage:${companyId ?? "all"}`;
export function loadCalendarCoverage(token: string, companyId: string | null) {
  return pageDataCache.request(token, calendarCoverageKey(companyId), "GET", async () => {
    if (companyId) z.string().uuid().parse(companyId);
    const db = await initializeSupabase();
    const response = await db.rpc("sb_calendar_coverage", { p_company_id: companyId })
      .abortSignal(AbortSignal.timeout(20000));
    if (response.error) throw new Error("coverage_unavailable");
    return coverageSchema.parse(response.data);
  });
}

/** Coverage is independent of date reads: a provider outage never erases verified dates. */
export function useCalendarCoverage(companyId: string | null, enabled = true) {
  const { token } = useAuth();
  const [revision, setRevision] = useState(0);
  const [collectionRevision, setCollectionRevision] = useState(0);
  const [state, setState] = useState<{
    key: string; data: Coverage | null; error: string; polling: boolean;
  }>({ key: "", data: null, error: "", polling: false });
  const key = JSON.stringify([token, companyId, revision, enabled]);
  const cacheKey = calendarCoverageKey(companyId);
  const snapshot = token && enabled ? pageDataCache.peek<Coverage>(token, cacheKey) : undefined;
  const reload = useCallback(() => {
    if (token) pageDataCache.invalidate(token, cacheKey);
    setRevision((value) => value + 1);
  }, [token, cacheKey]);
  useEffect(() => {
    if (!token || !enabled) return;
    let alive = true;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    void (async () => {
      try {
        const saved = pageDataCache.peek<Coverage>(token, cacheKey);
        const wasPending = companyId ? saved?.selected?.pending === true : (saved?.pending_companies ?? 0) > 0;
        // Poll only a server-confirmed pending collection, at most 12 more times.
        // Each completed poll refreshes the independent date queries; no provider
        // requests or queue writes are initiated by this read-only status hook.
        for (let poll = 0; poll <= 12 && alive; poll++) {
          if (poll > 0) pageDataCache.invalidate(token, cacheKey);
          const data = await loadCalendarCoverage(token, companyId);
          if (!alive) return;
          const pending = companyId ? data.selected?.pending === true : data.pending_companies > 0;
          const polling = pending && poll < 12;
          setState({ key, data, error: "", polling });
          if (poll > 0 || (wasPending && !pending)) setCollectionRevision(value => value + 1);
          if (!polling) return;
          await new Promise<void>(resolve => {
            const cancel = () => { clearTimeout(timer); resolve(); };
            timer = setTimeout(() => {
              controller.signal.removeEventListener("abort", cancel);
              resolve();
            }, 10000);
            controller.signal.addEventListener("abort", cancel, { once: true });
          });
        }
      } catch {
        if (alive) setState({ key, data: null, error: "공식 일정 수집 범위를 확인하지 못했습니다. 일정 목록은 별도로 조회합니다.", polling: false });
      }
    })();
    return () => { alive = false; clearTimeout(timer); controller.abort(); };
  }, [token, companyId, revision, key, enabled, cacheKey]);
  const current = state.key === key;
  const data = current && state.data !== null ? state.data : snapshot ?? null;
  return {
    data,
    error: current ? state.error : "",
    loading: Boolean(enabled && token && !data && !current),
    polling: current && state.polling,
    collectionRevision,
    reload,
  };
}

/** Uses the signed-in user's JWT and existing calendar RLS, never a service key. */
export function useCalendarData(query: CalendarQuery | null, collectionRevision = 0) {
  const { token } = useAuth();
  const serialized = JSON.stringify(query);
  const key = query ? calendarDataKey(query) : "";
  const [revision, setRevision] = useState(0);
  const previousCollection = useRef<{ token: string | null; revision: number } | null>(null);
  const [state, setState] = useState<{
    key: string;
    token: string | null;
    data: CalendarResult | null;
    loading: boolean;
    error: string;
  }>({ key: "", token: null, data: null, loading: false, error: "" });
  const snapshot = token && query ? pageDataCache.peek<CalendarResult>(token, key) : undefined;
  const current = state.key === key && state.token === token;
  const data = current && state.data !== null ? state.data : snapshot ?? null;
  const reload = useCallback(() => {
    if (token && key) pageDataCache.invalidate(token, key);
    setRevision((value) => value + 1);
  }, [token, key, setRevision]);
  useEffect(() => {
    let alive = true;
    if (!token || serialized === "null") {
      previousCollection.current = { token, revision: collectionRevision };
      setState({ key, token, data: null, loading: false, error: "" });
      return;
    }
    // A collector completion is new evidence even while the last read is still fresh.
    if (previousCollection.current?.token === token &&
        previousCollection.current.revision !== collectionRevision)
      pageDataCache.invalidate(token, key);
    previousCollection.current = { token, revision: collectionRevision };
    const saved = pageDataCache.peek<CalendarResult>(token, key);
    setState({ key, token, data: saved ?? null, loading: saved === undefined, error: "" });
    void Promise.resolve().then(() => {
      if (!alive) return;
      return loadCalendarData(token, JSON.parse(serialized) as CalendarQuery)
        .then((value) => {
          if (alive) setState({ key, token, data: value, loading: false, error: "" });
        })
        .catch((error: unknown) => {
          if (alive) setState({
            key, token, data: pageDataCache.peek<CalendarResult>(token, key) ?? null, loading: false,
            error: error instanceof Error && error.message.startsWith("일정")
              ? error.message : "일정 데이터와 연결 상태를 확인해 주세요.",
          });
        });
    });
    // The request belongs to the shared cache. Only this view's continuation ends.
    return () => { alive = false; };
  }, [key, serialized, token, revision, collectionRevision]);
  return {
    data,
    loading: Boolean(token && query && !data && (!current || state.loading)),
    error: current ? state.error : "",
    reload,
  };
}
