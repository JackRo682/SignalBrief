"use client";

import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { useAuth } from "@/components/auth";
import { initializeSupabase } from "@/lib/supabase";
import {
  calendarEntrySchema,
  isoDaySchema,
  type CalendarEntry,
} from "./calendar-utils";

const fields =
  "id,title,occurs_on,company_id,event_id,origin,quote,source_url,source_timezone,verified_at";
type Query =
  | { id: string }
  | {
      from: string;
      until: string;
      companyId?: string;
      companyIds?: string[];
      includePersonal?: boolean;
      order?: "asc" | "desc";
    };
type Result = { items: CalendarEntry[]; truncated: boolean };

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

/** Coverage is independent of date reads: a provider outage never erases verified dates. */
export function useCalendarCoverage(companyId: string | null, enabled = true) {
  const { token } = useAuth();
  const [revision, setRevision] = useState(0);
  const [collectionRevision, setCollectionRevision] = useState(0);
  const [state, setState] = useState<{
    key: string; data: z.infer<typeof coverageSchema> | null; error: string; polling: boolean;
  }>({ key: "", data: null, error: "", polling: false });
  const key = JSON.stringify([token, companyId, revision, enabled]);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    if (!token || !enabled) return;
    let alive = true;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    void (async () => {
      try {
        if (companyId) z.string().uuid().parse(companyId);
        const db = await initializeSupabase();
        // Poll only a server-confirmed pending collection, at most 12 more times.
        // Each completed poll refreshes the independent date queries; no provider
        // requests or queue writes are initiated by this read-only status hook.
        for (let poll = 0; poll <= 12 && alive; poll++) {
          const response = await db.rpc("sb_calendar_coverage", { p_company_id: companyId })
            .abortSignal(AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]));
          if (response.error) throw new Error("coverage_unavailable");
          const data = coverageSchema.parse(response.data);
          if (!alive) return;
          const pending = companyId ? data.selected?.pending === true : data.pending_companies > 0;
          const polling = pending && poll < 12;
          setState({ key, data, error: "", polling });
          if (poll > 0) setCollectionRevision(value => value + 1);
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
  }, [token, companyId, revision, key, enabled]);
  const current = state.key === key;
  return {
    data: current ? state.data : null,
    error: current ? state.error : "",
    loading: Boolean(enabled && token && !current),
    polling: current && state.polling,
    collectionRevision,
    reload,
  };
}

/** Uses the signed-in user's JWT and existing calendar RLS, never a service key. */
export function useCalendarData(query: Query | null, collectionRevision = 0) {
  const { token } = useAuth();
  const key = JSON.stringify(query);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{
    key: string;
    token: string | null;
    data: Result | null;
    loading: boolean;
    error: string;
  }>({ key: "", token: null, data: null, loading: false, error: "" });
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    if (!token || key === "null") {
      setState({ key, token, data: null, loading: false, error: "" });
      return;
    }
    setState({ key, token, data: null, loading: true, error: "" });
    void (async () => {
      try {
        const input = JSON.parse(key) as Query;
        const companyIds = "id" in input || input.companyIds === undefined
          ? undefined
          : z.array(z.string().uuid()).max(500).parse(input.companyIds);
        if (!("id" in input)) {
          const from = isoDaySchema.parse(input.from), until = isoDaySchema.parse(input.until);
          if (from > until) throw new Error("Invalid range");
          if (companyIds?.length === 0 && input.includePersonal === false) {
            if (alive) setState({ key, token, data: { items: [], truncated: false }, loading: false, error: "" });
            return;
          }
        }
        const db = await initializeSupabase();
        // calendar_items is RLS-protected: verified official rows, or this user's own rows.
        let request = db
          .from("calendar_items")
          .select(fields)
          .eq("calendar_status", "confirmed");
        if ("id" in input)
          request = request.eq("id", z.string().uuid().parse(input.id));
        else {
          const from = isoDaySchema.parse(input.from),
            until = isoDaySchema.parse(input.until);
          if (from > until) throw new Error("Invalid range");
          request = request.gte("occurs_on", from).lte("occurs_on", until);
          if (input.companyId)
            request = request.eq(
              "company_id",
              z.string().uuid().parse(input.companyId),
            );
          // Filter before LIMIT: unrelated companies must not displace selected dates.
          if (companyIds !== undefined) {
            if (input.includePersonal !== false) {
              request = companyIds.length
                ? request.or(`origin.eq.user,company_id.in.(${companyIds.join(",")})`)
                : request.eq("origin", "user");
            } else request = request.in("company_id", companyIds).neq("origin", "user");
          } else if (input.includePersonal === false) request = request.neq("origin", "user");
        }
        const response = await request
          .order("occurs_on", { ascending: "id" in input || input.order !== "desc" })
          .order("id")
          .limit("id" in input ? 1 : 501)
          .abortSignal(
            AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]),
          );
        if (response.error)
          throw new Error("일정을 불러오지 못했습니다. 다시 시도해 주세요.");
        const entries = z.array(calendarEntrySchema).parse(response.data);
        if (alive)
          setState({
            key,
            token,
            data: {
              items: entries.slice(0, 500),
              truncated: entries.length > 500,
            },
            loading: false,
            error: "",
          });
      } catch (error) {
        if (alive)
          setState({
            key,
            token,
            data: null,
            loading: false,
            error:
              error instanceof Error && error.message.startsWith("일정")
                ? error.message
                : "일정 데이터와 연결 상태를 확인해 주세요.",
          });
      }
    })();
    return () => {
      alive = false;
      controller.abort();
    };
  }, [key, token, revision, collectionRevision]);
  // Never show a previous account's or previous range's records during a transition.
  const current = state.key === key && state.token === token;
  return {
    data: current ? state.data : null,
    loading: Boolean(token && query && (!current || state.loading)),
    error: current ? state.error : "",
    reload,
  };
}
