import type { z } from "zod";
import type { Company } from "@/lib/contracts";
import type { NewsResponse } from "@/lib/news-contract";
import {
  resourceHref,
  type monitoringSchema,
  type Resource,
  type verifiedCalendarSchema,
} from "@/workspace/contracts";
import { calendarHref, dayInZone, type CalendarEntry } from "./calendar-utils";

export type ActivityKind = "document" | "analysis" | "news" | "calendar";
export type HomeActivity = {
  key: string;
  kind: ActivityKind;
  companyId: string;
  companyName: string;
  ticker: string;
  title: string;
  href: string;
  date: string | null;
  precision: string;
  external: boolean;
};

export const activityLabels: Record<ActivityKind, string> = {
  document: "공시",
  analysis: "분석",
  news: "뉴스",
  calendar: "일정",
};

export function resourceActivity(item: Resource, kind: "document" | "analysis"): HomeActivity {
  return {
    key: `${item.kind}:${item.id}`,
    kind,
    companyId: item.company_id,
    companyName: item.company_name,
    ticker: item.ticker,
    title: item.title,
    href: resourceHref(item),
    // An analysis becomes available on approval, not on the source filing date.
    date: kind === "analysis" ? item.reviewed_at ?? null : item.published_at,
    precision: kind === "analysis" ? "timestamp" : item.publication_precision,
    external: false,
  };
}

export function newsActivities(
  response: NewsResponse | null,
  company: Pick<Resource, "id" | "company_name" | "ticker"> | undefined,
): HomeActivity[] {
  if (!response || !company) return [];
  return response.items.map((item) => ({
    key: `news:${company.id}:${item.originalLink ?? item.link}`,
    kind: "news",
    companyId: company.id,
    companyName: company.company_name,
    ticker: company.ticker,
    title: item.title,
    href: item.originalLink ?? item.link,
    date: item.publishedAt,
    precision: "timestamp",
    external: true,
  }));
}

export function calendarActivity(
  item: z.infer<typeof verifiedCalendarSchema> & { company_name: string },
): HomeActivity {
  return {
    key: `calendar:${item.id}`,
    kind: "calendar",
    companyId: item.company_id,
    companyName: item.company_name,
    ticker: "",
    title: item.title,
    href: calendarHref(item),
    date: item.occurs_on,
    precision: "date",
    external: false,
  };
}

function activityInstant(item: HomeActivity): number {
  if (!item.date) return -Infinity;
  const value = new Date(
    item.precision === "date" ? `${item.date.slice(0, 10)}T00:00:00+09:00` : item.date,
  ).getTime();
  return Number.isFinite(value) ? value : -Infinity;
}

/** Preserve canonical identity across previews; never count the same row twice. */
export function combineActivities(...groups: ReadonlyArray<ReadonlyArray<HomeActivity>>): HomeActivity[] {
  const unique = new Map(groups.flat().map((item) => [item.key, item]));
  return [...unique.values()].sort((a, b) => {
    const left = activityInstant(a), right = activityInstant(b);
    return (left === right ? 0 : left > right ? -1 : 1) || a.key.localeCompare(b.key);
  });
}

/** The overview may fall back to all companies. The watchlist remains authoritative. */
export function followingActivities(
  monitoring: ReadonlyArray<z.infer<typeof monitoringSchema>>,
  companies: ReadonlyArray<Company>,
  news: ReadonlyArray<HomeActivity> = [],
): HomeActivity[] {
  const followed = new Set(companies.map((company) => company.id));
  const records = monitoring.flatMap((row) => {
    if (!followed.has(row.company_id)) return [];
    const result: HomeActivity[] = [];
    if (row.latest_filing?.company_id === row.company_id)
      result.push(resourceActivity(row.latest_filing, "document"));
    if (row.latest_analysis?.company_id === row.company_id)
      result.push(resourceActivity(row.latest_analysis, "analysis"));
    return result;
  });
  return combineActivities(records, news.filter((item) => followed.has(item.companyId)));
}

/** Null means the Calendar's all-company scope; an empty list means no followed companies. */
export function upcomingCompanyEvents(
  items: ReadonlyArray<CalendarEntry>,
  companies: ReadonlyArray<Company> | null,
  from: string,
  until: string,
): CalendarEntry[] {
  const followed = companies === null ? null : new Set(companies.map((company) => company.id));
  return items.filter((item) =>
    item.origin !== "user" && item.company_id !== null && (followed === null || followed.has(item.company_id)) &&
    item.occurs_on >= from && item.occurs_on <= until,
  ).sort((a, b) => a.occurs_on.localeCompare(b.occurs_on) || a.id.localeCompare(b.id));
}

export function activityDay(item: HomeActivity): string | null {
  if (!item.date) return null;
  try { return dayInZone(item.precision === "date" ? item.date.slice(0, 10) : item.date); } catch { return null; }
}

/** Never turn a DATE-only source into an invented hours/minutes-ago timestamp. */
export function activityWhen(item: HomeActivity, now: Date): string {
  const day = activityDay(item);
  if (!day) return "날짜 미제공";
  const elapsed = now.getTime() - activityInstant(item);
  if (item.precision !== "date" && elapsed >= 0 && elapsed < 864e5) {
    if (elapsed < 6e4) return "방금 전";
    if (elapsed < 36e5) return `${Math.floor(elapsed / 6e4)}분 전`;
    return `${Math.floor(elapsed / 36e5)}시간 전`;
  }
  return day.replaceAll("-", ". ");
}
