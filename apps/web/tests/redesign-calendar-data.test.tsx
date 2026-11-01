import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCalendarCoverage, useCalendarData } from "@/redesign/calendar-data";

const mocks = vi.hoisted(() => ({
  token: "synthetic-account-a" as string | null,
  from: vi.fn(),
  rpc: vi.fn(),
  coverage: vi.fn(),
  result: vi.fn(),
  queries: [] as Array<Record<string, ReturnType<typeof vi.fn>>>,
}));
vi.mock("@/components/auth", () => ({
  useAuth: () => ({ token: mocks.token }),
}));
vi.mock("@/lib/supabase", () => ({
  initializeSupabase: async () => ({
    from: (...args: unknown[]) => mocks.from(...args),
    rpc: (...args: unknown[]) => mocks.rpc(...args),
  }),
}));
const row = {
  id: "00000000-0000-4000-8000-000000000001",
  title: "Synthetic private date",
  occurs_on: "2026-11-01",
  company_id: null,
  event_id: null,
  origin: "user",
  quote: null,
  source_url: null,
  source_timezone: null,
  verified_at: null,
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.token = "synthetic-account-a";
  mocks.queries = [];
  mocks.from.mockImplementation(() => {
    const query: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const name of ["select", "eq", "neq", "in", "or", "gte", "lte", "order", "limit"])
      query[name] = vi.fn(() => query);
    query.abortSignal = vi.fn(() => mocks.result());
    mocks.queries.push(query);
    return query;
  });
  mocks.result.mockResolvedValue({ data: [row], error: null });
  mocks.rpc.mockImplementation(() => ({ abortSignal: () => mocks.coverage() }));
  mocks.coverage.mockResolvedValue({ data: {
    registered_companies: 7, covered_companies: 2,
    selected: { company_id: "00000000-0000-4000-8000-000000000002", source_count: 0, last_success_at: null, has_error: false },
  }, error: null });
});

describe("calendar source coverage", () => {
  it("keeps an unconnected company distinct from a verified empty event range", async () => {
    const id = "00000000-0000-4000-8000-000000000002";
    const { result } = renderHook(() => useCalendarCoverage(id));
    await waitFor(() => expect(result.current.data?.selected?.source_count).toBe(0));
    expect(mocks.rpc).toHaveBeenCalledWith("sb_calendar_coverage", { p_company_id: id });
    expect(result.current.data?.registered_companies).toBe(7);
    expect(result.current.data?.covered_companies).toBe(2);
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("reports failed coverage queries without claiming zero coverage or hiding event data", async () => {
    mocks.coverage.mockResolvedValue({ data: null, error: { message: "Unavailable" } });
    const coverage = renderHook(() => useCalendarCoverage(null));
    const calendar = renderHook(() => useCalendarData({ from: "2026-11-01", until: "2026-11-30" }));
    await waitFor(() => expect(coverage.result.current.error).not.toBe(""));
    await waitFor(() => expect(calendar.result.current.data?.items).toHaveLength(1));
    expect(coverage.result.current.data).toBeNull();
    expect(calendar.result.current.error).toBe("");
  });
});
afterEach(() => cleanup());

describe("calendar authenticated read states", () => {
  it("does not issue unauthenticated database reads", () => {
    mocks.token = null;
    const { result } = renderHook(() =>
      useCalendarData({ from: "2026-11-01", until: "2026-11-30" }),
    );
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("applies date boundaries before a bounded query and validates returned records", async () => {
    const { result } = renderHook(() =>
      useCalendarData({ from: "2026-11-01", until: "2026-11-30" }),
    );
    await waitFor(() => expect(result.current.data?.items).toHaveLength(1));
    expect(mocks.from).toHaveBeenCalledWith("calendar_items");
    expect(mocks.queries[0].gte).toHaveBeenCalledWith(
      "occurs_on",
      "2026-11-01",
    );
    expect(mocks.queries[0].lte).toHaveBeenCalledWith(
      "occurs_on",
      "2026-11-30",
    );
    expect(mocks.queries[0].limit).toHaveBeenCalledWith(501);
  });
  it("hides previous-account data immediately and rejects a late previous-account response", async () => {
    let finishA: (value: unknown) => void = () => {},
      finishB: (value: unknown) => void = () => {};
    mocks.result
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishA = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishB = resolve;
          }),
      );
    const { result, rerender } = renderHook(() =>
      useCalendarData({ from: "2026-11-01", until: "2026-11-30" }),
    );
    await waitFor(() => expect(mocks.result).toHaveBeenCalledTimes(1));
    mocks.token = "synthetic-account-b";
    rerender();
    expect(result.current.data).toBeNull();
    await waitFor(() => expect(mocks.result).toHaveBeenCalledTimes(2));
    await act(async () =>
      finishB({
        data: [{ ...row, title: "Synthetic account B date" }],
        error: null,
      }),
    );
    await waitFor(() =>
      expect(result.current.data?.items[0].title).toBe(
        "Synthetic account B date",
      ),
    );
    await act(async () => finishA({ data: [row], error: null }));
    expect(result.current.data?.items[0].title).toBe(
      "Synthetic account B date",
    );
  });
  it("applies selected-company and personal scope before ordering and limiting", async () => {
    const companyId = "00000000-0000-4000-8000-000000000002";
    const { result } = renderHook(() => useCalendarData({
      from: "2026-11-01", until: "2026-11-30", companyIds: [companyId], includePersonal: true,
    }));
    await waitFor(() => expect(result.current.data?.items).toHaveLength(1));
    const query = mocks.queries[0];
    expect(query.or).toHaveBeenCalledWith(`origin.eq.user,company_id.in.(${companyId})`);
    expect(query.or.mock.invocationCallOrder[0]).toBeLessThan(query.limit.mock.invocationCallOrder[0]);
  });
  it("supports a reverse chronological past-only query without including personal dates", async () => {
    const companyId = "00000000-0000-4000-8000-000000000002";
    const { result } = renderHook(() => useCalendarData({
      from: "2026-08-03", until: "2026-10-31", companyIds: [companyId], includePersonal: false, order: "desc",
    }));
    await waitFor(() => expect(result.current.data?.items).toHaveLength(1));
    const query = mocks.queries[0];
    expect(query.in).toHaveBeenCalledWith("company_id", [companyId]);
    expect(query.neq).toHaveBeenCalledWith("origin", "user");
    expect(query.order).toHaveBeenCalledWith("occurs_on", { ascending: false });
    expect(query.in.mock.invocationCallOrder[0]).toBeLessThan(query.limit.mock.invocationCallOrder[0]);
  });
  it("returns a genuine empty selection without falling back to every company's dates", async () => {
    const { result } = renderHook(() => useCalendarData({
      from: "2026-11-01", until: "2026-11-30", companyIds: [], includePersonal: false,
    }));
    await waitFor(() => expect(result.current.data).toEqual({ items: [], truncated: false }));
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("rejects invalid company identifiers before constructing an OR filter", async () => {
    const { result } = renderHook(() => useCalendarData({
      from: "2026-11-01", until: "2026-11-30", companyIds: ["id),origin.eq.official"], includePersonal: true,
    }));
    await waitFor(() => expect(result.current.error).not.toBe(""));
    expect(result.current.data).toBeNull();
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("reports denied reads as errors, not as an empty calendar", async () => {
    mocks.result.mockResolvedValue({
      data: null,
      error: { message: "permission denied" },
    });
    const { result } = renderHook(() => useCalendarData({ id: row.id }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).not.toBe("");
    expect(result.current.data).toBeNull();
  });
  it("detects a 500-row ceiling explicitly", async () => {
    mocks.result.mockResolvedValue({
      data: Array.from({ length: 501 }, () => row),
      error: null,
    });
    const { result } = renderHook(() =>
      useCalendarData({ from: "2026-11-01", until: "2026-11-30" }),
    );
    await waitFor(() => expect(result.current.data?.truncated).toBe(true));
    expect(result.current.data?.items).toHaveLength(500);
  });
});
