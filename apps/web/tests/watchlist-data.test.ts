import { describe, expect, it } from "vitest";
import type { Company } from "../src/lib/contracts";
import { resourceSchema, type Resource } from "../src/workspace/contracts";
import type { CalendarEntry } from "../src/redesign/calendar-utils";
import {
  compareWatchlistCompanies,
  latestWatchlistUpdate,
  matchesWatchlistFilter,
  nextWatchlistEvents,
  recentlyUpdatedCompanies,
  watchlistMonitoring,
  watchlistUpcoming,
  type CompanyMonitoring,
} from "../src/redesign/watchlist-data";

// Synthetic records exercise selection and provenance boundaries, not provider accuracy.
const alpha: Company = {
  id: "21000000-0000-4000-8000-000000000001", name: "Alpha", ticker: "ALPH",
  market: "NASDAQ", provider: "sec", is_demo: true, last_ingested_at: null,
};
const beta: Company = { ...alpha, id: "21000000-0000-4000-8000-000000000002", name: "Beta", ticker: "BETA" };
const outside: Company = { ...alpha, id: "21000000-0000-4000-8000-000000000003", name: "Outside" };
const filing: Resource = resourceSchema.parse({
  id: "31000000-0000-4000-8000-000000000001", kind: "filing", title: "Synthetic official filing", summary: "",
  company_id: alpha.id, company_name: alpha.name, ticker: alpha.ticker, market: alpha.market,
  source_url: "https://example.org/synthetic-filing", published_at: "2026-10-01T00:00:00Z",
  publication_precision: "timestamp", category: "10-Q", is_saved: false,
});
const analysis: Resource = { ...filing, kind: "us_analysis", title: "Synthetic approved analysis", reviewed_at: "2026-11-04T02:00:00Z" };
const event: CalendarEntry = {
  id: "41000000-0000-4000-8000-000000000001", title: "Synthetic confirmed event", occurs_on: "2026-11-10",
  company_id: alpha.id, event_id: null, origin: "official_ir", quote: null,
  source_url: "https://example.org/synthetic-event", source_timezone: "America/New_York", verified_at: "2026-11-01T00:00:00Z",
};
function row(company: Company, patch: Partial<CompanyMonitoring> = {}): CompanyMonitoring {
  return {
    company_id: company.id, latest_filing: null, latest_analysis: null, next_event: null,
    last_collected_at: null, filing_count: 0, analysis_count: 0, ...patch,
  };
}

describe("watchlist data boundaries", () => {
  it("intersects an overbroad response with the watchlist and rejects misattributed nested records", () => {
    const foreign = { ...filing, company_id: outside.id };
    const ownRow = row(alpha, { latest_filing: foreign, latest_analysis: analysis, filing_count: 7, analysis_count: 2 });
    const rows = [ownRow, row(outside, { latest_filing: foreign })];
    const result = watchlistMonitoring(rows, [alpha]);
    expect([...result.keys()]).toEqual([alpha.id]);
    expect(result.get(alpha.id)).toMatchObject({ latest_filing: null, latest_analysis: analysis, filing_count: 7, analysis_count: 2 });
    expect(watchlistMonitoring([row(alpha, { latest_analysis: { ...analysis, company_id: outside.id } })], [alpha]).get(alpha.id)?.latest_analysis).toBeNull();
    expect(watchlistMonitoring(rows, []).size).toBe(0);
    expect(ownRow.latest_filing).toBe(foreign);
  });

  it.each([
    ["NASDAQ", true, false], [" nyse ", true, false], ["US", true, false], ["NYSE ARCA", true, false],
    ["LSE", false, false], ["TSE", false, false], ["KRX", false, true], ["KOSPI", false, true],
    ["KOSDAQ", false, true], ["KR", false, true], ["코스피", false, true], ["", false, false],
  ])("classifies %s by exchange without treating every overseas company as US", (market, us, kr) => {
    expect(matchesWatchlistFilter({ ...alpha, market }, "us", new Set(), new Map())).toBe(us);
    expect(matchesWatchlistFilter({ ...alpha, market }, "kr", new Set(), new Map())).toBe(kr);
  });

  it("uses saved notification preferences and real event membership for its filters", () => {
    const muted = new Set([alpha.id]), next = new Map([[alpha.id, event]]);
    expect(matchesWatchlistFilter(alpha, "notifications", muted, next)).toBe(false);
    expect(matchesWatchlistFilter(beta, "notifications", muted, next)).toBe(true);
    expect(matchesWatchlistFilter(alpha, "upcoming", muted, next)).toBe(true);
    expect(matchesWatchlistFilter(beta, "upcoming", muted, next)).toBe(false);
    expect(matchesWatchlistFilter(alpha, "all", muted, next)).toBe(true);
  });

  it("orders updates by approval or filing time instead of cumulative counts, future dates, or collection retries", () => {
    const first = row(alpha, { latest_filing: filing, latest_analysis: analysis, filing_count: 2, analysis_count: 1 });
    const second = row(beta, {
      latest_filing: { ...filing, company_id: beta.id, published_at: "2026-11-03T12:00:00Z" },
      filing_count: 999, analysis_count: 999, last_collected_at: "2030-01-01T00:00:00Z",
      next_event: { id: event.id, company_id: beta.id, title: event.title, occurs_on: "2030-01-01",
        source_url: "https://example.org/synthetic-future", source_timezone: null, verified_at: "2026-11-01T00:00:00Z" },
    });
    const monitoring = new Map([[alpha.id, first], [beta.id, second], [outside.id, row(outside)]]);
    expect(latestWatchlistUpdate(first)).toBe(Date.parse(analysis.reviewed_at!));
    expect(latestWatchlistUpdate(second)).toBe(Date.parse("2026-11-03T12:00:00Z"));
    expect([beta, outside, alpha].sort((a, b) => compareWatchlistCompanies(a, b, "latest", monitoring, new Map()))).toEqual([alpha, beta, outside]);
    expect(recentlyUpdatedCompanies([beta, outside, alpha], monitoring)).toEqual([alpha, beta]);
    expect(latestWatchlistUpdate(row(outside, { last_collected_at: "2030-01-01T00:00:00Z" }))).toBe(0);
  });

  it("handles missing and malformed update timestamps without inventing recency", () => {
    expect(latestWatchlistUpdate(undefined)).toBe(0);
    expect(latestWatchlistUpdate(row(alpha, { latest_filing: { ...filing, published_at: "invalid" } }))).toBe(0);
    expect(latestWatchlistUpdate(row(alpha, { latest_analysis: { ...analysis, reviewed_at: null } }))).toBe(Date.parse(filing.published_at!));
    expect(latestWatchlistUpdate(row(alpha, { latest_analysis: { ...analysis, reviewed_at: null, published_at: null } }))).toBe(0);
  });

  it("keeps missing event dates last and breaks equal sort keys deterministically", () => {
    const sameName = { ...beta, name: alpha.name };
    const next = new Map([[alpha.id, event], [beta.id, { ...event, company_id: beta.id, occurs_on: "2026-11-06" }]]);
    expect([outside, alpha, beta].sort((a, b) => compareWatchlistCompanies(a, b, "event", new Map(), next))).toEqual([beta, alpha, outside]);
    expect(compareWatchlistCompanies(alpha, sameName, "latest", new Map(), new Map())).toBeLessThan(0);
    expect([beta, alpha].sort((a, b) => compareWatchlistCompanies(a, b, "name", new Map(), next))).toEqual([alpha, beta]);
  });

  it("retains only official followed events within both inclusive date boundaries and deduplicates IDs", () => {
    const first = { ...event, id: "41000000-0000-4000-8000-000000000002", company_id: beta.id, occurs_on: "2026-11-04" };
    const last = { ...event, id: "41000000-0000-4000-8000-000000000003", occurs_on: "2027-11-04" };
    const rows = [last, event, first, event,
      { ...event, id: "personal", origin: "user" },
      { ...event, id: "foreign", company_id: outside.id },
      { ...event, id: "unassigned", company_id: null },
      { ...event, id: "past", occurs_on: "2026-11-03" },
      { ...event, id: "too-late", occurs_on: "2027-11-05" },
    ];
    const result = watchlistUpcoming(rows, [alpha, beta], "2026-11-04", "2027-11-04");
    expect(result).toEqual([first, event, last]);
    expect(watchlistUpcoming(rows, [], "2026-11-04", "2027-11-04")).toEqual([]);
    const next = nextWatchlistEvents(result);
    expect([...next.keys()]).toEqual([beta.id, alpha.id]);
    expect(next.get(alpha.id)).toBe(event);
    expect(next.get(beta.id)).toBe(first);
  });
});
