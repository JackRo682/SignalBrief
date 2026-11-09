import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pageDataCache } from "@/lib/page-data-cache";
import { useNavigationPrefetch } from "@/redesign/use-navigation-prefetch";

const state = vi.hoisted(() => ({
  token: "synthetic-prefetch-session",
  me: { id: "00000000-0000-4000-8000-000000000001", is_admin: true, onboarding_completed: true },
  loaded: true, prefetch: vi.fn(),
}));
vi.mock("@/components/auth", () => ({ useAuth: () => ({ token: state.token, me: state.me }) }));
vi.mock("@/workspace/preferences", () => ({ usePrefs: () => ({ loaded: state.loaded, value: { timezone: "Asia/Seoul" } }) }));
vi.mock("@/redesign/navigation-data", () => ({
  navigationPaths: ["/today", "/explore", "/watchlist", "/calendar", "/saved"],
  prefetchNavigation: state.prefetch,
}));

const originalConnection = Object.getOwnPropertyDescriptor(navigator, "connection");
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("NEXT_PUBLIC_HOME_AB_MODE", "split");
  vi.stubGlobal("requestIdleCallback", (callback: () => void) => window.setTimeout(callback, 0));
  vi.stubGlobal("cancelIdleCallback", (id: number) => window.clearTimeout(id));
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  Object.defineProperty(navigator, "connection", { configurable: true, value: {} });
  window.history.replaceState({}, "", "/today");
  state.loaded = true;
  state.me = { id: "00000000-0000-4000-8000-000000000001", is_admin: true, onboarding_completed: true };
  state.prefetch.mockReset(); state.prefetch.mockResolvedValue(undefined);
  pageDataCache.reset(state.token);
});
afterEach(() => {
  cleanup(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs();
  if (originalConnection) Object.defineProperty(navigator, "connection", originalConnection);
  else Reflect.deleteProperty(navigator, "connection");
});
const advance = () => act(async () => { await vi.advanceTimersByTimeAsync(600); });

describe("navigation warming priority", () => {
  it("joins pending Home reads before starting the all-company destination", async () => {
    let finish!: () => void;
    state.prefetch.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    renderHook(() => useNavigationPrefetch("/today"));
    await advance();
    expect(state.prefetch.mock.calls.map(call => call[1])).toEqual(["/today"]);
    await act(async () => { finish(); });
    expect(state.prefetch.mock.calls.map(call => call[1])).toEqual(["/today", "/explore", "/watchlist", "/calendar", "/saved"]);
  });

  it("prepares Home first from another route and skips the already visible destination", async () => {
    renderHook(() => useNavigationPrefetch("/calendar"));
    await advance();
    expect(state.prefetch.mock.calls.map(call => call[1])).toEqual(["/today", "/explore", "/watchlist", "/saved"]);
  });

  it("resumes work when an initially hidden document becomes visible", async () => {
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    renderHook(() => useNavigationPrefetch("/today"));
    await advance(); expect(state.prefetch).not.toHaveBeenCalled();
    visibility.mockReturnValue("visible");
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    await advance();
    expect(state.prefetch.mock.calls[0][1]).toBe("/today");
    expect(state.prefetch.mock.calls).toHaveLength(5);
  });

  it("reads the current administrator preview on intent without needing a pathname change", async () => {
    const { result, rerender } = renderHook(() => useNavigationPrefetch("/today"));
    window.history.replaceState({}, "", "/today?home_preview=B");
    await act(async () => { await result.current("/today"); });
    expect(state.prefetch).toHaveBeenLastCalledWith(state.token, "/today", { timezone: "Asia/Seoul", homeVariant: "B" });
    state.me = { ...state.me, is_admin: false }; rerender();
    await act(async () => { await result.current("/today"); });
    expect(state.prefetch).toHaveBeenLastCalledWith(state.token, "/today", { timezone: "Asia/Seoul", homeVariant: "A" });
  });

  it("respects Data Saver for idle work while preserving explicit navigation intent", async () => {
    Object.defineProperty(navigator, "connection", { configurable: true, value: { saveData: true } });
    const { result } = renderHook(() => useNavigationPrefetch("/today"));
    await advance(); expect(state.prefetch).not.toHaveBeenCalled();
    await act(async () => { await result.current("/calendar"); });
    expect(state.prefetch).toHaveBeenCalledExactlyOnceWith(state.token, "/calendar", { timezone: "Asia/Seoul", homeVariant: "A" });
    pageDataCache.reset(null);
    await act(async () => { await result.current("/today"); });
    expect(state.prefetch).toHaveBeenCalledTimes(1);
  });
});
