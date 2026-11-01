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
  { id: string } | { from: string; until: string; companyId?: string };
type Result = { items: CalendarEntry[]; truncated: boolean };

/** Uses the signed-in user's JWT and existing calendar RLS, never a service key. */
export function useCalendarData(query: Query | null) {
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
        }
        const response = await request
          .order("occurs_on")
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
  }, [key, token, revision]);
  // Never show a previous account's or previous range's records during a transition.
  const current = state.key === key && state.token === token;
  return {
    data: current ? state.data : null,
    loading: Boolean(token && query && (!current || state.loading)),
    error: current ? state.error : "",
    reload,
  };
}
