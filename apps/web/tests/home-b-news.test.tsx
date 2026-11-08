import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useHomeBNews } from "../src/redesign/home-b-news";

const auth = vi.hoisted(() => ({ token: "synthetic-account-a" as string | null }));
vi.mock("@/components/auth", () => ({ useAuth: () => ({ token: auth.token }) }));

const firstCompany = "22000000-0000-4000-8000-000000000001";
const nextCompany = "22000000-0000-4000-8000-000000000002";
const fetchMock = vi.fn<typeof fetch>();

function news(title: string) {
  return {
    provider: "NAVER", query: "Synthetic company", retrievedAt: "2026-11-08T00:00:00Z",
    items: [{ title, link: "https://example.com/article", originalLink: null, publishedAt: "2026-11-08T00:00:00Z" }],
  };
}
function response(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  auth.token = "synthetic-account-a";
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Home B news request lifecycle", () => {
  it("waits for authentication and requests the real market endpoint without caching", async () => {
    auth.token = null;
    fetchMock.mockResolvedValue(response(news("Market news")));
    const { result, rerender } = renderHook(() => useHomeBNews(""));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({ data: null, error: "", loading: false });

    auth.token = "synthetic-account-a";
    rerender();
    await waitFor(() => expect(result.current.data?.items[0]?.title).toBe("Market news"));
    expect(fetchMock).toHaveBeenCalledWith(`/api/news?q=${encodeURIComponent("증시")}`, expect.objectContaining({
      headers: { Authorization: "Bearer synthetic-account-a" }, cache: "no-store", signal: expect.any(AbortSignal),
    }));
    expect(result.current.loading).toBe(false);
  });

  it("aborts the old company request and ignores its late response after a company switch", async () => {
    const previous = deferred<Response>(), next = deferred<Response>();
    fetchMock.mockReturnValueOnce(previous.promise).mockReturnValueOnce(next.promise);
    const { result, rerender } = renderHook(({ company }) => useHomeBNews(company), { initialProps: { company: firstCompany } });
    const oldSignal = fetchMock.mock.calls[0][1]?.signal;
    rerender({ company: nextCompany });
    expect(oldSignal?.aborted).toBe(true);
    expect(result.current).toMatchObject({ data: null, loading: true, error: "" });
    expect(fetchMock.mock.calls[1][0]).toBe(`/api/news?company_id=${nextCompany}`);

    await act(async () => { next.resolve(response(news("New company"))); });
    await waitFor(() => expect(result.current.data?.items[0]?.title).toBe("New company"));
    // The provider may finish even when a browser has already cancelled its request.
    await act(async () => { previous.resolve(response(news("Stale company"))); });
    expect(result.current.data?.items[0]?.title).toBe("New company");
    expect(result.current.loading).toBe(false);
  });

  it("hides already loaded results immediately when the selected company changes", async () => {
    const next = deferred<Response>();
    fetchMock.mockResolvedValueOnce(response(news("Previous company"))).mockReturnValueOnce(next.promise);
    const { result, rerender } = renderHook(({ company }) => useHomeBNews(company), { initialProps: { company: firstCompany } });
    await waitFor(() => expect(result.current.data?.items[0]?.title).toBe("Previous company"));
    rerender({ company: nextCompany });
    expect(result.current).toMatchObject({ data: null, loading: true, error: "" });
    await act(async () => { next.resolve(response(news("Selected company"))); });
    await waitFor(() => expect(result.current.data?.items[0]?.title).toBe("Selected company"));
  });

  it("isolates account changes and logout from both loaded data and pending responses", async () => {
    const next = deferred<Response>();
    fetchMock.mockResolvedValueOnce(response(news("Account A"))).mockReturnValueOnce(next.promise);
    const { result, rerender } = renderHook(() => useHomeBNews(firstCompany));
    await waitFor(() => expect(result.current.data?.items[0]?.title).toBe("Account A"));
    auth.token = "synthetic-account-b";
    rerender();
    expect(result.current).toMatchObject({ data: null, loading: true, error: "" });
    expect(fetchMock.mock.calls[1][1]?.headers).toEqual({ Authorization: "Bearer synthetic-account-b" });
    const nextSignal = fetchMock.mock.calls[1][1]?.signal;

    auth.token = null;
    rerender();
    expect(nextSignal?.aborted).toBe(true);
    expect(result.current).toMatchObject({ data: null, loading: false, error: "" });
    await act(async () => { next.resolve(response(news("Account B after logout"))); });
    expect(result.current).toMatchObject({ data: null, loading: false, error: "" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    [429, "뉴스 요청이 많습니다. 잠시 후 다시 시도해 주세요."],
    [422, "이 기업의 공식 뉴스 검색 정보를 확인하지 못했습니다."],
    [503, "뉴스 제공자에 연결하지 못했습니다."],
  ])("reports HTTP %s and recovers through retry", async (status, error) => {
    const retry = deferred<Response>();
    fetchMock.mockResolvedValueOnce(response({ error: "provider_error" }, Number(status))).mockReturnValueOnce(retry.promise);
    const { result } = renderHook(() => useHomeBNews(firstCompany));
    await waitFor(() => expect(result.current.error).toBe(error));
    expect(result.current).toMatchObject({ data: null, loading: false });
    act(() => result.current.reload());
    expect(result.current).toMatchObject({ data: null, loading: true, error: "" });
    await act(async () => { retry.resolve(response(news("Recovered news"))); });
    await waitFor(() => expect(result.current.data?.items[0]?.title).toBe("Recovered news"));
    expect(result.current).toMatchObject({ error: "", loading: false });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    { ...news("Unexpected provider"), provider: "OTHER" },
    { ...news("Unsafe URL"), items: [{ ...news("Unsafe URL").items[0], link: "javascript:alert(1)" }] },
    { ...news("Credentials in URL"), items: [{ ...news("Credentials in URL").items[0], originalLink: "https://user:secret@example.com/" }] },
  ])("rejects invalid provider data without exposing any item", async payload => {
    fetchMock.mockResolvedValue(response(payload));
    const { result } = renderHook(() => useHomeBNews(firstCompany));
    await waitFor(() => expect(result.current.error).toBe("뉴스를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요."));
    expect(result.current).toMatchObject({ data: null, loading: false });
  });

  it.each([
    new TypeError("Failed to fetch https://provider.invalid/internal"),
    new DOMException("Internal timeout details", "TimeoutError"),
  ])("shows a recoverable message without exposing network or timeout diagnostics", async error => {
    fetchMock.mockRejectedValue(error);
    const { result } = renderHook(() => useHomeBNews(firstCompany));
    await waitFor(() => expect(result.current.error).toBe("뉴스를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요."));
    expect(result.current).toMatchObject({ data: null, loading: false });
  });

  it("aborts the active request on unmount even when response parsing has begun", async () => {
    const body = deferred<ReturnType<typeof news>>();
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: () => body.promise } as Response);
    const { unmount } = renderHook(() => useHomeBNews(firstCompany));
    await act(async () => {});
    const signal = fetchMock.mock.calls[0][1]?.signal;
    expect(signal?.aborted).toBe(false);
    unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => { body.resolve(news("Completed after unmount")); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
