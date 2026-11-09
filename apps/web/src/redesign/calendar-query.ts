"use client";

import { z } from "zod";
import { pageDataCache } from "@/lib/page-data-cache";
import { initializeSupabase } from "@/lib/supabase";
import { calendarEntrySchema, isoDaySchema, type CalendarEntry } from "./calendar-utils";

export type CalendarQuery =
  | { id: string }
  | {
      from: string;
      until: string;
      companyId?: string;
      companyIds?: string[];
      includePersonal?: boolean;
      order?: "asc" | "desc";
    };
export type CalendarResult = { items: CalendarEntry[]; truncated: boolean };
const fields =
  "id,title,occurs_on,company_id,event_id,origin,quote,source_url,source_timezone,verified_at";

/** Equivalent scopes share a result; different dates, users and personal scopes never do. */
export function calendarDataKey(query: CalendarQuery) {
  return "calendar-data:" + JSON.stringify("id" in query ? { id: query.id } : {
    from: query.from,
    until: query.until,
    companyId: query.companyId ?? "",
    companyIds: query.companyIds === undefined ? null : [...query.companyIds].sort(),
    includePersonal: query.includePersonal !== false,
    order: query.order ?? "asc",
  });
}

/** Shared bounded read used by the screen and navigation prefetch; all existing RLS applies. */
export function loadCalendarData(token: string, input: CalendarQuery): Promise<CalendarResult> {
  const key = calendarDataKey(input);
  return pageDataCache.request(token, key, "GET", async () => {
    const companyIds = "id" in input || input.companyIds === undefined
      ? undefined
      : [...new Set(z.array(z.string().uuid()).max(500).parse(input.companyIds))].sort();
    if (!("id" in input)) {
      const from = isoDaySchema.parse(input.from), until = isoDaySchema.parse(input.until);
      if (from > until) throw new Error("Invalid range");
      if (input.companyId) z.string().uuid().parse(input.companyId);
      if (companyIds?.length === 0 && input.includePersonal === false)
        return { items: [], truncated: false };
    } else z.string().uuid().parse(input.id);

    const db = await initializeSupabase();
    // calendar_items is RLS-protected: verified official rows, or this user's own rows.
    let request = db.from("calendar_items").select(fields).eq("calendar_status", "confirmed");
    if ("id" in input) request = request.eq("id", input.id);
    else {
      request = request.gte("occurs_on", input.from).lte("occurs_on", input.until);
      if (input.companyId) request = request.eq("company_id", input.companyId);
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
      // One consumer leaving a tab must not abort a request shared with another reader.
      .abortSignal(AbortSignal.timeout(20000));
    if (response.error) throw new Error("일정을 불러오지 못했습니다. 다시 시도해 주세요.");
    const entries = z.array(calendarEntrySchema).parse(response.data);
    return { items: entries.slice(0, 500), truncated: entries.length > 500 };
  });
}
