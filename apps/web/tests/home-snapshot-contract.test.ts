import { describe, expect, it } from "vitest";
import { homeSnapshotSchema } from "../src/redesign/home-snapshot-contract";

function response() {
  const catalog = { items: [], total: 0, counts: {}, markets: [], categories: [], next_offset: null };
  return {
    as_of: "2026-11-09T03:00:00Z",
    today: "2026-11-09",
    watchlist: { id: "synthetic-list", name: "관심종목", items: [] },
    monitoring: [],
    directory: catalog,
    documents: catalog,
    analyses: catalog,
    saved: { items: [], counts: { event: 0, document: 0, analysis: 0, history: 0 } },
    notifications: { items: [], unread_count: 0 },
    dashboard: {
      as_of: "2026-11-09T03:00:00Z", timezone: "Asia/Seoul",
      start_date: "2026-10-11", end_date: "2026-11-09",
      filing_count: 0, analysis_count: 0, event_count: 0,
      filings: [], analyses: [], events: [],
    },
  };
}

describe("Home snapshot response boundary", () => {
  it("accepts verified empty data without inventing missing widgets", () => {
    expect(homeSnapshotSchema.parse(response())).toEqual(response());
    for (const key of ["watchlist", "monitoring", "directory", "documents", "analyses", "saved", "notifications", "dashboard"]) {
      const incomplete: Record<string, unknown> = response();
      delete incomplete[key];
      expect(homeSnapshotSchema.safeParse(incomplete).success, key).toBe(false);
    }
  });

  it("rejects a response for an incoherent default date window", () => {
    for (const patch of [{ start_date: "2026-10-10" }, { end_date: "2026-11-08" }]) {
      const value = response();
      expect(homeSnapshotSchema.safeParse({ ...value, dashboard: { ...value.dashboard, ...patch } }).success).toBe(false);
    }
    expect(homeSnapshotSchema.safeParse({ ...response(), today: "2026-02-30" }).success).toBe(false);
    expect(homeSnapshotSchema.safeParse({ ...response(), as_of: "unknown" }).success).toBe(false);
  });

  it("requires validated notification counts and approved-resource DTOs in every slice", () => {
    const value = response();
    expect(homeSnapshotSchema.safeParse({ ...value, notifications: { items: [], unread_count: -1 } }).success).toBe(false);
    const privateRecord = { id: "synthetic-private-row", provider_payload: "not a customer DTO" };
    for (const key of ["directory", "documents", "analyses", "saved"] as const) {
      expect(homeSnapshotSchema.safeParse({ ...value, [key]: { ...value[key], items: [privateRecord] } }).success, key).toBe(false);
    }
  });
});
