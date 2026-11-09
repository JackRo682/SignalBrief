import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { calendarDataKey, loadCalendarData, useCalendarCoverage, useCalendarData } from "@/redesign/calendar-data";
import { pageDataCache } from "@/lib/page-data-cache";

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
  pageDataCache.reset();
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

describe("calendar navigation cache", () => {
  const range = { from: "2026-11-01", until: "2026-11-30" };

  it("uses a prefetched result on the first render without another database read", async () => {
    await loadCalendarData(mocks.token!, range);
    const { result } = renderHook(() => useCalendarData(range));
    expect(result.current.data?.items).toEqual([row]);
    expect(result.current.loading).toBe(false);
    await act(async () => {});
    expect(mocks.from).toHaveBeenCalledTimes(1);
  });

  it("deduplicates concurrent readers and keeps the request alive when one leaves", async () => {
    let finish!: (value: unknown) => void;
    mocks.result.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const first = renderHook(() => useCalendarData(range));
    const second = renderHook(() => useCalendarData(range));
    await waitFor(() => expect(mocks.from).toHaveBeenCalledTimes(1));
    first.unmount();
    const signal = mocks.queries[0].abortSignal.mock.calls[0][0] as AbortSignal;
    expect(signal.aborted).toBe(false);
    await act(async () => finish({ data: [row], error: null }));
    expect(second.result.current.data?.items).toEqual([row]);
    expect(second.result.current.loading).toBe(false);
  });

  it("keeps previous values visible during a stale refresh and then replaces them", async () => {
    vi.useFakeTimers();
    await loadCalendarData(mocks.token!, range);
    vi.advanceTimersByTime(60_001);
    let finish!: (value: unknown) => void;
    mocks.result.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const { result } = renderHook(() => useCalendarData(range));
    expect(result.current.data?.items).toEqual([row]);
    expect(result.current.loading).toBe(false);
    await act(async () => {});
    expect(mocks.from).toHaveBeenCalledTimes(2);
    const updated = { ...row, title: "Freshly confirmed date" };
    await act(async () => finish({ data: [updated], error: null }));
    expect(result.current.data?.items).toEqual([updated]);
  });

  it("shares equivalent scopes while separating dates, order and personal visibility", async () => {
    const a = "00000000-0000-4000-8000-000000000002";
    const b = "00000000-0000-4000-8000-000000000003";
    const query = { ...range, companyIds: [a, b] };
    await loadCalendarData(mocks.token!, query);
    await loadCalendarData(mocks.token!, { until: range.until, companyIds: [b, a], from: range.from, includePersonal: true, order: "asc" });
    expect(mocks.from).toHaveBeenCalledTimes(1);
    expect(calendarDataKey({ ...query, includePersonal: false })).not.toBe(calendarDataKey(query));
    expect(calendarDataKey({ ...query, order: "desc" })).not.toBe(calendarDataKey(query));
    expect(calendarDataKey({ ...query, until: "2026-12-01" })).not.toBe(calendarDataKey(query));
    expect(calendarDataKey({ ...query, companyIds: [] })).not.toBe(calendarDataKey(range));
  });

  it("does not briefly show the previous range when a new range has no cache", async () => {
    const { result, rerender } = renderHook(({ until }) => useCalendarData({ ...range, until }), {
      initialProps: { until: range.until },
    });
    await waitFor(() => expect(result.current.data?.items).toHaveLength(1));
    mocks.result.mockImplementationOnce(() => new Promise(() => {}));
    rerender({ until: "2026-12-31" });
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(true);
  });

  it("forces an explicit fresh read without throwing away unrelated cached tabs", async () => {
    await pageDataCache.request(mocks.token!, "/v1/watchlist", "GET", async () => ({ items: ["kept"] }));
    const { result } = renderHook(() => useCalendarData(range));
    await waitFor(() => expect(result.current.data?.items).toHaveLength(1));
    const updated = { ...row, title: "Refresh result" };
    mocks.result.mockResolvedValueOnce({ data: [updated], error: null });
    await act(async () => result.current.reload());
    expect(mocks.from).toHaveBeenCalledTimes(2);
    expect(result.current.data?.items).toEqual([updated]);
    expect(pageDataCache.peek(mocks.token!, "/v1/watchlist")).toEqual({ items: ["kept"] });
  });

  it("surfaces a failed background refresh alongside the last successful snapshot", async () => {
    await loadCalendarData(mocks.token!, range);
    const { result } = renderHook(() => useCalendarData(range));
    await act(async () => {});
    mocks.result.mockResolvedValueOnce({ data: null, error: { message: "permission denied" } });
    await act(async () => result.current.reload());
    expect(result.current.error).not.toBe("");
    expect(result.current.data?.items).toEqual([row]);
    expect(result.current.loading).toBe(false);
  });

  it("discards an earlier response when an explicit refresh finishes first", async () => {
    let finishEarlier!: (value: unknown) => void;
    mocks.result.mockImplementationOnce(() => new Promise(resolve => { finishEarlier = resolve; }));
    const { result } = renderHook(() => useCalendarData(range));
    await waitFor(() => expect(mocks.from).toHaveBeenCalledTimes(1));
    const updated = { ...row, title: "Newer refresh" };
    mocks.result.mockResolvedValueOnce({ data: [updated], error: null });
    await act(async () => result.current.reload());
    expect(result.current.data?.items).toEqual([updated]);
    await act(async () => finishEarlier({ data: [row], error: null }));
    expect(result.current.data?.items).toEqual([updated]);
    expect(pageDataCache.peek(mocks.token!, calendarDataKey(range))).toEqual({ items: [updated], truncated: false });
  });

  it("uses cached coverage on a return visit but explicit refresh still queries the server", async () => {
    const first = renderHook(() => useCalendarCoverage(null));
    await waitFor(() => expect(first.result.current.data).not.toBeNull());
    first.unmount();
    const second = renderHook(() => useCalendarCoverage(null));
    expect(second.result.current.data?.registered_companies).toBe(7);
    expect(second.result.current.loading).toBe(false);
    await act(async () => {});
    expect(mocks.coverage).toHaveBeenCalledTimes(1);
    await act(async () => second.result.current.reload());
    expect(mocks.coverage).toHaveBeenCalledTimes(2);
  });

  it("clears a cached private date immediately on logout", async () => {
    const { result, rerender } = renderHook(() => useCalendarData(range));
    await waitFor(() => expect(result.current.data?.items).toHaveLength(1));
    mocks.token = null;
    pageDataCache.reset();
    rerender();
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);
  });
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
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("calendar pending collection refresh", () => {
  const companyId = "00000000-0000-4000-8000-000000000002";
  const coverage = (pending: boolean) => ({ data: {
    registered_companies: 2, covered_companies: 2, pending_companies: pending ? 1 : 0,
    selected: { company_id: companyId, source_count: 1, last_success_at: null, has_error: false, pending },
  }, error: null });

  it("refreshes the open date query when background collection finishes without a page reload", async () => {
    vi.useFakeTimers();
    mocks.coverage.mockResolvedValueOnce(coverage(true)).mockResolvedValue(coverage(false));
    mocks.result.mockResolvedValueOnce({ data: [], error: null }).mockResolvedValue({ data: [row], error: null });
    const { result } = renderHook(() => {
      const status = useCalendarCoverage(companyId);
      const dates = useCalendarData({ from: "2026-11-01", until: "2026-11-30" }, status.collectionRevision);
      return { status, dates };
    });
    await act(async () => {});
    expect(result.current.status.polling).toBe(true);
    expect(result.current.dates.data?.items).toEqual([]);
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(result.current.status.polling).toBe(false);
    expect(result.current.status.data?.selected?.pending).toBe(false);
    expect(result.current.dates.data?.items).toEqual([row]);
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(mocks.coverage).toHaveBeenCalledTimes(2);
    expect(mocks.from).toHaveBeenCalledTimes(2);
  });

  it("does not poll an unsupported selected issuer just because another company is pending", async () => {
    vi.useFakeTimers();
    mocks.coverage.mockResolvedValue({ data: { ...coverage(false).data, pending_companies: 1,
      selected: { ...coverage(false).data.selected, source_count: 0 } }, error: null });
    const { result } = renderHook(() => useCalendarCoverage(companyId));
    await act(async () => {});
    await act(async () => { await vi.advanceTimersByTimeAsync(120000); });
    expect(result.current.polling).toBe(false);
    expect(mocks.coverage).toHaveBeenCalledTimes(1);
  });

  it("bounds automatic reads while preserving pending status and an explicit retry", async () => {
    vi.useFakeTimers();
    mocks.coverage.mockResolvedValue(coverage(true));
    const { result } = renderHook(() => useCalendarCoverage(null));
    await act(async () => {});
    await act(async () => { await vi.advanceTimersByTimeAsync(120000); });
    expect(mocks.coverage).toHaveBeenCalledTimes(13);
    expect(result.current.data?.pending_companies).toBe(1);
    expect(result.current.polling).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(120000); });
    expect(mocks.coverage).toHaveBeenCalledTimes(13);
    mocks.coverage.mockResolvedValue(coverage(false));
    await act(async () => { result.current.reload(); });
    expect(mocks.coverage).toHaveBeenCalledTimes(14);
    expect(result.current.data?.pending_companies).toBe(0);
  });

  it("cancels pending polling when the selected company changes or the view unmounts", async () => {
    vi.useFakeTimers();
    mocks.coverage.mockResolvedValueOnce(coverage(true)).mockResolvedValue(coverage(false));
    const { result, rerender, unmount } = renderHook(({ id }) => useCalendarCoverage(id), { initialProps: { id: companyId } });
    await act(async () => {});
    rerender({ id: "00000000-0000-4000-8000-000000000003" });
    await act(async () => {});
    expect(result.current.polling).toBe(false);
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(120000); });
    expect(mocks.coverage).toHaveBeenCalledTimes(2);
  });

  it("stops automatic reads on a status error and keeps the date read independent", async () => {
    vi.useFakeTimers();
    mocks.coverage.mockResolvedValueOnce(coverage(true)).mockResolvedValue({ data: null, error: { message: "Unavailable" } });
    const { result } = renderHook(() => useCalendarCoverage(companyId));
    await act(async () => {});
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(result.current.error).not.toBe("");
    expect(result.current.polling).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(120000); });
    expect(mocks.coverage).toHaveBeenCalledTimes(2);
    expect(mocks.from).not.toHaveBeenCalled();
  });
});

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
