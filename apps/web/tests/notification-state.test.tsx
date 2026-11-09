import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { contentNotificationsSchema, type WorkspaceRequest } from "../src/workspace/contracts";
import { markContentNotificationRead, useContentNotifications } from "../src/workspace/notification-state";
import { DesktopShell } from "../src/desktop/shell";
import { pageDataCache } from "../src/lib/page-data-cache";
import { homeSnapshotKey, loadHomeSnapshot, useHomeSnapshot } from "../src/redesign/home-snapshot";
import { homeSnapshotSchema } from "../src/redesign/home-snapshot-contract";
import { rangeStart } from "../src/redesign/dashboard-contract";

const mocks = vi.hoisted(() => ({ workspace: vi.fn(), token: "synthetic-account-a" }));
vi.mock("@/components/auth", () => ({ useAuth: () => ({
  token: mocks.token,
  me: { id: "synthetic-account", display_name: "Synthetic", onboarding_completed: true },
  loading: false,
}) }));
vi.mock("@/workspace/client", () => ({ workspace: mocks.workspace }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/settings/account",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/workspace/preferences", () => ({ usePrefs: () => ({ text: (ko: string) => ko }) }));

type Notifications = z.infer<typeof contentNotificationsSchema>;
const firstId = "80000000-0000-4000-8000-000000000001";
const secondId = "80000000-0000-4000-8000-000000000002";
const unread: Notifications = {
  unread_count: 2,
  items: [firstId, secondId].map((id) => ({
    id,
    created_at: "2026-11-01T00:00:00Z",
    read_at: null,
    resource: {
      id: "40000000-0000-4000-8000-000000000001",
      kind: "us_analysis",
      title: "Synthetic notification",
      summary: "Synthetic test fixture",
      company_id: "20000000-0000-4000-8000-000000000001",
      company_name: "Synthetic company",
      ticker: "TEST",
      market: "NASDAQ",
      source_url: null,
      published_at: null,
      publication_precision: "date",
      category: "analysis",
      is_saved: false,
    },
  })),
};
const read: Notifications = {
  unread_count: 0,
  items: unread.items.map((item) => ({ ...item, read_at: "2026-11-02T00:00:00Z" })),
};

const today = "2026-11-09";
function homeSnapshot(notifications: Notifications = unread) {
  const catalog = { items: [], total: 0, counts: {}, markets: [], next_offset: null };
  return homeSnapshotSchema.parse({
    as_of: "2026-11-09T00:30:00Z", today, watchlist: { id: "list", name: "Watchlist", items: [] },
    monitoring: [], directory: catalog, documents: catalog, analyses: catalog,
    saved: { items: [], counts: { event: 0, document: 0, analysis: 0, history: 0 } }, notifications,
    dashboard: { as_of: "2026-11-09T00:30:00Z", timezone: "Asia/Seoul", start_date: rangeStart(today, 30), end_date: today,
      filing_count: 0, analysis_count: 0, event_count: 0, filings: [], analyses: [], events: [] },
  });
}
function Consumer({ name, home = false, ready = true }: { name: string; home?: boolean; ready?: boolean }) {
  const state = useContentNotifications(true, home ? { homeToday: today, homeReady: ready } : {});
  return <div data-testid={name}>
    <output aria-label={`${name} unread`}>{state.data?.unread_count ?? "loading"}</output>
    <output aria-label={`${name} rows`}>{state.data?.items.filter((item) => !item.read_at).length ?? "loading"}</output>
    {state.error && <p role="alert">{state.error}</p>}
  </div>;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function HomeReader() {
  const snapshot = useHomeSnapshot(today);
  return <output aria-label="Home state">{snapshot.data ? "ready" : "loading"}</output>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.workspace.mockReset();
  pageDataCache.reset();
  mocks.token = "synthetic-account-a";
  localStorage.clear();
  mocks.workspace.mockImplementation(async (_token: string, request: WorkspaceRequest) =>
    request.action === "content_notifications" ? structuredClone(unread)
      : request.action === "home_snapshot" ? homeSnapshot() : { updated: true });
});
afterEach(() => cleanup());

describe("confirmed notification read state", () => {
  it("updates bell and list immediately after confirmation, keeping other unread rows and older totals", async () => {
    mocks.workspace.mockResolvedValueOnce({ ...unread, unread_count: 102 });
    render(<><Consumer name="bell" /><Consumer name="list" /></>);
    await waitFor(() => expect(screen.getByLabelText("bell unread")).toHaveTextContent("102"));
    await waitFor(() => expect(screen.getByLabelText("list unread")).toHaveTextContent("102"));
    // Hold revalidation: the persisted write itself must update every mounted consumer.
    mocks.workspace.mockImplementation((_token: string, request: WorkspaceRequest) =>
      request.action === "content_notifications" ? new Promise(() => {}) : Promise.resolve({ updated: true }));
    await act(() => markContentNotificationRead(mocks.token, firstId));
    for (const name of ["bell", "list"]) {
      expect(screen.getByLabelText(`${name} unread`)).toHaveTextContent("101");
      expect(screen.getByLabelText(`${name} rows`)).toHaveTextContent("1");
    }
    // A repeated acknowledgement must not decrement the total twice.
    await act(() => markContentNotificationRead(mocks.token, firstId));
    expect(screen.getByLabelText("bell unread")).toHaveTextContent("101");
    await act(() => markContentNotificationRead(mocks.token));
    for (const name of ["bell", "list"]) {
      expect(screen.getByLabelText(`${name} unread`)).toHaveTextContent("0");
      expect(screen.getByLabelText(`${name} rows`)).toHaveTextContent("0");
    }
    const signal = localStorage.getItem("signalbrief:notifications-updated");
    expect(signal).toBeTruthy();
    expect(signal).not.toContain(mocks.token);
    expect(signal).not.toContain(firstId);
  });

  it("leaves every unread state unchanged and sends no cross-tab signal when the write fails", async () => {
    render(<><Consumer name="bell" /><Consumer name="list" /></>);
    await waitFor(() => expect(screen.getByLabelText("list unread")).toHaveTextContent("2"));
    mocks.workspace.mockRejectedValueOnce(new Error("Read failed"));
    await expect(markContentNotificationRead(mocks.token)).rejects.toThrow("Read failed");
    expect(screen.getByLabelText("bell unread")).toHaveTextContent("2");
    expect(screen.getByLabelText("list rows")).toHaveTextContent("2");
    expect(localStorage.getItem("signalbrief:notifications-updated")).toBeNull();
  });

  it("ignores a response started before a confirmed read, even while revalidation is pending", async () => {
    render(<Consumer name="bell" />);
    await waitFor(() => expect(screen.getByLabelText("bell unread")).toHaveTextContent("2"));
    const stale = deferred<Notifications>(), fresh = deferred<Notifications>();
    mocks.workspace.mockImplementation((_token: string, request: WorkspaceRequest) =>
      request.action === "content_notifications" ? fresh.promise : Promise.resolve({ updated: true }));
    mocks.workspace.mockReturnValueOnce(stale.promise);
    fireEvent.focus(window);
    await waitFor(() => expect(mocks.workspace).toHaveBeenCalledTimes(2));
    await act(() => markContentNotificationRead(mocks.token));
    expect(screen.getByLabelText("bell unread")).toHaveTextContent("0");
    await act(async () => { stale.resolve(unread); await stale.promise; });
    expect(screen.getByLabelText("bell unread")).toHaveTextContent("0");
    await act(async () => { fresh.resolve(read); await fresh.promise; });
    expect(screen.getByLabelText("bell unread")).toHaveTextContent("0");
  });

  it("revalidates reads made elsewhere on focus, visibility and cross-tab storage changes", async () => {
    render(<Consumer name="bell" />);
    await waitFor(() => expect(screen.getByLabelText("bell unread")).toHaveTextContent("2"));
    mocks.workspace.mockResolvedValue(read);
    fireEvent.focus(window);
    await waitFor(() => expect(screen.getByLabelText("bell unread")).toHaveTextContent("0"));
    mocks.workspace.mockResolvedValue(unread);
    fireEvent(window, new StorageEvent("storage", { key: "signalbrief:notifications-updated", newValue: "other-tab" }));
    await waitFor(() => expect(screen.getByLabelText("bell unread")).toHaveTextContent("2"));
    mocks.workspace.mockResolvedValue(read);
    fireEvent(document, new Event("visibilitychange"));
    await waitFor(() => expect(screen.getByLabelText("bell unread")).toHaveTextContent("0"));
  });

  it("does not expose a previous account's response or confirmation after an account change", async () => {
    const previous = deferred<Notifications>(), next = deferred<Notifications>();
    mocks.workspace.mockImplementation((token: string, request: WorkspaceRequest) =>
      request.action !== "content_notifications" ? Promise.resolve({ updated: true })
        : token === "synthetic-account-a" ? previous.promise : next.promise);
    const view = render(<Consumer name="bell" />);
    mocks.token = "synthetic-account-b";
    view.rerender(<Consumer name="bell" />);
    await act(async () => { previous.resolve(unread); await previous.promise; });
    expect(screen.getByLabelText("bell unread")).toHaveTextContent("loading");
    await act(() => markContentNotificationRead("synthetic-account-a"));
    expect(screen.getByLabelText("bell unread")).toHaveTextContent("loading");
    await act(async () => { next.resolve(read); await next.promise; });
    expect(screen.getByLabelText("bell unread")).toHaveTextContent("0");
  });

  it("keeps the live desktop settings/help bell in sync on focus and cross-tab reads", async () => {
    render(<DesktopShell><p>Synthetic settings page</p></DesktopShell>);
    const bell = await screen.findByRole("link", { name: "알림 센터 · 읽지 않은 알림 2개" });
    expect(bell.querySelector("i")).not.toBeNull();
    mocks.workspace.mockResolvedValue(read);
    fireEvent.focus(window);
    await waitFor(() => expect(bell).toHaveAccessibleName("알림 센터"));
    expect(bell.querySelector("i")).toBeNull();
    mocks.workspace.mockResolvedValue(unread);
    fireEvent(window, new StorageEvent("storage", { key: "signalbrief:notifications-updated", newValue: "other-tab" }));
    await waitFor(() => expect(bell).toHaveAccessibleName("알림 센터 · 읽지 않은 알림 2개"));
    mocks.workspace.mockImplementation((_token: string, request: WorkspaceRequest) =>
      request.action === "content_notifications" ? new Promise(() => {}) : Promise.resolve({ updated: true }));
    await act(() => markContentNotificationRead(mocks.token));
    expect(bell).toHaveAccessibleName("알림 센터");
    expect(bell.querySelector("i")).toBeNull();
  });
});

describe("shared notification reads", () => {
  it("uses one Home snapshot for the header, list, and default widgets, then dedicated notification refresh", async () => {
    render(<><Consumer name="bell" home /><Consumer name="list" home /><HomeReader /></>);
    await waitFor(() => expect(screen.getByLabelText("Home state")).toHaveTextContent("ready"));
    expect(screen.getByLabelText("bell unread")).toHaveTextContent("2");
    expect(screen.getByLabelText("list unread")).toHaveTextContent("2");
    expect(mocks.workspace.mock.calls.map(([, request]) => request.action)).toEqual(["home_snapshot"]);
    mocks.workspace.mockResolvedValue(read);
    fireEvent.focus(window);
    await waitFor(() => expect(screen.getByLabelText("list unread")).toHaveTextContent("0"));
    expect(mocks.workspace.mock.calls.map(([, request]) => request.action)).toEqual(["home_snapshot", "content_notifications"]);
    expect(pageDataCache.peek<ReturnType<typeof homeSnapshot>>(mocks.token, homeSnapshotKey(today))?.notifications.unread_count).toBe(0);
  });

  it("renders prepared snapshot notifications synchronously before a notification consumer has mounted", async () => {
    pageDataCache.reset(mocks.token);
    await loadHomeSnapshot(mocks.token, today);
    render(<Consumer name="prepared" home />);
    expect(screen.getByLabelText("prepared unread")).toHaveTextContent("2");
    await act(async () => {});
    expect(mocks.workspace).toHaveBeenCalledTimes(1);
  });

  it("does not let a pending pre-ack Home response restore unread rows", async () => {
    const old = deferred<ReturnType<typeof homeSnapshot>>(), fresh = deferred<Notifications>();
    mocks.workspace.mockImplementation((_token: string, request: WorkspaceRequest) =>
      request.action === "home_snapshot" ? old.promise : request.action === "content_notifications" ? fresh.promise : Promise.resolve({ updated: true }));
    render(<><Consumer name="bell" home /><Consumer name="list" home /><HomeReader /></>);
    await waitFor(() => expect(mocks.workspace).toHaveBeenCalledTimes(1));
    await act(() => markContentNotificationRead(mocks.token));
    await waitFor(() => expect(mocks.workspace.mock.calls.some(([, request]) => request.action === "content_notifications")).toBe(true));
    await act(async () => { old.resolve(homeSnapshot()); await old.promise; });
    expect(screen.getByLabelText("bell unread")).not.toHaveTextContent("2");
    expect(screen.getByLabelText("list unread")).not.toHaveTextContent("2");
    expect(pageDataCache.peek(mocks.token, homeSnapshotKey(today))).toBeUndefined();
    await act(async () => { fresh.resolve(read); await fresh.promise; });
    expect(screen.getByLabelText("bell unread")).toHaveTextContent("0");
    expect(screen.getByLabelText("list unread")).toHaveTextContent("0");
  });

  it("does not let an older dedicated notification response overwrite the acknowledged Home snapshot", async () => {
    render(<Consumer name="bell" home />);
    await waitFor(() => expect(screen.getByLabelText("bell unread")).toHaveTextContent("2"));
    const old = deferred<Notifications>(), fresh = deferred<Notifications>();
    mocks.workspace.mockImplementation((_token: string, request: WorkspaceRequest) =>
      request.action === "content_notifications" ? fresh.promise : Promise.resolve({ updated: true }));
    mocks.workspace.mockReturnValueOnce(old.promise);
    fireEvent.focus(window);
    await waitFor(() => expect(mocks.workspace).toHaveBeenCalledTimes(2));
    await act(() => markContentNotificationRead(mocks.token));
    expect(screen.getByLabelText("bell unread")).toHaveTextContent("0");
    await act(async () => { old.resolve(unread); await old.promise; });
    expect(pageDataCache.peek<ReturnType<typeof homeSnapshot>>(mocks.token, homeSnapshotKey(today))?.notifications.unread_count).toBe(0);
    await act(async () => { fresh.resolve(read); await fresh.promise; });
    expect(screen.getByLabelText("bell unread")).toHaveTextContent("0");
  });

  it("retries an early onboarding prerequisite only after the profile is confirmed", async () => {
    mocks.token = "early-header"; pageDataCache.reset(mocks.token);
    const early = deferred<ReturnType<typeof homeSnapshot>>();
    mocks.workspace.mockReturnValueOnce(early.promise);
    const view = render(<Consumer name="bell" home ready={false} />);
    await waitFor(() => expect(mocks.workspace).toHaveBeenCalledTimes(1));
    view.rerender(<Consumer name="bell" home ready />);
    await act(async () => {});
    await act(async () => { early.reject(Object.assign(new Error("onboarding_required"), { status: 403, code: "onboarding_required" })); });
    await waitFor(() => expect(screen.getByLabelText("bell unread")).toHaveTextContent("2"));
    expect(mocks.workspace.mock.calls.map(([, request]) => request.action)).toEqual(["home_snapshot", "home_snapshot"]);
  });

  it.each([401, 403, 429])("does not fall back to another notification endpoint after Home rejects with %s", async status => {
    mocks.workspace.mockRejectedValue(Object.assign(new Error("protected Home read"), { status, code: "access_denied" }));
    render(<Consumer name="bell" home />);
    expect(await screen.findByRole("alert")).toHaveTextContent("protected Home read");
    expect(mocks.workspace.mock.calls.map(([, request]) => request.action)).toEqual(["home_snapshot"]);
  });

  it("falls back to the independent notification read for a recoverable Home service outage", async () => {
    mocks.workspace.mockRejectedValueOnce(Object.assign(new Error("Home unavailable"), { status: 503, code: "workspace_unavailable" }));
    render(<Consumer name="bell" home />);
    await waitFor(() => expect(screen.getByLabelText("bell unread")).toHaveTextContent("2"));
    expect(mocks.workspace.mock.calls.map(([, request]) => request.action)).toEqual(["home_snapshot", "content_notifications"]);
  });

  it("shares one initial request and one event refresh between the header and page", async () => {
    const pending = deferred<Notifications>();
    mocks.workspace.mockReturnValueOnce(pending.promise);
    render(<><Consumer name="bell" /><Consumer name="list" /></>);
    await waitFor(() => expect(mocks.workspace).toHaveBeenCalledTimes(1));
    await act(async () => { pending.resolve(unread); await pending.promise; });
    expect(screen.getByLabelText("bell unread")).toHaveTextContent("2");
    expect(screen.getByLabelText("list unread")).toHaveTextContent("2");
    mocks.workspace.mockResolvedValue(read);
    fireEvent.focus(window);
    await waitFor(() => expect(screen.getByLabelText("list unread")).toHaveTextContent("0"));
    expect(screen.getByLabelText("bell unread")).toHaveTextContent("0");
    expect(mocks.workspace).toHaveBeenCalledTimes(2);
  });

  it("renders previously loaded notifications synchronously on a return visit", async () => {
    const first = render(<Consumer name="first" />);
    await waitFor(() => expect(screen.getByLabelText("first unread")).toHaveTextContent("2"));
    first.unmount();
    render(<Consumer name="return" />);
    expect(screen.getByLabelText("return unread")).toHaveTextContent("2");
    await act(async () => {});
    expect(mocks.workspace).toHaveBeenCalledTimes(1);
  });

  it("keeps confirmed reads in the cached snapshot while a return visit revalidates", async () => {
    const first = render(<Consumer name="first" />);
    await waitFor(() => expect(screen.getByLabelText("first unread")).toHaveTextContent("2"));
    first.unmount();
    mocks.workspace.mockImplementation((_token: string, request: WorkspaceRequest) =>
      request.action === "content_notifications" ? new Promise(() => {}) : Promise.resolve({ updated: true }));
    await act(() => markContentNotificationRead(mocks.token, firstId));
    render(<Consumer name="return" />);
    expect(screen.getByLabelText("return unread")).toHaveTextContent("1");
    expect(screen.getByLabelText("return rows")).toHaveTextContent("1");
  });

  it("does not discard already loaded rows when background revalidation fails", async () => {
    render(<Consumer name="bell" />);
    await waitFor(() => expect(screen.getByLabelText("bell unread")).toHaveTextContent("2"));
    mocks.workspace.mockRejectedValueOnce(new Error("Synthetic notification outage"));
    fireEvent.focus(window);
    expect(await screen.findByRole("alert")).toHaveTextContent("Synthetic notification outage");
    expect(screen.getByLabelText("bell unread")).toHaveTextContent("2");
  });
});
