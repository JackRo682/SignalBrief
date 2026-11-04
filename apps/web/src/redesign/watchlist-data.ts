import type { Company } from "@/lib/contracts";
import type { sourceOverviewSchema } from "@/workspace/contracts";
import type { z } from "zod";
import type { CalendarEntry } from "./calendar-utils";

export type WatchlistFilter = "all" | "notifications" | "us" | "kr" | "upcoming";
export type WatchlistSort = "latest" | "name" | "event";
export type CompanyMonitoring = z.infer<typeof sourceOverviewSchema>["monitoring"][number];
const usMarkets = new Set([
  "US", "NASDAQ", "NYSE", "AMEX", "NYSEARCA", "NYSE ARCA", "NYSEAMERICAN",
  "NYSE AMERICAN", "CBOE", "OTC", "OTCQX", "OTCQB", "BATS",
]);
const koreanMarkets = new Set([
  "KR", "KRX", "KOSPI", "KOSDAQ", "KONEX", "KRX:KOSPI", "KRX:KOSDAQ",
  "코스피", "코스닥", "코넥스", "한국",
]);

/** Exchange membership, not the broad directory's overseas classification. */
export function matchesWatchlistFilter(company: Company, filter: WatchlistFilter,
  muted: ReadonlySet<string>, nextEvents: ReadonlyMap<string, CalendarEntry>): boolean {
  if (filter === "notifications") return !muted.has(company.id);
  if (filter === "upcoming") return nextEvents.has(company.id);
  const market = company.market.trim().toUpperCase();
  if (filter === "us") return usMarkets.has(market);
  if (filter === "kr") return koreanMarkets.has(market);
  return true;
}

/** A fallback/overbroad overview must never expand the actual personal watchlist. */
export function watchlistMonitoring(rows: ReadonlyArray<CompanyMonitoring>,
  companies: ReadonlyArray<Company>): Map<string, CompanyMonitoring> {
  const ids = new Set(companies.map(company => company.id));
  return new Map(rows.filter(row => ids.has(row.company_id)).map(row => [row.company_id, {
    ...row,
    latest_filing: row.latest_filing?.company_id === row.company_id ? row.latest_filing : null,
    latest_analysis: row.latest_analysis?.company_id === row.company_id ? row.latest_analysis : null,
  }]));
}

function timestamp(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** An approval is an update; a future event or an ingestion retry is not. */
export function latestWatchlistUpdate(row: CompanyMonitoring | undefined): number {
  return Math.max(timestamp(row?.latest_filing?.published_at),
    timestamp(row?.latest_analysis?.reviewed_at ?? row?.latest_analysis?.published_at));
}

export function compareWatchlistCompanies(a: Company, b: Company, sort: WatchlistSort,
  monitoring: ReadonlyMap<string, CompanyMonitoring>, nextEvents: ReadonlyMap<string, CalendarEntry>): number {
  const name = () => a.name.localeCompare(b.name, "ko") || a.id.localeCompare(b.id);
  if (sort === "latest")
    return latestWatchlistUpdate(monitoring.get(b.id)) - latestWatchlistUpdate(monitoring.get(a.id)) || name();
  if (sort === "event")
    return (nextEvents.get(a.id)?.occurs_on ?? "9999-12-31")
      .localeCompare(nextEvents.get(b.id)?.occurs_on ?? "9999-12-31") || name();
  return name();
}

export function watchlistUpcoming(items: ReadonlyArray<CalendarEntry>, companies: ReadonlyArray<Company>,
  from: string, until: string): CalendarEntry[] {
  const followed = new Set(companies.map(company => company.id)), seen = new Set<string>();
  return items.filter(item => {
    if (item.origin === "user" || !item.company_id || !followed.has(item.company_id) ||
      item.occurs_on < from || item.occurs_on > until || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  }).sort((a, b) => a.occurs_on.localeCompare(b.occurs_on) || a.id.localeCompare(b.id));
}

export function nextWatchlistEvents(items: ReadonlyArray<CalendarEntry>): Map<string, CalendarEntry> {
  const result = new Map<string, CalendarEntry>();
  for (const item of items) {
    if (item.company_id && !result.has(item.company_id)) result.set(item.company_id, item);
  }
  return result;
}

export function recentlyUpdatedCompanies(companies: ReadonlyArray<Company>,
  monitoring: ReadonlyMap<string, CompanyMonitoring>): Company[] {
  return companies.filter(company => latestWatchlistUpdate(monitoring.get(company.id)) > 0)
    .sort((a, b) => compareWatchlistCompanies(a, b, "latest", monitoring, new Map()));
}
