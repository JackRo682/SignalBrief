import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCalendarData } from "@/redesign/calendar-data";

const mocks = vi.hoisted(() => ({
  token: "synthetic-account-a" as string | null,
  from: vi.fn(),
  result: vi.fn(),
  queries: [] as Array<Record<string, ReturnType<typeof vi.fn>>>,
}));
vi.mock("@/components/auth", () => ({
  useAuth: () => ({ token: mocks.token }),
}));
vi.mock("@/lib/supabase", () => ({
  initializeSupabase: async () => ({
    from: (...args: unknown[]) => mocks.from(...args),
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
    for (const name of ["select", "eq", "gte", "lte", "order", "limit"])
      query[name] = vi.fn(() => query);
    query.abortSignal = vi.fn(() => mocks.result());
    mocks.queries.push(query);
    return query;
  });
  mocks.result.mockResolvedValue({ data: [row], error: null });
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
